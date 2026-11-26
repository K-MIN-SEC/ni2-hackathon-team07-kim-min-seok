"""1차 규칙 기반 분류 (감성 + 주제 + 주제별 감성 + 키워드).

입력: data/reviews.csv (원본, 읽기 전용)
출력: work/rule_labels.csv  (review_id 기준 규칙 판정 + 애매 플래그 + rule_confident)

판정 원칙
- 감성은 별점이 아니라 리뷰 내용으로 판정 (긍정/부정/중립/혼합)
- 주제는 복수 선택. 어느 주제에도 안 걸리면 '일반'
- 주제별 감성: 해당 주제 키워드가 들어 있는 절(clause)의 극성 + 키워드 고유 극성
- 문의형: 구체적 문제(버그/계정 등 고유 부정 키워드)가 보이면 부정, 아니면 중립
"""
from __future__ import annotations

import os
import re
import sys

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------- 주제 키워드
# (정규식은 공백 제거 + 소문자화한 텍스트에 적용)
# 각 주제: {대표키워드: 정규식}
TOPIC_KEYWORDS: dict[str, dict[str, str]] = {
    "과금": {
        "무과금": r"무과금|무자본|무현질|현질(을)?안|과금(을)?안|현질없이|과금없이|돈(을)?안(쓰|써|들)|현질(을)?하지않",
        "과금": r"(?<!무)과금(?!유도)",
        "현질": r"현질(?!유도)|현금결제|지르|질렀|지름",
        "과금유도": r"과금유도|현질유도|돈독|돈만밝|돈벌|창렬|비싸|비쌈|가성비|혜자",
        "확률": r"확률|운빨|극악|(레전드|전설|유니크|신화|에픽|무기|스킬|원하는)\S{0,8}(안뜸|안뜨|안떠|안나와|안나옴|안나오|안떴|안나|하나도안)",
        "뽑기": r"뽑기|가챠|뽑|소환|천장",
        "패스/패키지": r"패스|패키지|월정액|상품",
        "결제/환불": r"결제|환불|구매|구입|\d+(,\d+)?원|만원",
        "광고제거": r"광고제거",
    },
    "버그": {
        "튕김": r"튕|팅기|팅김|팅겨|팅겼|팅구|강제종료|꺼짐|꺼져|꺼지|꺼졌|나가짐|나가져|나가지네|나가버",
        "렉": r"렉|랙|버벅|끊김|끊겨|끊기|프레임|멈춤|멈춰|멈추|멈췄|프리징|느려지",
        "접속불가": r"접속(이|은|도)?안|접속불가|접속(이)?(되지|불)|로그인(이|은)?안|실행(이|은|도)?안|안켜|안켜져|시작(이)?안|무한로딩|로딩(이|만)?\S{0,4}(안|계속)|네트워크|서버|세션만료|들어가지지|안들어가져|안들어가지",
        "발열": r"발열|뜨거|뜨겁|열받|열이|배터리|최적화",
        "버그/오류": r"버그|오류|에러|error|먹통|검은화면|블랙화면|화면이까",
        "업데이트불가": r"(업데이트|업뎃)(가|이|는|도)?\S{0,3}안(되|돼|됨|됩)|최신빌드|업데이트하라고|업데이트(가|를)?못|(업데이트|업뎃)\S{0,3}문제|(업데이트|업뎃)만\S{0,6}(시간|분)",
        "결제 미지급": r"(결제|구매|패스|패키지|쿠폰|구입)\S{0,20}(안들어|안들어와|안들어오|못받|안받아|안줘|안주|미지급|지급(이|은)?안|적용(이|되지|안))|중복결제|(2|두)번결제",
        "설치/로그인지연": r"깔리지(가)?않|설치(가|도)?안|안깔|보안정책|로그인(이)?\S{0,4}(오래|느)|불러온다고|다운(로드)?(이|가)?\S{0,3}느",
    },
    "콘텐츠": {
        "컨텐츠": r"컨텐츠|콘텐츠|컨텐트|컨탠츠|할게|할것|할거(리)?(?!같)|즐길거리|볼거리",
        "스토리/챕터": r"스토리|엔딩|챕터|시나리오",
        "보스": r"보스",
        "던전/모드": r"던전|시련|레이드|모드|서바이벌|길드|pvp|아레나|타워|수호자의탑|탑",
        "스킬/장비": r"스킬|룬|무기|장비|펫|유물|동료",
        "이벤트/콜라보": r"이벤트|콜라보",
        "업데이트": r"업데이트(?!가?\S{0,3}안|하라고|가?못|\S{0,3}문제|만)|업뎃(?!이?\S{0,3}안|\S{0,3}문제|만)|패치|신규|신캐",
        "지루함": r"지루|질림|질려|질리|고갈|할게없|할것도없|할거없|반복|단조",
    },
    "운영": {
        "계정": r"계정|연동|아이디|로그아웃|게스트|데이터(가)?(날|사라|없어)|초기화|날아|날라|사라졌|사라짐",
        "복구": r"복구",
        "쿠폰": r"쿠폰",
        "소통/CS": r"소통|피드백|공지|운영진|운영자|(?<!자동)운영|개발자|개발진|제작자|답변|문의|고객센터|\bcs\b|이메일|메일",
        "점검": r"점검",
        "신규서버": r"신섭|신서버|새서버|서버통합",
        "이용제한": r"이용제한|정지|제재|밴당|영구",
        "iOS지원": r"아이폰|ios|애플",
    },
    "밸런스/성장": {
        "난이도": r"난이도|어려|어렵|쉽|쉬움|쉬워|못깨|못잡|안깨|안잡|막힘|막혀|막히|막혔|벽(이|에)|억까",
        "성장": r"성장|레벨업|렙업|전투력|스펙|육성|키우는맛|키울맛|정체|안오르|안올라",
        "보상/재화": r"보상|재화|루비|보석|다이아|골드|수급|퍼주|퍼줌|퍼줘|짜다|짜요|짜네",
        "밸런스": r"밸런스|너프|상향|하향|인플레|사기캐|op",
        "랭킹 격차": r"랭킹|랭커|순위",
        "오프라인보상": r"오프라인보상|방치보상|오프보상",
    },
    "UI/편의성": {
        "UI": r"(?<![a-z])ui(?![a-z])|유아이|인터페이스|글씨|글자|폰트|버튼|메뉴|화면이\S{0,3}작|창이작",
        "절전모드": r"절전",
        "화면": r"화면회전|가로|세로|해상도|태블릿|테블릿|화면비|아이패드|탭으로",
        "편의": r"편의|편리|편하|편해|불편|자동|일괄|스킵|빨리감기|배속",
        "가이드/설명": r"가이드|튜토|설명|도움말|안내|퀘스트",
    },
    "캐릭터/아트": {
        "귀여움": r"귀엽|귀여|귀욤|귀염|큐트|아기자기|깜찍|cute",
        "캐릭터": r"캐릭|케릭|캐랙|코스튬|의상|스킨|일러|라이브2d|live2d|니아|달토끼(가|는|도|랑|들|이)",
        "그래픽": r"그래픽|도트|디자인|모션|연출|이펙트|퀄리티|작화|화풍|그림체|그림",
        "사운드": r"성우|더빙|목소리|보이스|bgm|브금|음악|ost|효과음|사운드|노래",
    },
    "광고": {
        "광고": r"광고(?!제거|멘트)",
    },
}

# ------------------------------------------------------------- 감성 사전
# 부정 → 긍정으로 뒤집히는 패턴 (먼저 치환)
NEGATED_NEG = [
    r"(렉|랙|버그|발열|오류|튕김|팅김|과금유도|현질유도|강요|광고|단점|부담|스트레스|문제|불만|흠|과금압박)(이|가|도|은|는)?(거의|별로|하나도|전혀)?(없|안느껴)",
    r"(현질|과금|돈)(을|은)?(안|하지않)(해도|하고도|하셔도|써도|쓰고도|들여도)",
    r"(안|않)(튕|팅|렉)\S{0,3}(서|고)(좋|최고|만족)",
    r"질리지(도)?않|지루(하지|할틈)(도)?(않|없)|지루할틈",
    r"아깝지않|후회(안|없|하지않)|부족함(이)?없|흠잡을(데|곳)(가|이)?없",
    r"나쁘지않|나쁘지도않|괜찮",
]
NEG_PHRASES_FIRST = [  # 긍정어를 포함하지만 부정인 구
    r"재미(가|는|도)?없|재미(가|는)?업|재미(가)?\S{0,2}없어|재밌지(가)?않|재미있지않|노잼|재미(가)?떨어|재미(를)?못|좋지않|좋지못|좋지도않|별로좋|추천(안|하지않|못|비추)|비추",
    r"할만(하지|한게)?(않|없)",
]
POS_WORDS = (
    r"재밌|재미있|재밋|재미(가|도)?(있|좋|쏠쏠|짐|지네)|재미짐|잼있|잼나|잼남|잼씀|잼써|잼슴|꿀잼|존잼|핵잼|개잼|꿀겜|갓겜|굿겜|명작|"
    r"좋아|좋네|좋고|좋음|좋습|좋은|좋다|좋았|좋던|좋을|좋구|좋더|좋어|좋져|좋죠|좋으|"
    r"최고|추천|강추|귀엽|귀여|귀욤|할만|할맛|만족|감사|고맙|훌륭|대박|짱|굿|good|nice|best|great|love|fun|"
    r"중독|사랑|행복|힐링|편하|편해|깔끔|예쁘|이쁘|멋지|멋있|완벽|혜자|퍼줌|퍼주|넉넉|착하|기대|응원|화이팅|파이팅|"
    r"괜찮|나쁘지않|무난|쏠쏠|든든|시간가는줄|밤새|빠져|👍|👌|❤|♥|♡|😍|🥰|🤩|"
    r"굳|구웃|(?<!잼민)잼(?!민)|젬있|재있|재밎|재미(?!없|가없|는없|도없|업|떨|를못|가업)|즐겜|조아|따봉|졸잼|꾸르잼|커엽|기여|와우|낫뱃|낫배드|"
    r"원탑|1황|1위|awesome|cool|흥미|신선|맛있|맛잇|감다살|축하|친절|홧팅|수고|퀄리티(가)?(좋|장난아|진심|높)|명품|띵작|갓-?겜"
)
NEG_WORDS = (
    r"노잼|별로|최악|쓰레기|짜증|불편|아쉽|아쉬|실망|싫|안됨|안되|안돼|안됩|안됐|못하|못함|못해|못깨|못잡|"
    r"튕|팅기|팅김|팅겨|렉|랙|버벅|끊김|끊겨|멈춤|멈춰|먹통|발열|뜨거|오류|에러|버그|고쳐|고치|수정(해|좀|바)|해결(해|좀|바|부탁)|"
    r"환불|사기|삭제|접습|접음|접었|접는|접어|접을|그만|화나|빡치|빡쳐|빡침|억까|심함|심해|심하|심각|비싸|비쌈|창렬|구리|구림|"
    r"불량|망겜|똥겜|후회|문제|힘들|어렵|어려|지루|질림|질려|느림|느려|부족|날아|날라|초기화|사라졌|사라짐|안줘|안주|미지급|"
    r"안들어|안나와|안나옴|안뜸|안뜨|짜다|짜요|짜네|극악|과금유도|현질유도|돈독|양산|표절|베낌|베꼈|복붙|ㅡㅡ|;;|🤬|😡|💩|"
    r"답답|귀찮|피곤|피로|스트레스|불만|거르|걸러|비추|하지마|최적화(가)?안|엉망|개판|허접|조잡|성의없|대충|"
    r"아까|느리|오래걸|작아|작음|아픔|아파|어지러|이용제한|뭐같|이딴|쓰뤅|하락|지워졌|어디감|깔리지(가)?않|안깔|뺑이"
)
INQUIRY = r"\?|어떻게|방법|왜|하나요|되나요|인가요|건가요|나요$|까요|주세요|바랍니다|부탁"
CONTRAST_SPLIT = r"[.!?\n~·;]+|(?:근데|하지만|그런데|다만|그러나|그래도|그치만|그렇지만|반면|단점은|아쉬운점은|아쉬운건)"


def norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s).lower())


def preprocess(t: str) -> tuple[str, int]:
    """부정된 부정어를 긍정 토큰으로 치환. (치환 텍스트, 치환 수)"""
    n = 0
    for p in NEGATED_NEG:
        t, k = re.subn(p, " ◎ ", t)
        n += k
    return t, n


def polarity(t_norm: str) -> tuple[int, int]:
    """(긍정 수, 부정 수). t_norm은 norm()된 텍스트."""
    t, flipped = preprocess(t_norm)
    neg = 0
    for p in NEG_PHRASES_FIRST:
        t, k = re.subn(p, " ✕ ", t)
        neg += k
    pos = len(re.findall(POS_WORDS, t)) + flipped
    neg += len(re.findall(NEG_WORDS, t))
    return pos, neg


def nearest_polarity(c: str, pats: list[str]) -> tuple[int, int]:
    """절 안에 긍·부정이 함께 있으면 주제 키워드에 가장 가까운 감성어의 극성만 취한다."""
    t, _ = preprocess(c)
    for p in NEG_PHRASES_FIRST:
        t = re.sub(p, " ✕ ", t)
    sw = [(m.start(), +1) for m in re.finditer(POS_WORDS + r"|◎", t)] + \
         [(m.start(), -1) for m in re.finditer(NEG_WORDS + r"|✕", t)]
    if not sw:
        return 0, 0
    if all(s > 0 for _, s in sw):
        return 1, 0
    if all(s < 0 for _, s in sw):
        return 0, 1
    kpos = [m.start() for p in pats for m in re.finditer(p, t)]
    if not kpos:
        return label_counts(sw)
    best = min(sw, key=lambda x: min(abs(x[0] - k) for k in kpos))
    return (1, 0) if best[1] > 0 else (0, 1)


def label_counts(sw):
    p = sum(1 for _, s in sw if s > 0)
    n = sum(1 for _, s in sw if s < 0)
    return p, n


def find_topics(t_norm: str) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    for topic, kws in TOPIC_KEYWORDS.items():
        for kw, pat in kws.items():
            if re.search(pat, t_norm):
                hits.setdefault(topic, []).append(kw)
    # 결제 미지급은 과금 주제에도 걸리게 하지 않음(버그 쪽으로 판정), 단 결제 키워드는 과금에 남음
    return hits


def split_clauses(text: str) -> list[str]:
    parts = re.split(CONTRAST_SPLIT, str(text))
    out = []
    for p in parts:
        if p and p.strip():
            # '~는데', '~지만' 연결어미로도 분리
            out += [q for q in re.split(r"(?<=는데|은데|ㄴ데|지만|던데)\s", p) if q.strip()]
    return out or [str(text)]


def label_from(pos: int, neg: int) -> str:
    if pos and neg:
        return "혼합"
    if pos:
        return "긍정"
    if neg:
        return "부정"
    return "중립"


# 키워드 자체가 가진 극성 (주제별)
INTRINSIC = {
    "버그": {"튕김": -1, "렉": -1, "접속불가": -1, "발열": -1, "버그/오류": -1, "업데이트불가": -1, "결제 미지급": -1, "설치/로그인지연": -1},
    "운영": {"복구": -1},
    "콘텐츠": {"지루함": -1},
    "과금": {"과금유도": 0, "확률": 0},
}


def topic_sentiment(topic: str, kws: list[str], clauses_n: list[str], overall: str) -> tuple[str, bool]:
    """(주제 감성, 애매 여부)"""
    pats = [TOPIC_KEYWORDS[topic][k] for k in kws]
    pos = neg = 0
    for c in clauses_n:
        if not any(re.search(p, c) for p in pats):
            continue
        if topic == "버그":
            # 버그 키워드는 부정된 경우('렉 없음' 등)를 빼면 항상 불만
            t_pre, _ = preprocess(c)
            if any(re.search(TOPIC_KEYWORDS["버그"][k], t_pre) for k in kws if INTRINSIC["버그"].get(k) == -1):
                neg += 1
            else:
                pos += 1
            continue
        p_, n_ = nearest_polarity(c, pats)
        pos += p_
        neg += n_
    lab = label_from(pos, neg)
    if lab == "중립":
        if overall in ("긍정", "부정"):
            return overall, False
        if overall == "중립":
            return "중립", False
        return "혼합", True  # 전체 혼합인데 주제 절에서 극성 없음 → 애매
    return lab, False


def classify_row(text: str, rating: int) -> dict:
    raw = str(text) if isinstance(text, str) else ""
    tn = norm(raw)
    topics = find_topics(tn)
    clauses = split_clauses(raw)
    clauses_n = [norm(c) for c in clauses]

    pos, neg = polarity(tn)
    # 버그 고유 부정 반영
    if "버그" in topics and neg == 0:
        bug_neg = any(INTRINSIC["버그"].get(k) == -1 for k in topics["버그"])
        if bug_neg and not re.search(NEGATED_NEG[0], tn):
            neg += 1
    if "운영" in topics and ("복구" in topics["운영"] or re.search(r"날아|날라|초기화|사라졌|사라짐", tn)) and neg == 0:
        neg += 1
    overall = label_from(pos, neg)

    reasons = []
    t_sent = {}
    for tp, kws in topics.items():
        s, amb = topic_sentiment(tp, kws, clauses_n, overall)
        t_sent[tp] = s
        if amb:
            reasons.append(f"주제감성불명:{tp}")

    is_inq = bool(re.search(INQUIRY, raw))
    L = len(raw.strip())
    if overall == "중립" and L >= 12:
        reasons.append("감성신호없음")
    if overall == "긍정" and rating <= 2:
        reasons.append("긍정인데별점낮음")
    if overall == "부정" and rating == 5 and not topics.get("버그") and not topics.get("운영"):
        reasons.append("부정인데별점5")
    if overall == "혼합" and not topics:
        reasons.append("혼합_주제없음")
    if L >= 150:
        reasons.append("장문")
    if is_inq and overall in ("긍정", "중립") and (topics.get("버그") or topics.get("운영")):
        reasons.append("문의형")

    if not topics:
        topics = {"일반": []}
        t_sent = {"일반": overall}

    return {
        "rule_sentiment": overall,
        "rule_topics": "|".join(topics.keys()),
        "rule_topic_sentiments": "|".join(f"{k}:{v}" for k, v in t_sent.items()),
        "rule_keywords": "|".join(f"{tp}/{kw}" for tp, kws in topics.items() for kw in kws),
        "pos_hits": pos,
        "neg_hits": neg,
        "ambiguous": bool(reasons),
        "amb_reasons": "|".join(reasons),
    }


def rule_confident(text: str, r) -> bool:
    """규칙 판정을 그대로 믿을 리뷰인지. False인 리뷰는 수동(AI) 판정 대상이다.
    원래는 수동으로 정한 기준을 데이터에서 역추적한 것으로, 6,349건 전부에서 원래 기준과 일치한다.
    요약: 짧고(≤24자) 애매 플래그가 없고 주제 하나에 혼합이 아닌 리뷰, 또는 25~39자의 주제 없는('일반') 리뷰."""
    L = len(text.strip())
    amb, mixed, neu = bool(r.ambiguous), r.rule_sentiment == "혼합", r.rule_sentiment == "중립"
    nt = len(r.rule_topics.split("|"))
    if L <= 24:
        if not amb:
            return (not mixed) if nt == 1 else neu
        return L <= 11 and neu
    return r.rule_topics == "일반" and not amb and L <= 39


def main():
    d = pd.read_csv("data/reviews.csv", encoding="utf-8-sig", dtype={"review_id": str})
    res = d.apply(lambda r: pd.Series(classify_row(r["content"], int(r["rating"]))), axis=1)
    out = pd.concat([d[["store", "review_id", "rating", "content"]], res], axis=1)
    out["rule_confident"] = [rule_confident(t, r)
                             for t, r in zip(d.content.fillna("").astype(str), res.itertuples())]
    os.makedirs("work", exist_ok=True)
    out.to_csv("work/rule_labels.csv", index=False, encoding="utf-8-sig")
    print("저장 work/rule_labels.csv", len(out))
    print(out.rule_sentiment.value_counts())
    print("애매:", out.ambiguous.sum())
    print(out.amb_reasons.str.split("|").explode().value_counts())
    tp = out.rule_topics.str.split("|").explode().value_counts()
    print((tp / len(out) * 100).round(1).astype(str) + "%  " + tp.astype(str))


if __name__ == "__main__":
    main()
