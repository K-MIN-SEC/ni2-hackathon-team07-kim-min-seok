"""v2 데이터셋 생성: 추가 웹 열람 리뷰 + 업데이트 이력 + 매핑 + 용도별 데이터셋 분리 → data/v2/

기존 파일(data/*.csv, data/web/*)은 읽기만 하고 수정하지 않는다.

입력
  - data/sources/web_view_20261126/*.keys.json      (1차 웹 열람 지문, 기존)
  - data/sources/web_view_v2_20261126/*.keys.json   (2차 웹 열람 지문, 이번 작업)
  - data/sources/web_view_v2_20261126/gp_en_us_newest.json, ios_web_us.json, ios_web_foreign.json (해외 리뷰, 화면 값 + 지문)
  - data/reviews.csv        (팀 파일: 지문이 정확히 일치한 행의 본문만 가져옴)
  - data/web/reviews_web.csv (1차 결과: App Store 한국 웹 리뷰 10건, 1차 채택 목록)
  - data/updates.csv        (App Store 공식 버전 기록 25개)

출력 (data/v2/)
  reviews_additional.csv, reviews_training.csv, reviews_validation.csv, reviews_analytics.csv,
  reviews_rating_supplement.csv, reviews_foreign.csv, community_feedback.csv,
  updates_official.csv, updates_observed.csv, collection_report_v2.json

사용법: python scripts/build_v2_datasets.py
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from dataset_common import GAME, GP_PACKAGE, read_csv, write_csv, write_json, proxy_sentiment  # noqa: E402
from preprocess_reviews import is_korean, mask_pii, norm_for_dup  # noqa: E402

V1_KEYS = "data/sources/web_view_20261126"
V2_DIR = "data/sources/web_view_v2_20261126"
OUT = "data/v2"
CAPTURED = "2026-11-26"
MAX_WINDOW_DAYS = 45  # 추정 기간 상한(적용일로부터). 넘으면 unmatched

NEWEST_GROUPS = {"gp_web_newest", "gp_web_newest_ext", "gp_web_newest_full"}  # 실제 분포(최신순; full은 목록 전체)
RATING_GROUPS = {"gp_web_rating1_supplement", "gp_web_rating2_supplement", "gp_web_rating3_supplement",
                 "gp_web_rating4_supplement", "gp_web_rating5_supplement"}
RELEVANCE_GROUPS = {"gp_web_relevance"}
IOS_KR_GROUPS = {"ios_web_default"}
V2_KR_GROUPS = {"gp_web_newest_ext", "gp_web_newest_full", "gp_web_relevance", "gp_web_rating3_supplement",
                "gp_web_rating4_supplement", "gp_web_rating5_supplement"}


def sha12(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def nows(t: str) -> str:
    return re.sub(r"\s+", "", t or "")


# ---------------------------------------------------------------- 언어(문자 체계 기반 추정)
SCRIPTS = [("ko", re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")), ("ja", re.compile(r"[぀-ヿ]")),
           ("zh", re.compile(r"[一-鿿]")), ("latin", re.compile(r"[A-Za-zÀ-ɏ]")),
           ("ar", re.compile(r"[؀-ۿ]")), ("bn", re.compile(r"[ঀ-৿]"))]


def detect_lang(text: str) -> str:
    c = {k: len(p.findall(text)) for k, p in SCRIPTS}
    if c["ja"]:
        c["ja"] += c["zh"]  # 일본어 문장의 한자는 일본어로 본다
        c["zh"] = 0
    k, n = max(c.items(), key=lambda kv: kv[1])
    return k if n else "und"  # und: 이모지·기호만 있음


# ---------------------------------------------------------------- 한국 Google Play: 지문 → 팀 파일 행
def team_gp_index(path="data/reviews.csv"):
    idx = {}
    for r in read_csv(path):
        if r["store"] != "google_play":
            continue
        t = datetime.strptime(r["date"], "%Y-%m-%d %H:%M:%S")
        d = (t - timedelta(hours=9)).strftime("%Y-%m-%d")
        idx[sha12(f"{r['review_id']}|{r['rating']}|{d}|{nows(r['content'])}")] = (r, d)
    return idx


def entries_of(meta):
    e = meta["entries"]
    if isinstance(e, str):
        return [{"k": x.split(":")[0], "h": int(x.split(":")[1])} for x in e.split(",") if x]
    return e


def load_kr_gp(idx):
    rows: dict[str, dict] = {}
    per_file = {}
    for d, phase in ((V2_DIR, "v2"), (V1_KEYS, "v1")):
        for p in sorted(glob.glob(os.path.join(d, "gp_*.keys.json"))):
            meta = json.load(open(p, encoding="utf-8"))
            ents = entries_of(meta)
            st = {"phase": phase, "group": meta["collection_group"], "viewed": len(ents), "matched": 0, "unmatched": 0}
            for e in ents:
                if e["k"] not in idx:
                    st["unmatched"] += 1
                    continue
                st["matched"] += 1
                r, d8 = idx[e["k"]]
                rid = r["review_id"]
                if rid in rows:
                    if meta["collection_group"] not in rows[rid]["groups"]:
                        rows[rid]["groups"].append(meta["collection_group"])
                    continue
                rows[rid] = {"platform": "Google Play", "country": "KR", "review_id": rid, "title": "",
                             "text": r["content"], "rating": int(r["rating"]), "date": d8, "date_basis": "utc_date",
                             "helpful": e.get("h"), "has_dev_reply": None, "groups": [meta["collection_group"]],
                             "source_url": f"https://play.google.com/store/apps/details?id={GP_PACKAGE}&hl=ko&gl=KR&reviewId={rid}",
                             "verification": "fingerprint_match_team_file", "source_file": os.path.basename(p)}
            per_file[f"{phase}/{os.path.basename(p)}"] = st
    return rows, per_file


def load_ios_kr():
    out = {}
    for r in read_csv("data/web/reviews_web.csv"):
        if r["store"] != "app_store":
            continue
        out[r["review_id"]] = {"platform": "App Store", "country": "KR", "review_id": r["review_id"],
                               "title": r["title"], "text": r["content"], "rating": int(r["rating"]),
                               "date": r["date"], "date_basis": "utc_date", "helpful": None, "has_dev_reply": None,
                               "groups": r["collection_group"].split(";"), "source_url": r["source_url"],
                               "verification": "fingerprint(v1)", "source_file": "data/web/reviews_web.csv"}
    return out


def load_foreign():
    out, stats = [], {}
    m = json.load(open(os.path.join(V2_DIR, "gp_en_us_newest.json"), encoding="utf-8"))
    keys = [k.split(":") for k in m["keys"].split(",")]
    ok = 0
    for row, (k, h) in zip(m["rows"], keys):
        rid, rating, date, helpful, reply, reply_date, text = row
        if sha12(f"{rid}|{rating}|{date}|{nows(text)}") != k or int(h) != helpful:
            continue
        ok += 1
        out.append({"platform": "Google Play", "country": "US", "review_id": rid, "title": "", "text": text,
                    "rating": rating, "date": date, "date_basis": "screen_date_us_locale", "helpful": helpful,
                    "has_dev_reply": bool(reply), "groups": [m["collection_group"]],
                    "source_url": f"https://play.google.com/store/apps/details?id={GP_PACKAGE}&hl=en&gl=US&reviewId={rid}",
                    "verification": "screen_values+fingerprint", "source_file": "gp_en_us_newest.json"})
    stats["gp_en_us_newest"] = {"viewed_loaded": 200, "transcribed": len(m["rows"]), "verified": ok}

    us = json.load(open(os.path.join(V2_DIR, "ios_web_us.json"), encoding="utf-8"))
    for r in us["rows"]:
        out.append(_ios_row(r, "us", us["collection_group"], "screen_values(지문 재확인 불가: HTTP 429)", "ios_web_us.json"))
    stats["ios_web_us"] = {"viewed": len(us["rows"]), "verified": 0, "note": "DOM 추출값을 그대로 저장. 지문 재확인 요청이 HTTP 429로 거부됨"}

    fo = json.load(open(os.path.join(V2_DIR, "ios_web_foreign.json"), encoding="utf-8"))
    for c, v in fo["countries"].items():
        ok = 0
        for r in v["rows"]:
            if sha12(f"{r['id']}|{r['dt']}|{nows(r['title'])}|{nows(r['body'])}") != r["k"]:
                continue
            ok += 1
            out.append(_ios_row(r, c, fo["collection_group"], "screen_values+fingerprint", "ios_web_foreign.json"))
        stats[f"ios_web_{c}"] = {"viewed": len(v["rows"]), "verified": ok}
    return out, stats


def _ios_row(r, country, group, ver, src):
    return {"platform": "App Store", "country": country.upper(), "review_id": r["id"], "title": r["title"],
            "text": r["body"], "rating": r["rating"], "date": r["dt"][:10], "date_basis": "utc_date",
            "helpful": None, "has_dev_reply": bool(r.get("reply")), "groups": [group],
            "source_url": f"https://apps.apple.com/{country}/app/id1599684924?see-all=reviews&platform=iphone",
            "verification": ver, "source_file": src}


# ---------------------------------------------------------------- 업데이트 이력
def load_official_updates():
    ups = []
    for u in read_csv("data/updates.csv"):
        if u["verification_status"] != "official_store_history":
            continue
        ups.append({"update_id": u["update_id"], "platform": "App Store", "version": u["version"],
                    "notice_title": "", "notice_posted_at": "", "applied_date": u["release_date"],
                    "applied_date_basis": "App Store 버전 기록 표시 날짜", "update_type": u["update_type"],
                    "update_group": u["update_group"], "change_summary": u["patch_summary"],
                    "source_type": "store_version_history", "source_url": u["source_url"],
                    "verified_at": "2026-11-26", "verification_status": "official_verified"})
    ups.append({"update_id": "gp-1.154.3", "platform": "Google Play", "version": "1.154.3", "notice_title": "",
                "notice_posted_at": "", "applied_date": "2026-10-29",
                "applied_date_basis": "Google Play 앱 정보 '업데이트 날짜'(스토어 등록정보 갱신일). 해당 버전 배포 시작일과 다를 수 있음",
                "update_type": "unknown", "update_group": "", "change_summary": "",
                "source_type": "store_listing_about", "source_url": f"https://play.google.com/store/apps/details?id={GP_PACKAGE}&hl=ko&gl=KR",
                "verified_at": "2026-11-26", "verification_status": "official_verified_listing_date"})
    ups.sort(key=lambda u: (u["platform"], u["applied_date"]))
    return ups


# ---------------------------------------------------------------- 네이버 라운지 패치노트(사람이 직접 옮긴 파일)
LOUNGE_URL = re.compile(r"^https://game\.naver\.com/lounge/DalToKi/board/detail/\d+$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PLATFORMS = {"Google Play": ["Google Play"], "App Store": ["App Store"], "both": ["Google Play", "App Store"]}


def load_lounge_patchnotes(path):
    """사람이 열람해 옮긴 패치노트 CSV를 검증해 공식 이력 행으로 바꾼다.
    - applied_date가 빈 행은 '미입력'으로 건너뛴다(추정해서 채우지 않음)
    - 형식 오류는 errors로 모아 중단한다
    returns (rows, pending_urls, errors)
    """
    if not path or not os.path.exists(path):
        return [], None, []
    rows, pending, errors = [], [], []
    for i, r in enumerate(read_csv(path), start=2):
        r = {k: (v or "").strip() for k, v in r.items()}
        url = r.get("source_url", "")
        where = f"{os.path.basename(path)}:{i}"
        if not LOUNGE_URL.match(url):
            errors.append(f"{where} source_url 형식 오류: {url!r}")
        if not r.get("applied_date"):
            pending.append(url)
            continue
        for k in ("notice_posted_at", "applied_date"):
            if r.get(k) and not DATE.match(r[k]):
                errors.append(f"{where} {k}는 YYYY-MM-DD(KST): {r[k]!r}")
        if r.get("applied_time") and not re.match(r"^\d{2}:\d{2}$", r["applied_time"]):
            errors.append(f"{where} applied_time은 HH:MM(KST): {r['applied_time']!r}")
        if r.get("platform") not in PLATFORMS:
            errors.append(f"{where} platform은 Google Play / App Store / both 중 하나: {r.get('platform')!r}")
            continue
        if r.get("version") and not re.match(r"^\d+(\.\d+)+$", r["version"]):
            errors.append(f"{where} version 형식 오류: {r['version']!r}")
        if not r.get("transcribed_by") or not r.get("transcribed_at"):
            errors.append(f"{where} transcribed_by / transcribed_at(옮긴 사람·날짜) 필수")
        post_id = url.rsplit("/", 1)[1]
        for plat in PLATFORMS[r["platform"]]:
            rows.append({"update_id": f"lounge-{post_id}-{'gp' if plat == 'Google Play' else 'ios'}",
                         "platform": plat, "version": r.get("version", ""), "notice_title": r.get("notice_title", ""),
                         "notice_posted_at": r.get("notice_posted_at", ""), "applied_date": r["applied_date"],
                         "applied_date_basis": "네이버 라운지 공식 공지의 적용(점검) 일자" + (f" {r['applied_time']} KST" if r.get("applied_time") else ""),
                         "update_type": r.get("update_type") or "unknown", "update_group": "",
                         "change_summary": r.get("change_summary", ""), "source_type": "naver_lounge_notice",
                         "source_url": url, "verified_at": r["transcribed_at"],
                         "verification_status": f"manually_transcribed_by:{r['transcribed_by']}"})
    return rows, pending, errors


def merge_official(store_rows, lounge_rows):
    """같은 (플랫폼, 버전)이 여러 공식 출처에 있으면:
    - 스토어 등록정보 날짜(listing)는 라운지 적용일로 대체(매핑에서 제외, 행은 남김)
    - 그 밖에 적용일이 서로 다르면 임의로 고르지 않고 오류
    """
    errors = []
    by_key = {(u["platform"], u["version"]): u for u in store_rows if u["version"]}
    for l in lounge_rows:
        u = by_key.get((l["platform"], l["version"]))
        if not u:
            continue
        if u["applied_date"] == l["applied_date"]:
            # 같은 내용을 두 공식 출처가 확인 → 매핑에는 한 번만 쓴다
            l["verification_status"] += ";same_date_as:" + u["update_id"]
            continue
        if u["source_type"] == "store_listing_about":
            u["verification_status"] += ";superseded_for_mapping_by:" + l["update_id"]
        else:
            errors.append(f"적용일 충돌 {l['platform']} {l['version']}: {u['source_type']} {u['applied_date']} vs 라운지 {l['applied_date']} ({l['source_url']})")
    allrows = store_rows + lounge_rows
    allrows.sort(key=lambda u: (u["platform"], u["applied_date"], u["update_id"]))
    return allrows, errors


# ---------------------------------------------------------------- 매핑
UPDATE_WORDS = re.compile(r"업데이트|업뎃|업데|패치|점검|핫픽스|버전|이번\s*업|개편|리뉴얼|신규\s*(?:콘텐츠|컨텐츠|시스템)|"
                          r"update|patch|version|hotfix|アプデ|アップデート|更新|改版", re.I)
STOP = {"신규", "추가", "기타", "개선", "및", "버그", "수정", "시작", "이벤트", "시즌", "bug", "fix", "bugfix", "오류", "시스템", "확장", "등급"}


def patch_terms(summary: str) -> set[str]:
    words = re.findall(r"[가-힣A-Za-z]{2,}", summary or "")
    return {w for w in words if w not in STOP}


def map_review(r, official_by_plat):
    """exact_version / official_date_estimated / observed_date_estimated / unmatched"""
    if r.get("app_version"):
        return {"mapping_type": "exact_version"}  # 웹 열람 데이터에는 버전이 없어 실제로는 발생하지 않음
    ups = official_by_plat.get(r["platform"], [])
    cand = [u for u in ups if u["applied_date"] and u["applied_date"] <= r["date"]]
    if not cand:
        reason = ("no_official_release_dates_before_review_date" if ups else "no_official_release_dates_for_platform")
        return {"mapping_type": "unmatched", "unmatched_reason": reason + ";no_third_party_observations_available"}
    u = cand[-1]
    nxt = [x for x in ups if x["applied_date"] > u["applied_date"]]
    window_end = nxt[0]["applied_date"] if nxt else CAPTURED
    # 공식 날짜가 드문 구간에서 기간이 수년으로 늘어나지 않도록 상한을 둔다
    cap = (datetime.strptime(u["applied_date"], "%Y-%m-%d") + timedelta(days=MAX_WINDOW_DAYS)).strftime("%Y-%m-%d")
    if r["date"] >= cap:
        return {"mapping_type": "unmatched",
                "unmatched_reason": f"beyond_{MAX_WINDOW_DAYS}d_after_last_known_official_update({u['update_id']});"
                                    "no_third_party_observations_available"}
    window_end = min(window_end, cap)
    return {"mapping_type": "official_date_estimated", "mapped_update_id": u["update_id"],
            "mapped_version_estimated": u["version"], "window_start": u["applied_date"], "window_end": window_end,
            "boundary_day": r["date"] == u["applied_date"], "_summary": u["change_summary"]}


def relation(r, m):
    if m["mapping_type"] == "unmatched":
        return "not_applicable"
    txt = (r.get("title") or "") + " " + r["text"]
    generic = bool(UPDATE_WORDS.search(txt))
    content = sorted(t for t in patch_terms(m.get("_summary", "")) if t in txt)
    if content:
        return "mentions_patch_content:" + "|".join(content)
    if generic:
        return "mentions_update_generic"
    return "period_only"


# ---------------------------------------------------------------- main
COLS = ["review_id", "game", "platform", "country", "language", "language_basis", "review_title", "review_text",
        "rating", "published_date", "published_date_basis", "helpful_count", "has_dev_reply", "collection_groups",
        "in_newest_sample", "is_rating_supplement", "is_relevance_view", "is_new_in_v2", "verification",
        "source_url", "collected_at", "is_korean", "char_len", "pii_masked", "text_dup_group", "is_text_duplicate",
        "proxy_sentiment", "mapping_type", "mapped_update_id", "mapped_version_estimated", "window_start",
        "window_end", "boundary_day", "unmatched_reason", "update_relation", "update_relation_basis"]


def main():
    import argparse
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--patchnotes", default="data/sources/naver_lounge_patchnotes.csv",
                    help="사람이 옮긴 라운지 패치노트 CSV(양식: data/sources/naver_lounge_patchnotes_TEMPLATE.csv). 없으면 건너뜀")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    OUT = args.out
    os.makedirs(OUT, exist_ok=True)

    lounge_rows, lounge_pending, lounge_errors = load_lounge_patchnotes(args.patchnotes)
    idx = team_gp_index()
    kr_gp, per_file = load_kr_gp(idx)
    ios_kr = load_ios_kr()
    foreign, foreign_stats = load_foreign()
    v1_ids = {(r["store"], r["review_id"]) for r in read_csv("data/web/reviews_web.csv")}

    allrows = list(kr_gp.values()) + list(ios_kr.values()) + foreign
    seen, rows, dropped_dup = set(), [], 0
    for r in allrows:
        key = (r["platform"], r["review_id"])
        if key in seen:
            dropped_dup += 1
            continue
        seen.add(key)
        rows.append(r)

    official, merge_errors = merge_official(load_official_updates(), lounge_rows)
    if lounge_errors or merge_errors:
        print("패치노트 파일 오류 — 출력하지 않고 중단합니다:")
        for e in lounge_errors + merge_errors:
            print("  -", e)
        sys.exit(1)
    by_plat = defaultdict(list)
    for u in official:
        if "superseded_for_mapping" in u["verification_status"] or "same_date_as" in u["verification_status"]:
            continue
        by_plat[u["platform"]].append(u)

    out = []
    norm_count = Counter()
    for r in rows:
        text, n1 = mask_pii(r["text"].strip())
        title, n2 = mask_pii(r["title"].strip()) if r["title"] else ("", 0)
        g = set(r["groups"])
        store_key = "google_play" if r["platform"] == "Google Play" else "app_store"
        m = map_review(r, by_plat)
        c = {"review_id": r["review_id"], "game": GAME, "platform": r["platform"], "country": r["country"],
             "language": detect_lang(title + " " + text), "language_basis": "script_heuristic",
             "review_title": title or None, "review_text": text, "rating": r["rating"], "published_date": r["date"],
             "published_date_basis": r["date_basis"], "helpful_count": r["helpful"], "has_dev_reply": r["has_dev_reply"],
             "collection_groups": ";".join(r["groups"]), "in_newest_sample": bool(g & (NEWEST_GROUPS | IOS_KR_GROUPS)),
             "is_rating_supplement": bool(g & RATING_GROUPS), "is_relevance_view": bool(g & RELEVANCE_GROUPS),
             "is_new_in_v2": (store_key, r["review_id"]) not in v1_ids, "verification": r["verification"],
             "source_url": r["source_url"], "collected_at": CAPTURED, "is_korean": is_korean(title + " " + text),
             "char_len": len(text), "pii_masked": n1 + n2, "proxy_sentiment": proxy_sentiment(r["rating"]),
             "_norm": norm_for_dup(title + text), **{k: v for k, v in m.items() if not k.startswith("_")}}
        c["update_relation"] = relation(r, m)
        c["update_relation_basis"] = "keyword_heuristic(미검수)" if m["mapping_type"] != "unmatched" else ""
        norm_count[c["_norm"]] += 1
        out.append(c)

    # 동일 텍스트 그룹(국가·플랫폼 무관, 정규화 후). 삭제하지 않고 표시만 한다
    gid, seen_norm = {}, set()
    for c in sorted(out, key=lambda c: (c["published_date"], c["review_id"])):
        k = c.pop("_norm")
        if k and norm_count[k] > 1:
            gid.setdefault(k, f"T{len(gid) + 1:04d}")
            c["text_dup_group"] = gid[k]
            c["is_text_duplicate"] = k in seen_norm
        else:
            c["text_dup_group"], c["is_text_duplicate"] = None, False
        seen_norm.add(k)
    out.sort(key=lambda c: (c["platform"], c["country"], c["published_date"]), reverse=True)

    kr = [c for c in out if c["country"] == "KR"]
    foreign_rows = [c for c in out if c["country"] != "KR"]
    additional = [c for c in out if c["is_new_in_v2"]]
    analytics = [c for c in kr if c["in_newest_sample"]]
    supplement = [c for c in kr if not c["in_newest_sample"]]

    # 머신러닝용: 한국 스토어 + 한국어 + 텍스트 중복 아님. 시간순 분할(공식 업데이트 기록 시작일 기준)
    VAL_FROM = "2026-03-12"
    ml = [c for c in kr if c["is_korean"] and not c["is_text_duplicate"]]
    train = [dict(c, ml_split="train") for c in ml if c["published_date"] < VAL_FROM]
    val = [dict(c, ml_split="validation") for c in ml if c["published_date"] >= VAL_FROM]

    W = lambda name, rs, cols=COLS: write_csv(os.path.join(OUT, name), rs, cols)  # noqa: E731
    W("reviews_additional.csv", additional)
    W("reviews_analytics.csv", analytics)
    W("reviews_rating_supplement.csv", supplement)
    W("reviews_foreign.csv", foreign_rows)
    W("reviews_training.csv", train, COLS + ["ml_split"])
    W("reviews_validation.csv", val, COLS + ["ml_split"])
    write_csv(os.path.join(OUT, "community_feedback.csv"), [],
              ["feedback_id", "source", "board", "posted_at", "title", "text", "related_update_id", "source_url", "collected_at"])
    ucols = ["update_id", "platform", "version", "notice_title", "notice_posted_at", "applied_date", "applied_date_basis",
             "update_type", "update_group", "change_summary", "source_type", "source_url", "verified_at", "verification_status"]
    write_csv(os.path.join(OUT, "updates_official.csv"), official, ucols)
    write_csv(os.path.join(OUT, "updates_observed.csv"), [],
              ["platform", "version", "observed_date", "observed_date_basis", "observer", "source_url", "collected_at", "note"])

    # ------------------------------------------------------------ 보고서
    def dist(rs, key):
        return dict(sorted(Counter(str(c[key]) for c in rs).items()))

    per_update = []
    for u in official:
        rs = [c for c in out if c.get("mapped_update_id") == u["update_id"]]
        if not rs:
            per_update.append({"update_id": u["update_id"], "platform": u["platform"], "version": u["version"],
                               "applied_date": u["applied_date"], "reviews": 0})
            continue
        per_update.append({"update_id": u["update_id"], "platform": u["platform"], "version": u["version"],
                           "applied_date": u["applied_date"], "reviews": len(rs),
                           "by_country": dist(rs, "country"), "rating_dist": dist(rs, "rating"),
                           "in_newest_sample": sum(c["in_newest_sample"] for c in rs),
                           "rating_supplement_only": sum(not c["in_newest_sample"] and c["country"] == "KR" for c in rs),
                           "update_relation": dict(Counter(c["update_relation"].split(":")[0] for c in rs)),
                           "boundary_day": sum(bool(c.get("boundary_day")) for c in rs)})

    report = {
        "generated_at": CAPTURED, "status": "OK",
        "per_source_viewed": per_file, "foreign_sources": foreign_stats,
        "dedup": {"rows_before": len(allrows), "duplicate_platform_review_id_removed": dropped_dup, "unique": len(out),
                  "text_duplicate_groups": len(gid), "text_duplicate_extra_rows": sum(c["is_text_duplicate"] for c in out)},
        "unique_by_platform_country": dict(Counter(f"{c['platform']}|{c['country']}" for c in out)),
        "new_in_v2": {"total": len(additional),
                      "by_platform_country": dict(Counter(f"{c['platform']}|{c['country']}" for c in additional)),
                      "kr_by_group_first_seen": dict(Counter(c["collection_groups"].split(";")[0] for c in additional if c["country"] == "KR")),
                      "rating_dist": dist(additional, "rating"), "language_dist": dist(additional, "language")},
        "datasets": {
            "reviews_additional.csv": len(additional),
            "reviews_analytics.csv": {"rows": len(analytics), "rating_dist": dist(analytics, "rating"),
                                      "by_platform": dist(analytics, "platform"),
                                      "date_range": [min(c["published_date"] for c in analytics), max(c["published_date"] for c in analytics)]},
            "reviews_rating_supplement.csv": {"rows": len(supplement), "rating_dist": dist(supplement, "rating")},
            "reviews_foreign.csv": {"rows": len(foreign_rows), "by_country": dist(foreign_rows, "country"),
                                    "language_dist": dist(foreign_rows, "language"), "rating_dist": dist(foreign_rows, "rating")},
            "reviews_training.csv": {"rows": len(train), "proxy_sentiment": dist(train, "proxy_sentiment"), "split_rule": f"published_date < {VAL_FROM}"},
            "reviews_validation.csv": {"rows": len(val), "proxy_sentiment": dist(val, "proxy_sentiment"), "split_rule": f"published_date >= {VAL_FROM}"},
            "community_feedback.csv": 0,
            "updates_official.csv": {"rows": len(official), "by_platform": dict(Counter(u["platform"] for u in official))},
            "updates_observed.csv": 0,
        },
        "rating_dist_all_unique": dist(out, "rating"), "language_dist_all_unique": dist(out, "language"),
        "korean_flag_dist": dist(out, "is_korean"),
        "mapping": {"by_type": dist(out, "mapping_type"),
                    "by_type_platform_country": dict(Counter(f"{c['mapping_type']}|{c['platform']}|{c['country']}" for c in out)),
                    "unmatched_reasons": dict(Counter(c.get("unmatched_reason") for c in out if c["mapping_type"] == "unmatched")),
                    "update_relation": dict(Counter(c["update_relation"].split(":")[0] for c in out))},
        "per_update": per_update,
        "access_failures": [
            {"source": "appdashboard.app", "purpose": "제3자 버전 관측 47개", "result": "Cloudflare 봇 확인(HTTP 403)", "action": "우회하지 않음"},
            {"source": "appbrain.com", "purpose": "리뷰·버전", "result": "Cloudflare 봇 확인(HTTP 403)", "action": "우회하지 않음"},
            {"source": "apkpure.net", "purpose": "리뷰·버전", "result": "Cloudflare 봇 확인(HTTP 403)", "action": "우회하지 않음"},
            {"source": "taptap.io", "purpose": "리뷰", "result": "페이지 열림, 9 평점, 리뷰 본문 0건 표시", "action": "수집할 데이터 없음"},
            {"source": "game.naver.com/lounge", "purpose": "공식 패치노트", "result": "브라우저 안전 정책 차단, 웹 가져오기 도구 차단, 검색 색인 없음", "action": "우회하지 않음"},
            {"source": "apps.apple.com/us", "purpose": "US 리뷰 지문 재확인", "result": "HTTP 429 요청 제한", "action": "재시도하지 않음(US 10건 지문 미검증)"},
        ],
        "lounge_patchnotes": {"input_file": args.patchnotes if lounge_pending is not None else None,
                              "imported_rows": len(lounge_rows),
                              "imported_posts": len({u["source_url"] for u in lounge_rows})},
        "pending_official_patch_notes": lounge_pending if lounge_pending is not None else
        [f"https://game.naver.com/lounge/DalToKi/board/detail/{i}" for i in
         (442423, 509464, 517798, 689095, 1764765, 3338846, 3423833, 4834780, 5289552, 5441141, 5753796)],
    }
    write_json(os.path.join(OUT, "collection_report_v2.json"), report)
    print(json.dumps({k: report[k] for k in ("dedup", "unique_by_platform_country", "new_in_v2", "mapping")}, ensure_ascii=False, indent=1))
    print(json.dumps(report["datasets"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
