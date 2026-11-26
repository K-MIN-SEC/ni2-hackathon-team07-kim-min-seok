"""work/analysis.json (+ work/audit.json) → dashboard/dashboard.html (오프라인 단일 파일)"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

data = json.load(open("work/analysis.json", encoding="utf-8"))
if os.path.exists("work/audit.json"):
    data["audit"] = json.load(open("work/audit.json", encoding="utf-8"))
tpl = open("dashboard/dashboard_template.html", encoding="utf-8").read()
payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
html = tpl.replace("/*__DATA__*/null", payload)
open("dashboard/dashboard.html", "w", encoding="utf-8").write(html)
print("저장 dashboard/dashboard.html", len(html) // 1024, "KB")
