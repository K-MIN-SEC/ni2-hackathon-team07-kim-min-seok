"""스토어 웹페이지에서 '열람 확인된' 리뷰만으로 파이프라인 입력 CSV 생성 → data/web/reviews_web.csv

배경:
  - 자동 수집(google-play-scraper, iTunes RSS)은 각 스토어 robots.txt 금지 경로라 사용하지 않는다.
  - 대신 브라우저로 스토어 웹페이지를 열람하며, 화면에 보인 리뷰마다 지문(key)을 남겼다
    (data/sources/web_view_*/*.keys.json).
    key = sha1(review_id | 별점 | 화면 표시 날짜 | 공백 제거 본문)의 앞 12자
  - 팀 파일(data/reviews.csv)의 행으로 같은 key를 계산해 '정확히 일치하는 행'만 채택한다.
    → 채택된 행의 ID·별점·날짜·본문은 웹 화면에 보인 값과 같다는 것이 검증된 것이다.
  - 웹 화면에 보이지 않는 값(앱 버전, 정확한 시각, 개발자 답변)은 사용하지 않는다 → null.
    공감 수는 웹 화면 값(h)을 쓴다.

날짜 기준(검증 결과):
  - Google Play 웹 화면 날짜 = 팀 파일 시각 - 9시간의 날짜(200/200건 일치).
    팀 파일 시각을 KST로 보면 웹 화면 날짜는 UTC 날짜다 → date_basis='utc_date'
  - App Store 웹 화면 날짜 = time 요소의 UTC 날짜 → date_basis='utc_date'

사용법:
    python scripts/build_web_view_dataset.py [--keys-dir data/sources/web_view_20261126]
                                             [--team data/reviews.csv] [--out data/web/reviews_web.csv]
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import GP_PACKAGE, IOS_REVIEWS_URL, read_csv, write_csv, write_json  # noqa: E402

OUT_COLUMNS = ["store", "review_id", "date", "rating", "version", "title", "content", "thumbs_up", "dev_reply",
               "reply_date", "date_basis", "collection_group", "collection_method", "source_url", "source_file",
               "collected_at"]


def sha12(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def norm(t: str) -> str:
    return re.sub(r"\s+", "", t or "")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keys-dir", default="data/sources/web_view_20261126")
    ap.add_argument("--team", default="data/reviews.csv")
    ap.add_argument("--out", default="data/web/reviews_web.csv")
    args = ap.parse_args()

    team = read_csv(args.team)
    gp_idx, ios_idx = {}, {}
    for r in team:
        t = datetime.strptime(r["date"], "%Y-%m-%d %H:%M:%S")
        if r["store"] == "google_play":
            d = (t - timedelta(hours=9)).strftime("%Y-%m-%d")
            gp_idx[sha12(f"{r['review_id']}|{r['rating']}|{d}|{norm(r['content'])}")] = (r, d)
        else:
            d = t.strftime("%Y-%m-%d")  # 팀 파일 iOS 시각은 UTC
            ios_idx[sha12(f"{r['review_id']}|{r['rating']}|{d}|{norm(r['content'])}")] = (r, d)

    out: dict[tuple, dict] = {}
    report = {"files": {}, "unmatched": []}
    for path in sorted(glob.glob(os.path.join(args.keys_dir, "*.keys.json"))):
        meta = json.load(open(path, encoding="utf-8"))
        plat = meta["platform"]
        entries = meta["entries"]
        if isinstance(entries, str):
            entries = [{"k": e.split(":")[0], "h": int(e.split(":")[1])} for e in entries.split(",")]
        stats = {"entries": len(entries), "matched": 0, "manual_verified": 0, "unmatched": 0}
        for i, e in enumerate(entries):
            row = None
            if plat == "Google Play" and e["k"] in gp_idx:
                r, d = gp_idx[e["k"]]
                row = {"store": "google_play", "review_id": r["review_id"], "date": d, "rating": r["rating"],
                       "title": "", "content": r["content"], "thumbs_up": e.get("h", ""),
                       "source_url": f"https://play.google.com/store/apps/details?id={GP_PACKAGE}&hl=ko&gl=KR&reviewId={r['review_id']}"}
            elif plat == "App Store" and e["k"] in ios_idx and sha12(norm(ios_idx[e["k"]][0]["title"])) == e.get("tk"):
                r, d = ios_idx[e["k"]]
                row = {"store": "app_store", "review_id": r["review_id"], "date": d, "rating": r["rating"],
                       "title": r["title"], "content": r["content"], "thumbs_up": "", "source_url": IOS_REVIEWS_URL}
            elif plat == "App Store" and e.get("manual"):
                m = e["manual"]
                d = m["datetime"][:10]
                ok = (sha12(f"{e['id']}|{e['r']}|{d}|{norm(m['body'])}") == e["k"] and sha12(norm(m["title"])) == e["tk"])
                if ok:
                    row = {"store": "app_store", "review_id": e["id"], "date": d, "rating": e["r"], "title": m["title"],
                           "content": m["body"], "thumbs_up": "", "source_url": IOS_REVIEWS_URL}
                    stats["manual_verified"] += 1
            if not row:
                stats["unmatched"] += 1
                report["unmatched"].append({"file": os.path.basename(path), "index": i, "key": e.get("k")})
                continue
            stats["matched"] += 1
            row.update(version="", dev_reply="", reply_date="", date_basis="utc_date",
                       collection_group=meta["collection_group"],
                       collection_method="브라우저 열람(웹 화면 표시 리뷰) + 지문 대조 검증",
                       source_file=os.path.basename(path), collected_at=meta["captured_at"][:10])
            key = (row["store"], row["review_id"])
            if key in out:
                # 같은 리뷰가 여러 열람 묶음(최신순·별점 필터)에 있으면 1건으로 두고 묶음을 함께 기록
                out[key]["collection_group"] += ";" + meta["collection_group"]
            else:
                out[key] = row
        report["files"][os.path.basename(path)] = stats

    rows = sorted(out.values(), key=lambda r: (r["store"], r["date"]), reverse=True)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    write_csv(args.out, rows, OUT_COLUMNS)
    report["unique_reviews"] = len(rows)
    report["by_store"] = {s: sum(1 for r in rows if r["store"] == s) for s in ("google_play", "app_store")}
    write_json(os.path.splitext(args.out)[0] + "_build_report.json", report)
    print(json.dumps({k: report[k] for k in ("files", "unique_reviews", "by_store")}, ensure_ascii=False))
    if report["unmatched"]:
        print("UNMATCHED:", report["unmatched"][:10])


if __name__ == "__main__":
    main()
