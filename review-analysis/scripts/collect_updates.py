"""업데이트 이력 테이블 생성 → data/updates.csv

이 스크립트는 웹에 접속하지 않는다. 입력:
 1) 공식 스토어 스냅샷 JSON (--snapshot, 여러 개 가능)
    예: data/sources/appstore_version_history_20261126.json (App Store 앱 페이지 '버전 기록' 열람 기록)
 2) 기업 제공 출시 이력 CSV (--official-csv, 여러 개 가능)
    열: platform(Google Play|App Store|ONE store), version, release_date(YYYY-MM-DD, KST), notes, source
    양식: data/sources/official_release_history_TEMPLATE.csv
 3) 리뷰에 기록된 실제 앱 버전 (--reviews) → 공식 이력이 없는 버전을 '리뷰에서 관측된 버전'으로 등록
    적용일은 확정하지 않는다(null). 첫/마지막 관측 리뷰 날짜는 참고값

사용법:
    python scripts/collect_updates.py [--snapshot S.json ...] [--official-csv C.csv ...]
                                      [--reviews data/cleaned_reviews.csv] [--out data/updates.csv]

규칙(요청서 5장):
 - 플랫폼별 적용일을 서로 빌려오지 않는다
 - 공식 변경 사항이 'bug fix'류만이면 hotfix, 아니면 major. 노트가 비어 있으면 unknown
 - 핫픽스는 같은 플랫폼에서 날짜상 직전 주요 업데이트 그룹에 연결
 - 공식 이력이 없는 버전: 다른 플랫폼에 같은 버전 문자열의 공식 기록이 있으면 변경 사항·유형·그룹만 참고 연결,
   없으면 update_type=unknown, 그룹은 'v{major}.{minor}.x'(임시)
 - 같은 (플랫폼, 버전)이 여러 공식 출처에 있으면 적용일이 다를 경우 오류로 중단(임의 선택 금지)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import PLATFORM_PREFIX, kst_date, minor_group, read_csv, version_key, write_csv  # noqa: E402

PLATFORM_PREFIX = {**PLATFORM_PREFIX, "ONE store": "one"}
COLUMNS = ["update_id", "version", "platform", "release_date", "update_type", "update_group", "patch_summary",
           "source_url", "verification_status", "type_basis", "group_basis", "first_review_date",
           "last_review_date", "review_count_with_version"]
OFFICIAL_STATUSES = ("official_store_history", "official_company_provided")
HOTFIX_RE = re.compile(r"^\s*(bug[\s_-]*fix(es)?|버그\s*수정|핫픽스|hotfix)\s*$", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_official(snapshots: list[str], csvs: list[str]) -> list[dict]:
    items = []
    for s in snapshots:
        snap = json.load(open(s, encoding="utf-8"))
        for v in snap["versions"]:
            items.append({"platform": snap["platform"], "version": v["version"], "release_date": v["release_date"],
                          "notes": v.get("notes") or "", "source_url": snap["source_url"],
                          "status": "official_store_history"})
    for c in csvs:
        for i, r in enumerate(read_csv(c), start=2):
            plat, ver, d = (r.get("platform") or "").strip(), (r.get("version") or "").strip(), (r.get("release_date") or "").strip()
            if plat not in PLATFORM_PREFIX or not ver or not DATE_RE.match(d):
                raise SystemExit(f"{c}:{i}행 형식 오류 (platform/version/release_date 확인)")
            items.append({"platform": plat, "version": ver, "release_date": d, "notes": (r.get("notes") or "").strip(),
                          "source_url": (r.get("source") or "").strip() or f"기업 제공 파일: {os.path.basename(c)}",
                          "status": "official_company_provided"})
    return items


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot", nargs="*", default=["data/sources/appstore_version_history_20261126.json"])
    ap.add_argument("--official-csv", nargs="*", default=[])
    ap.add_argument("--reviews", default="data/cleaned_reviews.csv")
    ap.add_argument("--out", default="data/updates.csv")
    args = ap.parse_args()

    official = load_official(args.snapshot, args.official_csv)
    updates: dict[tuple, dict] = {}
    by_platform = defaultdict(list)
    for v in official:
        key = (v["platform"], v["version"])
        prev = next((x for x in by_platform[v["platform"]] if x["version"] == v["version"]), None)
        if prev:
            if prev["release_date"] != v["release_date"]:
                raise SystemExit(f"공식 출처 간 적용일 불일치: {key} {prev['release_date']} vs {v['release_date']}")
            continue  # 같은 내용 중복 → 첫 출처 유지
        by_platform[v["platform"]].append(v)

    for plat, items in by_platform.items():
        current_major = None
        for v in sorted(items, key=lambda v: (v["release_date"], version_key(v["version"]) or ())):
            notes = v["notes"]
            if not notes:
                utype = "unknown"
            else:
                utype = "hotfix" if HOTFIX_RE.match(notes) else "major"
            if utype == "major":
                current_major = v["version"]
                group, gbasis = f"v{v['version']}", "self_major"
            elif utype == "hotfix" and current_major:
                group, gbasis = f"v{current_major}", "preceding_major_same_platform"
            elif utype == "hotfix":
                group, gbasis = f"v{v['version']}", "hotfix_without_preceding_major_in_source"
            else:
                group, gbasis = minor_group(v["version"]), "minor_version_heuristic"
            updates[(plat, v["version"])] = {
                "update_id": f"{PLATFORM_PREFIX[plat]}-{v['version']}", "version": v["version"], "platform": plat,
                "release_date": v["release_date"], "update_type": utype, "update_group": group,
                "patch_summary": notes or None, "source_url": v["source_url"], "verification_status": v["status"],
                "type_basis": "official_patch_notes" if notes else "no_notes_in_source", "group_basis": gbasis,
            }

    official_by_version = defaultdict(list)
    for (p, ver), u in updates.items():
        official_by_version[ver].append(u)

    seen = defaultdict(list)
    for r in read_csv(args.reviews):
        if r.get("app_version"):
            seen[(r["platform"], r["app_version"])].append(kst_date(r["published_at"]))
    for (p, ver), dates in seen.items():
        dates = sorted(d for d in dates if d)
        u = updates.get((p, ver))
        if not u:
            same = next((x for x in official_by_version.get(ver, []) if x["platform"] != p and x["patch_summary"]), None)
            if same:
                tag = f"same_version_string_on_{same['platform'].replace(' ', '_')}"
                u = {"update_type": same["update_type"], "type_basis": tag, "update_group": same["update_group"],
                     "group_basis": tag, "patch_summary": same["patch_summary"],
                     "verification_status": "observed_in_reviews; notes_from_other_platform_same_version"}
            else:
                u = {"update_type": "unknown", "type_basis": "no_official_notes", "update_group": minor_group(ver),
                     "group_basis": "minor_version_heuristic", "patch_summary": None,
                     "verification_status": "observed_in_reviews"}
            u.update(update_id=f"{PLATFORM_PREFIX[p]}-{ver}", version=ver, platform=p, release_date=None, source_url=None)
            updates[(p, ver)] = u
        u["first_review_date"] = dates[0] if dates else None
        u["last_review_date"] = dates[-1] if dates else None
        u["review_count_with_version"] = len(dates)

    rows = sorted(updates.values(), key=lambda u: (u["platform"], version_key(u["version"]) or (), u["version"]))
    ids = [u["update_id"] for u in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("update_id 중복")
    write_csv(args.out, rows, COLUMNS)
    by = defaultdict(int)
    for u in rows:
        by[f"{u['platform']} | {u['verification_status']}"] += 1
    print(f"저장: {args.out} ({len(rows)}건)", dict(by))


if __name__ == "__main__":
    main()
