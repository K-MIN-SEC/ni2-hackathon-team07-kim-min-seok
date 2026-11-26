"""'달토끼 키우기' 고유 단어 제거 실험: 모델이 이 게임에만 나오는 단어에 기대어 판정하는지 확인한다.

방법
- 게임명·캐릭터·세계관·고유 재화/아이템·콜라보 이름(아래 TERMS)을 리뷰에서 지운 텍스트로
  ml_classify.py의 5-겹 교차검증(evaluate)을 그대로 다시 돌리고, 원본 텍스트로 돌린 결과와 비교한다.
- 같은 정답(reviews_labeled.csv)·같은 분할·같은 하이퍼파라미터. ML 입력(TF-IDF·형태소·임베딩)만 바뀐다.
- 규칙 특징은 두 경우 모두 원본 텍스트로 계산한다. 사람이 쓴 규칙은 그대로 두고 ML이 배운 것만 떼어 보기 위해서다.
- 학습된 모델(work/ml_model.joblib)의 감성 모델 가중치에서 고유 단어 특징의 순위·비중도 함께 본다.

사용
  python scripts/ablation_game_terms.py run      # 원본·제거 교차검증 두 번 + 비교 (CPU에서 수십 분)
  python scripts/ablation_game_terms.py report   # 저장된 결과로 비교만 다시

결과: work/ablation_game_terms/{base,mask}/ml_eval.json·ml_oof.csv, work/ablation_game_terms/report.json
(work/ml_eval.json 등 기존 결과 파일은 건드리지 않는다. 지운 텍스트의 임베딩은 기존 임베딩 캐시에 추가된다.)

한계: 이 실험은 "이 게임 리뷰 안에서 고유 단어에 기대지 않는가"까지만 보여 준다. 방치형 RPG 장르 어휘와
이 게임 리뷰의 말투는 그대로 남으므로, 다른 게임에서도 잘 맞는지는 다른 게임 리뷰에 정답을 붙여 평가해야 안다.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ml_classify as mc  # noqa: E402

OUT = os.path.join(mc.ROOT, "work", "ablation_game_terms")

H = "가-힣"
# (분류, 정규식). 리뷰 본문에서 실제로 나온 표기만 넣었다 (data/reviews_labeled.csv 기준).
TERMS = [
    ("게임명", r"달\s?토끼\s?키우기|달\s?터끼\s?키우기|달\s?키우기|달토끼|달터끼|달토키|달키(?![우])|달쁠뿡|김쁠뿡"),
    ("게임명(토끼)", r"토끼|토키"),
    # '린'은 '어린·느린' 같은 단어 일부와 겹치지 않게, 앞이 한글이 아니고 뒤가 조사·공백·기호일 때만
    ("캐릭터", rf"니아|미호|유나(?![{H}])|(?<![{H}])린(?=[이가은는과와도을를의랑]|\s|$|[^{H}])|레니|에스더|라이아나"),
    ("세계관", r"수호자|어둠의\s?시련|초월체|초월제"),
    ("재화/아이템", r"루비|당근|(?:드래곤|드레곤|사탕)\s?바주카"),
    ("콜라보", r"이터널\s?리턴|이터리|루미아\s?섬|스텔라\s?이브"),
]
PATTERNS = [(c, re.compile(p)) for c, p in TERMS]
ALL = re.compile("|".join(f"(?:{p})" for _, p in TERMS))


def mask(text):
    """고유 단어를 지운다 (공백으로 바꿔 앞뒤 단어가 붙지 않게)."""
    if not isinstance(text, str):
        return text
    return re.sub(r"\s{2,}", " ", ALL.sub(" ", text)).strip()


def has_term(texts) -> np.ndarray:
    return np.array([bool(ALL.search(t)) if isinstance(t, str) else False for t in texts])


# ------------------------------------------------------------------ 실행
def run():
    orig_load, orig_work = mc.load_labeled, mc.WORK
    for tag in ["base", "mask"]:
        out = os.path.join(OUT, tag)
        os.makedirs(out, exist_ok=True)
        shutil.copy(os.path.join(orig_work, "audit_sample.csv"), os.path.join(out, "audit_sample.csv"))

        def load(tag=tag):
            lab, rf = orig_load()  # 규칙 특징은 원본 텍스트로
            if tag == "mask":
                lab = lab.copy()
                lab["content"] = lab.content.apply(mask)
            return lab, rf

        mc.load_labeled, mc.WORK = load, out
        print(f"\n##### {tag} ({'원본' if tag == 'base' else '고유 단어 제거'}) #####", flush=True)
        try:
            mc.evaluate()
        finally:
            mc.load_labeled, mc.WORK = orig_load, orig_work
    report()


# ------------------------------------------------------------------ 비교
def _ts_eq(a, b):
    return dict(x.split(":", 1) for x in str(a).split("|")) == dict(x.split(":", 1) for x in str(b).split("|"))


def weight_analysis():
    """학습된 감성 모델에서 고유 단어 특징(글자·단어·형태소)의 순위와 가중치 비중."""
    if not os.path.exists(mc.MODEL_PATH):
        return None
    rm = mc.load_model()["review"]
    names = []
    for pre, v in [("char", rm.v_char), ("word", rm.v_word), ("morph", rm.v_morph)]:
        names += [(pre, f) for f in v.get_feature_names_out()]
    nv = len(names)
    W = rm.sent.coef_[:, :nv]
    absw = np.abs(W).max(0)
    is_game = np.array([bool(ALL.search(f.split("/")[0] if pre == "morph" else f)) for pre, f in names])
    rank = np.empty(nv, int)
    rank[absw.argsort()[::-1]] = np.arange(1, nv + 1)
    top = sorted(np.where(is_game)[0], key=lambda k: -absw[k])[:15]
    return {
        "n_vocab_features": nv, "n_game_features": int(is_game.sum()),
        "game_weight_share": float(absw[is_game].sum() / absw.sum()),
        "game_in_top1000": int((is_game & (rank <= 1000)).sum()),
        "top_game_features": [{"feature": f"{names[k][0]}:{names[k][1]}", "rank": int(rank[k]),
                               **{c: round(float(W[j, k]), 3) for j, c in enumerate(rm.sent.classes_)}}
                              for k in top],
    }


def report():
    lab = pd.read_csv(mc.LABELED, encoding="utf-8-sig", dtype={"review_id": str})
    text = lab.content.fillna("")
    has = has_term(text)
    hard = (lab.label_source == "manual").values
    g, gts = lab.sentiment.values, lab.topic_sentiments.values
    E = {t: json.load(open(os.path.join(OUT, t, "ml_eval.json"), encoding="utf-8")) for t in ["base", "mask"]}
    O = {t: pd.read_csv(os.path.join(OUT, t, "ml_oof.csv"), encoding="utf-8-sig", dtype={"review_id": str}) for t in E}
    for t in O:
        assert (O[t].review_id.values == lab.review_id.values).all(), "ml_oof.csv 순서가 정답과 다름"

    rep = {"terms": {c: p for c, p in TERMS},
           "reviews_with_terms": {"all": int(has.sum()), "hard": int((has & hard).sum()), "n": len(lab)},
           "term_counts": {c: int(sum(bool(p.search(x)) for x in text)) for c, p in PATTERNS}}

    keys = ["sentiment_acc", "sentiment_macro_f1", "topics_exact", "topic_sentiments_exact"]
    rep["metrics"] = {}
    print("=== 지표: 원본 → 고유 단어 제거 ===")
    print(f"{'방법':14s} {'범위':9s} " + " ".join(f"{k:>30s}" for k in keys))
    for a, b in zip(E["base"]["results"], E["mask"]["results"]):
        for sc in ["hard_2030", "all_6349"]:
            rep["metrics"][f"{a['method']}/{sc}"] = {k: {"base": a[sc][k], "mask": b[sc][k]} for k in keys}
            if a["method"] == "규칙 단독":
                continue
            print(f"{a['method']:14s} {sc:9s} " + " ".join(
                f"{a[sc][k]:8.1%} → {b[sc][k]:6.1%} ({(b[sc][k] - a[sc][k]) * 100:+.2f}%p)" for k in keys))
    rep["topic_f1_ml_hard"] = {tp: {"base": v, "mask": E["mask"]["results"][1]["hard_2030"]["topic_f1"][tp]}
                               for tp, v in E["base"]["results"][1]["hard_2030"]["topic_f1"].items()}

    print("\n=== 하이브리드, 고유 단어 포함 여부별 ===")
    rep["by_subset"] = {}
    for nm, m in [("포함·어려운", has & hard), ("없음·어려운", ~has & hard), ("포함·전체", has), ("없음·전체", ~has)]:
        r = {}
        for t in O:
            r[t] = {"sentiment_acc": float((O[t].sentiment.values == g)[m].mean()),
                    "topic_sentiments_exact": float(np.mean([_ts_eq(a, b) for a, b in
                                                             zip(O[t].topic_sentiments.values[m], gts[m])]))}
        rep["by_subset"][nm] = {"n": int(m.sum()), **r}
        print(f"{nm:8s} n={m.sum():5d}  감성 {r['base']['sentiment_acc']:.1%} → {r['mask']['sentiment_acc']:.1%}"
              f"  주제별 감성 {r['base']['topic_sentiments_exact']:.1%} → {r['mask']['topic_sentiments_exact']:.1%}")

    pb, pm = O["base"].sentiment.values, O["mask"].sentiment.values
    ch = hard & (pb != pm)
    rep["hard_sentiment_changes"] = {
        "changed": int(ch.sum()), "changed_with_terms": int((ch & has).sum()),
        "newly_right": int((ch & (pm == g)).sum()), "newly_wrong": int((ch & (pb == g)).sum())}
    print("\n어려운 건 감성 판정 변화:", rep["hard_sentiment_changes"])
    rep["topic_negative_counts"] = {"gold": E["base"]["topic_negative_counts"]["gold"],
                                    "base": E["base"]["topic_negative_counts"]["hybrid_cv"],
                                    "mask": E["mask"]["topic_negative_counts"]["hybrid_cv"]}

    w = weight_analysis()
    if w:
        rep["model_weights"] = w
        print(f"\n학습된 감성 모델: 어휘 특징 {w['n_vocab_features']:,}개 중 고유 단어 {w['n_game_features']}개, "
              f"|가중치| 비중 {w['game_weight_share']:.2%}, 상위 1000위 안 {w['game_in_top1000']}개")
        for f in w["top_game_features"][:8]:
            print(f"  #{f['rank']:6d} {f['feature']}")
    json.dump(rep, open(os.path.join(OUT, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n저장", os.path.join(OUT, "report.json"))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd not in ("run", "report"):
        sys.exit(__doc__)
    {"run": run, "report": report}[cmd]()
