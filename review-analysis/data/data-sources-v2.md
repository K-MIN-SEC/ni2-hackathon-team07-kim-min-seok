# 달토끼 키우기 — 추가 데이터 확보 및 업데이트 이력 보완 (v2)

- 작성일: 2026-11-26
- 범위: 추가 리뷰 확보·검증, 업데이트 이력 보완, 매핑 방식 분리, 용도별 데이터셋 분리. **머신러닝 모델과 대시보드는 구현하지 않음.**
- 기존 데이터(`data/*.csv`, `data/web/*`, `data/data-sources.md`, `data/collection_report.json`)는 **수정·삭제하지 않았다.** v2 결과는 모두 `data/v2/`와 `data/sources/web_view_v2_20261126/`에 새로 만들었다.
- 재현 (`review-analysis/` 폴더에서):
  ```
  python scripts/check_web_keys.py data/sources/web_view_v2_20261126/*.keys.json   # 지문 대조 확인
  python scripts/build_v2_datasets.py                                              # data/v2/ 생성
  ```

> **추가 수집 (2026-11-26, 같은 날 후속 작업):** 한국 Google Play 최신순 목록을 **끝까지** 스크롤해 **5,718건 전체**를 확보했다(`gp_web_newest_full`). 5,718건 모두 지문이 팀 파일과 정확히 일치했다.
> - 이 목록에는 앞서 별점 필터·관련성순으로 본 리뷰가 **모두** 포함된다. 그래서 별점별 보충 데이터셋은 0건이 되었고, `reviews_analytics.csv`는 표본이 아니라 **한국 Google Play 본문 리뷰 전체**다.
> - 아래 3·4·7장의 수치는 이 결과를 반영했다. 이유와 대책은 10장에 있다.

## 1. 출처별 접근 정책 확인 결과 (2026-11-26)

| 출처 | robots.txt (직접 확인) | 실제 접근 결과 | 이번 작업 |
|---|---|---|---|
| Google Play 웹 | `/store/apps/details` 허용. `/_`(리뷰 API 경로)·`/store/getreviews` 금지 | 정상 | 1차와 같은 방식: 브라우저로 '리뷰 모두 보기' 창을 1.5초 간격으로 스크롤하며 화면 값을 읽음. 비공식 API·스크래퍼 미사용 |
| App Store 웹 (apps.apple.com) | `/kr/app/...`, `/us/app/...` 허용(`/api/*`, `/v1/*` 금지) | KR·GB·CA·AU·JP·TW 정상. **US 재방문 시 HTTP 429(요청 제한)** | 국가별 기본 노출 리뷰만 열람. 429 이후 재시도하지 않음 |
| appdashboard.app | `User-agent: *`는 `/app/` 허용, **`ClaudeBot` 전체 금지**, `Content-Signal: ai-train=no` | **Cloudflare 봇 확인(Turnstile) 화면, HTTP 403** | 우회하지 않음 → 47개 버전 이력 **미확보** |
| AppBrain | `/app/` 허용 | **Cloudflare 봇 확인, HTTP 403** | 우회하지 않음 → 미확보 |
| APKPure | `*`는 `/kr/...` 허용(`/kr/reviews/`는 Googlebot만 금지) | **Cloudflare 봇 확인, HTTP 403** | 우회하지 않음 → 미확보 |
| TapTap | `*`는 `/app/` 허용, **`ClaudeBot` 전체 금지**, `/webapi/` 금지 | 페이지 열림. "9 평점", **리뷰 본문 0건 표시** | 화면 확인만. 수집할 리뷰 없음 |
| 네이버 게임 라운지 | `*` 허용 (`Yeti`만 `/lounge/` 금지) | **브라우저 안전 정책으로 차단**, 웹 가져오기 도구도 "unable to fetch from game.naver.com" | 우회하지 않음 → 패치노트 본문 **미확보** |
| 검색엔진 (라운지 게시글 색인) | — | `site:game.naver.com/lounge/DalToKi ...` 검색 결과에 라운지 게시글 없음 | 미확보 |

- 데이터 재사용 범위:
  - 스토어 리뷰는 공개 화면 값만 내부 분석에 쓴다. 작성자명은 저장하지 않았다. 개발자 답변은 본문 없이 유무·날짜만 저장했다.
  - appdashboard는 `ai-train=no`를 선언한다. 나중에 사람이 직접 확보하더라도 **모델 학습 데이터로 쓰지 말고** 버전·날짜 메타데이터로만 써야 한다.

## 2. 수집 방법과 검증

- **한국 Google Play:** 화면에 보인 리뷰마다 지문을 만들었다.
  - 지문 = `sha1(review_id|별점|화면 날짜|공백 제거 본문)`의 앞 12자. 브라우저에서 화면 값으로 계산했다.
  - 팀 파일(`data/reviews.csv`)에서 지문이 **정확히 같은 행**의 본문만 가져왔다(1차와 같은 방식).
  - 결과: 상한 묶음 **1,250/1,250건**, 전체 목록 **5,718/5,718건** 일치, 불일치 0건(`check_web_keys.py`).
- **해외 리뷰:** 팀 파일에 없으므로 화면 값을 직접 옮겼다.
  - 옮긴 값으로 지문을 다시 계산해 브라우저 지문과 비교했다.
  - Google Play US 100/100, App Store GB·CA·AU·JP·TW 31/31 일치.
  - App Store US 10건은 DOM 추출값을 그대로 저장했지만, 지문 재확인 요청이 429로 거부되어 **지문 검증 없음**(`verification` 열에 표시).
- 날짜 기준:
  - Google Play KR: 화면 날짜(UTC 날짜, 1차 결과와 같음)
  - Google Play US: 화면 날짜(en-US 표기)
  - App Store: time 요소의 UTC 날짜

## 3. 출처별 실제 추가 수집량

| 열람 묶음 | 조건 | 화면 열람 | 검증 일치 | v2 신규 고유 리뷰 |
|---|---|---:|---:|---:|
| `gp_web_newest_full` | KR, 최신순, **목록 끝까지(전체)** | 5,718 | 5,718 | 4,603 |
| `gp_web_newest_ext` | KR, 최신순, 1,000건 상한(1차 200건 포함) | 1,000 | 1,000 | 689 |
| `gp_web_relevance` | KR, 관련성순(= '유용한 순'), 300건 상한 | 300 | 300 | 156 |
| `gp_web_rating3_supplement` | KR, 최신순, 별 3개, **끝까지(전체)** | 250 | 250 | 197 |
| `gp_web_rating4_supplement` | KR, 최신순, 별 4개, 400건 상한 | 400 | 400 | 321 |
| `gp_web_rating5_supplement` | KR, 최신순, 별 5개, 300건 상한 | 300 | 300 | 0 (전부 최신순 묶음과 겹침) |
| `gp_web_foreign_en_us_newest` | US/en, 최신순(200건 로드, 상위 100건 저장) | 100 | 100 | 100 |
| `ios_web_foreign_default` | US 10, GB 3, CA 6, AU 2, JP 10, TW 10 (국가별 기본 노출 전체) | 41 | 31 (+US 10 미검증) | 41 |
| TapTap / AppBrain / APKPure | — | 0 | — | 0 |
| **합계** | | | | **5,433** |

- 묶음끼리 겹치는 리뷰는 1건으로 합쳤다(`collection_groups`에 함께 기록). 신규 수는 처음 나온 묶음 기준이다(최신순 1,000 → 전체 → 별점 필터 → 관련성 순으로 읽음).
  - 별점 필터·관련성 묶음의 신규 수(197·321·156)는 전체 목록을 받기 전 기준이다. 지금은 모두 전체 목록에 포함된다.
- 전체 목록 5,718건은 브라우저에서 지문을 5개 조각(1,100~1,500건)으로 옮겼다. 조각별 digest와 전체 digest(`ed63f53482a1`)로 누락·순서 오류가 없음을 확인했다(`scripts/merge_key_parts.py`).
- 영어 Google Play(100)는 **표시 가능한 전체가 아니다.**

## 4. 중복 제거 후 유효 데이터 (1차 436 + 2차 5,433)

| 플랫폼·국가 | 고유 리뷰 |
|---|---:|
| Google Play KR | **5,718 (전체)** |
| App Store KR | 10 |
| Google Play US | 100 |
| App Store US / TW / JP / CA / GB / AU | 10 / 10 / 10 / 6 / 3 / 2 |
| **합계** | **5,869** |

- (플랫폼, review_id) 중복 제거: 0건
- 정규화 후 같은 텍스트: 200개 그룹, 중복 행 1,659건. 대부분 "굿" 같은 짧은 리뷰다. 삭제하지 않고 `is_text_duplicate`로 표시했다.
- 별점(전체 5,869): 1점 540 / 2점 127 / 3점 257 / 4점 580 / 5점 4,365
- 언어(문자 체계 기반 추정, `language_basis=script_heuristic`): ko 5,585 / latin 219 / und 41 / zh 11 / ja 10 / ar 2 / bn 1
  - `latin`에는 영어 외에 인도네시아어 등이 섞여 있다. 정확한 언어 판별이 아니다.

## 5. 업데이트 이력

### 5.1 공식 이력 (`updates_official.csv`, 26건)

| 플랫폼 | 건수 | 기간 | 출처 | 비고 |
|---|---:|---|---|---|
| App Store | 25 | 2026-03-12 ~ 2026-10-29 | App Store 버전 기록(1차 스냅샷) | 적용일·변경 사항 공식 |
| Google Play | 1 | 1.154.3, 2026-10-29 | Play 앱 정보 '버전'·'업데이트 날짜' | 스토어 등록정보 갱신일이므로 배포 시작일과 다를 수 있음(`applied_date_basis`에 명시). 출시일 2021-06-22도 화면에서 확인 |

- **네이버 라운지 패치노트: 0건.** 사용자가 제공한 URL 11개는 `collection_report_v2.json`의 `pending_official_patch_notes`에 "미확인" 상태로만 남겼다. 본문·날짜·버전을 추정해 채우지 않았다.
- 공지 작성일(`notice_posted_at`)과 공지 제목 열은 만들어 두었지만 모두 비어 있다(출처를 열람하지 못함).

### 5.2 제3자 버전 관측 이력 (`updates_observed.csv`, 0건)

- appdashboard의 47개 버전 이력은 봇 확인 화면 때문에 **확보하지 못했다.** 파일은 열 구조만 있다.
- 참고: 1차 `data/updates.csv`에 '팀 리뷰 메타데이터에서 관측된 버전' 324개가 있다. 하지만 이것은 웹 화면에 없는 값이라 1차 결정(9장)에 따라 v2 매핑에 쓰지 않았고, 제3자 관측 이력에도 섞지 않았다.

## 6. 매핑 (리뷰 ↔ 업데이트)

| 매핑 유형 | 정의 | 건수 |
|---|---|---:|
| `exact_version` | 리뷰에 실제 앱 버전이 있고 일치 | **0** (웹 화면에 앱 버전이 표시되지 않음) |
| `official_date_estimated` | 같은 플랫폼의 공식 적용일 기준 기간에 작성 | **21** (GP US 16, GP KR 3, App Store JP 2) |
| `observed_date_estimated` | 제3자 관측 날짜 기준 기간 | **0** (관측 이력 미확보) |
| `unmatched` | 매핑 불가 | **5,848** |

- 미분류 사유는 모두 `no_official_release_dates_before_review_date;no_third_party_observations_available`이다.
  - Google Play 공식 날짜가 2026-10-29 하나뿐이다. 그래서 그 이전 Google Play 리뷰는 기간을 정할 수 없다.
  - App Store 한국 웹 리뷰 10건은 모두 공식 기록 시작(2026-03-12) 이전에 작성되었다.
- 추정 결과는 `mapped_version_estimated`에 넣었다. **실제 앱 버전으로 간주하지 않는다.**
  - 적용일 당일 작성은 `boundary_day=True`로 표시했다(3건). 리뷰 날짜는 UTC, 적용일은 스토어 표시 날짜라서 ±1일 오차가 있을 수 있다.
- **직접 평가 여부(`update_relation`)**는 키워드 규칙으로 정했다. 검수하지 않은 값이다.
  - `mentions_patch_content:<단어>`: 해당 업데이트 변경 사항의 단어가 리뷰에 나온다. 0건
  - `mentions_update_generic`: 업데이트·패치·アプデ 같은 일반 표현이 나온다. 1건
  - `period_only`: 기간에만 해당한다. **직접 평가로 보지 않는다.** 20건

### 업데이트별 리뷰 수 (리뷰가 1건 이상인 업데이트만)

| 업데이트 | 적용일 | 리뷰 | 국가 | 별점 | 관계 |
|---|---|---:|---|---|---|
| gp-1.154.3 | 2026-10-29 | 19 | KR 3, US 16 | 1:4, 2:1, 3:1, 4:1, 5:12 | period_only 19 |
| ios-1.148.2 | 2026-08-01 | 1 | JP 1 | 2:1 | period_only (경계일) |
| ios-1.146.1 | 2026-06-27 | 1 | JP 1 | 1:1 | mentions_update_generic |

- 나머지 23개 공식 업데이트는 리뷰 0건이다. 전체 목록은 `collection_report_v2.json`의 `per_update`에 있다.

## 7. 데이터셋 분리 (`data/v2/`)

| 파일 | 내용 | 행 |
|---|---|---:|
| `reviews_additional.csv` | v2에서 새로 확보한 고유 리뷰(국내·해외 모두) | 5,433 |
| `reviews_analytics.csv` | **일반 리뷰 통계용.** 한국 Google Play 최신순 **전체** 5,718 + App Store KR 기본 노출 10. 해외 리뷰 제외 | 5,728 |
| `reviews_rating_supplement.csv` | 별점별 추가 확보(최신순 목록에 없는 한국 리뷰). 전체 목록을 받은 뒤로는 해당 없음 | 0 |
| `reviews_foreign.csv` | 해외 리뷰. `country`와 `language` 기록 | 141 |
| `reviews_training.csv` | 머신러닝 학습용: 한국 스토어 + 한국어 + 텍스트 중복 아님 + 작성일 < 2026-03-12 | 3,970 |
| `reviews_validation.csv` | 머신러닝 검증용: 위와 같은 조건 + 작성일 ≥ 2026-03-12 (시간순 분할) | 50 |
| `community_feedback.csv` | 커뮤니티 피드백(라운지·카페 접근 불가) | 0 |
| `updates_official.csv` | 공식 업데이트 이력 | 26 |
| `updates_observed.csv` | 제3자 버전 관측 이력 | 0 |
| `collection_report_v2.json` | 모든 집계와 실패 사유 | — |

- 분리 규칙:
  - 별점별 추가 확보와 커뮤니티 피드백은 `reviews_analytics.csv`에 섞지 않는다.
  - 해외 리뷰는 학습·검증용에 넣지 않는다(한국어 전용 모델 기준).
  - 학습·검증 사이에 같은 텍스트 그룹이 겹치지 않음을 확인했다(0건).
- 실제 분포(`reviews_analytics.csv`, 별점 1~5): 515 / 118 / 251 / 567 / 4,277 (5점 74.7%)
  - Google Play만: 515 / 118 / 250 / 565 / 4,270 — 별 2개(118)·3개(250)는 앞서 끝까지 받은 별점 필터 목록 건수와 정확히 같다.
  - Google Play 작성일 범위: 2021-06-26 ~ 2026-11-17 (출시 2021-06-22 직후부터 전체)
- 학습용 임시 라벨(별점 기반, 정답 아님):
  - 학습: positive 3,166 / negative 598 / unlabeled(3점) 206
  - 검증: positive 28 / negative 16 / unlabeled 6
  - 별점 1·2점 비율이 약 15%로 낮아, 학습 시 가중치나 샘플링으로 보정해야 한다.

## 8. 라운지 패치노트 수동 입력 절차

작업 환경에서는 네이버 라운지를 열 수 없다. 그래서 팀원이 직접 열람해 옮기면 같은 빌드에 반영되도록 했다.

1. 양식을 복사한다. 양식 파일에는 11개 URL이 미리 들어 있다.
   ```powershell
   Copy-Item data/sources/naver_lounge_patchnotes_TEMPLATE.csv data/sources/naver_lounge_patchnotes.csv
   ```
2. 글을 하나씩 열어 **화면에 적힌 값만** 채운다. 모르는 칸은 비워 둔다.

   | 열 | 형식 | 설명 |
   |---|---|---|
   | `notice_title` | 텍스트 | 공지 제목 |
   | `notice_posted_at` | YYYY-MM-DD (KST) | 공지 작성일 |
   | `applied_date` | YYYY-MM-DD (KST) | **실제 업데이트 적용일**(점검일). 비우면 그 글은 '미입력'으로 남고 반영되지 않는다 |
   | `applied_time` | HH:MM (KST) | 선택 |
   | `platform` | `Google Play` / `App Store` / `both` | `both`면 플랫폼별 2행으로 나뉜다 |
   | `version` | 예: 1.154.3 | 공지에 적힌 경우만 |
   | `update_type` | major / hotfix / maintenance 등 | |
   | `change_summary` | 텍스트 | 주요 변경 사항 요약 |
   | `transcribed_by`, `transcribed_at` | 이름, YYYY-MM-DD | **필수**(옮긴 사람·날짜) |

   추가로 찾은 패치노트 글은 행을 더하면 된다. URL 형식은 `https://game.naver.com/lounge/DalToKi/board/detail/<번호>`이다.
3. 다시 빌드한다.
   ```powershell
   python scripts/build_v2_datasets.py
   ```
4. 반영 규칙:
   - 형식 오류가 하나라도 있으면 **아무 파일도 쓰지 않고 중단**한다. 오류 위치는 행 번호로 표시된다.
   - 같은 플랫폼·버전의 적용일이 App Store 버전 기록과 다르면 **충돌 오류**로 중단한다. 임의로 고르지 않는다.
   - Google Play 등록정보 날짜(gp-1.154.3)와 다르면 라운지 적용일로 매핑하고, 등록정보 행은 `superseded_for_mapping`으로 표시한다.
   - App Store 기록과 날짜가 같은 행은 매핑에 한 번만 쓴다(`same_date_as`).
   - 매핑은 `official_date_estimated`로 들어간다. 실제 앱 버전으로 보지 않는다.
   - 추정 기간은 적용일로부터 **최대 45일**이다. 그 이후 리뷰는 `unmatched`(`beyond_45d_after_last_known_official_update`)로 남는다. 공식 날짜가 드문 구간에서 기간이 수년으로 늘어나는 것을 막기 위해서다.
   - 반영 건수와 남은 미입력 URL은 `collection_report_v2.json`의 `lounge_patchnotes`, `pending_official_patch_notes`에 기록된다.
- 시험 결과(2026-11-26): 작업용 임시 폴더에서 **가짜 시험 값**으로 확인했다. 저장소 데이터에는 섞지 않았다. 다음 동작을 모두 확인했다.
  - 정상 반영, `both` 분할, 등록정보 날짜 대체, 같은 날짜 중복 처리
  - 미입력 행 유지
  - 형식 오류 4종과 충돌 1건에서 중단
  - 45일 상한 적용
  - 패치노트 파일이 없을 때 기존 v2 결과와 동일

## 9. 남은 한계와 팀 확인 필요 사항

1. **검증 세트가 50건으로 작다.** 2026-03-12 이후 리뷰가 적기 때문이다. 기준일 조정 또는 무작위 분할 병행을 정해야 한다.
2. **업데이트별 분석은 여전히 어렵다.**
   - Google Play 과거 적용일과 라운지 패치노트를 확보하지 못했다.
   - 팀원이 라운지 글을 직접 열람해 옮기는 것이 현재 유일한 경로다. 절차는 8장에 있다.
3. appdashboard·AppBrain·APKPure는 사람이 봇 확인을 직접 통과해야 열린다. appdashboard의 `ai-train=no` 선언도 고려해야 한다.
4. App Store US 10건은 지문 검증이 없다. 다음에 요청 제한이 풀린 뒤 재확인해야 한다.
5. 1차 문서 7장의 공개 저장소 원문 문제는 v2 파일에도 똑같이 적용된다. **아직 커밋하지 않았다.**

## 10. 6만 건 대비 수집량이 적은 이유와 대책 (2026-11-26 추가)

### 이유
1. **6.8만 건의 대부분은 본문 없는 별점이다.**
   - Google Play 화면의 별점 수: 5점 57,665 / 4점 4,575 / 3점 2,313 / 2점 508 / 1점 2,872
   - 이것은 별점을 누른 사람 수다. 웹·API 어디에도 개별 항목으로 나오지 않아 누구도 수집할 수 없다.
   - 한국 Google Play에서 **본문이 있는 리뷰는 현재 5,718건이 전부**다(목록 끝 = 2021-06-26, 출시 2021-06-22).
2. 처음에 상한(최신순 1,000건 등)을 두었다. → 이번에 목록 끝까지 받아 해소했다.
3. 팀 파일(google-play-scraper, 6,199건)보다 **481건 적다.**
   - 이 481건은 현재 스토어 웹 목록에 나오지 않는다. 작성자가 삭제했거나 숨김·수정된 리뷰로 보인다(추정).
   - 분포: 2021년 115 / 2022년 250 / 2023년 70 / 2024년 28 / 2025년 13 / 2026년 5. 별점은 5점이 363건으로 대부분이다.
   - 공개 웹 화면만 쓰기로 한 방침(9장)에 따라 포함하지 않았다.
4. App Store는 웹에 국가별 약 10건만 표시된다. RSS는 robots.txt 금지라서 쓰지 않는다.

### 대책
- **한국 Google Play:** 완료(5,718 = 웹 공개 전체). 추가 확보할 것이 없다.
- **해외 Google Play:** 언어별(en·ja·zh-TW·id·th 등) 목록을 끝까지 받을 수 있다.
  - 단, 팀 파일에 없어 본문을 직접 옮겨야 하므로 건수가 많으면 시간이 크게 든다.
  - 한국어 모델에는 쓰지 않으므로 우선순위가 낮다.
- **App Store 한국 리뷰·앱 버전·정확한 배포일:** 개발사 공식 데이터(App Store Connect·Play Console 내보내기)만이 경로다. 요청서 초안은 `docs/official-data-request.md`에 있다(미발송, 팀 결정 필요).
- **별점만 있는 평가:** 개별 수집은 불가능하다. 위 별점 분포표를 '전체 평점 분포'로 함께 보고한다.
