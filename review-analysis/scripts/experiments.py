"""감성 모델 개선 실험 (ml_classify.py와 같은 5-겹 분할로 비교).

실험
  base     지금 모델 (TF-IDF + 고정 임베딩 + 규칙 특징 → 로지스틱 회귀)
  thr      클래스별 판정 기준 조정 (중립·혼합 등 확률에 더하는 보정값을 다른 겹에서 정해 적용)
  ens      여러 모델의 확률 평균 (TF-IDF 단독, 임베딩 단독, 미세조정 모델)
  noise    잡음 라벨 가중치 낮추기 (학습 겹 안에서 다시 교차검증해, 모델이 확신하는데 정답과 어긋나는 규칙 라벨의 가중치를 낮춤)

사용: python scripts/experiments.py [oof|report]
  oof     각 모델의 겹별 확률을 계산해 work/exp/에 저장
  report  저장된 확률로 조합을 비교 (미세조정 결과 work/ft/oof_sent.npy가 있으면 함께 비교)
"""
from __future__ import annotations

import itertools
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, precision_recall_fscore_support
from sklearn.model_selection import StratifiedKFold

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ml_classify as mc  # noqa: E402
from embeddings import embed  # noqa: E402

EXP = os.path.join(mc.ROOT, "work", "exp", os.environ.get("EXP_TAG", ""))
SENTS = mc.SENTS


def pinned_folds(lab):
    """work/cv_folds.csv에 고정한 분할 (미세조정 교차검증과 같은 분할)."""
    f = pd.read_csv(os.path.join(mc.ROOT, "work", "cv_folds.csv"), encoding="utf-8-sig", dtype={"review_id": str})
    fold = lab.review_id.map(dict(zip(f.review_id, f.fold))).values
    return [(np.where(fold != k)[0], np.where(fold == k)[0]) for k in range(5)]


def blocks(rm, df, rf):
    """특징 묶음을 따로 만든다: TF-IDF(글자·단어·형태소), 임베딩, 규칙/별점."""
    t = mc.text_of(df)
    tf = hstack([rm.v_char.transform(t), rm.v_word.transform(t),
                 rm.v_morph.transform([mc.morphs(x) for x in t])]).tocsr()
    em = csr_matrix(embed(t.tolist(), mc.EMB_MODEL) * mc.EMB_W)
    de = csr_matrix(mc.dense_feats(df, rf) * 2.0)
    return tf, em, de


def lr(X, y, w, C=mc.C_SENT):
    return LogisticRegression(C=C, max_iter=3000).fit(X, y, sample_weight=w)


def noise_weights(Xtr, ytr, wtr, is_rule, thr=0.15, low=0.2, seed=0):
    """학습 겹 안에서 3-겹 교차검증 → 규칙 라벨인데 모델이 정답 클래스에 thr 미만 확률을 준 리뷰는 가중치 low."""
    p_gold = np.zeros(len(ytr))
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=seed)
    for a, b in skf.split(Xtr, ytr):
        m = lr(Xtr[a], ytr[a], wtr[a])
        P = m.predict_proba(Xtr[b])
        cls = list(m.classes_)
        p_gold[b] = [P[k, cls.index(y)] for k, y in enumerate(ytr[b])]
    flag = is_rule & (p_gold < thr)
    w = wtr.copy()
    w[flag] *= low
    return w, flag, p_gold


def compute_oof():
    os.makedirs(EXP, exist_ok=True)
    lab, rf = mc.load_labeled()
    y = lab.sentiment.values
    n = len(lab)
    folds = pinned_folds(lab)
    out = {k: np.zeros((n, 4)) for k in ["base", "tfidf", "emb", "noise"]}
    flagged = np.zeros(n, bool)
    pgold = np.zeros(n)
    for f, (tr, te) in enumerate(folds):
        dtr, dte, rtr, rte = lab.iloc[tr], lab.iloc[te], rf.iloc[tr], rf.iloc[te]
        w = np.where(rtr.rule_confident.values, 1.0, mc.HARD_W)
        rm = mc.ReviewModel()
        rm._vec_fit(mc.text_of(dtr))
        tf_tr, em_tr, de_tr = blocks(rm, dtr, rtr)
        tf_te, em_te, de_te = blocks(rm, dte, rte)
        Xtr = hstack([tf_tr, em_tr, de_tr]).tocsr()
        Xte = hstack([tf_te, em_te, de_te]).tocsr()
        ytr = y[tr]
        m = lr(Xtr, ytr, w)
        assert list(m.classes_) == sorted(SENTS)
        order = [list(m.classes_).index(s) for s in SENTS]
        out["base"][te] = m.predict_proba(Xte)[:, order]
        m = lr(hstack([tf_tr, de_tr]).tocsr(), ytr, w)
        out["tfidf"][te] = m.predict_proba(hstack([tf_te, de_te]).tocsr())[:, order]
        m = lr(hstack([em_tr, de_tr]).tocsr(), ytr, w, C=1.0)
        out["emb"][te] = m.predict_proba(hstack([em_te, de_te]).tocsr())[:, order]
        w2, fl, pg = noise_weights(Xtr, ytr, w, rtr.rule_confident.values)
        flagged[tr[fl]] = True
        pgold[tr] = pg  # 마지막으로 계산된 값 (겹마다 덮어씀, 참고용)
        m = lr(Xtr, ytr, w2)
        out["noise"][te] = m.predict_proba(Xte)[:, order]
        print(f"fold {f + 1}/5 완료 (잡음 의심 {fl.sum()}건 가중치 낮춤)", flush=True)
    for k, v in out.items():
        np.save(os.path.join(EXP, f"oof_{k}.npy"), v)
    np.save(os.path.join(EXP, "noise_flagged.npy"), flagged)
    print("저장", EXP)


# ------------------------------------------------------------------ 비교
def metrics(y, pred, hard):
    r = {}
    for name, m in [("hard", hard), ("all", np.ones(len(y), bool))]:
        g, p = y[m], pred[m]
        pr, rc, f1, _ = precision_recall_fscore_support(g, p, labels=SENTS, zero_division=0)
        r[name] = {"acc": float((g == p).mean()), "macro_f1": float(f1_score(g, p, labels=SENTS, average="macro")),
                   **{f"{s}_p": float(a) for s, a in zip(SENTS, pr)},
                   **{f"{s}_r": float(a) for s, a in zip(SENTS, rc)},
                   **{f"{s}_f1": float(a) for s, a in zip(SENTS, f1)}}
    return r


def hybrid_sent(P, rule_sent, confident):
    """하이브리드: 규칙 확신 건은 규칙 감성, 나머지는 확률 최댓값."""
    pred = np.array(SENTS, dtype=object)[P.argmax(1)]
    return np.where(confident, rule_sent, pred)


GRID = [-0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.9]


def tune_bias(logP, y, mask, objective="acc"):
    """긍정 기준 0, 부정·중립·혼합의 로그확률 보정값을 격자 탐색 (mask 리뷰에서 목표 최대화)."""
    best, bb = -1, (0, 0, 0)
    ys = y[mask]
    L = logP[mask]
    for b in itertools.product(GRID, GRID, GRID):
        pred = np.array(SENTS)[(L + np.array([0, *b])).argmax(1)]
        s = (pred == ys).mean() if objective == "acc" else f1_score(ys, pred, labels=SENTS, average="macro")
        if s > best + 1e-9:
            best, bb = s, b
    return np.array([0, *bb])


def nested_bias(P, y, hard, folds, objective="acc"):
    """겹 k의 보정값은 나머지 겹의 어려운 리뷰로 정한다 (평가 리뷰로 기준을 정하지 않도록)."""
    logP = np.log(np.clip(P, 1e-9, 1))
    out = logP.copy()
    biases = []
    for tr, te in folds:
        m = np.zeros(len(y), bool)
        m[tr] = True
        b = tune_bias(logP, y, m & hard, objective)
        out[te] = logP[te] + b
        biases.append(b.tolist())
    return np.exp(out), biases


def report():
    lab = pd.read_csv(mc.LABELED, encoding="utf-8-sig", dtype={"review_id": str})
    rf = mc.rule_features(lab)
    y = lab.sentiment.values
    hard = (lab.label_source == "manual").values
    conf = rf.rule_confident.values
    rs = rf.rule_sentiment.values
    folds = pinned_folds(lab)
    P = {k: np.load(os.path.join(EXP, f"oof_{k}.npy")) for k in ["base", "tfidf", "emb", "noise"]}
    ft = os.path.join(mc.ROOT, "work", "ft", "oof_sent.npy")
    if os.path.exists(ft):
        P["ft"] = np.load(ft)
    cands = dict(P)
    cands["avg(tfidf,emb)"] = (P["tfidf"] + P["emb"]) / 2
    cands["avg(base,emb)"] = (P["base"] + P["emb"]) / 2
    if "ft" in P:
        for a in [0.3, 0.4, 0.5, 0.6, 0.7]:
            cands[f"base*{a}+ft"] = a * P["base"] + (1 - a) * P["ft"]
            cands[f"noise*{a}+ft"] = a * P["noise"] + (1 - a) * P["ft"]
            cands[f"tfidf*{a}+ft"] = a * P["tfidf"] + (1 - a) * P["ft"]
            cands[f"avg(tfidf,emb)*{a}+ft"] = a * (P["tfidf"] + P["emb"]) / 2 + (1 - a) * P["ft"]
        cands["avg(tfidf,emb,ft)"] = (P["tfidf"] + P["emb"] + P["ft"]) / 3
    rows = []
    res = {}
    for name, Pc in cands.items():
        for bias in ["", "+thr"]:
            Q, b = (nested_bias(Pc, y, hard, folds) if bias else (Pc, None))
            pred = hybrid_sent(Q, rs, conf)
            m = metrics(y, pred, hard)
            res[name + bias] = {**m, "bias": b}
            h = m["hard"]
            rows.append((name + bias, h["acc"], h["macro_f1"], h["중립_p"], h["중립_r"], h["중립_f1"], h["혼합_f1"],
                         m["all"]["acc"]))
    df = pd.DataFrame(rows, columns=["model", "hard_acc", "hard_mF1", "neu_P", "neu_R", "neu_F1", "mix_F1", "all_acc"])
    pd.set_option("display.width", 200)
    print(df.sort_values("hard_acc", ascending=False).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    json.dump(res, open(os.path.join(EXP, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    {"oof": compute_oof, "report": report}[cmd]()
