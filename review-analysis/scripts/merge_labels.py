"""규칙 판정(확신 건) + 수동 판정(애매 건)을 합쳐 data/reviews_labeled.csv 생성.

입력: data/reviews.csv(원본), work/rule_labels.csv, work/manual/out_*.jsonl
출력: data/reviews_labeled.csv
  원본 컬럼 + sentiment, topics, topics_grouped, topic_sentiments, sent_<주제>..., keywords, label_source
"""
from __future__ import annotations

import glob
import json
import re
import sys

import pandas as pd

from classify import TOPIC_KEYWORDS, norm

sys.stdout.reconfigure(encoding="utf-8")

TOPICS = ["과금", "버그", "콘텐츠", "운영", "밸런스/성장", "UI/편의성", "캐릭터/아트", "광고"]
SENTS = {"긍정", "부정", "중립", "혼합"}
OTHER_THRESHOLD = 0.03  # 전체 리뷰 대비 언급 비중이 이 미만이면 '기타'로 묶음


# 키워드 '태그' 전용 보조 사전 (판정 규칙과 무관; 수동 판정 리뷰의 미표기 표현을 대표어로 묶기 위함)
KEYWORD_EXTRA: dict[str, dict[str, str]] = {
    "버그": {
        "업데이트불가": r"패치(파일)?|최신패치|(업데이트|업뎃)할때마다|캐시(를)?지우|재설치|지웠다(깔|까)|지우고다시|삭제(하고|후)다시|지운(회수|횟수)|"
                        r"(업데이트|업뎃|업대이트|업게이트|엡데이트)\S{0,6}(안|되지않|불가|못|기다|쥭|ㅡㅡ|좀|노)",
        "결제 미지급": r"(구매|샀|구입|결제)\S{0,20}(없어|안됩|안되|안돼|안들|들어오지|없어지|받을수가없|없고|안입혀|만들어)|날라갔|날아갔|동작하지않",
        "광고보상 미지급": r"광고\S{0,12}(보상|보석|아이템|리워드)\S{0,8}(안|못|품절|지급하지)|광고보기(가)?\S{0,3}(되지|안)",
        "진행/기능 오류": r"퀘스트\S{0,10}(안|넘어가지)|진행(이)?안|게이지(가)?안|사라졌|사라진|사라져|초기화(되|가)|변경(이)?안|채널\S{0,4}오류|"
                         r"안먹어|개방(이)?안|충전(이)?(되지|안)|안넘어가|클리어가안|합성(이)?안|안보여|안보이|보상(이)?안들어|안줌|해제가안|남아있|피격판정|삭제가되어",
        "접속불가": r"로그인중|세션|접속(이)?끊|네트워크|들어가지질",
        "로딩·용량": r"로딩|로그인\S{0,4}오래|용량|최소사양|구형|태블릿",
        "발열": r"손난로|불날|베터리|발적화",
        "튕김": r"크래시|꺼버림|나가집|팅깁",
    },
    "운영": {
        "이벤트·보상 미지급": r"200연|\d+뽑|이벤트\S{0,6}(안|못)|보상(을)?(못|안)받|안주(나|세|는)|언제주",
        "허위 광고": r"허위광고|거짓광고|광고처럼|광고에서|광고보고깔",
        "소통/CS": r"카페|탈퇴|대응|백섭|롤백|리뷰\S{0,4}(답|지우)|답장|관리",
        "이용제한": r"비정상|차단|공기계",
        "알림/공지": r"푸쉬|푸시|알림",
        "BM 운영": r"오구매|마케팅|상품(을|들)?\S{0,6}(배치|판매)",
    },
    "콘텐츠": {
        "소셜/퀘스트": r"퀘스트|멀티|친구|파티|pvp|길드",
        "독창성 부족": r"단순|특별한게없|차별성|표절|똑같|기존있던",
        "지루함": r"지겹|질릴|질린|루즈|노잼|숙제|노가다",
        "게임성/다양성": r"다양|할수있는게|매커니즘|메커니즘|수집|손컨|컨트롤|수동|방치형과수동|조화",
    },
    "과금": {
        "과금유도": r"돈(을)?(많이|개많이|요구)|bm|캐쉬유도|캐시유도|유도(도)?(심하지|적당)",
        "무과금": r"돈한푼|추가금액(없|안)|무과(?!금)",
        "확률": r"레1|레전1|리세|잘나와|잘나오|안뽑|안나옴|확률",
        "결제/환불": r"구글(플레이)?포인트|포인트사용|들여서|\d+만\d*천",
    },
    "밸런스/성장": {
        "성장 속도": r"노가다|진행속도|속도|느려|느리|오래걸|굳어|렙|레벨|강해",
        "보상/재화": r"잘줘|많이줘|많이주|템(을)?잘|아이템(도)?많이|주긴|보싱|퍼주|돈(을)?더|무기좀|입장권|돈도",
        "오프라인보상": r"켜놔|켜둬|켜놓|하루종일|절전|무접속|방치해두면|\d시간",
        "난이도": r"쎄|쌔|힘들|체력|데미지|공격속도",
    },
    "UI/편의성": {
        "조작": r"조작|컨트롤|터치|손컨",
        "설정/옵션": r"소리|노래끄|시작음|음소거|온오프|설정|끌수",
        "업데이트·로딩 번거로움": r"업데이트하라|(업뎃|업데이트)\S{0,3}귀찮|오래걸|로딩|세션",
        "UI": r"표시|띄워|헷갈|복잡|위치|잘려|누르는느낌",
    },
    "캐릭터/아트": {},
    "광고": {},
}


def kw_for(text: str, topics: list[str]) -> list[str]:
    tn = norm(text)
    out = []
    for tp in topics:
        if tp == "일반":
            continue
        hits = [kw for kw, pat in TOPIC_KEYWORDS[tp].items() if re.search(pat, tn)]
        hits += [kw for kw, pat in KEYWORD_EXTRA.get(tp, {}).items() if kw not in hits and re.search(pat, tn)]
        out += [f"{tp}/{k}" for k in hits] or [f"{tp}/(기타표현)"]
    return out


def main():
    raw = pd.read_csv("data/reviews.csv", encoding="utf-8-sig", dtype={"review_id": str})
    rule = pd.read_csv("work/rule_labels.csv", encoding="utf-8-sig", dtype={"review_id": str})
    rule = rule.set_index("review_id")

    manual = {}
    for f in sorted(glob.glob("work/manual/out_*.jsonl")):
        for line in open(f, encoding="utf-8"):
            line = line.strip()
            if line:
                o = json.loads(line)
                manual[str(o["id"])] = o
    need = set(rule.index[~rule.rule_confident])
    missing = need - set(manual)
    if missing:
        sys.exit(f"수동 판정 누락 {len(missing)}건: 예) {list(missing)[:5]}")

    rows = []
    for _, r in raw.iterrows():
        rid = r.review_id
        if rid in manual:
            o = manual[rid]
            s = o["s"]
            ts = {k: v for k, v in o["t"].items()}
            src = "manual"
        else:
            rr = rule.loc[rid]
            s = rr.rule_sentiment
            ts = dict(x.split(":", 1) for x in rr.rule_topic_sentiments.split("|"))
            src = "rule"
        assert s in SENTS, (rid, s)
        assert all(k in TOPICS + ["일반"] and v in SENTS for k, v in ts.items()), (rid, ts)
        if not ts:
            ts = {"일반": s}
        if "일반" in ts and len(ts) > 1:
            ts.pop("일반")
        topics = list(ts)
        row = r.to_dict()
        row.update({
            "sentiment": s,
            "topics": "|".join(topics),
            "topic_sentiments": "|".join(f"{k}:{v}" for k, v in ts.items()),
            "keywords": "|".join(kw_for(r.content if isinstance(r.content, str) else "", topics)),
            "label_source": src,
        })
        for tp in TOPICS + ["일반"]:
            row[f"sent_{tp}"] = ts.get(tp, "")
        rows.append(row)
    out = pd.DataFrame(rows)

    # 기타 묶음
    share = {tp: (out[f"sent_{tp}"] != "").mean() for tp in TOPICS}
    small = [tp for tp, v in share.items() if v < OTHER_THRESHOLD]
    out["topics_grouped"] = out.topics.apply(
        lambda t: "|".join(dict.fromkeys("기타" if x in small else x for x in t.split("|"))))
    cols = list(raw.columns) + ["sentiment", "topics", "topics_grouped", "topic_sentiments"] + \
        [f"sent_{tp}" for tp in TOPICS + ["일반"]] + ["keywords", "label_source"]
    out[cols].to_csv("data/reviews_labeled.csv", index=False, encoding="utf-8-sig")

    print("저장 data/reviews_labeled.csv", len(out), "| 출처:", out.label_source.value_counts().to_dict())
    print("감성:", out.sentiment.value_counts().to_dict())
    print("주제 언급 비중:")
    for tp in TOPICS + ["일반"]:
        n = (out[f"sent_{tp}"] != "").sum()
        print(f"  {tp:8s} {n:5d}  {n / len(out):.1%}" + ("  → 기타" if tp in small else ""))
    json.dump({"other_threshold": OTHER_THRESHOLD, "other_topics": small,
               "share": {k: round(v, 4) for k, v in share.items()}},
              open("work/grouping.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
