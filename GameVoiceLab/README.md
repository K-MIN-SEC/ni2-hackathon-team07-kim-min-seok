# Game Voice Lab

2026 NI2.0 AID 해커톤 · 7팀 카페인 중독 · ㈜에이블게임즈 연계 과제

에이블게임즈의 「달토끼 키우기」와 「메이플 키우기」 공개 스토어 리뷰를 **의견 단위**로 나누고, 감성(긍정·부정·기타)과 주제(카테고리 13종)로 분류해 보여주는 정적 웹 대시보드입니다. 서버, DB, 유료 AI API는 쓰지 않습니다.

## 실행

```powershell
node tools/serve.js
```

브라우저에서 http://localhost:8080 을 엽니다. `index.html`을 더블클릭해 `file://`로 열면 브라우저 보안 정책 때문에 데이터를 불러올 수 없습니다.

## 테스트

```powershell
node tests/run-tests.js
```

집계, 필터, 데이터 검증을 QA ID별로 검사합니다. 결과는 [docs/qa-report.md](docs/qa-report.md)에 있습니다.

## 데이터 수정 및 재생성

분류 원장은 `tools/build-data.js`에 있습니다. 분류나 검수 상태를 고친 뒤 아래 명령으로 `data/*.json`을 다시 생성합니다. 생성할 때 참조 관계, 키워드 사전, 발췌 길이(40자), 판단 보류 사유 등을 검사합니다.

```powershell
node tools/build-data.js data
```

웹앱은 새로고침하면 바뀐 데이터로 다시 집계합니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html`, `css/style.css` | 화면 |
| `js/analytics.js` | 필터·집계 순수 함수(브라우저와 Node 공용) |
| `js/data-loader.js` | JSON 로드 및 형식·참조 검증 |
| `js/charts.js`, `js/filters.js`, `js/app.js` | 차트, 공통 필터, 화면 구성 |
| `data/` | reviews, opinions, categories, keywords, games, collections |
| `tools/` | 데이터 생성 스크립트, 로컬 서버 |
| `tests/` | 자동 테스트 |
| `docs/` | 기획서(project-plan.md), QA 보고서 |

## 데이터 유의 사항

- 실제 공개 리뷰 60건(Google Play 40건, App Store 20건, 수집일 2026-11-26)의 표본이며, 전체 이용자의 의견으로 일반화하지 않습니다.
- 리뷰 원문 전문은 저장하지 않습니다. 의견별로 40자 이하의 짧은 발췌와 출처 링크만 저장합니다.
- 분류는 사전에 수행한 1차 결과이며, 팀의 원문 대조 검수가 끝나지 않았습니다(미검수 108건, 판단 보류 3건).
