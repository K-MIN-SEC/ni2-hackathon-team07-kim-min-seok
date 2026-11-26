"""웹 열람 지문 파일(*.keys.json)의 각 항목이 팀 파일(data/reviews.csv)과 정확히 일치하는지 확인한다.

일치하지 않는 항목의 위치(index)를 출력한다. 이 항목들은 팀 파일에 없으므로,
웹 화면의 값을 직접 옮겨(manual) 지문으로 검증해야 한다.

사용법: python scripts/check_web_keys.py data/sources/web_view_v2_20261126/gp_relevance.keys.json
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta


def sha12(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def norm(t: str) -> str:
    return re.sub(r"\s+", "", t or "")


def team_index(path="data/reviews.csv") -> set[str]:
    import csv
    keys = set()
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r["store"] != "google_play":
                continue
            t = datetime.strptime(r["date"], "%Y-%m-%d %H:%M:%S")
            d = (t - timedelta(hours=9)).strftime("%Y-%m-%d")
            keys.add(sha12(f"{r['review_id']}|{r['rating']}|{d}|{norm(r['content'])}"))
    return keys


def entries_of(meta) -> list[dict]:
    e = meta["entries"]
    if isinstance(e, str):
        return [{"k": x.split(":")[0], "h": int(x.split(":")[1])} for x in e.split(",") if x]
    return e


if __name__ == "__main__":
    idx = team_index()
    for p in sys.argv[1:]:
        meta = json.load(open(p, encoding="utf-8"))
        ents = entries_of(meta)
        miss = [i for i, e in enumerate(ents) if e["k"] not in idx and not e.get("manual")]
        print(json.dumps({"file": p, "entries": len(ents), "matched_team": len(ents) - len(miss), "unmatched_idx": miss}))
