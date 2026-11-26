"""AI(LLM) 없이 리뷰를 분류하는 파이프라인: 규칙(classify.py) + 고전 머신러닝(TF-IDF + 로지스틱 회귀).

동작 방식 (메인 세션의 '규칙 + AI 수동 판정'에서 AI 자리를 ML 모델로 바꾼 구조)
- 규칙이 확신하는 리뷰(classify.py의 애매 플래그가 없는 리뷰)는 규칙 판정을 그대로 쓴다.
- 애매한 리뷰는 ML 모델 3개로 판정한다.
  1) 전체 감성 (긍정/부정/중립/혼합)
  2) 주제 (복수 선택, 주제마다 이진 분류기)
  3) 주제별 감성 (리뷰 × 주제 쌍마다, 그 주제 키워드가 들어 있는 절을 보고 판정)
- 모델 입력: 글자 n-gram, 단어 n-gram, 형태소(Kiwi) 원형, 별점, 규칙 판정 결과(감성어 개수, 규칙 주제 등).
  모두 AI 없이 계산된다. 필요 패키지: scikit-learn, kiwipiepy

사용법
  python scripts/ml_classify.py eval      # 5-겹 교차검증으로 규칙 단독 대비 정확도 측정 → work/ml_eval.json
  python scripts/ml_classify.py train     # reviews_labeled.csv 전체로 학습 → work/ml_model.joblib
  python scripts/ml_classify.py predict [입력.csv] [출력.csv]
                                  # 기본: data/reviews.csv → data/reviews_labeled_ml.csv (reviews_labeled.csv와 같은 형식)

학습 라벨은 reviews_labeled.csv를 쓴다(규칙 4,319건 + AI 판정 2,030건). AI는 학습 데이터를 만들 때 한 번만 쓰인 것이고,
학습이 끝나면 새 리뷰 분류에는 토큰이 들지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import sys

import joblib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import StratifiedKFold

from classify import INQUIRY, TOPIC_KEYWORDS, classify_row, norm, rule_confident, split_clauses
from merge_labels import OTHER_THRESHOLD, TOPICS, kw_for

sys.stdout.reconfigure(encoding="utf-8")

SENTS = ["긍정", "부정", "중립", "혼합"]
LABELED = "data/reviews_labeled.csv"
MODEL_PATH = "work/ml_model.joblib"
SEED = 2026
# 클래스 가중치: 교차검증에서 "balanced"(희귀 클래스 가중)보다 None이 정확도도 높고, 주제별 부정 건수도
# 정답에 가깝게 나왔다 (balanced는 부정·혼합을 과다 판정해 콘텐츠 부정이 129→332건으로 부풀었음).
CW_SENT, CW_TOPIC, CW_PAIR = None, None, None
# 하이퍼파라미터 (교차검증 실험으로 정함)
C_SENT, C_TOPIC, C_PAIR = 4.0, 4.0, 2.0   # 로지스틱 회귀 규제 강도의 역수 (클수록 학습 데이터에 더 맞춤)
TOPIC_THR = 0.4                            # 주제 확률이 이 값 이상이면 그 주제로 판정
FALLBACK_THR = 0.2                         # 주제가 하나도 안 걸릴 때 최상위 주제를 채택하는 확률 기준
HARD_W = 5.0                               # 학습 때 애매한(규칙이 확신 못 한) 리뷰에 주는 가중치
# 주제별 감성 일관성: 정답 라벨에서 전체 감성이 긍정/부정/중립이면 주제별 감성도 98%가 같았다.
# 그래서 주제별 감성 모델은 '혼합' 리뷰에만 쓰고, 나머지는 전체 감성을 그대로 따른다.
CONSIST = True
USE_KIWI = True  # 형태소(Kiwi) 특징 추가: "어렵다/어려워서/어렵네"를 같은 원형으로 묶는다


_kiwi = None
_morph_cache: dict[str, str] = {}


def morphs(text: str) -> str:
    """형태소 분석 결과를 '원형/품사' 토큰 문자열로. 조사·문장부호는 뺀다."""
    global _kiwi
    if text in _morph_cache:
        return _morph_cache[text]
    if _kiwi is None:
        from kiwipiepy import Kiwi
        _kiwi = Kiwi()
    toks = []
    for t in _kiwi.tokenize(text):
        if t.tag.startswith(("J", "S")) and t.tag not in ("SL", "SN"):
            continue
        toks.append(f"{t.form}/{t.tag[:2]}")
    _morph_cache[text] = out = " ".join(toks)
    return out


# ------------------------------------------------------------------ 규칙 특징
def rule_features(df: pd.DataFrame) -> pd.DataFrame:
    """classify.py 규칙을 돌려 규칙 판정과 보조 특징을 만든다."""
    res = [classify_row(c, int(r)) for c, r in zip(df.content, df.rating)]
    rf = pd.DataFrame(res, index=df.index)
    rf["rule_confident"] = [rule_confident(t, r) for t, r in zip(text_of(df), rf.itertuples())]
    return rf


def text_of(df: pd.DataFrame) -> pd.Series:
    return df.content.fillna("").astype(str)


def dense_feats(df: pd.DataFrame, rf: pd.DataFrame) -> np.ndarray:
    """별점, 규칙 감성, 규칙 주제, 감성어 수, 길이, 문의형 여부."""
    cols = []
    for k in range(1, 6):
        cols.append((df.rating.values == k).astype(float))
    for s in SENTS:
        cols.append((rf.rule_sentiment.values == s).astype(float))
    rt = rf.rule_topics.fillna("").str.split("|")
    for tp in TOPICS:
        cols.append(rt.apply(lambda x: tp in x).astype(float).values)
    cols.append(np.log1p(rf.pos_hits.values.astype(float)))
    cols.append(np.log1p(rf.neg_hits.values.astype(float)))
    L = text_of(df).str.len().values
    cols.append(np.log1p(L) / 6)
    cols.append(text_of(df).str.contains(INQUIRY, regex=True).astype(float).values)
    return np.vstack(cols).T


# ------------------------------------------------------------------ 리뷰 단위 모델 (감성 + 주제)
class ReviewModel:
    def __init__(self, C_sent: float | None = None, C_topic: float | None = None):
        self.C_sent, self.C_topic = C_sent or C_SENT, C_topic or C_TOPIC

    def _vec_fit(self, texts):
        self.v_char = TfidfVectorizer(analyzer="char_wb", ngram_range=(1, 4), min_df=2, sublinear_tf=True,
                                      max_features=150_000)
        self.v_word = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, sublinear_tf=True,
                                      token_pattern=r"(?u)[^\s.,!?~]+")
        self.v_char.fit(texts)
        self.v_word.fit(texts)
        if USE_KIWI:
            self.v_morph = TfidfVectorizer(analyzer=str.split, ngram_range=(1, 1), min_df=2, sublinear_tf=True)
            self.v_morph.fit([morphs(t) for t in texts])
        self.kiwi = USE_KIWI

    def _X(self, df, rf):
        t = text_of(df)
        parts = [self.v_char.transform(t), self.v_word.transform(t)]
        if getattr(self, "kiwi", False):
            parts.append(self.v_morph.transform([morphs(x) for x in t]))
        parts.append(csr_matrix(dense_feats(df, rf) * 2.0))
        return hstack(parts).tocsr()

    def fit(self, df, rf, y_sent, y_topics, w=None):
        self._vec_fit(text_of(df))
        X = self._X(df, rf)
        self.sent = LogisticRegression(C=self.C_sent, max_iter=3000, class_weight=CW_SENT)
        self.sent.fit(X, y_sent, sample_weight=w)
        self.topic = {}
        for tp in TOPICS:
            y = np.array([tp in ts for ts in y_topics], dtype=int)
            m = LogisticRegression(C=self.C_topic, max_iter=3000, class_weight=CW_TOPIC)
            m.fit(X, y, sample_weight=w)
            self.topic[tp] = m
        return self

    def predict(self, df, rf, thr: float | None = None):
        thr = TOPIC_THR if thr is None else thr
        X = self._X(df, rf)
        s = self.sent.predict(X)
        P = np.vstack([self.topic[tp].predict_proba(X)[:, 1] for tp in TOPICS]).T
        topics = []
        for row in P:
            t = [tp for tp, p in zip(TOPICS, row) if p >= thr]
            if not t and row.max() >= FALLBACK_THR:  # 기준을 넘는 주제가 없어도 가장 유력한 주제가 충분히 높으면 채택
                t = [TOPICS[int(row.argmax())]]
            topics.append(t or ["일반"])
        return s, topics


# ------------------------------------------------------------------ 주제별 감성 모델 (리뷰 × 주제 쌍)
def topic_context(text: str, topic: str) -> str:
    """주제 키워드가 들어 있는 절만 모은다. 없으면 전체 텍스트."""
    if topic == "일반":
        return text
    pats = list(TOPIC_KEYWORDS[topic].values())
    cl = [c for c in split_clauses(text) if any(re.search(p, norm(c)) for p in pats)]
    return " / ".join(cl) if cl else text


def pair_rows(df, topics_list, overall, rule_ts):
    rows = []
    for i, (txt, tps, ov, rts) in enumerate(zip(text_of(df), topics_list, overall, rule_ts)):
        rts = dict(x.split(":", 1) for x in rts.split("|")) if isinstance(rts, str) and rts else {}
        for tp in tps:
            rows.append({"i": i, "topic": tp, "ctx": topic_context(txt, tp), "overall": ov,
                         "rule_ts": rts.get(tp, ""), "n_topics": len(tps)})
    return pd.DataFrame(rows)


class PairModel:
    def __init__(self, C: float | None = None):
        self.C = C or C_PAIR

    def _dense(self, P):
        cols = [(P.topic.values == tp).astype(float) for tp in TOPICS + ["일반"]]
        cols += [(P.overall.values == s).astype(float) for s in SENTS]
        cols += [(P.rule_ts.values == s).astype(float) for s in SENTS]
        cols.append((P.n_topics.values == 1).astype(float))
        return np.vstack(cols).T * 2.0

    def _X(self, P):
        return hstack([self.v.transform(P.ctx), csr_matrix(self._dense(P))]).tocsr()

    def fit(self, P, y):
        if CONSIST:  # 혼합 리뷰의 쌍만 학습
            keep = (P.overall.values == "혼합")
            P, y = P[keep].reset_index(drop=True), np.asarray(y)[keep]
        self.v = TfidfVectorizer(analyzer="char_wb", ngram_range=(1, 4), min_df=2, sublinear_tf=True,
                                 max_features=100_000).fit(P.ctx)
        self.m = LogisticRegression(C=self.C, max_iter=3000, class_weight=CW_PAIR).fit(self._X(P), y)
        return self

    def predict(self, P):
        return self.m.predict(self._X(P))


def gold_pairs(lab: pd.DataFrame):
    ts = lab.topic_sentiments.str.split("|").apply(lambda xs: dict(x.split(":", 1) for x in xs))
    return [list(d) for d in ts], [list(d.values()) for d in ts]


# ------------------------------------------------------------------ 하이브리드 판정
def ml_predict(rm: ReviewModel, pm: PairModel, df: pd.DataFrame, rf: pd.DataFrame):
    """ML만으로 (전체 감성 배열, [{주제: 감성}]) 판정."""
    s_ml, t_ml = rm.predict(df, rf)
    P = pair_rows(df, t_ml, s_ml, rf.rule_topic_sentiments.values)
    ts_ml = [dict() for _ in range(len(df))]
    if len(P):
        ps = pm.predict(P)
        for i, tp, ov, s in zip(P.i, P.topic, P.overall, ps):
            ts_ml[i][tp] = ov if (CONSIST and ov != "혼합") else s
    return s_ml, ts_ml


def hybrid_predict(rm: ReviewModel, pm: PairModel, df: pd.DataFrame, rf: pd.DataFrame):
    """규칙 확신 건은 규칙, 애매 건은 ML. (sentiment, {topic: sentiment}, source) 목록."""
    s_ml, ts_ml = ml_predict(rm, pm, df, rf)
    out = []
    for k in range(len(df)):
        r = rf.iloc[k]
        if r.rule_confident:
            ts = dict(x.split(":", 1) for x in r.rule_topic_sentiments.split("|"))
            out.append((r.rule_sentiment, ts, "rule"))
        else:
            out.append((s_ml[k], ts_ml[k], "ml"))
    return out


# ------------------------------------------------------------------ 평가
def load_labeled():
    lab = pd.read_csv(LABELED, encoding="utf-8-sig", dtype={"review_id": str})
    rf = rule_features(lab)
    # reviews_labeled.csv의 label_source와 지금 규칙의 확신 여부가 같아야 비교가 공정하다
    mismatch = (rf.rule_confident.values != (lab.label_source == "rule").values).sum()
    if mismatch:
        print(f"[주의] 규칙 확신 여부가 label_source와 {mismatch}건 다름 (classify.py가 바뀌었을 수 있음)")
    return lab, rf


def score(name, lab, preds, mask):
    g_s = lab.sentiment.values[mask]
    g_t = lab.topics.values[mask]
    g_ts = lab.topic_sentiments.values[mask]
    p = [preds[i] for i in np.where(mask)[0]]
    p_s = np.array([x[0] for x in p])
    p_t = np.array(["|".join(x[1]) for x in p])
    p_ts = np.array(["|".join(f"{k}:{v}" for k, v in x[1].items()) for x in p])
    same_set = lambda a, b: set(a.split("|")) == set(b.split("|"))
    same_ts = lambda a, b: dict(x.split(":", 1) for x in a.split("|")) == dict(x.split(":", 1) for x in b.split("|"))
    r = {
        "name": name, "n": int(mask.sum()),
        "sentiment_acc": float((p_s == g_s).mean()),
        "sentiment_macro_f1": float(f1_score(g_s, p_s, average="macro", labels=SENTS)),
        "topics_exact": float(np.mean([same_set(a, b) for a, b in zip(p_t, g_t)])),
        "topic_sentiments_exact": float(np.mean([same_ts(a, b) for a, b in zip(p_ts, g_ts)])),
    }
    # 주제별 F1 (언급 여부)
    r["topic_f1"] = {}
    for tp in TOPICS:
        g = np.array([tp in x.split("|") for x in g_t])
        q = np.array([tp in x.split("|") for x in p_t])
        r["topic_f1"][tp] = float(f1_score(g, q, zero_division=0))
    return r, p_s


def evaluate():
    lab, rf = load_labeled()
    n = len(lab)
    hard = (lab.label_source == "manual").values
    g_topics, g_sents = gold_pairs(lab)

    # 규칙 단독 (기준선)
    rule_preds = [(r.rule_sentiment, dict(x.split(":", 1) for x in r.rule_topic_sentiments.split("|")), "rule")
                  for r in rf.itertuples()]

    # 5-겹 교차검증: 매 겹마다 나머지로 학습하고, 학습에 안 쓴 리뷰만 판정
    oof = [None] * n
    oof_ml_only = [None] * n
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    strat = lab.sentiment + "_" + lab.label_source
    for f, (tr, te) in enumerate(skf.split(lab, strat)):
        dtr, dte = lab.iloc[tr], lab.iloc[te]
        rtr, rte = rf.iloc[tr], rf.iloc[te]
        w = np.where(rtr.rule_confident.values, 1.0, HARD_W)
        rm = ReviewModel().fit(dtr, rtr, dtr.sentiment.values, [g_topics[i] for i in tr], w)
        Ptr = pair_rows(dtr, [g_topics[i] for i in tr], dtr.sentiment.values, rtr.rule_topic_sentiments.values)
        pm = PairModel().fit(Ptr, [s for i in tr for s in g_sents[i]])
        hp = hybrid_predict(rm, pm, dte, rte)
        for j, i in enumerate(te):
            oof[i] = hp[j]
        # ML 단독(규칙 확신 건도 ML로) — 참고용
        s_ml, tsd = ml_predict(rm, pm, dte, rte)
        for j, i in enumerate(te):
            oof_ml_only[i] = (s_ml[j], tsd[j], "ml")
        print(f"  fold {f + 1}/5 완료")

    report = {"setup": {
        "label_file": LABELED, "n": n, "n_hard": int(hard.sum()),
        "cv": "5-fold stratified (감성×출처), random_state=2026",
        "note": "정답은 reviews_labeled.csv(규칙 4,319 + AI 판정 2,030). 규칙 확신 건은 정답이 곧 규칙 판정이라 "
                "하이브리드에서 100% 일치하는 게 당연하다. 의미 있는 비교는 '어려운 2,030건'(AI가 맡았던 것)이다."}}
    res = []
    for name, preds in [("규칙 단독", rule_preds), ("ML 단독", oof_ml_only), ("규칙+ML 하이브리드", oof)]:
        r_h, ps_h = score(name, lab, preds, hard)
        r_a, _ = score(name, lab, preds, np.ones(n, bool))
        res.append({"method": name, "hard_2030": r_h, "all_6349": r_a})
    report["results"] = res
    r_h, ps_h = score("하이브리드", lab, oof, hard)
    report["hybrid_hard_sentiment_report"] = classification_report(
        lab.sentiment.values[hard], ps_h, labels=SENTS, output_dict=True, zero_division=0)

    # 검수 표본 50건: 검수에서 바로잡은 3건을 반영한 정답으로 비교
    audit = pd.read_csv("work/audit_sample.csv", encoding="utf-8-sig", dtype={"review_id": str})
    fix = {"주아": ("긍정", "일반:긍정"), "벌런스가좋아요": ("긍정", "밸런스/성장:긍정"), "현질게임": ("부정", "과금:부정")}
    idx = {rid: k for k, rid in enumerate(lab.review_id)}
    rows = []
    for a in audit.itertuples():
        g_s, g_ts = fix.get(str(a.content).strip(), (a.sentiment, a.topic_sentiments))
        k = idx[a.review_id]
        rows.append({"content": a.content, "gold": g_s, "gold_ts": g_ts,
                     "rule": rule_preds[k][0], "hybrid": oof[k][0], "ml_only": oof_ml_only[k][0]})
    A = pd.DataFrame(rows)
    report["audit50_corrected"] = {
        "sentiment_ok": {m: int((A[m] == A.gold).sum()) for m in ["rule", "hybrid", "ml_only"]},
        "note": "AI 검수 50건(규칙 34 + AI 판정 16)에서 오판 3건을 바로잡은 정답 기준. 3건의 정답은 "
                "현재 학습 라벨과 달라서, 학습 라벨을 그대로 흉내 내는 모델은 이 3건을 맞히기 어렵다.",
        "the_3_fixed": A[A.content.str.strip().isin(fix)][["content", "gold", "rule", "hybrid", "ml_only"]]
        .to_dict("records"),
    }

    # 어려운 건 중 하이브리드가 틀린 예시 (오류 분석용)
    wrong = [k for k in np.where(hard)[0] if oof[k][0] != lab.sentiment.iat[k]]
    rng = np.random.default_rng(SEED)
    report["hard_errors_sample"] = [
        {"content": str(lab.content.iat[k])[:200], "gold": lab.sentiment.iat[k], "pred": oof[k][0],
         "rating": int(lab.rating.iat[k])}
        for k in rng.choice(wrong, size=min(25, len(wrong)), replace=False)]

    # 결론이 바뀌는지: 주제별 부정 언급 건수 (정답 vs 교차검증 하이브리드)
    def neg_counts(ts_list):
        c = {tp: 0 for tp in TOPICS}
        for ts in ts_list:
            for k, v in ts.items():
                if k in c and v in ("부정", "혼합"):
                    c[k] += 1
        return c
    gold_ts = [dict(x.split(":", 1) for x in s.split("|")) for s in lab.topic_sentiments]
    report["topic_negative_counts"] = {"gold": neg_counts(gold_ts), "hybrid_cv": neg_counts([p[1] for p in oof])}

    os.makedirs("work", exist_ok=True)
    pd.DataFrame({"review_id": lab.review_id, "sentiment": [p[0] for p in oof],
                  "topic_sentiments": ["|".join(f"{k}:{v}" for k, v in p[1].items()) for p in oof],
                  "source": [p[2] for p in oof]}).to_csv("work/ml_oof.csv", index=False, encoding="utf-8-sig")
    json.dump(report, open("work/ml_eval.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("\n=== 어려운 2,030건 (메인 세션에서 AI가 판정한 리뷰) ===")
    print(f"{'방법':14s} {'감성 정확도':>10s} {'감성 macroF1':>12s} {'주제 일치':>9s} {'주제별감성 일치':>14s}")
    for r in res:
        h = r["hard_2030"]
        print(f"{r['method']:14s} {h['sentiment_acc']:10.1%} {h['sentiment_macro_f1']:12.3f} "
              f"{h['topics_exact']:9.1%} {h['topic_sentiments_exact']:14.1%}")
    print("\n=== 전체 6,349건 ===")
    for r in res:
        h = r["all_6349"]
        print(f"{r['method']:14s} {h['sentiment_acc']:10.1%} {h['sentiment_macro_f1']:12.3f} "
              f"{h['topics_exact']:9.1%} {h['topic_sentiments_exact']:14.1%}")
    print("\n검수 50건(정정 반영) 감성 일치:", report["audit50_corrected"]["sentiment_ok"])
    print("저장 work/ml_eval.json")


# ------------------------------------------------------------------ 학습 / 판정
def train():
    lab, rf = load_labeled()
    g_topics, g_sents = gold_pairs(lab)
    w = np.where(rf.rule_confident.values, 1.0, HARD_W)
    rm = ReviewModel().fit(lab, rf, lab.sentiment.values, g_topics, w)
    P = pair_rows(lab, g_topics, lab.sentiment.values, rf.rule_topic_sentiments.values)
    pm = PairModel().fit(P, [s for ss in g_sents for s in ss])
    os.makedirs("work", exist_ok=True)
    joblib.dump({"review": rm, "pair": pm}, MODEL_PATH)
    print("저장", MODEL_PATH, "| 학습 리뷰", len(lab), "| 주제 쌍", len(P))


def predict(src="data/reviews.csv", dst="data/reviews_labeled_ml.csv"):
    if os.path.abspath(dst) == os.path.abspath(LABELED):
        sys.exit("reviews_labeled.csv(학습 정답)는 덮어쓰지 않습니다. 다른 출력 경로를 주세요.")
    bundle = joblib.load(MODEL_PATH)
    raw = pd.read_csv(src, encoding="utf-8-sig", dtype={"review_id": str})
    rf = rule_features(raw)
    preds = hybrid_predict(bundle["review"], bundle["pair"], raw, rf)
    rows = []
    for (_, r), (s, ts, srcl) in zip(raw.iterrows(), preds):
        ts = {k: v for k, v in ts.items() if v in SENTS} or {"일반": s}
        if "일반" in ts and len(ts) > 1:
            ts.pop("일반")
        row = r.to_dict()
        row.update({"sentiment": s, "topics": "|".join(ts),
                    "topic_sentiments": "|".join(f"{k}:{v}" for k, v in ts.items()),
                    "keywords": "|".join(kw_for(r.content if isinstance(r.content, str) else "", list(ts))),
                    "label_source": srcl})
        for tp in TOPICS + ["일반"]:
            row[f"sent_{tp}"] = ts.get(tp, "")
        rows.append(row)
    out = pd.DataFrame(rows)
    share = {tp: (out[f"sent_{tp}"] != "").mean() for tp in TOPICS}
    small = [tp for tp, v in share.items() if v < OTHER_THRESHOLD]
    out["topics_grouped"] = out.topics.apply(
        lambda t: "|".join(dict.fromkeys("기타" if x in small else x for x in t.split("|"))))
    cols = list(raw.columns) + ["sentiment", "topics", "topics_grouped", "topic_sentiments"] + \
        [f"sent_{tp}" for tp in TOPICS + ["일반"]] + ["keywords", "label_source"]
    out[cols].to_csv(dst, index=False, encoding="utf-8-sig")
    print("저장", dst, len(out), "| 출처:", out.label_source.value_counts().to_dict())
    print("감성:", out.sentiment.value_counts().to_dict())


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "eval"
    if cmd == "eval":
        evaluate()
    elif cmd == "train":
        train()
    elif cmd == "predict":
        predict(*sys.argv[2:4])
    else:
        sys.exit(__doc__)
