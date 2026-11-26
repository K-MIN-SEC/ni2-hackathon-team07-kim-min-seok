"""다른 게임 리뷰에 기존 분류기(달토끼 키우기로 학습)가 얼마나 통하는지 확인한다.

사용법:
    python scripts/cross_game_eval.py sample  --src data/maple/reviews.csv --out work/maple --n 300
    (work/maple/sample.jsonl 을 보고 사람/AI가 work/maple/gold.jsonl 을 작성. 기준: work/manual/RUBRIC.md)
    python scripts/cross_game_eval.py compare --src data/maple/reviews.csv --out work/maple

- sample: 무작위 표본을 뽑아 {"id","text"}만 쓴다. 별점은 주지 않는다(RUBRIC과 같이 내용만으로 판정).
- compare: 같은 표본을 학습된 모델(규칙+ML+미세조정, 서버와 같은 경로)과 규칙 단독으로 판정하고
  gold.jsonl과 비교한다. 결과: <out>/compare.json, <out>/compare_rows.csv
- 쉬움/어려움 구분은 달토끼 때와 같다(규칙 확신 여부). 달토끼에서는 쉬운 리뷰의 정답이 곧 규칙 판정이었지만,
  여기서는 모든 표본을 따로 판정했으므로 쉬운 리뷰의 정확도도 실제 값이다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ml_classify as mc  # noqa: E402

SEED = 2026


def load_src(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"review_id": str})
    df["content"] = df.content.fillna("").astype(str).str.strip()
    return df[df.content != ""].reset_index(drop=True)


def cmd_sample(args):
    df = load_src(args.src)
    s = df.sample(n=args.n, random_state=SEED)
    os.makedirs(args.out, exist_ok=True)
    p = os.path.join(args.out, "sample.jsonl")
    if os.path.exists(p) and not args.force:
        sys.exit(f"{p} 가 이미 있습니다 (--force)")
    with open(p, "w", encoding="utf-8") as f:
        for _, r in s.iterrows():
            f.write(json.dumps({"id": r.review_id, "text": r.content}, ensure_ascii=False) + "\n")
    print("저장", p, len(s), "| 스토어:", s.store.value_counts().to_dict())


def norm_ts(ts: dict, s: str) -> dict:
    ts = {k: v for k, v in ts.items() if v in mc.SENTS} or {"일반": s}
    if "일반" in ts and len(ts) > 1:
        ts.pop("일반")
    return ts


def metrics(g_s, p_s, g_t, p_t):
    g_s, p_s = np.array(g_s), np.array(p_s)
    r = {"n": int(len(g_s))}
    if not len(g_s):
        return r
    r["sentiment_acc"] = float((g_s == p_s).mean())
    r["sentiment_macro_f1"] = float(f1_score(g_s, p_s, average="macro", labels=mc.SENTS, zero_division=0))
    # 긍정 / 부정·혼합 / 중립 3분류 (대시보드에서 실제로 쓰는 묶음)
    m3 = lambda x: "부정·혼합" if x in ("부정", "혼합") else x
    r["sentiment_acc_3way"] = float(np.mean([m3(a) == m3(b) for a, b in zip(g_s, p_s)]))
    r["topics_exact"] = float(np.mean([set(a) == set(b) for a, b in zip(g_t, p_t)]))
    r["topic_sentiments_exact"] = float(np.mean([a == b for a, b in zip(g_t, p_t)]))
    r["topic_f1"] = {}
    for tp in mc.TOPICS:
        g = np.array([tp in x for x in g_t])
        q = np.array([tp in x for x in p_t])
        if g.sum() or q.sum():
            r["topic_f1"][tp] = {"f1": float(f1_score(g, q, zero_division=0)),
                                 "gold": int(g.sum()), "pred": int(q.sum())}
    # 주제가 맞은 경우의 주제별 감성 일치율
    hit = tot = 0
    for a, b in zip(g_t, p_t):
        for k in set(a) & set(b):
            tot += 1
            hit += a[k] == b[k]
    r["topic_sentiment_acc_on_matched"] = float(hit / tot) if tot else None
    r["confusion"] = {"labels": mc.SENTS,
                      "matrix(gold행×pred열)": confusion_matrix(g_s, p_s, labels=mc.SENTS).tolist()}
    return r


def cmd_compare(args):
    df = load_src(args.src).set_index("review_id")
    gold = [json.loads(l) for l in open(os.path.join(args.out, "gold.jsonl"), encoding="utf-8") if l.strip()]
    sample = [json.loads(l) for l in open(os.path.join(args.out, "sample.jsonl"), encoding="utf-8") if l.strip()]
    assert [g["id"] for g in gold] == [s["id"] for s in sample], "gold.jsonl 순서/개수가 sample.jsonl과 다릅니다"
    sub = df.loc[[g["id"] for g in gold]].reset_index()
    items = [{"content": c, "rating": int(r)} for c, r in zip(sub.content, sub.rating)]

    print("모델 상태:", mc.ft_status()["reason"], file=sys.stderr)
    model = mc.classify_reviews(items)
    rf = mc.rule_features(sub[["content", "rating"]])

    g_s = [g["s"] for g in gold]
    g_t = [norm_ts(g["t"], g["s"]) for g in gold]
    m_s = [m["sentiment"] for m in model]
    m_t = [m["topics"] for m in model]
    r_s = rf.rule_sentiment.tolist()
    r_t = [norm_ts(dict(x.split(":", 1) for x in v.split("|")), s)
           for v, s in zip(rf.rule_topic_sentiments, r_s)]
    # 별점만 보고 감성을 정하는 단순 기준선 (4~5 긍정, 3 혼합, 1~2 부정)
    b_s = ["긍정" if r >= 4 else "부정" if r <= 2 else "혼합" for r in sub.rating]

    easy = rf.rule_confident.values.astype(bool)
    out = {"setup": {"src": os.path.relpath(args.src, mc.ROOT).replace("\\", "/"), "n": len(gold),
                     "n_easy(규칙 확신)": int(easy.sum()), "n_hard": int((~easy).sum()),
                     "model": mc.ft_status()["reason"], "seed": SEED}}
    for name, ps, pt in [("모델(서버와 같은 경로)", m_s, m_t), ("규칙 단독", r_s, r_t)]:
        out[name] = {}
        for part, mask in [("전체", np.ones(len(gold), bool)), ("쉬움", easy), ("어려움", ~easy)]:
            idx = np.where(mask)[0]
            out[name][part] = metrics([g_s[i] for i in idx], [ps[i] for i in idx],
                                      [g_t[i] for i in idx], [pt[i] for i in idx])
    out["별점 기준선"] = {"전체": {"sentiment_acc": float(np.mean(np.array(b_s) == np.array(g_s)))}}
    out["분포"] = {"정답 감성": pd.Series(g_s).value_counts().to_dict(),
                 "모델 감성": pd.Series(m_s).value_counts().to_dict(),
                 "모델 판정 출처": pd.Series([m["source"] for m in model]).value_counts().to_dict()}

    with open(os.path.join(args.out, "compare.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    fmt = lambda t: "|".join(f"{k}:{v}" for k, v in t.items())
    pd.DataFrame({
        "review_id": sub.review_id, "store": sub.store, "rating": sub.rating, "content": sub.content,
        "difficulty": np.where(easy, "쉬움", "어려움"), "source": [m["source"] for m in model],
        "gold_s": g_s, "model_s": m_s, "rule_s": r_s,
        "gold_t": [fmt(t) for t in g_t], "model_t": [fmt(t) for t in m_t], "rule_t": [fmt(t) for t in r_t],
        "s_match": np.array(g_s) == np.array(m_s),
        "t_match": [set(a) == set(b) for a, b in zip(g_t, m_t)],
    }).to_csv(os.path.join(args.out, "compare_rows.csv"), index=False, encoding="utf-8-sig")
    keys = ("n", "sentiment_acc", "sentiment_acc_3way", "topics_exact")
    for name in ("모델(서버와 같은 경로)", "규칙 단독"):
        for part, v in out[name].items():
            print(name, part, {k: round(v[k], 3) if isinstance(v.get(k), float) else v.get(k) for k in keys})
    print("별점 기준선 감성 정확도", round(out["별점 기준선"]["전체"]["sentiment_acc"], 3))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["sample", "compare"])
    ap.add_argument("--src", default=os.path.join(mc.ROOT, "data", "maple", "reviews.csv"))
    ap.add_argument("--out", default=os.path.join(mc.ROOT, "work", "maple"))
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    a.src, a.out = os.path.abspath(a.src), os.path.abspath(a.out)
    {"sample": cmd_sample, "compare": cmd_compare}[a.cmd](a)


if __name__ == "__main__":
    main()
