"""브라우저에서 나눠 받은 지문 조각(*.partNN.txt)을 하나의 keys.json으로 합친다.

조각 형식: 쉼표로 구분된 항목. 항목 = '지문12자' 또는 '지문12자:유용함수'(유용함 0이면 생략)
사용법:
  python scripts/merge_key_parts.py <조각 폴더> <출력 keys.json> <meta.json>
meta.json: platform, collection_group, source, source_url, rating_filter, sort, captured_at, expected_total, check_digest
check_digest: 브라우저에서 계산한 sha1(전체 항목을 쉼표로 이은 문자열) 앞 12자 → 조각 누락·순서 오류 확인용
"""
import glob
import hashlib
import json
import os
import re
import sys

parts_dir, out_path, meta_path = sys.argv[1:4]
meta = json.load(open(meta_path, encoding="utf-8"))
files = sorted(glob.glob(os.path.join(parts_dir, "*.part*.txt")), key=lambda p: int(re.search(r"part(\d+)", p).group(1)))
items = []
for p in files:
    items += [x for x in open(p, encoding="utf-8").read().strip().split(",") if x]
entries = [x if ":" in x else f"{x}:0" for x in items]
bad = [x for x in entries if not re.fullmatch(r"[0-9a-f]{12}:\d+", x)]
digest = hashlib.sha1(",".join(items).encode()).hexdigest()[:12]
assert not bad, f"형식 오류 {bad[:5]}"
assert len(entries) == meta["expected_total"], f"개수 불일치 {len(entries)} != {meta['expected_total']}"
assert digest == meta["check_digest"], f"digest 불일치 {digest} != {meta['check_digest']}"
out = {k: meta[k] for k in ("platform", "collection_group", "source", "source_url", "rating_filter", "sort", "captured_at")}
out["key_rule"] = "sha1(review_id|rating|date(YYYY-MM-DD, 화면 표시)|본문에서 공백 제거)의 앞 12자. h=화면의 '유용함' 수"
out["entries"] = ",".join(entries)
json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"OK {len(entries)} entries from {len(files)} parts, digest {digest}")
