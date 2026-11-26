"""기업이 제공한 공식 내보내기 파일 → 파이프라인 입력 CSV (웹 수집 없음)

지원 형식:
  --gp   Google Play Console 리뷰 내보내기 CSV (월별 reviews_<패키지>_YYYYMM.csv, 보통 UTF-16). 여러 개 지정 가능
  --asc  App Store Connect Customer Reviews API 응답 JSON ({"data":[{"id":..,"attributes":{..}}]}). 여러 개 지정 가능

출력: data/official/reviews_official.csv
  기존 data/reviews.csv와 같은 열(store, review_id, date, rating, version, title, content, thumbs_up,
  dev_reply, reply_date) + date_basis, collection_group, collection_method, source_url, source_file

사용법:
    python scripts/import_official_exports.py --gp exports/reviews_*.csv [--asc exports/asc_reviews.json]
    python scripts/preprocess_reviews.py --in data/official/reviews_official.csv --out-dir data/official
    (이후 collect_updates / match_versions / validate_dataset 에 --reviews / --data-dir 로 같은 폴더 지정)

처리 원칙:
 - 작성자 닉네임, 기기명 등 식별 정보는 가져오지 않는다
 - 같은 리뷰가 여러 달 파일에 나오면(수정된 리뷰) 마지막 수정 시각 기준 최신 1건만 남기고 개수를 보고한다
 - 날짜는 내보내기 원본의 UTC 시각을 그대로 쓰고 date_basis=utc로 표시한다(이후 KST로 변환)
 - 확인할 수 없는 값은 빈 값(null)
"""
from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import GP_PACKAGE, IOS_REVIEWS_URL, write_csv, write_json  # noqa: E402

OUT_COLUMNS = ["store", "review_id", "date", "rating", "version", "title", "content", "thumbs_up", "dev_reply",
               "reply_date", "date_basis", "collection_group", "collection_method", "source_url", "source_file"]


def read_text_any(path: str) -> str:
    raw = open(path, "rb").read()
    for enc in ("utf-16", "utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            if "," in text or "\t" in text:
                return text
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"인코딩을 알 수 없습니다: {path}")


def utc_str(iso: str | None) -> str:
    """'2026-10-01T12:34:56Z' / '...-07:00' → UTC 'YYYY-MM-DD HH:MM:SS'"""
    if not iso:
        return ""
    s = iso.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError(f"시간대 없는 시각: {iso}")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def gp_rows(path: str) -> list[dict]:
    text = read_text_any(path)
    reader = csv.DictReader(io.StringIO(text))
    required = {"Star Rating", "Review Text", "Review Submit Date and Time"}
    missing = required - set(reader.fieldnames or [])
    if missing:
        raise SystemExit(f"{path}: Play Console 리뷰 내보내기 형식이 아닙니다(누락 열 {sorted(missing)})")
    out = []
    for r in reader:
        pkg = (r.get("Package Name") or GP_PACKAGE).strip()
        link = (r.get("Review Link") or "").strip()
        rid = parse_qs(urlparse(link).query).get("reviewId", [None])[0] if link else None
        if not rid:
            basis = f"{r.get('Review Submit Millis Since Epoch')}|{r.get('Review Text')}"
            rid = "gpx-" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]
        updated = r.get("Review Last Update Millis Since Epoch") or r.get("Review Submit Millis Since Epoch") or "0"
        out.append({
            "store": "google_play",
            "review_id": rid,
            "date": utc_str(r.get("Review Submit Date and Time")),
            "rating": (r.get("Star Rating") or "").strip(),
            "version": (r.get("App Version Name") or "").strip(),
            "title": (r.get("Review Title") or "").strip(),
            "content": (r.get("Review Text") or "").strip(),
            "thumbs_up": "",  # Play Console 내보내기에는 공감 수가 없음 → null
            "dev_reply": (r.get("Developer Reply Text") or "").strip(),
            "reply_date": utc_str(r.get("Developer Reply Date and Time")) if r.get("Developer Reply Date and Time") else "",
            "date_basis": "utc",
            "collection_group": "gp_play_console_export",
            "collection_method": "기업 제공 Play Console 리뷰 내보내기",
            "source_url": link or f"https://play.google.com/store/apps/details?id={pkg}",
            "source_file": os.path.basename(path),
            "_updated": int(float(updated or 0)),
        })
    return out


def asc_rows(path: str) -> list[dict]:
    doc = json.load(open(path, encoding="utf-8"))
    items = doc.get("data", doc if isinstance(doc, list) else [])
    out = []
    for it in items:
        a = it.get("attributes", {})
        out.append({
            "store": "app_store",
            "review_id": str(it.get("id")),
            "date": utc_str(a.get("createdDate")),
            "rating": a.get("rating", ""),
            "version": "",  # Customer Reviews API에는 앱 버전이 없음 → null (날짜 기반 추정 대상)
            "title": (a.get("title") or "").strip(),
            "content": (a.get("body") or "").strip(),
            "thumbs_up": "",
            "dev_reply": "",
            "reply_date": "",
            "date_basis": "utc",
            "collection_group": "ios_app_store_connect",
            "collection_method": "기업 제공 App Store Connect 고객 리뷰",
            "source_url": IOS_REVIEWS_URL,
            "source_file": os.path.basename(path),
            "_updated": 0,
        })
    return out


def expand(patterns: list[str] | None) -> list[str]:
    files = []
    for p in patterns or []:
        hit = sorted(glob.glob(p))
        if not hit:
            raise SystemExit(f"파일을 찾을 수 없습니다: {p}")
        files += hit
    return files


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gp", nargs="*", help="Play Console 리뷰 CSV (glob 가능)")
    ap.add_argument("--asc", nargs="*", help="App Store Connect 리뷰 JSON (glob 가능)")
    ap.add_argument("--out", default="data/official/reviews_official.csv")
    args = ap.parse_args()
    gp_files, asc_files = expand(args.gp), expand(args.asc)
    if not gp_files and not asc_files:
        ap.error("--gp 또는 --asc 파일이 필요합니다")

    rows = []
    for f in gp_files:
        rows += gp_rows(f)
    for f in asc_files:
        rows += asc_rows(f)

    # 같은 리뷰가 여러 파일에 있으면 마지막 수정본만 남김
    latest: dict[tuple, dict] = {}
    for r in rows:
        k = (r["store"], r["review_id"])
        if k not in latest or r["_updated"] >= latest[k]["_updated"]:
            latest[k] = r
    merged = sorted(latest.values(), key=lambda r: (r["store"], r["date"]), reverse=True)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    write_csv(args.out, merged, OUT_COLUMNS)
    stats = {"gp_files": len(gp_files), "asc_files": len(asc_files), "rows_read": len(rows),
             "duplicates_merged": len(rows) - len(merged), "rows_written": len(merged),
             "by_store": {s: sum(1 for r in merged if r["store"] == s) for s in ("google_play", "app_store")},
             "with_version": sum(1 for r in merged if r["version"])}
    write_json(os.path.splitext(args.out)[0] + "_import_stats.json", stats)
    print(stats)


if __name__ == "__main__":
    main()
