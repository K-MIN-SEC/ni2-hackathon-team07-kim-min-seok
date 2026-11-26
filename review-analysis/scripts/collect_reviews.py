"""스토어 리뷰 수집기 (Google Play + App Store, kr/ko).

사용법:
    python scripts/collect_reviews.py --gp <구글플레이ID> --ios <앱스토어ID> [--max N] [--since YYYY-MM-DD] [--out data/reviews.csv]

- Google Play: google-play-scraper, 최신순, --max 건수까지
- App Store: Apple 공개 RSS 피드 (국가당 최근 최대 10페이지 x 50건 = 약 500건이 Apple 쪽 한도)
- 출력: utf-8-sig CSV
  컬럼: store, review_id, date, rating, version, title, content, thumbs_up, dev_reply, reply_date
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime, timezone

import requests

COLUMNS = ["store", "review_id", "date", "rating", "version", "title",
           "content", "thumbs_up", "dev_reply", "reply_date"]
COUNTRY = "kr"
LANG = "ko"


def _fmt(dt) -> str:
    if dt is None or dt == "":
        return ""
    if isinstance(dt, datetime):
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)


def collect_gp(app_id: str, max_n: int, since: datetime | None) -> list[dict]:
    from google_play_scraper import Sort, reviews

    out: list[dict] = []
    seen: set[str] = set()
    token = None
    batch = 200
    retries = 0
    while len(out) < max_n:
        try:
            result, token = reviews(
                app_id, lang=LANG, country=COUNTRY, sort=Sort.NEWEST,
                count=min(batch, max_n - len(out)), continuation_token=token,
            )
        except Exception as e:  # 네트워크/레이트리밋 등
            retries += 1
            if retries > 5:
                print(f"[GP] 재시도 초과, 중단: {e!r}", file=sys.stderr)
                break
            print(f"[GP] 오류 {e!r}, {2 ** retries}s 후 재시도", file=sys.stderr)
            time.sleep(2 ** retries)
            continue
        retries = 0
        if not result:
            break
        stop = False
        for r in result:
            rid = r.get("reviewId")
            if rid in seen:
                continue
            seen.add(rid)
            at = r.get("at")
            if since and at and at < since:
                stop = True
                break
            out.append({
                "store": "google_play",
                "review_id": rid,
                "date": _fmt(at),
                "rating": r.get("score"),
                "version": r.get("reviewCreatedVersion") or r.get("appVersion") or "",
                "title": "",
                "content": (r.get("content") or "").strip(),
                "thumbs_up": r.get("thumbsUpCount") or 0,
                "dev_reply": (r.get("replyContent") or "").strip(),
                "reply_date": _fmt(r.get("repliedAt")),
            })
        print(f"[GP] {len(out)}건 (마지막 {out[-1]['date'] if out else '-'})", file=sys.stderr)
        if stop or token is None or getattr(token, "token", None) is None:
            break
        time.sleep(0.5)
    return out[:max_n]


def collect_ios(app_id: str, max_n: int, since: datetime | None) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for page in range(1, 11):  # Apple RSS는 최대 10페이지
        # 주의: 'sortBy=mostRecent'는 대소문자를 구분한다. 소문자(sortby=mostrecent)면 빈 피드가 온다.
        url = (f"https://itunes.apple.com/{COUNTRY}/rss/customerreviews/"
               f"page={page}/id={app_id}/sortBy=mostRecent/json")
        data = None
        for attempt in range(4):
            try:
                resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200 and resp.text.strip():
                    data = resp.json()
                    break
                print(f"[iOS] page {page} HTTP {resp.status_code}", file=sys.stderr)
            except Exception as e:
                print(f"[iOS] page {page} 오류 {e!r}", file=sys.stderr)
            time.sleep(2 ** attempt)
        if data is None:
            break
        entries = data.get("feed", {}).get("entry", [])
        if isinstance(entries, dict):  # 1건이면 dict로 옴
            entries = [entries]
        entries = [e for e in entries if "im:rating" in e]  # 앱 정보 엔트리 제외
        if not entries:
            break
        stop = False
        for e in entries:
            rid = e.get("id", {}).get("label", "")
            if rid in seen:
                continue
            seen.add(rid)
            updated = e.get("updated", {}).get("label", "")
            try:
                dt = datetime.fromisoformat(updated)
            except ValueError:
                dt = None
            if since and dt and _fmt(dt) < _fmt(since):
                stop = True
                break
            out.append({
                "store": "app_store",
                "review_id": rid,
                "date": _fmt(dt) if dt else updated,
                "rating": int(e.get("im:rating", {}).get("label", 0) or 0),
                "version": e.get("im:version", {}).get("label", ""),
                "title": (e.get("title", {}).get("label") or "").strip(),
                "content": (e.get("content", {}).get("label") or "").strip(),
                "thumbs_up": int(e.get("im:voteSum", {}).get("label", 0) or 0),
                "dev_reply": "",   # RSS 피드에는 개발자 답변이 없음
                "reply_date": "",
            })
            if len(out) >= max_n:
                stop = True
                break
        print(f"[iOS] page {page}: 누적 {len(out)}건", file=sys.stderr)
        if stop:
            break
        time.sleep(0.5)
    return out


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 저장소 폴더


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gp", help="Google Play 패키지 ID")
    ap.add_argument("--ios", help="App Store 숫자 ID")
    ap.add_argument("--max", type=int, default=5000, help="스토어당 최대 건수 (기본 5000)")
    ap.add_argument("--since", help="이 날짜 이후 리뷰만 (YYYY-MM-DD)")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "reviews.csv"),
                    help="출력 CSV (기본: 저장소의 data/reviews.csv)")
    ap.add_argument("--force", action="store_true", help="기존 출력 파일 덮어쓰기 허용")
    args = ap.parse_args()
    if not args.gp and not args.ios:
        ap.error("--gp 또는 --ios 중 하나는 필요합니다")
    if os.path.exists(args.out) and not args.force:
        ap.error(f"{args.out} 이(가) 이미 있습니다. 원본 보호를 위해 중단합니다 (--out 다른 이름 또는 --force)")
    since = datetime.strptime(args.since, "%Y-%m-%d") if args.since else None

    rows: list[dict] = []
    if args.gp:
        rows += collect_gp(args.gp, args.max, since)
    if args.ios:
        rows += collect_ios(args.ios, args.max, since)

    if os.path.exists(args.out) and not args.force:
        sys.exit(f"{args.out} 이(가) 이미 있습니다. 원본 보호를 위해 중단합니다 (--out 다른 이름 또는 --force)")
    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"저장: {args.out} ({len(rows)}건)")


if __name__ == "__main__":
    main()
