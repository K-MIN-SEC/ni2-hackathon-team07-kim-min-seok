"""팀원(review-analysis) 라벨 → GameVoiceLab 의견 단위 데이터 변환
출력: tools/generated/team_web_import.json  (build-data.js가 읽어 data/*.json에 병합)

입력
  - ../review-analysis/data/web/cleaned_reviews.csv : 스토어 웹 열람으로 확인된 리뷰(개인정보 마스킹본)
  - ../review-analysis/data/reviews_labeled.csv     : 팀원 라벨(규칙 판정 + AI 판정)
  - data/reviews.json                               : 이미 GameVoiceLab에서 직접 분류한 리뷰(이 리뷰는 건너뜀)

변환 규칙 (project-plan.md 21장)
  - (리뷰, 팀원 주제)마다 의견 1건. 같은 주제 안에서 키워드가 다른 GVL 카테고리를 가리키면 카테고리별로 분리
  - 감성: 긍정→positive, 부정→negative, 중립→other/neutral, 혼합→other/unknown + on_hold(사유 기록)
  - 원문 전문은 저장하지 않음(B-01). evidenceText는 키워드 단서가 있는 절에서 40자 이하 발췌(마스킹본 기준), 없으면 null
  - Review.summary는 자동 생성 요약(분류 결과 나열)이며 '[자동]'으로 표시
  - sampleRole: 최신순·기본 노출 묶음 = distribution, 별점 필터로만 들어온 리뷰 = supplement
사용법 (GameVoiceLab 폴더에서): python tools/convert_team_labels.py
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RA = os.path.join(os.path.dirname(ROOT), "review-analysis")
WEB = os.path.join(RA, "data", "web", "cleaned_reviews.csv")
LABELS = os.path.join(RA, "data", "reviews_labeled.csv")
GVL_REVIEWS = os.path.join(ROOT, "data", "reviews.json")
OUT = os.path.join(ROOT, "tools", "generated", "team_web_import.json")
EXCERPT_MAX = 40

CAT_NAME = {"CAT-001": "성장", "CAT-002": "경제", "CAT-003": "수익화", "CAT-004": "전투", "CAT-005": "콘텐츠",
            "CAT-006": "UX/UI", "CAT-007": "기술·안정성", "CAT-008": "운영", "CAT-009": "아트·사운드",
            "CAT-010": "소셜", "CAT-011": "계정·데이터", "CAT-012": "전체 경험", "CAT-013": "기타"}
TOPIC_DEFAULT_CAT = {"과금": "CAT-003", "광고": "CAT-003", "버그": "CAT-007", "콘텐츠": "CAT-005", "운영": "CAT-008",
                     "밸런스/성장": "CAT-001", "UI/편의성": "CAT-006", "캐릭터/아트": "CAT-009", "일반": "CAT-012"}
# 키워드(주제/키워드) → (카테고리, GVL 키워드). 없으면 주제 기본 카테고리 + 팀원 키워드 이름
KW_OVERRIDE = {
    "운영/계정": ("CAT-011", "계정 문제"),
    "운영/복구": ("CAT-011", "계정 복구 요청"),
    "밸런스/성장/보상/재화": ("CAT-002", "보상·재화"),
    "밸런스/성장/오프라인보상": ("CAT-002", "오프라인 보상"),
    "콘텐츠/스킬/장비": ("CAT-004", "스킬·장비"),
    "버그/결제 미지급": ("CAT-003", "결제 미지급"),
    "버그/접속불가": ("CAT-007", "접속 불가"),
    "버그/튕김": ("CAT-007", "비정상 종료"),
    "버그/발열": ("CAT-007", "발열"),
    "과금/과금유도": ("CAT-003", "과금 유도"),
}
SENT = {"긍정": ("positive", None), "부정": ("negative", None), "중립": ("other", "neutral"), "혼합": ("other", "unknown")}
GENERAL_KW = {"positive": "전반적 만족", "negative": "전반적 불만", "other": "전반적 언급"}
# 발췌 위치를 찾기 위한 단서어(없으면 키워드 이름의 2글자 이상 조각)
TRIGGERS = {
    "접속 불가": ["접속", "로그인", "실행", "들어가", "켜지"], "비정상 종료": ["튕", "팅", "꺼지", "꺼짐", "종료"],
    "발열": ["발열", "뜨거", "열이", "열 받"], "업데이트불가": ["업데이트", "업뎃", "패치"], "계정 문제": ["계정", "연동", "초기화", "날아", "사라"],
    "계정 복구 요청": ["복구", "복원"], "렉": ["렉", "버벅", "끊"], "과금 유도": ["과금", "현질", "유도"], "과금": ["과금", "현질"],
    "무과금": ["무과금"], "현질": ["현질"], "뽑기": ["뽑기", "가챠", "뽑"], "확률": ["확률"], "결제/환불": ["결제", "환불"],
    "결제 미지급": ["결제", "지급", "안들어", "안 들어"], "귀여움": ["귀여", "귀엽"], "캐릭터": ["캐릭"], "그래픽": ["그래픽", "일러", "그림"],
    "난이도": ["어렵", "난이도", "힘들", "막히"], "보상·재화": ["보상", "재화", "골드", "루비"], "오프라인 보상": ["오프라인"],
    "광고": ["광고"], "쿠폰": ["쿠폰"], "소통/CS": ["문의", "답변", "고객센터", "답장"], "UI": ["UI", "화면", "글자", "버튼", "키보드", "작아"],
    "성장": ["성장", "레벨"], "스킬·장비": ["스킬", "무기", "장비"], "업데이트": ["업데이트", "업뎃"], "컨텐츠": ["컨텐츠", "콘텐츠"],
    "지루함": ["지루", "노잼", "재미없"], "이벤트/콜라보": ["이벤트", "콜라보"], "스토리/챕터": ["스토리", "챕터"],
    "버그/오류": ["버그", "오류", "에러"], "로딩·용량": ["로딩", "용량", "다운"], "설치/로그인지연": ["설치", "로그인", "로딩"],
    "진행/기능 오류": ["오류", "안됨", "안 돼", "안돼"], "던전/모드": ["던전", "모드"],
}


def read_csv(p):
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def excerpt(text: str, kw: str) -> str | None:
    if not text:
        return None
    t = text.strip()
    if len(t) <= EXCERPT_MAX:
        return t
    tokens = TRIGGERS.get(kw) or [p for p in re.split(r"[/·\s]+", kw) if len(p) >= 2]
    clauses = [c.strip() for c in re.split(r"(?<=[.!?。])\s+|\n+", t) if c.strip()]
    for c in clauses:
        hit = next((tok for tok in tokens if tok and tok in c), None)
        if not hit:
            continue
        if len(c) <= EXCERPT_MAX:
            return c
        i = c.index(hit)
        start = max(0, min(i - 12, len(c) - EXCERPT_MAX))
        return c[start:start + EXCERPT_MAX].strip()
    return None


def main() -> None:
    web = read_csv(WEB)
    labels = {r["review_id"]: r for r in read_csv(LABELS)}
    # GameVoiceLab에서 직접 분류한 리뷰만 '기존'으로 본다(이전 변환 결과는 다시 변환해 덮어씀)
    existing = {r["externalReviewId"] for r in json.load(open(GVL_REVIEWS, encoding="utf-8"))
                if r.get("externalReviewId") and r.get("labelSource", "gvl_manual") == "gvl_manual"}

    reviews, opinions, skipped = [], [], []
    kw_cat: dict[str, str] = {}
    used_codes: set[str] = set()
    for w in web:
        ext = w["review_id"]
        if ext in existing:
            skipped.append({"externalReviewId": ext, "reason": "GameVoiceLab 직접 분류분 유지"})
            continue
        lab = labels.get(ext)
        if not lab:
            skipped.append({"externalReviewId": ext, "reason": "팀원 라벨 없음"})
            continue
        plat = w["platform"]
        code = ("DT-GW-" if plat == "Google Play" else "DT-AW-") + re.sub(r"[^0-9a-zA-Z]", "", ext)[:8]
        if code in used_codes:
            raise SystemExit(f"코드 충돌 {code}")
        used_codes.add(code)
        groups = w["collection_group"].split(";")
        primary = next((g for g in groups if g in ("gp_web_newest", "ios_web_default")), groups[0])
        role = "distribution" if primary in ("gp_web_newest", "ios_web_default") else "supplement"
        source = "team_rule" if lab["label_source"] == "rule" else "team_ai"
        text = ((w.get("review_title") or "") + " " + (w.get("review_text") or "")).strip()

        ops = []
        for pair in filter(None, lab["topic_sentiments"].split("|")):
            topic, sent = pair.rsplit(":", 1)
            s, other_type = SENT[sent]
            kws = [k for k in filter(None, lab["keywords"].split("|")) if k.startswith(topic + "/")]
            by_cat: dict[str, list[str]] = defaultdict(list)
            if topic == "일반":
                by_cat["CAT-012"].append(GENERAL_KW[s])
            elif not kws:
                cat = TOPIC_DEFAULT_CAT[topic]
                by_cat[cat].append(f"{CAT_NAME[cat]} 기타 표현")
            for k in kws:
                if k in KW_OVERRIDE:
                    cat, name = KW_OVERRIDE[k]
                else:
                    cat = TOPIC_DEFAULT_CAT[topic]
                    if topic == "밸런스/성장":
                        cat = "CAT-001"
                    leaf = k[len(topic) + 1:]
                    name = f"{CAT_NAME[cat]} 기타 표현" if leaf == "(기타표현)" else leaf.replace("/", "·")
                    if topic == "광고":
                        name = "광고" if leaf in ("광고", "(기타표현)") else name
                by_cat[cat].append(name)
            for cat, names in by_cat.items():
                kw = names[0]
                if kw_cat.setdefault(kw, cat) != cat:
                    kw = f"{kw}({CAT_NAME[cat]})"
                    kw_cat.setdefault(kw, cat)
                hold = sent == "혼합"
                ops.append({
                    "categoryId": cat, "sentiment": s, "otherType": other_type, "keyword": kw,
                    "summary": f"[자동] {CAT_NAME[cat]} · {sent}" + (f" · {', '.join(dict.fromkeys(names))}" if names else ""),
                    "evidenceText": excerpt(text, kw.split("(")[0]),
                    "verificationStatus": "on_hold" if hold else "unreviewed",
                    "holdReason": "팀원 라벨이 '혼합'(긍정·부정 공존) — 의견 분리 검수 필요" if hold else None,
                    "labelSource": source,
                })
        if not ops:
            skipped.append({"externalReviewId": ext, "reason": "주제 라벨 없음"})
            continue
        reviews.append({
            "code": code, "externalReviewId": ext, "gameId": "daltoki", "platform": plat,
            "rating": int(w["rating"]) if w["rating"] else None, "publishedAt": w["published_at"][:10],
            "publishedAtRaw": w["published_at"], "publishedAtBasis": "store_web_display_utc_date",
            "sourceUrl": w["source_url"], "collectedAt": w["collected_at"] or None,
            "helpfulCount": int(w["helpful_count"]) if w["helpful_count"] not in ("", None) else None,
            "collectionGroup": primary, "collectionGroups": groups, "sampleRole": role, "labelSource": source,
            "summary": "[자동] 팀원 라벨 변환 — " + "; ".join(o["summary"].replace("[자동] ", "") for o in ops),
        })
        for i, o in enumerate(ops, 1):
            o["opinionCode"] = f"{code}-{i}"
            o["reviewCode"] = code
            opinions.append(o)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    result = {
        "generatedFrom": {"web": os.path.relpath(WEB, ROOT), "labels": os.path.relpath(LABELS, ROOT)},
        "reviews": reviews, "opinions": opinions,
        "keywords": [{"keyword": k, "categoryId": c} for k, c in sorted(kw_cat.items())],
        "skipped": skipped,
    }
    json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({
        "reviews": len(reviews), "opinions": len(opinions), "keywords": len(kw_cat), "skipped": Counter(s["reason"] for s in skipped),
        "sampleRole": Counter(r["sampleRole"] for r in reviews), "labelSource": Counter(r["labelSource"] for r in reviews),
        "sentiment": Counter(o["sentiment"] for o in opinions), "on_hold": sum(1 for o in opinions if o["verificationStatus"] == "on_hold"),
        "evidence_null": sum(1 for o in opinions if not o["evidenceText"]),
        "categories": Counter(CAT_NAME[o["categoryId"]] for o in opinions),
    }, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main()
