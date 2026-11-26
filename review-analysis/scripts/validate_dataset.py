"""데이터셋 품질 검증 → data/collection_report.json (+ 업데이트별 표 출력)

사용법:
    python scripts/validate_dataset.py [--data-dir data] [--collected-before 2026-11-27]

검증 항목(요청서 8장):
 리뷰 중복 / 업데이트 버전 중복 / 작성일·적용일 형식과 범위 / 실제·추정 버전 구분 /
 업데이트별 리뷰 수·별점 분포 / 플랫폼별 리뷰 수 / 미분류 리뷰 수 / 출처 존재 / 임시 라벨 규칙 / 실제 데이터만 포함
오류가 있으면 종료 코드 1.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import kst_date, proxy_sentiment, read_csv, version_key, write_json  # noqa: E402

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def rating_dist(rows) -> dict:
    c = Counter(str(r.get("rating")) for r in rows)
    return {s: c.get(s, 0) for s in ("1", "2", "3", "4", "5")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--collected-before", default="2026-11-27", help="리뷰 작성일이 이 날짜보다 앞서야 함")
    ap.add_argument("--earliest", default="2021-06-01", help="국내 출시(2021-06) 이전 작성일은 오류")
    args = ap.parse_args()
    p = lambda n: os.path.join(args.data_dir, n)  # noqa: E731

    errors, warnings = [], []
    raw = read_csv(p("raw_reviews.csv"))
    cleaned = read_csv(p("cleaned_reviews.csv"))
    updates = read_csv(p("updates.csv"))
    mapped = read_csv(p("version_mapped_reviews.csv"))
    unmatched = read_csv(p("unmatched_reviews.csv"))
    labels = read_csv(p("labeling_template.csv"))
    pre = json.load(open(p("_preprocess_stats.json"), encoding="utf-8"))

    # 1. 리뷰 중복
    for name, rows in (("cleaned", cleaned), ("mapped+unmatched", mapped + unmatched)):
        dup = [k for k, c in Counter((r["platform"], r["review_id"]) for r in rows).items() if c > 1]
        if dup:
            errors.append(f"{name}: 리뷰 ID 중복 {len(dup)}건")
    if len(mapped) + len(unmatched) != len(cleaned):
        errors.append(f"매핑 결과 합계 불일치: {len(mapped)}+{len(unmatched)} != {len(cleaned)}")
    if len(labels) != len(cleaned):
        errors.append("라벨링 템플릿 행 수가 정제 리뷰 수와 다름")

    # 2. 업데이트 버전 중복
    uid = Counter(u["update_id"] for u in updates)
    pv = Counter((u["platform"], u["version"]) for u in updates)
    if any(c > 1 for c in uid.values()) or any(c > 1 for c in pv.values()):
        errors.append("업데이트 ID 또는 (플랫폼, 버전) 중복")
    by_id = {u["update_id"]: u for u in updates}

    # 3. 날짜 검증
    for r in cleaned:
        d = kst_date(r["published_at"])
        if not d or not DATE_RE.match(d):
            errors.append(f"{r['review_id']}: 작성일 형식 오류")
        elif not (args.earliest <= d < args.collected_before):
            errors.append(f"{r['review_id']}: 작성일 범위 밖 {d}")
    official_statuses = ("official_store_history", "official_company_provided")
    official = [u for u in updates if u["verification_status"] in official_statuses]
    for u in updates:
        if u["release_date"] and not DATE_RE.match(u["release_date"]):
            errors.append(f"{u['update_id']}: 적용일 형식 오류")
        if u["release_date"] and u["verification_status"] not in official_statuses:
            errors.append(f"{u['update_id']}: 공식 출처 없는 적용일")
        if u["verification_status"] in official_statuses and not u["source_url"]:
            errors.append(f"{u['update_id']}: 공식 업데이트에 출처 없음")
    per_plat = defaultdict(list)
    for u in official:
        per_plat[u["platform"]].append(u)
    for plat, us in per_plat.items():
        us = sorted(us, key=lambda u: version_key(u["version"]))
        for a, b in zip(us, us[1:]):
            if a["release_date"] > b["release_date"]:
                warnings.append(f"{plat}: 버전 순서와 적용일 순서 불일치 {a['version']}({a['release_date']}) > {b['version']}({b['release_date']})")
    # 실제 버전 리뷰가 그 버전의 공식 적용일보다 먼저 작성된 경우
    early = []
    for r in mapped:
        u = by_id.get(r["update_id"])
        if not u:
            errors.append(f"{r['review_id']}: 없는 update_id {r['update_id']}")
            continue
        if r["matching_method"] == "actual_version" and u["release_date"] and kst_date(r["published_at"]) < u["release_date"]:
            early.append(r["review_id"])
    if early:
        warnings.append(f"실제 버전의 공식 적용일보다 먼저 작성된 리뷰 {len(early)}건 (시간대·단계적 출시 확인 필요): {early[:5]}")

    # 4. 매핑 방식 구분
    methods = Counter(r["matching_method"] for r in mapped)
    bad = set(methods) - {"actual_version", "date_estimated"}
    if bad:
        errors.append(f"알 수 없는 매핑 방식 {bad}")
    for r in mapped:
        if r["matching_method"] == "actual_version" and not r["app_version"]:
            errors.append(f"{r['review_id']}: 버전 없이 actual_version")
        if r["matching_method"] == "date_estimated" and r["app_version"]:
            errors.append(f"{r['review_id']}: 버전이 있는데 date_estimated")

    # 5. 출처·데이터 유형·임시 라벨
    if any(not r["source_url"] for r in cleaned):
        errors.append("출처 URL 없는 리뷰")
    if any(r["data_type"] != "actual" for r in cleaned):
        errors.append("실제 데이터가 아닌 행 포함")
    if any(r["proxy_sentiment"] != proxy_sentiment(r["rating"]) for r in cleaned):
        errors.append("임시 라벨 규칙 위반")

    # ---- 분포 ----
    plat_counts = {plat: {
        "raw": sum(1 for r in raw if r["platform"] == plat),
        "cleaned": sum(1 for r in cleaned if r["platform"] == plat),
        "actual_version": sum(1 for r in mapped if r["platform"] == plat and r["matching_method"] == "actual_version"),
        "date_estimated": sum(1 for r in mapped if r["platform"] == plat and r["matching_method"] == "date_estimated"),
        "unmatched": sum(1 for r in unmatched if r["platform"] == plat),
        "rating_dist": rating_dist([r for r in cleaned if r["platform"] == plat]),
        "date_range": [min(kst_date(r["published_at"]) for r in cleaned if r["platform"] == plat),
                       max(kst_date(r["published_at"]) for r in cleaned if r["platform"] == plat)],
        "collection_group": sorted({r["collection_group"] for r in cleaned if r["platform"] == plat}),
    } for plat in sorted({r["platform"] for r in raw})}

    # 공식 업데이트별 표 (요청서 11장): 플랫폼은 섞지 않고 열로 분리
    rv_by_update = defaultdict(list)
    for r in mapped:
        rv_by_update[r["update_id"]].append(r)
    by_plat_ver = defaultdict(list)
    for r in mapped:
        if r["app_version"]:
            by_plat_ver[(r["platform"], r["app_version"])].append(r)
    plats = sorted({r["platform"] for r in cleaned})
    official_table = []
    for u in sorted(official, key=lambda u: (u["platform"], version_key(u["version"])), reverse=True):
        rows_same = rv_by_update[u["update_id"]]
        other = {p: by_plat_ver.get((p, u["version"]), []) for p in plats if p != u["platform"]}
        official_table.append({
            "version": u["version"], "platform": u["platform"], "release_date": u["release_date"],
            "update_type": u["update_type"], "update_group": u["update_group"], "patch_summary": u["patch_summary"],
            "reviews": len(rows_same), "rating_dist": rating_dist(rows_same),
            "actual_version": sum(1 for r in rows_same if r["matching_method"] == "actual_version"),
            "date_estimated": sum(1 for r in rows_same if r["matching_method"] == "date_estimated"),
            "other_platform_same_version_string": {p: {"reviews": len(rs), "rating_dist": rating_dist(rs)} for p, rs in other.items()},
            "source_url": u["source_url"],
            "status": f"공식 출처 확인({u['platform']}, {u['verification_status']})",
        })

    # 업데이트 그룹별(플랫폼 분리) 요약
    group_rows = defaultdict(list)
    for r in mapped:
        group_rows[(r["platform"], r["update_group"])].append(r)
    group_basis = {}
    for u in updates:
        group_basis.setdefault((u["platform"], u["update_group"]), set()).add(u["group_basis"])
    groups = sorted(({
        "platform": plat, "update_group": g, "reviews": len(rows),
        "actual_version": sum(1 for r in rows if r["matching_method"] == "actual_version"),
        "date_estimated": sum(1 for r in rows if r["matching_method"] == "date_estimated"),
        "rating_dist": rating_dist(rows),
        "group_basis": sorted(group_basis.get((plat, g), [])),
    } for (plat, g), rows in group_rows.items()), key=lambda x: (x["platform"], version_key((x["update_group"] or "v0").lstrip("v").replace(".x", "")) or ()), reverse=True)

    report = {
        "generated_for": "달토끼 키우기 업데이트별 리뷰 데이터셋",
        "status": "FAIL" if errors else "PASS",
        "errors": errors[:200],
        "warnings": warnings,
        "preprocess": pre,
        "platforms": plat_counts,
        "updates": {
            "total": len(updates),
            "by_status": dict(Counter(f"{u['platform']} | {u['verification_status']}" for u in updates).most_common()),
            "official_count": len(official),
        },
        "mapping": {"actual_version": methods.get("actual_version", 0), "date_estimated": methods.get("date_estimated", 0),
                    "unmatched": len(unmatched), "unmatched_reasons": dict(Counter(r["unmatched_reason"] for r in unmatched))},
        "missing": {
            "app_version_null": sum(1 for r in cleaned if not r["app_version"]),
            "helpful_count_null": sum(1 for r in cleaned if r["helpful_count"] == ""),
            "collected_at_null": sum(1 for r in cleaned if not r["collected_at"]),
            "rating_null": sum(1 for r in cleaned if not r["rating"]),
        },
        "labeling": {
            "proxy_sentiment": dict(Counter(r["proxy_sentiment"] for r in cleaned)),
            "split_hint": dict(Counter(r["split_hint"] for r in labels)),
            "korean_non_duplicate": sum(1 for r in cleaned if r["is_korean"] == "True" and r["is_text_duplicate"] == "False"),
        },
        "official_update_table": official_table,
        "update_groups": groups,
    }
    write_json(p("collection_report.json"), report)

    print(f"status: {report['status']}  errors={len(errors)} warnings={len(warnings)}")
    for e in errors[:20]:
        print("  ERROR", e)
    for w in warnings:
        print("  WARN ", w)
    print(json.dumps({k: report[k] for k in ("platforms", "mapping", "missing", "labeling")}, ensure_ascii=False, indent=1))
    print("\n플랫폼 | 버전 | 적용일 | 유형 | 리뷰(실제/추정) | 별점1~5 | 다른 플랫폼 같은 버전 리뷰")
    for t in official_table:
        other = ", ".join(f"{p} {v['reviews']}" for p, v in t["other_platform_same_version_string"].items())
        print(f"{t['platform']} | {t['version']} | {t['release_date']} | {t['update_type']} | {t['reviews']}({t['actual_version']}/{t['date_estimated']}) | "
              f"{'/'.join(map(str, t['rating_dist'].values()))} | {other}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
