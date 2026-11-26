"""data/reviews_labeled.csv (+ work/audit.json) → dashboard/dashboard.html (오프라인 단일 파일)

대시보드는 리뷰 단위 데이터로 모든 수치를 브라우저 안에서 계산한다(scripts/analyze.py와 같은 규칙).
여기서 넣는 리뷰는 '예시 자료'이며, 사용자는 화면의 'CSV 불러오기'로 다른 라벨 CSV를 넣어 다시 계산할 수 있다.
개발자 답변은 넣지 않는다.
"""
import csv
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

TOPICS = ["과금", "버그", "콘텐츠", "운영", "밸런스/성장", "UI/편의성", "캐릭터/아트", "광고", "일반"]
SENT_CODE = {"긍정": "P", "혼합": "M", "중립": "N", "부정": "X"}

data = {}
if os.path.exists("work/audit.json"):
    data["audit"] = json.load(open("work/audit.json", encoding="utf-8"))

# analyze.py의 불용어 목록을 그대로 가져와 같은 규칙으로 '자주 나온 표현'을 센다
src = open("scripts/analyze.py", encoding="utf-8").read()
data["stop"] = re.search(r'STOP = set\("""(.*?)"""\.split\(\)\)', src, re.S).group(1).split()

rows = []
with open("data/reviews_labeled.csv", encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        ver = (r.get("version") or "").strip()
        m = re.match(r"^(\d+\.\d+)", ver)
        topics = r.get("topics") or ""
        rows.append({
            "i": r["review_id"], "s": "g" if r["store"] == "google_play" else "a", "d": r["date"][:19],
            "r": int(r["rating"]), "v": ver, "mi": m.group(1) if m else "",
            "th": int(float(r["thumbs_up"] or 0)), "ti": (r.get("title") or "").strip(),
            "t": r["content"] or "", "se": SENT_CODE[r["sentiment"]],
            "ts": {t: SENT_CODE[r[f"sent_{t}"]] for t in TOPICS if r.get(f"sent_{t}")},
            "k": [k for k in (r["keywords"] or "").split("|") if k], "ls": r["label_source"],
            "nt": topics.count("|") + 1,   # analyze.py pick_quotes의 주제 수(topics.str.count('|') + 1)
        })
data["reviews"] = rows

tpl = open("dashboard/dashboard_template.html", encoding="utf-8").read()
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = tpl.replace("/*__DATA__*/null", payload)
open("dashboard/dashboard.html", "w", encoding="utf-8").write(html)
print("저장 dashboard/dashboard.html", len(html.encode("utf-8")) // 1024, "KB (예시 리뷰", len(rows), "건 내장)")
