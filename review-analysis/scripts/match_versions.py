"""리뷰 ↔ 업데이트 연결 → version_mapped_reviews.csv / unmatched_reviews.csv / labeling_template.csv

사용법:
    python scripts/match_versions.py [--reviews data/cleaned_reviews.csv] [--updates data/updates.csv]
                                     [--out-dir data] [--test-from 2026-03-12]

매핑 규칙(요청서 5장):
 1. 리뷰에 실제 앱 버전이 있으면 그 버전을 사용한다 (matching_method=actual_version)
 2. 앱 버전이 없으면 '같은 플랫폼'의 공식 적용일(release_date)로 추정한다 (matching_method=date_estimated)
    - 리뷰 작성일(KST) 이전에 적용된 가장 최근 공식 버전. 공식 이력이 시작되기 전 날짜는 추정하지 않는다
 3. 둘 다 불가능하면 미분류(unmatched)로 남긴다. 다른 플랫폼의 적용일은 쓰지 않는다

라벨링 템플릿:
 - 리뷰 1건 = 1행. 의견 분리는 검수자가 opinion_no를 늘려 행을 추가한다
 - split_group = review_id → 같은 리뷰에서 나온 의견은 학습/테스트로 나뉘지 않게 한다
 - split_hint: --test-from 이후 작성된 리뷰를 temporal_test로 표시(시간순 검증용 제안값)
 - proxy_sentiment는 별점 기반 임시값이며 정답 라벨이 아니다
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import PLATFORM_PREFIX, kst_date, read_csv, version_key, write_csv  # noqa: E402

MAPPED_COLUMNS = ["review_id", "review_text", "rating", "platform", "published_at", "app_version", "update_id",
                  "update_group", "update_type", "matching_method", "helpful_count", "source_url", "collected_at",
                  "collection_group", "is_korean", "is_text_duplicate", "proxy_sentiment"]
UNMATCHED_COLUMNS = MAPPED_COLUMNS + ["unmatched_reason"]
LABEL_COLUMNS = ["review_id", "platform", "published_at", "app_version", "update_group", "matching_method",
                 "rating", "proxy_sentiment", "is_korean", "is_text_duplicate", "review_text", "split_group",
                 "split_hint", "opinion_no", "opinion_text", "sentiment", "other_type", "category_id", "keyword",
                 "annotator", "label_status", "note"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reviews", default="data/cleaned_reviews.csv")
    ap.add_argument("--updates", default="data/updates.csv")
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--test-from", default="2026-03-12",
                    help="이 날짜(KST) 이후 작성 리뷰를 temporal_test로 표시 (기본: 공식 버전 기록 시작일)")
    args = ap.parse_args()

    updates = read_csv(args.updates)
    by_id = {u["update_id"]: u for u in updates}
    official = defaultdict(list)  # platform -> [(release_date, version_key, update)]
    for u in updates:
        if u["release_date"]:
            official[u["platform"]].append((u["release_date"], version_key(u["version"]) or (), u))
    for p in official:
        official[p].sort(key=lambda t: (t[0], t[1]))

    mapped, unmatched = [], []
    for r in read_csv(args.reviews):
        out = {k: r.get(k) for k in MAPPED_COLUMNS}
        ver = r.get("app_version")
        d = kst_date(r.get("published_at"))
        u = None
        if ver:
            u = by_id.get(f"{PLATFORM_PREFIX[r['platform']]}-{ver}")
            method = "actual_version" if u else None
        elif d and official.get(r["platform"]):
            cands = [t for t in official[r["platform"]] if t[0] <= d]
            if cands:
                u = cands[-1][2]
                method = "date_estimated"
        if u:
            out.update(update_id=u["update_id"], update_group=u["update_group"], update_type=u["update_type"],
                       matching_method=method)
            mapped.append(out)
        else:
            if ver:
                reason = "version_not_in_updates_table"
            elif not d:
                reason = "no_app_version_no_date"
            elif not official.get(r["platform"]):
                reason = "no_app_version_and_no_official_release_dates_for_platform"
            else:
                reason = "no_app_version_and_date_before_official_history"
            out.update(update_id=None, update_group=None, update_type=None, matching_method="unmatched",
                       unmatched_reason=reason)
            unmatched.append(out)

    write_csv(os.path.join(args.out_dir, "version_mapped_reviews.csv"), mapped, MAPPED_COLUMNS)
    write_csv(os.path.join(args.out_dir, "unmatched_reviews.csv"), unmatched, UNMATCHED_COLUMNS)

    label_rows = []
    for r in mapped + unmatched:
        d = kst_date(r.get("published_at")) or ""
        label_rows.append({
            **{k: r.get(k) for k in LABEL_COLUMNS if k in r},
            "split_group": r["review_id"],
            "split_hint": "temporal_test" if d >= args.test_from else "train_candidate",
            "opinion_no": 1,
            "label_status": "unlabeled",
        })
    label_rows.sort(key=lambda x: (x["published_at"] or ""), reverse=True)
    write_csv(os.path.join(args.out_dir, "labeling_template.csv"), label_rows, LABEL_COLUMNS)

    cnt = defaultdict(int)
    for r in mapped:
        cnt[(r["platform"], r["matching_method"])] += 1
    for r in unmatched:
        cnt[(r["platform"], "unmatched:" + r["unmatched_reason"])] += 1
    print(f"mapped {len(mapped)} / unmatched {len(unmatched)}", dict(cnt))


if __name__ == "__main__":
    main()
