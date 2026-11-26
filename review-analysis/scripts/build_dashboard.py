"""work/analysis.json (+ work/audit.json) → dashboard/dashboard.html (오프라인 단일 파일)"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 저장소 폴더


def main():
    data = json.load(open("work/analysis.json", encoding="utf-8"))
    if os.path.exists("work/audit.json"):
        data["audit"] = json.load(open("work/audit.json", encoding="utf-8"))
    tpl = open("dashboard/dashboard_template.html", encoding="utf-8").read()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = tpl.replace("/*__DATA__*/null", payload)
    open("dashboard/dashboard.html", "w", encoding="utf-8").write(html)
    print("저장 dashboard/dashboard.html", len(html) // 1024, "KB")


if __name__ == "__main__":
    os.chdir(ROOT)  # 어느 위치에서 실행해도 저장소 폴더 기준 경로(data/, work/)로 동작
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
