"""AI(LLM) 없이 리뷰를 분류하는 파이프라인: 규칙(classify.py) + 고전 머신러닝(TF-IDF + 로지스틱 회귀).

동작 방식 (메인 세션의 '규칙 + AI 수동 판정'에서 AI 자리를 ML 모델로 바꾼 구조)
- 규칙이 확신하는 리뷰(classify.py의 애매 플래그가 없는 리뷰)는 규칙 판정을 그대로 쓴다.
  단, 규칙이 '중립'이라고 한 리뷰는 확신하더라도 ML로 넘긴다(NEUTRAL_TO_ML).
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

웹 서버 등 다른 코드에서 쓰기 (scripts 폴더를 sys.path에 넣고)
  import ml_classify
  ml_classify.load_model(serving=True)          # 서버 시작 때 한 번 (모델·임베딩·Kiwi를 미리 불러 둠, 약 10초)
  ml_classify.classify_reviews([{"content": "재밌는데 렉이 심해요", "rating": 4}])
  → [{"sentiment": "혼합", "topics": {"버그": "부정", ...}, "source": "ml", "truncated": False}]

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
from embeddings import embed
from merge_labels import OTHER_THRESHOLD, TOPICS, kw_for

SENTS = ["긍정", "부정", "중립", "혼합"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 저장소 폴더
LABELED = os.path.join(ROOT, "data", "reviews_labeled.csv")
MODEL_PATH = os.path.join(ROOT, "work", "ml_model.joblib")
WORK = os.path.join(ROOT, "work")
MAX_CHARS = 2000  # classify_reviews 입력 길이 상한 (더 긴 리뷰는 앞부분만 판정)
SEED = 2026
# 클래스 가중치: 교차검증에서 "balanced"(희귀 클래스 가중)보다 None이 정확도도 높고, 주제별 부정 건수도
# 정답에 가깝게 나왔다 (balanced는 부정·혼합을 과다 판정해 콘텐츠 부정이 129→332건으로 부풀었음).
CW_SENT, CW_TOPIC, CW_PAIR = None, None, None
# 하이퍼파라미터 (교차검증 실험으로 정함)
C_SENT, C_TOPIC, C_PAIR = 4.0, 4.0, 2.0   # 로지스틱 회귀 규제 강도의 역수 (클수록 학습 데이터에 더 맞춤)
TOPIC_THR = 0.4                            # 주제 확률이 이 값 이상이면 그 주제로 판정
FALLBACK_THR = 0.2                         # 주제가 하나도 안 걸릴 때 최상위 주제를 채택하는 확률 기준
# 규칙이 확신하더라도 '중립'이라고 판정한 리뷰는 ML로 넘긴다. 규칙 사전에 없는 단어로 쓴 짧은 리뷰
# ("과금 미쳣음", "조작겜")를 규칙이 중립으로 확신하던 문제 때문이다. 다른 게임(메이플 키우기) 300건에서
# 감성 정확도 88.0% → 91.0% (docs/MAPLE_CROSS_GAME_TEST.md). 달토끼 교차검증(evaluate)은 쉬운 리뷰의
# 정답이 규칙 판정 그 자체라 이 효과를 잴 수 없으므로, 기록된 수치를 재현하도록 evaluate에서는 끈다.
NEUTRAL_TO_ML = True
HARD_W = 5.0                               # 학습 때 애매한(규칙이 확신 못 한) 리뷰에 주는 가중치
# 주제별 감성 일관성: 정답 라벨에서 전체 감성이 긍정/부정/중립이면 주제별 감성도 98%가 같았다.
# 그래서 주제별 감성 모델은 '혼합' 리뷰에만 쓰고, 나머지는 전체 감성을 그대로 따른다.
CONSIST = True
USE_KIWI = True  # 형태소(Kiwi) 특징 추가: "어렵다/어려워서/어렵네"를 같은 원형으로 묶는다
# 로컬 문장 임베딩 특징 (scripts/embeddings.py). None이면 쓰지 않는다.
EMB_MODEL: str | None = "jhgan/ko-sroberta-multitask"
EMB_W = 1.0       # 임베딩 특징의 배율 (TF-IDF 특징과의 상대적 비중)
PAIR_EMB = True   # 주제별 감성 모델에도 해당 절의 임베딩을 쓸지
# 미세조정 모델 (scripts/finetune.py): 임베딩 모델 자체를 우리 라벨로 학습시킨 모델. 감성·주제 확률을 위 로지스틱
# 회귀의 확률과 가중 평균한다. 0이면 쓰지 않는다. 학습된 모델 폴더(work/ft/model)가 있어야 한다.
# 교차검증(어려운 2,030건 감성): 기존 모델 85.1%, 미세조정 단독 89.0%, 기존 0.4 + 미세조정 0.6 = 89.7%
FT_SENT_W = 0.6   # 감성 확률에서 미세조정 모델의 비중
# 주제 확률도 0.5로 평균하면 주제 완전일치는 +1.1%p였지만 버그 부정 언급이 정답 640건 → 704건으로 부풀어
# 우선순위가 왜곡돼서 쓰지 않는다 (0이면 버그 부정 639건으로 정답과 거의 같다).
FT_TOPIC_W = 0.0  # 주제 확률에서 미세조정 모델의 비중
# 감성을 TF-IDF 모델과 임베딩 모델로 따로 학습해 확률을 평균할지 (True), 한 모델에 특징을 합칠지 (False).
# 미세조정 모델과 평균할 때는 차이가 0.1%p(2건)라 단순한 쪽(False)을 쓴다.
SENT_SPLIT = False
# 클래스별 판정 기준 조정: 감성 로그확률에 더하는 보정값 [긍정, 부정, 중립, 혼합].
# 음수면 그 감성으로 판정하려면 확률이 더 높아야 한다 (예: 중립 정밀도가 낮아 중립 기준을 높임).
# experiments.py 교차검증: 미세조정 모델 없이는 조합에 따라 -0.1~+0.7%p였지만, 미세조정 모델과 평균한 뒤에는 -0.9%p라 쓰지 않는다.
SENT_BIAS = [0.0, 0.0, 0.0, 0.0]
CV_FOLDS = os.path.join(WORK, "cv_folds.csv")  # 교차검증 분할 고정 (finetune.py와 같은 분할)
FT_OOF_DIR = os.path.join(WORK, "ft")         # finetune.py cv가 만든 겹별 확률 (교차검증 평가용)
_FT_OVERRIDE: dict | None = None              # 평가 때 미세조정 모델 확률을 미리 계산한 값으로 대신한다


_kiwi = None
_morph_cache: dict[str, str] = {}
MORPH_CACHE_MAX = 20_000  # 형태소 분석 결과 캐시 상한 (학습 데이터 6,349건은 충분히 들어감)


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
    if len(_morph_cache) >= MORPH_CACHE_MAX:  # 서버에서 요청이 쌓여도 메모리가 끝없이 늘지 않게
        _morph_cache.clear()
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


# ------------------------------------------------------------------ 미세조정 모델 확률
FT_MODEL_DIR = os.path.join(WORK, "ft", "model")  # finetune.py train이 저장하는 위치 (약 420MB, git에 안 들어감)
FT_REQUIRED = ("config.json", "heads.pt", "model.safetensors", "tokenizer.json")
_ft_state: dict | None = None  # {"active": bool, "reason": str}


def ft_status() -> dict:
    """미세조정 모델을 쓸 수 있는지. 폴더·파일이 없거나 불러오다 실패하면 기존 모델(로지스틱 회귀)로만 판정한다.
    판정 결과가 '조용히' 나빠지지 않도록 처음 한 번 경고를 출력하고, 서버 상태(/api/health)에도 알린다."""
    global _ft_state
    if _ft_state is None:
        missing = [f for f in FT_REQUIRED if not os.path.exists(os.path.join(FT_MODEL_DIR, f))]
        if missing:
            _ft_state = {"active": False, "reason": f"미세조정 모델 파일이 없습니다 ({FT_MODEL_DIR}: {', '.join(missing)})"}
        else:
            try:
                import finetune
                finetune.load(FT_MODEL_DIR)
                _ft_state = {"active": True, "reason": "미세조정 모델 사용 중"}
            except Exception as e:  # 파일이 깨졌거나 버전이 안 맞는 경우
                _ft_state = {"active": False, "reason": f"미세조정 모델을 불러오지 못했습니다 ({type(e).__name__}: {e})"}
        if not _ft_state["active"]:
            print("[경고] " + _ft_state["reason"] + ". 기존 모델로만 판정합니다 "
                  "(어려운 리뷰 감성 정확도 약 89.7% → 약 85%). 복구: 다른 컴퓨터의 work/ft/model 폴더를 복사하거나 "
                  "python scripts/finetune.py train 실행", file=sys.stderr, flush=True)
    return _ft_state


def ft_proba(df: pd.DataFrame):
    """미세조정 모델의 (감성 확률 (n,4), 주제 확률 (n,8)). 평가 때는 _FT_OVERRIDE(겹별로 미리 계산한 값)를 쓴다."""
    import finetune
    keys = [finetune.model_input(c, r) for c, r in zip(df.content, df.rating)]
    if _FT_OVERRIDE is not None:
        return (np.vstack([_FT_OVERRIDE[k][0] for k in keys]), np.vstack([_FT_OVERRIDE[k][1] for k in keys]))
    return finetune.predict_reviews(df.content.tolist(), df.rating.tolist())


def cv_folds(lab: pd.DataFrame):
    """교차검증 분할. work/cv_folds.csv가 있으면 그 분할을 쓴다 (미세조정 교차검증과 같은 분할이어야 공정하다)."""
    if os.path.exists(CV_FOLDS):
        f = pd.read_csv(CV_FOLDS, encoding="utf-8-sig", dtype={"review_id": str})
        fold = lab.review_id.map(dict(zip(f.review_id, f.fold)))
        if fold.notna().all():
            fold = fold.astype(int).values
            return [(np.where(fold != k)[0], np.where(fold == k)[0]) for k in range(5)]
        print("[주의] cv_folds.csv에 없는 리뷰가 있어 새로 분할합니다")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    return list(skf.split(lab, lab.sentiment + "_" + lab.label_source))


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
        self.emb = (EMB_MODEL, EMB_W) if EMB_MODEL else None

    def _X(self, df, rf):
        t = text_of(df)
        parts = [self.v_char.transform(t), self.v_word.transform(t)]
        if getattr(self, "kiwi", False):
            parts.append(self.v_morph.transform([morphs(x) for x in t]))
        if getattr(self, "emb", None):
            parts.append(csr_matrix(embed(t.tolist(), self.emb[0]) * self.emb[1]))
        parts.append(csr_matrix(dense_feats(df, rf) * 2.0))
        return hstack(parts).tocsr()

    def fit(self, df, rf, y_sent, y_topics, w=None):
        self._vec_fit(text_of(df))
        X = self._X(df, rf)
        self.sent = LogisticRegression(C=self.C_sent, max_iter=3000, class_weight=CW_SENT)
        self.sent.fit(X, y_sent, sample_weight=w)
        self.split = bool(SENT_SPLIT and self.emb)
        if self.split:  # TF-IDF 단독, 임베딩 단독 감성 모델을 따로 학습해 확률을 평균한다
            self.emb_dim = embed(text_of(df).iloc[:1].tolist(), self.emb[0]).shape[1]
            self.n_dense = dense_feats(df.iloc[:1], rf.iloc[:1]).shape[1]
            tf_cols, em_cols = self._split_cols(X.shape[1], self.emb_dim, self.n_dense)
            self.sent_tf = LogisticRegression(C=self.C_sent, max_iter=3000).fit(X[:, tf_cols], y_sent, sample_weight=w)
            self.sent_em = LogisticRegression(C=1.0, max_iter=3000).fit(X[:, em_cols], y_sent, sample_weight=w)
        self.topic = {}
        for tp in TOPICS:
            y = np.array([tp in ts for ts in y_topics], dtype=int)
            m = LogisticRegression(C=self.C_topic, max_iter=3000, class_weight=CW_TOPIC)
            m.fit(X, y, sample_weight=w)
            self.topic[tp] = m
        self.ft_w = (FT_SENT_W, FT_TOPIC_W)
        self.bias = np.asarray(SENT_BIAS, float)
        return self

    @staticmethod
    def _split_cols(n_all, n_emb, n_de):
        """특징 열 순서: [TF-IDF..., 임베딩(n_emb), 규칙/별점(n_de)]"""
        n_tf = n_all - n_emb - n_de
        tf_cols = np.r_[0:n_tf, n_tf + n_emb:n_all]
        em_cols = np.r_[n_tf:n_all]
        return tf_cols, em_cols

    def _sent_proba(self, X):
        order = [list(self.sent.classes_).index(s) for s in SENTS]
        if getattr(self, "split", False):
            tf_cols, em_cols = self._split_cols(X.shape[1], self.emb_dim, self.n_dense)
            return (self.sent_tf.predict_proba(X[:, tf_cols])[:, order] +
                    self.sent_em.predict_proba(X[:, em_cols])[:, order]) / 2
        return self.sent.predict_proba(X)[:, order]

    def predict(self, df, rf, thr: float | None = None):
        thr = TOPIC_THR if thr is None else thr
        X = self._X(df, rf)
        Ps = self._sent_proba(X)
        P = np.vstack([self.topic[tp].predict_proba(X)[:, 1] for tp in TOPICS]).T
        ws, wt = getattr(self, "ft_w", (0.0, 0.0))
        # 평가 중(_FT_OVERRIDE)에는 미리 계산한 확률을 쓰고, 그 외에는 모델 폴더가 있을 때만 섞는다
        if (ws > 0 or wt > 0) and (_FT_OVERRIDE is not None or ft_status()["active"]):
            fs, ftp = ft_proba(df)
            Ps = (1 - ws) * Ps + ws * fs
            P = (1 - wt) * P + wt * ftp
        bias = getattr(self, "bias", np.zeros(len(SENTS)))
        s = np.array(SENTS, dtype=object)[(np.log(np.clip(Ps, 1e-9, 1)) + bias).argmax(1)]
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
        parts = [self.v.transform(P.ctx), csr_matrix(self._dense(P))]
        if getattr(self, "emb", None):
            from embeddings import embed
            parts.append(csr_matrix(embed(P.ctx.tolist(), self.emb[0]) * self.emb[1]))
        return hstack(parts).tocsr()

    def fit(self, P, y):
        if CONSIST:  # 혼합 리뷰의 쌍만 학습
            keep = (P.overall.values == "혼합")
            P, y = P[keep].reset_index(drop=True), np.asarray(y)[keep]
        self.emb = (EMB_MODEL, EMB_W) if (EMB_MODEL and PAIR_EMB) else None
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
        need = (P.overall.values == "혼합") if CONSIST else np.ones(len(P), bool)
        ps = np.array(P.overall.values, dtype=object)  # 혼합이 아니면 전체 감성을 그대로 따른다
        if need.any():
            ps[need] = pm.predict(P[need].reset_index(drop=True))
        for i, tp, s in zip(P.i, P.topic, ps):
            ts_ml[i][tp] = s
    return s_ml, ts_ml


def hybrid_predict(rm: ReviewModel, pm: PairModel, df: pd.DataFrame, rf: pd.DataFrame,
                   neutral_to_ml: bool = NEUTRAL_TO_ML):
    """규칙 확신 건은 규칙, 애매 건은 ML. (sentiment, {topic: sentiment}, source) 목록.
    ML(임베딩 포함)은 애매한 리뷰에만 돌린다. 규칙 확신 건까지 돌리면 결과는 같고 시간만 몇 배 든다.
    neutral_to_ml이면 규칙이 확신한 '중립'도 ML로 판정한다(NEUTRAL_TO_ML 설명 참고)."""
    hard = ~rf.rule_confident.values.astype(bool)
    if neutral_to_ml:
        hard |= rf.rule_sentiment.values == "중립"
    ml_res = {}
    if hard.any():
        s_ml, ts_ml = ml_predict(rm, pm, df[hard].reset_index(drop=True), rf[hard].reset_index(drop=True))
        ml_res = dict(zip(np.where(hard)[0], zip(s_ml, ts_ml)))
    out = []
    for k in range(len(df)):
        r = rf.iloc[k]
        if k in ml_res:
            out.append((ml_res[k][0], ml_res[k][1], "ml"))
        else:
            ts = dict(x.split(":", 1) for x in r.rule_topic_sentiments.split("|"))
            out.append((r.rule_sentiment, ts, "rule"))
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
    global _FT_OVERRIDE
    oof = [None] * n
    oof_ml_only = [None] * n
    use_ft = FT_SENT_W > 0 or FT_TOPIC_W > 0
    if use_ft:  # 미세조정 모델은 겹마다 다시 학습하면 오래 걸려서, finetune.py cv가 같은 분할로 만든 겹별 확률을 쓴다
        import finetune
        ft_s = np.load(os.path.join(FT_OOF_DIR, "oof_sent.npy"))
        ft_t = np.load(os.path.join(FT_OOF_DIR, "oof_topic.npy"))
        ft_keys = [finetune.model_input(c, r) for c, r in zip(lab.content, lab.rating)]
    for f, (tr, te) in enumerate(cv_folds(lab)):
        if use_ft:  # 이 겹의 평가 리뷰는 이 겹을 빼고 학습한 미세조정 모델의 확률
            _FT_OVERRIDE = {ft_keys[i]: (ft_s[i], ft_t[i]) for i in te}
        dtr, dte = lab.iloc[tr], lab.iloc[te]
        rtr, rte = rf.iloc[tr], rf.iloc[te]
        w = np.where(rtr.rule_confident.values, 1.0, HARD_W)
        rm = ReviewModel().fit(dtr, rtr, dtr.sentiment.values, [g_topics[i] for i in tr], w)
        Ptr = pair_rows(dtr, [g_topics[i] for i in tr], dtr.sentiment.values, rtr.rule_topic_sentiments.values)
        pm = PairModel().fit(Ptr, [s for i in tr for s in g_sents[i]])
        hp = hybrid_predict(rm, pm, dte, rte, neutral_to_ml=False)  # 기록된 수치 재현용 (NEUTRAL_TO_ML 설명)
        for j, i in enumerate(te):
            oof[i] = hp[j]
        # ML 단독(규칙 확신 건도 ML로) — 참고용
        s_ml, tsd = ml_predict(rm, pm, dte, rte)
        for j, i in enumerate(te):
            oof_ml_only[i] = (s_ml[j], tsd[j], "ml")
        print(f"  fold {f + 1}/5 완료")
    _FT_OVERRIDE = None

    report = {"setup": {
        "label_file": os.path.relpath(LABELED, ROOT).replace(os.sep, "/"), "n": n, "n_hard": int(hard.sum()),
        "cv": "5-fold stratified (감성×출처), random_state=2026, 분할은 work/cv_folds.csv에 고정",
        "config": {"emb_model": EMB_MODEL, "ft_sent_w": FT_SENT_W, "ft_topic_w": FT_TOPIC_W,
                   "sent_split": SENT_SPLIT, "sent_bias": list(SENT_BIAS), "hard_w": HARD_W},
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
    audit = pd.read_csv(os.path.join(WORK, "audit_sample.csv"), encoding="utf-8-sig", dtype={"review_id": str})
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

    os.makedirs(WORK, exist_ok=True)
    pd.DataFrame({"review_id": lab.review_id, "sentiment": [p[0] for p in oof],
                  "topic_sentiments": ["|".join(f"{k}:{v}" for k, v in p[1].items()) for p in oof],
                  "source": [p[2] for p in oof]}).to_csv(os.path.join(WORK, "ml_oof.csv"), index=False, encoding="utf-8-sig")
    json.dump(report, open(os.path.join(WORK, "ml_eval.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

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
    os.makedirs(WORK, exist_ok=True)
    joblib.dump({"review": rm, "pair": pm}, MODEL_PATH)
    print("저장", MODEL_PATH, "| 학습 리뷰", len(lab), "| 주제 쌍", len(P))


def predict(src=os.path.join(ROOT, "data", "reviews.csv"), dst=os.path.join(ROOT, "data", "reviews_labeled_ml.csv")):
    if os.path.abspath(dst) == os.path.abspath(LABELED):
        sys.exit("reviews_labeled.csv(학습 정답)는 덮어쓰지 않습니다. 다른 출력 경로를 주세요.")
    bundle = load_model()
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


# ------------------------------------------------------------------ 서빙 (웹 서버 등에서 호출)
_bundle = None


def load_model(path: str = MODEL_PATH, serving: bool = False):
    """학습된 모델을 불러와 캐시한다. serving=True면 임베딩 캐시를 읽기 전용으로 바꾸고 무거운 모델을 미리 불러 둔다.
    주의: joblib(pickle) 파일은 열 때 코드가 실행될 수 있으므로, 직접 학습한 파일만 불러야 한다."""
    global _bundle
    if _bundle is None or serving:
        _bundle = joblib.load(path)
    if serving:
        import embeddings
        embeddings.set_cache_mode("read")
        emb = getattr(_bundle["review"], "emb", None)
        if emb:
            embeddings.get_model(emb[0])
        if any(getattr(_bundle["review"], "ft_w", (0, 0))):
            ft_status()  # 미세조정 모델을 미리 불러오고, 없으면 경고 후 기존 모델로 판정
        morphs("준비")  # Kiwi 미리 불러오기
    return _bundle


def classify_reviews(items: list[dict]) -> list[dict]:
    """리뷰 목록을 판정한다. items: [{"content": str, "rating": 1~5 정수}, ...]
    별점은 모델 입력이라 필수다(없으면 판정 기준이 달라짐). 내용이 MAX_CHARS보다 길면 앞부분만 판정한다."""
    if not isinstance(items, list) or not items:
        raise ValueError("리뷰 목록이 비었습니다")
    rows, truncated = [], []
    for k, it in enumerate(items):
        c, r = it.get("content"), it.get("rating")
        if not isinstance(c, str) or not c.strip():
            raise ValueError(f"{k + 1}번째 리뷰: content(리뷰 내용)가 비었습니다")
        if isinstance(r, bool) or not isinstance(r, (int, np.integer)) or not 1 <= int(r) <= 5:
            raise ValueError(f"{k + 1}번째 리뷰: rating은 1~5 정수여야 합니다")
        truncated.append(len(c) > MAX_CHARS)
        rows.append({"content": c[:MAX_CHARS], "rating": int(r)})
    df = pd.DataFrame(rows)
    b = load_model()
    preds = hybrid_predict(b["review"], b["pair"], df, rule_features(df))
    out = []
    for (s_, ts, src), tr in zip(preds, truncated):
        ts = {k: v for k, v in ts.items() if v in SENTS} or {"일반": s_}
        if "일반" in ts and len(ts) > 1:
            ts.pop("일반")
        out.append({"sentiment": s_, "topics": ts, "source": src, "truncated": tr})
    return out


def _cli(argv: list[str]):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = argv[0] if argv else "eval"
    if cmd == "eval":
        evaluate()
    elif cmd == "train":
        train()
    elif cmd == "predict":
        predict(*[os.path.abspath(a) for a in argv[1:3]])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    # 스크립트로 실행하면 이 파일은 '__main__' 모듈이 된다. 그 상태로 학습하면 모델 파일에 클래스가
    # '__main__.ReviewModel'로 기록돼서, 다른 코드(웹 서버 등)에서 불러올 때 클래스를 못 찾는다.
    # 그래서 같은 파일을 'ml_classify' 모듈로 다시 불러와 실행한다.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ml_classify
    ml_classify._cli(sys.argv[1:])
