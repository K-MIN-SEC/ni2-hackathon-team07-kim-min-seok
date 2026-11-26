# 달토끼 키우기 스토어 리뷰 분석

모바일 방치형 RPG **"달토끼 키우기"**의 Google Play·App Store 한국어 리뷰 6,349건을 모아서 다음을 했습니다.

1. 리뷰마다 **감성**(긍정/부정/중립/혼합), **주제**(복수 선택), **주제별 감성**, **키워드**를 판정했습니다.
2. **"무엇을 먼저 고쳐야 하는가"** 우선순위 점수를 계산했습니다.
3. 결과를 오프라인 단일 파일 **대시보드**로 만들었습니다.
4. AI(LLM) 없이 새 리뷰를 분류할 수 있도록 **규칙 + 머신러닝 분류기**를 학습했습니다.

> 👉 결과 대시보드는 [`dashboard/dashboard.html`](dashboard/dashboard.html)을 내려받아 브라우저로 열면 됩니다. 인터넷 연결 없이 열립니다.
> 👉 진행 과정과 판단 근거, 수치는 [`docs/WORK_SUMMARY.md`](docs/WORK_SUMMARY.md)에 자세히 정리했습니다.
>
> 2026 NI2.0 AID 해커톤 7팀 저장소 안의 `review-analysis/` 폴더입니다. 저장소 루트에 있는 오토 밸런싱 도구와는 별개의 작업입니다.

---

## 핵심 결과 한눈에

| 항목 | 값 |
|---|---|
| 리뷰 수 | 6,349건 (Google Play 6,199 + App Store 150) |
| 기간 | 2021-06-26 ~ 2026-11-17 |
| 평균 별점 | 4.39 |
| 감성 | 긍정 4,314 (67.9%) · 부정 920 (14.5%) · 중립 693 (10.9%) · 혼합 422 (6.6%) |
| 라벨 출처 | 규칙 판정 4,319건 + AI 수동 판정 2,030건 |
| 검수 (무작위 50건) | 전체 감성 48/50 · 주제 49/50 · 주제별 감성 47/50 |

**고쳐야 할 것 (우선순위 점수 상위)**

| 순위 | 주제 / 키워드 | 부정·혼합 언급 | 점수 |
|---|---|---|---|
| 1 | 버그 / 업데이트 불가 | 148 | 88.0 |
| 2 | 밸런스·성장 / 난이도 | 86 | 74.5 |
| 3 | 버그 / 접속 불가 | 105 | 73.0 |
| 4 | 버그 / 발열 | 117 | 71.3 |
| 5 | 밸런스·성장 / 보상·재화 | 69 | 69.7 |
| 6 | 운영 / 계정 | 95 | 63.0 |
| 7 | 버그 / 튕김 | 98 | 62.6 |

주제 단위로 보면 **버그(부정 640건, 점수 90.4)**가 압도적인 1순위이고, 그다음은 운영(42.2), 밸런스/성장(41.1), 과금(36.6) 순입니다.

**지켜야 할 장점**: 캐릭터/아트 쪽 언급 618건 가운데 567건(긍정 비율 96%)이 긍정입니다. 대표 키워드는 "귀여움"(383건)이었습니다.

**ML 분류기 (AI 없이 분류)**: 규칙만으로 판정하기 어려운 리뷰 2,030건에서 감성 정확도가 **62.2% → 81.9%**로 올랐습니다. 전체 6,349건 기준으로는 **87.9% → 94.2%**입니다(5-겹 교차검증).

---

## 폴더 구조

```
.
├── README.md                  ← 이 문서 (요약 + 실행 방법)
├── requirements.txt
├── docs/
│   └── WORK_SUMMARY.md        ← 작업 내용 상세 정리 (단계별 과정, 판단 근거, 수치)
├── scripts/                   ← 파이프라인 코드 (모두 이 폴더에서 실행)
│   ├── collect_reviews.py     1) 스토어 리뷰 수집
│   ├── classify.py            2) 규칙 기반 1차 분류 + 애매 플래그
│   ├── merge_labels.py        3) 규칙 판정 + AI 수동 판정 병합 → 최종 라벨
│   ├── analyze.py             4) 대시보드용 수치 계산 (우선순위 점수 등)
│   ├── build_dashboard.py     5) 대시보드 HTML 생성
│   └── ml_classify.py         6) 규칙 + ML 분류기 (평가/학습/예측)
├── data/
│   ├── reviews.csv            원본 리뷰 (수집 결과, 읽기 전용)
│   ├── reviews_labeled.csv    최종 라벨 (규칙 + AI 수동 판정) ← 정답 데이터
│   └── reviews_labeled_ml.csv 규칙 + ML로 다시 분류한 결과 (AI 미사용)
├── dashboard/
│   ├── dashboard_template.html 대시보드 템플릿
│   └── dashboard.html         완성된 대시보드 (데이터 내장, 오프라인)
└── work/                      ← 중간 산출물
    ├── rule_labels.csv        규칙 판정 결과 + 애매 여부
    ├── manual/                AI 수동 판정 입력(batch_*)·출력(out_*)과 판정 기준(RUBRIC.md)
    ├── grouping.json          주제 묶기 결과 (비중 3% 미만 주제 → '기타')
    ├── audit_sample.csv / audit.json  무작위 50건 검수
    ├── analysis.json          대시보드에 들어가는 전체 수치
    ├── ml_eval.json / ml_oof.csv      ML 교차검증 결과
    ├── ml_model.joblib        학습된 ML 모델
    └── logs/collect.log       수집 로그
```

---

## 실행 방법

### 환경 준비 (Python 3.12)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 파이프라인

**모든 스크립트는 이 폴더(팀 저장소에서는 `review-analysis/`)에서 실행합니다.** 경로가 이 폴더 기준으로 되어 있습니다.

```powershell
# 1) 리뷰 수집 (이미 data/reviews.csv가 있으면 덮어쓰지 않고 멈춤. 덮어쓰려면 --force)
python scripts/collect_reviews.py --gp <구글플레이_패키지ID> --ios <앱스토어_숫자ID> --max 10000

# 2) 규칙 분류 → work/rule_labels.csv
python scripts/classify.py

# 3) (AI 수동 판정 결과 work/manual/out_*.jsonl과) 병합 → data/reviews_labeled.csv
python scripts/merge_labels.py

# 4) 수치 계산 → work/analysis.json
python scripts/analyze.py

# 5) 대시보드 생성 → dashboard/dashboard.html
python scripts/build_dashboard.py
```

### AI 없이 새 리뷰 분류하기 (ML)

```powershell
python scripts/ml_classify.py eval                       # 5-겹 교차검증 → work/ml_eval.json
python scripts/ml_classify.py train                      # 전체 라벨로 학습 → work/ml_model.joblib
python scripts/ml_classify.py predict 새리뷰.csv 결과.csv  # 입력은 data/reviews.csv와 같은 컬럼 형식
```

`결과.csv`는 `data/reviews_labeled.csv`와 같은 형식이라서, 이 파일을 `analyze.py`의 입력으로 바꿔 넣으면 같은 대시보드를 만들 수 있습니다.

> 현재 커밋된 데이터로 2) → 5)와 ML `predict`를 다시 돌려 보면 결과 파일이 기존과 동일하게 재현됩니다. `analysis.json`만 예외인데, 건수가 같은 키워드끼리 나열 순서가 바뀔 수 있습니다.
