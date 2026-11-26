"""업데이트별 리뷰 데이터셋 공통 유틸 (표준 라이브러리만 사용)."""
from __future__ import annotations

import csv
import json
import re
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
GAME = "달토끼 키우기"
GP_PACKAGE = "com.AbleGames.DalToKi"
IOS_APP_ID = "1599684924"
PLATFORM_PREFIX = {"Google Play": "gp", "App Store": "ios"}
IOS_REVIEWS_URL = f"https://apps.apple.com/kr/app/id{IOS_APP_ID}?see-all=reviews&platform=iphone"


def read_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: str, rows: list[dict], columns: list[str]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in columns})


def write_json(path: str, obj) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def none_if_blank(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def version_key(v: str | None):
    """'1.154.2' -> (1, 154, 2). 숫자가 아닌 버전은 None."""
    if not v or not re.fullmatch(r"\d+(\.\d+)*", v.strip()):
        return None
    return tuple(int(p) for p in v.strip().split("."))


def minor_group(v: str) -> str | None:
    k = version_key(v)
    if not k or len(k) < 2:
        return None
    return f"v{k[0]}.{k[1]}.x"


def kst_date(iso_kst: str | None) -> str | None:
    return iso_kst[:10] if iso_kst else None


def to_kst_iso(raw: str | None, basis: str) -> str | None:
    """원본 시각 문자열('YYYY-MM-DD HH:MM:SS')을 KST ISO로.
    basis='utc'          : 원본이 UTC → +9시간
    basis='assumed_kst'  : 원본이 수집 PC 현지 시각(한국으로 가정) → 그대로 +09:00 표기
    """
    raw = none_if_blank(raw)
    if not raw:
        return None
    if basis == "utc_date":
        # 웹 화면에 날짜만 표시됨(UTC 기준). 시각이 없어 KST로 바꿀 수 없으므로 그대로 둔다
        return datetime.strptime(raw[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    if basis == "utc":
        dt = dt.replace(tzinfo=timezone.utc).astimezone(KST)
    elif basis == "assumed_kst":
        dt = dt.replace(tzinfo=KST)
    else:
        raise ValueError(basis)
    return dt.isoformat()


def proxy_sentiment(rating) -> str:
    """별점 기반 임시 라벨. 정답 라벨이 아니다."""
    try:
        r = int(rating)
    except (TypeError, ValueError):
        return "unlabeled"
    if r >= 4:
        return "positive"
    if r <= 2:
        return "negative"
    return "unlabeled"
