"""시연용 CSV 나누기: data/reviews_labeled.csv → data/demo/ (작성 연도별 4개 파일)

대시보드에 하나씩 넣으며 '누적'을 고르면 수치와 버전별 추이가 늘어나는 장면을 보여 주기 위한 파일입니다.
4개를 모두 누적하면 예시 자료(전체 6,349건)와 같은 수치가 됩니다.

사용법:
    python scripts/make_demo_splits.py
"""
from __future__ import annotations

import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "reviews_labeled.csv")
OUT = os.path.join(ROOT, "data", "demo")

# (파일 이름, 포함할 작성 연도)
PARTS = [
    ("1_2021.csv", {"2021"}),
    ("2_2022.csv", {"2022"}),
    ("3_2023.csv", {"2023"}),
    ("4_2024-2026.csv", {"2024", "2025", "2026"}),
]


def main() -> None:
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, years in PARTS:
        part = [r for r in rows if r["date"][:4] in years]
        with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(part)
        total += len(part)
        print(f"{name}: {len(part):,}건")
    assert total == len(rows), f"나눈 합계 {total} != 원본 {len(rows)}"
    print(f"합계 {total:,}건 = 원본 {len(rows):,}건")


if __name__ == "__main__":
    main()
