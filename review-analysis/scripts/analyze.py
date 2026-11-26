"""data/reviews_labeled.csv → work/analysis.json (대시보드에 쓰는 모든 수치를 코드로 계산)

우선순위 점수 (항목 = 주제/키워드, 부정·혼합 언급 기준)
  N  = 해당 항목의 부정(또는 혼합) 리뷰 수
  W  = Σ log2(1 + thumbs_up)   (같은 리뷰들의 좋아요 가중; 소수 리뷰의 극단값 완화)
  G  = 최근 추세 = clip(r, 0, 3) / 3
       r = 최근 6개월 언급률(평활) / 이전 기간 언급률
       최근 언급률(평활) = (n_recent + K·p_base) / (R_recent + K),  K = 20 (표본이 작아 기준선 쪽으로 수축)
       p_base = n_base / R_base  (R = 그 기간 전체 리뷰 수)
  Score = 100 × (0.5·N/N_max + 0.3·W/W_max + 0.2·G)
"""
from __future__ import annotations

import collections
import json
import math
import re
import sys

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

TOPICS = ["과금", "버그", "콘텐츠", "운영", "밸런스/성장", "UI/편의성", "캐릭터/아트", "광고"]
SENTS = ["긍정", "혼합", "중립", "부정"]
RECENT_DAYS = 182
K_SMOOTH = 20
MIN_ITEM_N = 8
STOP = set("""게임 너무 진짜 정말 그냥 이거 이게 하고 있는 있어요 있습니다 있고 있음 합니다 해서 하는 하면 하지만 근데 그리고 다른
제가 저는 이건 이런 그래도 계속 아직 일단 조금 많이 좀 거의 엄청 완전 매우 아주 지금 처음 다시 이제 그런데 같아요 같습니다 하는데 해도
있는데 있지만 게임은 게임이 게임을 게임도 게임에 달토끼 키우기 방치형 입니다 했는데 됩니다 되는 없는 없고 없어요 없음 없네요 그런 해주세요
있어서 하나 것도 뭔가 이게임 이게임은 게임이에요 게임입니다 게임이네요 하네요 하나요 인데 같은 같은데 정도 부탁드립니다 감사합니다 안녕하세요""".split())


def load():
    d = pd.read_csv("data/reviews_labeled.csv", encoding="utf-8-sig", dtype={"review_id": str})
    d["date"] = pd.to_datetime(d["date"])
    d["content"] = d["content"].fillna("")
    d["thumbs_up"] = d["thumbs_up"].fillna(0).astype(int)
    d["minor"] = d["version"].astype(str).str.extract(r"^(\d+\.\d+)")[0]
    for c in [c for c in d.columns if c.startswith("sent_")] + ["keywords", "topics", "topics_grouped"]:
        d[c] = d[c].fillna("")
    return d


def grouped_topic_sent(d, grouping):
    """기타로 묶인 주제의 감성 합성 (긍·부 섞이면 혼합)"""
    small = grouping["other_topics"]
    show = [t for t in TOPICS if t not in small] + (["기타"] if small else []) + ["일반"]
    for t in show:
        if t == "기타":
            def comb(r):
                vals = {r[f"sent_{s}"] for s in small if r[f"sent_{s}"]}
                if not vals:
                    return ""
                if len(vals) == 1:
                    return vals.pop()
                if "긍정" in vals and "부정" in vals or "혼합" in vals:
                    return "혼합"
                return sorted(vals - {"중립"})[0] if vals - {"중립"} else "중립"
            d["gs_기타"] = d.apply(comb, axis=1)
        else:
            d[f"gs_{t}"] = d[f"sent_{t}"].fillna("")
    return show


def kw_list(s):
    return [k for k in str(s).split("|") if k and k != "nan"]


def split_kw(k):
    """'밸런스/성장/보상/재화' → ('밸런스/성장', '보상/재화')  (주제명에 '/'가 있어 접두사로 분리)"""
    for tp in sorted(TOPICS, key=len, reverse=True):
        if k.startswith(tp + "/"):
            kw = k[len(tp) + 1:]
            return tp, ("기타 표현" if kw == "(기타표현)" else kw)
    raise ValueError(k)


def pick_quotes(sub, n=3, min_len=25, max_len=320):
    s = sub[(sub.content.str.len() >= min_len)]
    if len(s) < n:
        s = sub
    # 대표성: 좋아요가 많을수록, 다른 주제가 적게 섞일수록, 너무 길지 않을수록 우선
    ntop = s.topics.str.count(r"\|") + 1
    L = s.content.str.len()
    rank = s.thumbs_up.apply(lambda x: math.log2(1 + x)) - 1.5 * (ntop - 1) - 1.5 * (L > 220) + 0.002 * L.clip(upper=200)
    s = s.assign(_rank=rank).sort_values("_rank", ascending=False).head(n)
    return [{"text": r.content[:max_len] + ("…" if len(r.content) > max_len else ""),
             "rating": int(r.rating), "thumbs": int(r.thumbs_up), "date": r.date.strftime("%Y-%m-%d"),
             "store": "Google Play" if r.store == "google_play" else "App Store",
             "version": "" if pd.isna(r.version) else str(r.version)} for r in s.itertuples()]


def top_terms(texts, n=10):
    c = collections.Counter()
    for t in texts:
        for w in set(re.findall(r"[가-힣A-Za-z]{2,}", t)):
            if w not in STOP:
                c[w] += 1
    return c.most_common(n)


def main():
    d = load()
    grouping = json.load(open("work/grouping.json", encoding="utf-8"))
    show = grouped_topic_sent(d, grouping)
    N = len(d)
    end = d.date.max()
    recent_start = end - pd.Timedelta(days=RECENT_DAYS)
    d["recent"] = d.date > recent_start
    R_recent, R_base = int(d.recent.sum()), int((~d.recent).sum())
    out: dict = {"meta": {
        "n": N, "stores": d.store.value_counts().to_dict(),
        "start": d.date.min().strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d"),
        "recent_start": recent_start.strftime("%Y-%m-%d"), "recent_n": R_recent, "base_n": R_base,
        "last30_n": int((d.date > end - pd.Timedelta(days=30)).sum()),
        "label_source": d.label_source.value_counts().to_dict(),
        "grouping": grouping, "topics_shown": show,
        "avg_rating": round(d.rating.mean(), 2),
        "rating_dist": {str(k): int(v) for k, v in d.rating.value_counts().sort_index().items()},
        "store_stats": {s: {"n": int(len(g)), "start": g.date.min().strftime("%Y-%m-%d"),
                            "end": g.date.max().strftime("%Y-%m-%d"), "avg": round(g.rating.mean(), 2),
                            "rating_dist": {str(k): int(v) for k, v in g.rating.value_counts().sort_index().items()}}
                        for s, g in d.groupby("store")},
        "formula": __doc__.split("우선순위 점수", 1)[1].strip(),
    }}

    # 1) 전체 감성
    out["sentiment_overall"] = {s: int((d.sentiment == s).sum()) for s in SENTS}

    # 2) 주제 × 주제별 감성 교차표
    xt = []
    for t in show:
        col = d[f"gs_{t}"]
        m = col != ""
        row = {"topic": t, "n": int(m.sum()), "share": round(m.mean(), 4)}
        for s in SENTS:
            row[s] = int((col == s).sum())
            row[s + "_pct"] = round((col == s).sum() / max(m.sum(), 1), 4)
        xt.append(row)
    out["crosstab"] = xt
    # 리뷰 단위 전체 감성 × 주제 (참고표)
    out["crosstab_review_level"] = [
        {"topic": t, **{s: int(((d[f"gs_{t}"] != "") & (d.sentiment == s)).sum()) for s in SENTS}} for t in show]

    # 3) 감성 × 주제별 키워드 비중
    kwtab = []
    for t in show:
        if t == "일반":
            continue
        members = grouping["other_topics"] if t == "기타" else [t]
        for s in ["부정", "긍정", "혼합"]:
            sub = d[d[f"gs_{t}"] == s]
            if len(sub) == 0:
                continue
            c = collections.Counter()
            for ks in sub.keywords:
                for k in set(kw_list(ks)):
                    tp, kw = split_kw(k)
                    if tp in members:
                        c[(kw if t != "기타" else (tp if kw == tp else f"{tp}·{kw}"))] += 1
            kwtab.append({"topic": t, "sentiment": s, "n": int(len(sub)),
                          "keywords": [{"kw": k, "n": v, "pct": round(v / len(sub), 4)} for k, v in c.most_common(12)],
                          "terms": [{"kw": k, "n": v, "pct": round(v / len(sub), 4)} for k, v in top_terms(sub.content)]})
    out["keywords"] = kwtab

    # 4) 개선 우선순위 (주제/키워드 단위)
    items = []
    for tp in TOPICS:
        neg = d[d[f"sent_{tp}"].isin(["부정", "혼합"])]
        kws = collections.defaultdict(list)
        for r in neg.itertuples():
            for k in set(kw_list(r.keywords)):
                a, b = split_kw(k)
                if a == tp:
                    kws[b].append(r.Index)
        for kw, idx in kws.items():
            if kw == "기타 표현":  # 대표어로 묶이지 않은 잔여 표현은 조치 항목이 아니므로 순위에서 제외
                continue
            sub = d.loc[idx]
            n = len(sub)
            if n < MIN_ITEM_N:
                continue
            nr = int(sub.recent.sum()); nb = n - nr
            p_base = nb / R_base if R_base else 0
            rate_recent = (nr + K_SMOOTH * p_base) / (R_recent + K_SMOOTH)
            ratio = rate_recent / p_base if p_base > 0 else (3.0 if nr else 1.0)
            items.append({"topic": tp, "kw": kw, "n": n, "recent_n": nr, "base_n": nb,
                          "last30_n": int((sub.date > end - pd.Timedelta(days=30)).sum()),
                          "thumbs": int(sub.thumbs_up.sum()),
                          "W": round(float(sub.thumbs_up.apply(lambda x: math.log2(1 + x)).sum()), 2),
                          "recent_rate": round(nr / R_recent, 4) if R_recent else 0,
                          "base_rate": round(p_base, 4), "ratio": round(ratio, 3),
                          "G": round(min(max(ratio, 0), 3) / 3, 4), "idx": idx})
    nmax = max(i["n"] for i in items); wmax = max(i["W"] for i in items)
    for i in items:
        i["score"] = round(100 * (0.5 * i["n"] / nmax + 0.3 * i["W"] / wmax + 0.2 * i["G"]), 1)
        sub = d.loc[i.pop("idx")]
        i["quotes"] = pick_quotes(sub, 3)
    items.sort(key=lambda x: -x["score"])
    out["priority"] = items

    # 주제 단위 우선순위(요약)
    tsum = []
    for tp in TOPICS:
        sub = d[d[f"sent_{tp}"].isin(["부정", "혼합"])]
        n = len(sub); nr = int(sub.recent.sum()); nb = n - nr
        p_base = nb / R_base
        rate_recent = (nr + K_SMOOTH * p_base) / (R_recent + K_SMOOTH)
        ratio = rate_recent / p_base if p_base else 1
        tsum.append({"topic": tp, "n": n, "recent_n": nr, "W": round(float(sub.thumbs_up.apply(lambda x: math.log2(1 + x)).sum()), 2),
                     "ratio": round(ratio, 3), "G": round(min(ratio, 3) / 3, 4)})
    nm = max(t["n"] for t in tsum); wm = max(t["W"] for t in tsum)
    for t in tsum:
        t["score"] = round(100 * (0.5 * t["n"] / nm + 0.3 * t["W"] / wm + 0.2 * t["G"]), 1)
    out["priority_topics"] = sorted(tsum, key=lambda x: -x["score"])

    # 5) 장점
    strengths = []
    for tp in TOPICS:
        pos = d[d[f"sent_{tp}"] == "긍정"]
        mixed_pos = d[d[f"sent_{tp}"] == "혼합"]
        if len(pos) == 0:
            continue
        c = collections.Counter()
        for ks in pos.keywords:
            for k in set(kw_list(ks)):
                a, b = split_kw(k)
                if a == tp:
                    c[b] += 1
        negn = int((d[f"sent_{tp}"] == "부정").sum())
        strengths.append({"topic": tp, "n": int(len(pos)), "neg_n": negn, "mixed_n": int(len(mixed_pos)),
                          "pos_ratio": round(len(pos) / max(len(pos) + negn, 1), 4),
                          "keywords": [{"kw": k, "n": v, "pct": round(v / len(pos), 4)} for k, v in c.most_common(6)],
                          "quotes": pick_quotes(pos, 3)})
    strengths.sort(key=lambda x: -x["n"])
    gen_pos = d[d["sent_일반"] == "긍정"]
    out["strengths"] = strengths
    out["general_positive"] = {"n": int(len(gen_pos)), "terms": [{"kw": k, "n": v} for k, v in top_terms(gen_pos.content, 15)]}

    # 6) 월별 추이
    d["month"] = d.date.dt.to_period("M").astype(str)
    monthly = []
    for m, g in d.groupby("month"):
        row = {"month": m, "n": int(len(g)), "neg": int((g.sentiment == "부정").sum()),
               "mixed": int((g.sentiment == "혼합").sum()), "pos": int((g.sentiment == "긍정").sum()),
               "avg_rating": round(g.rating.mean(), 2)}
        for tp in TOPICS:
            row["neg_" + tp] = int(g[f"sent_{tp}"].isin(["부정", "혼합"]).sum())
        monthly.append(row)
    out["monthly"] = monthly
    # 분기별 (표본이 작은 후반부용)
    d["quarter"] = d.date.dt.to_period("Q").astype(str)
    quarterly = []
    for q, g in d.groupby("quarter"):
        row = {"q": q, "n": int(len(g)), "neg_or_mixed": int(g.sentiment.isin(["부정", "혼합"]).sum())}
        for tp in TOPICS:
            row["neg_" + tp] = int(g[f"sent_{tp}"].isin(["부정", "혼합"]).sum())
        quarterly.append(row)
    out["quarterly"] = quarterly

    # 7) 버전별 추이 (minor 버전, 리뷰 30건 이상)
    vs = []
    for v, g in d.dropna(subset=["minor"]).groupby("minor"):
        if len(g) < 30:
            continue
        row = {"version": v, "n": int(len(g)), "first": g.date.min().strftime("%Y-%m-%d"),
               "last": g.date.max().strftime("%Y-%m-%d"),
               "neg_share": round(g.sentiment.isin(["부정", "혼합"]).mean(), 4),
               "avg_rating": round(g.rating.mean(), 2)}
        for tp in TOPICS:
            row["neg_" + tp] = round(g[f"sent_{tp}"].isin(["부정", "혼합"]).mean(), 4)
        vs.append(row)
    vs.sort(key=lambda r: tuple(int(x) for x in r["version"].split(".")))
    changes = []
    for a, b in zip(vs, vs[1:]):
        diff = b["neg_share"] - a["neg_share"]
        tdiff = sorted(((tp, b["neg_" + tp] - a["neg_" + tp]) for tp in TOPICS), key=lambda x: -abs(x[1]))[:3]
        g = d[(d.minor == b["version"])]
        neg = g[g.sentiment.isin(["부정", "혼합"])]
        changes.append({"from": a["version"], "to": b["version"], "to_first": b["first"], "diff": round(diff, 4),
                        "from_share": a["neg_share"], "to_share": b["neg_share"], "n": b["n"],
                        "top_topic_changes": [{"topic": tp, "diff": round(x, 4)} for tp, x in tdiff],
                        "quotes": pick_quotes(neg, 2) if diff > 0 else pick_quotes(g[g.sentiment == "긍정"], 1)})
    out["versions"] = vs
    out["version_changes"] = sorted(changes, key=lambda c: -abs(c["diff"]))[:8]

    json.dump(out, open("work/analysis.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=int)
    print("저장 work/analysis.json")
    print("교차표:")
    for r in xt:
        print(f"  {r['topic']:8s} n={r['n']:5d} ({r['share']:.1%})  " + "  ".join(f"{s} {r[s]}({r[s + '_pct']:.0%})" for s in SENTS))
    print("우선순위 TOP10:")
    for i in items[:10]:
        print(f"  {i['score']:5.1f}  {i['topic']}/{i['kw']}  N={i['n']} W={i['W']} 최근6M={i['recent_n']} ratio={i['ratio']}")
    print("장점:", [(s["topic"], s["n"]) for s in strengths])


if __name__ == "__main__":
    main()
