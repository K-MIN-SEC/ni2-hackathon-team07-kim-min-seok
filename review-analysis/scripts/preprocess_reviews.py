"""리뷰 원본 정리 → raw_reviews.csv(원본 보존) / cleaned_reviews.csv(정제)

입력: data/reviews.csv (팀이 수집한 기존 파일, 읽기 전용. 이 스크립트는 수집을 하지 않는다)
사용법:
    python scripts/preprocess_reviews.py [--in data/reviews.csv] [--out-dir data]

처리:
 1. 새 스키마로 변환(raw, 텍스트 변경 없음)
 2. (플랫폼, review_id) 중복 제거
 3. 빈 리뷰 제거
 4. 한국어 여부 판별(is_korean)
 5. 개인정보 패턴 마스킹(이메일, 전화번호, URL, 긴 숫자 ID, '닉네임 xxx')
 6. 동일 텍스트(정규화 후) 그룹 표시 — 서로 다른 사용자의 짧은 리뷰일 수 있어 삭제하지 않고 표시만 한다
 7. 별점 기반 임시 감성 라벨(proxy_sentiment) — 정답 라벨 아님
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import (GAME, GP_PACKAGE, IOS_REVIEWS_URL, none_if_blank, proxy_sentiment,  # noqa: E402
                            read_csv, to_kst_iso, write_csv, write_json)

RAW_COLUMNS = ["review_id", "game", "platform", "review_title", "review_text", "rating", "published_at",
               "published_at_original", "published_at_basis", "app_version", "helpful_count", "dev_reply",
               "dev_reply_at", "source_url", "collected_at", "collection_group", "collection_method", "data_type"]
CLEAN_COLUMNS = ["review_id", "game", "platform", "review_title", "review_text", "rating", "published_at",
                 "published_at_basis", "app_version", "helpful_count", "source_url", "collected_at",
                 "collection_group", "data_type", "is_korean", "char_len", "pii_masked", "text_dup_group",
                 "is_text_duplicate", "proxy_sentiment"]

STORE_META = {
    "google_play": {
        "platform": "Google Play",
        # google-play-scraper의 시각은 수집 PC 현지 시각(naive)으로 저장되어 있다 → 한국 PC로 가정(확인 필요)
        "basis": "assumed_kst",
        "collection_group": "gp_newest_all",
        "collection_method": "팀 수집(google-play-scraper, 최신순, --max 10000). 이 데이터셋 작업에서는 재수집하지 않음",
    },
    "app_store": {
        "platform": "App Store",
        "basis": "utc",
        "collection_group": "ios_rss_most_recent",
        "collection_method": "팀 수집(Apple 고객 리뷰 RSS, 최신순 3페이지). 이 데이터셋 작업에서는 재수집하지 않음",
    },
}

PII_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[EMAIL]"),
    (re.compile(r"https?://\S+|www\.\S+"), "[URL]"),
    (re.compile(r"(?<!\d)0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)"), "[PHONE]"),
    # 닉네임·아이디 뒤 따옴표 안의 값 (예: 닉 ... '홍길동')
    (re.compile(r"((?:닉네임|닉|아이디)[^'\"‘“\n]{0,15})['\"‘“][^'\"’”\n]{1,20}['\"’”]"), r"\1'[MASKED]'"),
    # 영문+숫자가 섞인 6자 이상 토큰 (게임 내 UID 형태)
    (re.compile(r"\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b"), "[ID]"),
    # 닉네임·아이디 바로 뒤 토큰 — 일반 단어가 함께 가려질 수 있음(과마스킹, 보고서에 명시)
    (re.compile(r"(닉네임|닉|아이디|uid|UID|ID)\s*[:은는이가]?\s*(?!\[|')[\w가-힣]{2,20}"), r"\1 [MASKED]"),
    (re.compile(r"(?<!\d)\d{8,}(?!\d)"), "[NUMBER]"),
]
HANGUL = re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")
LETTER = re.compile(r"[A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ぀-ヿ一-鿿]")


def mask_pii(text: str) -> tuple[str, int]:
    n = 0
    for pat, rep in PII_PATTERNS:
        text, k = pat.subn(rep, text)
        n += k
    return text, n


def is_korean(text: str) -> bool:
    letters = LETTER.findall(text)
    if not letters:
        return False
    return len(HANGUL.findall(text)) / len(letters) >= 0.5


def norm_for_dup(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", text.lower())


def to_raw(r: dict) -> dict:
    # 공식 내보내기(import_official_exports.py) 결과는 행마다 메타데이터를 갖고 있으므로 그 값을 우선한다
    meta = dict(STORE_META[r["store"]])
    if none_if_blank(r.get("date_basis")):
        meta["basis"] = r["date_basis"]
    if none_if_blank(r.get("collection_group")):
        meta["collection_group"] = r["collection_group"]
    if none_if_blank(r.get("collection_method")):
        meta["collection_method"] = r["collection_method"]
    rid = r["review_id"]
    url = none_if_blank(r.get("source_url")) or (
        f"https://play.google.com/store/apps/details?id={GP_PACKAGE}&hl=ko&gl=KR&reviewId={rid}"
        if r["store"] == "google_play" else IOS_REVIEWS_URL)
    return {
        "review_id": rid,
        "game": GAME,
        "platform": meta["platform"],
        "review_title": none_if_blank(r.get("title")),
        "review_text": r.get("content", ""),
        "rating": int(r["rating"]) if none_if_blank(r.get("rating")) else None,
        "published_at": to_kst_iso(r.get("date"), meta["basis"]),
        "published_at_original": none_if_blank(r.get("date")),
        "published_at_basis": meta["basis"],
        "app_version": none_if_blank(r.get("version")),
        "helpful_count": int(r["thumbs_up"]) if none_if_blank(r.get("thumbs_up")) else None,
        "dev_reply": none_if_blank(r.get("dev_reply")),
        "dev_reply_at": none_if_blank(r.get("reply_date")),
        "source_url": url,
        # 팀 원본 파일에는 수집 시각 기록 없음(null). 웹 열람 데이터는 열람일을 갖고 있다
        "collected_at": none_if_blank(r.get("collected_at")),
        "collection_group": meta["collection_group"],
        "collection_method": meta["collection_method"],
        "data_type": "actual",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inp", default="data/reviews.csv")
    ap.add_argument("--out-dir", default="data")
    args = ap.parse_args()

    src = read_csv(args.inp)
    raw = [to_raw(r) for r in src]
    write_csv(os.path.join(args.out_dir, "raw_reviews.csv"), raw, RAW_COLUMNS)

    seen: set[tuple] = set()
    dup_id = empty = 0
    cleaned: list[dict] = []
    for r in raw:
        key = (r["platform"], r["review_id"])
        if key in seen:
            dup_id += 1
            continue
        seen.add(key)
        text = (r["review_text"] or "").strip()
        title = (r["review_title"] or "").strip()
        if not text and not title:
            empty += 1
            continue
        text, n1 = mask_pii(text)
        title_m, n2 = mask_pii(title) if title else ("", 0)
        c = {k: r.get(k) for k in CLEAN_COLUMNS}
        c["review_text"] = text
        c["review_title"] = title_m or None
        c["pii_masked"] = n1 + n2
        c["is_korean"] = is_korean(title_m + " " + text)
        c["char_len"] = len(text)
        c["proxy_sentiment"] = proxy_sentiment(r["rating"])
        c["_norm"] = norm_for_dup(title_m + text)
        cleaned.append(c)

    groups = Counter(c["_norm"] for c in cleaned if c["_norm"])
    gid: dict[str, str] = {}
    seen_norm: set[str] = set()
    for c in cleaned:
        k = c.pop("_norm")
        if k and groups[k] > 1:
            gid.setdefault(k, f"T{len(gid) + 1:04d}")
            c["text_dup_group"] = gid[k]
            c["is_text_duplicate"] = k in seen_norm
        else:
            c["text_dup_group"] = None
            c["is_text_duplicate"] = False
        seen_norm.add(k)

    write_csv(os.path.join(args.out_dir, "cleaned_reviews.csv"), cleaned, CLEAN_COLUMNS)
    stats = {
        "input_rows": len(src),
        "raw_rows": len(raw),
        "removed_duplicate_review_id": dup_id,
        "removed_empty": empty,
        "cleaned_rows": len(cleaned),
        "pii_masked_reviews": sum(1 for c in cleaned if c["pii_masked"]),
        "pii_masked_total": sum(c["pii_masked"] for c in cleaned),
        "non_korean_reviews": sum(1 for c in cleaned if not c["is_korean"]),
        "text_duplicate_groups": len(gid),
        "text_duplicate_extra_rows": sum(1 for c in cleaned if c["is_text_duplicate"]),
    }
    write_json(os.path.join(args.out_dir, "_preprocess_stats.json"), stats)
    print(stats)


if __name__ == "__main__":
    main()
