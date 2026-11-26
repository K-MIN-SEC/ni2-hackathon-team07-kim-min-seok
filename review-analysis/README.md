# 달토끼 키우기 스토어 리뷰 분석

모바일 방치형 RPG **"달토끼 키우기"**의 Google Play·App Store 한국어 리뷰 6,349건을 모아서 다음을 했습니다.

1. 리뷰마다 **감성**(긍정/부정/중립/혼합), **주제**(복수 선택), **주제별 감성**, **키워드**를 판정했습니다.
2. **"무엇을 먼저 고쳐야 하는가"** 우선순위 점수를 계산했습니다.
3. 결과를 오프라인 단일 파일 **대시보드**로 만들었습니다.
4. AI(LLM) 없이 새 리뷰를 분류할 수 있도록 **규칙 + 머신러닝 분류기**를 학습했습니다.

> 👉 결과 대시보드는 [`dashboard/dashboard.html`](dashboard/dashboard.html)을 내려받아 브라우저로 열면 됩니다. 인터넷 연결 없이 열립니다. 키보드만으로 쓸 수 있고, 모든 차트는 '표로 보기'로 수치를 표로 볼 수 있습니다(스크린리더·터치 지원, 색 대비 WCAG AA 기준).
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
| 감성 | 긍정 4,384 (69.1%) · 부정 943 (14.9%) · 중립 599 (9.4%) · 혼합 423 (6.7%) |
| 라벨 출처 | 규칙 판정 4,319건 + AI 수동 판정 2,030건 |
| 검수 (무작위 50건) | 전체 감성 50/50 · 주제 49/50 · 주제별 감성 49/50 (오타·은어 사전 보강 후. 처음엔 48 · 49 · 47) |

**고쳐야 할 것 (우선순위 점수 상위)**

| 순위 | 주제 / 키워드 | 부정·혼합 언급 | 점수 |
|---|---|---|---|
| 1 | 버그 / 업데이트 불가 | 148 | 88.0 |
| 2 | 밸런스·성장 / 난이도 | 85 | 74.2 |
| 3 | 버그 / 접속 불가 | 105 | 73.0 |
| 4 | 버그 / 발열 | 117 | 71.3 |
| 5 | 밸런스·성장 / 보상·재화 | 69 | 69.7 |
| 6 | 운영 / 계정 | 95 | 63.0 |
| 7 | 버그 / 튕김 | 98 | 62.6 |

주제 단위로 보면 **버그(부정 640건, 점수 90.4)**가 압도적인 1순위이고, 그다음은 운영(42.2), 밸런스/성장(41.0), 과금(36.6) 순입니다.

**지켜야 할 장점**: 캐릭터/아트 쪽 언급 618건 가운데 569건(긍정 비율 96%)이 긍정입니다. 대표 키워드는 "귀여움"(383건)이었습니다.

**ML 분류기 (AI 없이 분류)**: 규칙만으로 판정하기 어려운 리뷰 2,030건에서 감성 정확도가 **64.3%(규칙 단독) → 89.7%**입니다. 전체 6,349건 기준으로는 **88.6% → 96.7%**입니다(5-겹 교차검증). 두 모델의 확률을 평균합니다.
- 로지스틱 회귀: 글자·단어 n-gram, Kiwi 형태소, 로컬 한국어 문장 임베딩(`jhgan/ko-sroberta-multitask`)을 특징으로 씁니다.
- **미세조정 모델**: 같은 임베딩 모델을 우리 라벨로 직접 학습시킨 모델입니다.

이전 버전(임베딩 고정)은 84.0%였습니다. 개선 과정은 [`docs/MODEL_TUNING.md`](docs/MODEL_TUNING.md)에 정리했습니다.

---

## 시연: CSV를 넣으며 결과가 쌓이는 장면

대시보드(`dashboard/dashboard.html`)는 처음 열면 **파일 첨부 화면**만 보입니다. 라벨이 붙은 리뷰 CSV를 넣으면 그때 차트가 나타납니다.

1. `python scripts/make_demo_splits.py` → `data/demo/`에 작성 연도별 파일 4개 (저장소에 포함됨)
   - `1_2021.csv` 1,516건 · `2_2022.csv` 3,094건 · `3_2023.csv` 851건 · `4_2024-2026.csv` 888건
2. 대시보드에서 `1_2021.csv`를 넣습니다.
3. 다음 파일부터는 **누적 / 교체 / 취소**를 묻는 창이 뜹니다. **누적**을 고르면 요약 칸에 늘어난 건수와 비율 변화(%p)가 파란 글씨로 표시되고, 모든 차트가 다시 그려집니다.
4. 4개를 모두 누적하면 전체 자료(예시 자료, 6,349건)와 같은 수치가 됩니다.

- 같은 리뷰(`store` + `review_id`)는 한 번만 셉니다.
- "처음부터 다시"로 첫 화면으로 돌아갑니다. 주소 끝에 `?data=example`을 붙이면 예시 자료로 바로 시작합니다.
- 파일은 브라우저 안에서만 읽고, 새로고침하면 사라집니다(저장·전송하지 않음).

## 폴더 구조

```
.
├── README.md                  ← 이 문서 (요약 + 실행 방법)
├── requirements.txt
├── docs/
│   ├── WORK_SUMMARY.md        ← 작업 내용 상세 정리 (단계별 과정, 판단 근거, 수치)
│   ├── IMPROVEMENT_REPORT.md  ← 테스트·개선 보고 (오류 분석, 수정 전후)
│   └── MODEL_TUNING.md        ← 2차 개선: 임베딩 모델 미세조정 + 오타·은어 사전 등 실험 결과
├── scripts/                   ← 파이프라인 코드 (모두 이 폴더에서 실행)
│   ├── collect_reviews.py     1) 스토어 리뷰 수집
│   ├── classify.py            2) 규칙 기반 1차 분류 + 애매 플래그
│   ├── merge_labels.py        3) 규칙 판정 + AI 수동 판정 병합 → 최종 라벨
│   ├── analyze.py             4) 대시보드용 수치 계산 (우선순위 점수 등)
│   ├── build_dashboard.py     5) 대시보드 HTML 생성
│   ├── ml_classify.py         6) 규칙 + ML 분류기 (평가/학습/예측)
│   ├── embeddings.py          로컬 문장 임베딩 계산·캐시 (ml_classify.py가 사용)
│   ├── finetune.py            임베딩 모델 미세조정 (교차검증 / 최종 학습, CPU)
│   ├── experiments.py         가벼운 개선 비교 실험 (확률 평균·판정 기준·잡음 라벨)
│   └── ablation_game_terms.py 게임 고유 단어(달토끼·캐릭터명 등)를 지우고 다시 교차검증해 비교
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
    ├── ml_model.joblib        학습된 ML 모델 (로지스틱 회귀)
    ├── ft/                    미세조정 교차검증 결과(oof_*.npy). model/은 최종 모델(약 440MB, 저장소 제외)
    ├── cv_folds.csv           교차검증 분할 고정 (모든 실험이 같은 분할을 씀)
    ├── ablation_game_terms/   게임 고유 단어 제거 점검 결과 (원본/제거 교차검증, report.json)
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

스크립트는 실행 위치와 상관없이 이 폴더(팀 저장소에서는 `review-analysis/`)의 `data/`, `work/`, `dashboard/`를 읽고 씁니다. 아래 예시는 이 폴더에서 실행하는 기준입니다.

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
python scripts/embeddings.py                             # (선택) 임베딩 미리 계산 → work/emb_*.npz. 처음 한 번 모델(약 440MB)을 내려받음
python scripts/finetune.py cv                            # 미세조정 5-겹 교차검증 → work/ft/oof_*.npy (CPU 약 70분)
python scripts/ml_classify.py eval                       # 5-겹 교차검증 → work/ml_eval.json (위 결과 사용)
python scripts/finetune.py train                         # 미세조정 최종 모델 → work/ft/model/ (CPU 약 20분)
python scripts/ml_classify.py train                      # 전체 라벨로 학습 → work/ml_model.joblib
python scripts/ablation_game_terms.py run                # (선택) 게임 고유 단어 제거 점검 → work/ablation_game_terms/report.json
python scripts/ml_classify.py predict 새리뷰.csv 결과.csv  # 입력은 data/reviews.csv와 같은 컬럼 형식
```

`결과.csv`는 `data/reviews_labeled.csv`와 같은 형식이라서, 이 파일을 `analyze.py`의 입력으로 바꿔 넣으면 같은 대시보드를 만들 수 있습니다.

> **미세조정 모델 폴더가 없을 때**: `work/ft/model/`(약 420MB)은 용량 때문에 git에 들어 있지 않습니다. 저장소를 새로 받은 컴퓨터처럼 이 폴더가 없으면 `[경고]`를 한 번 출력하고 **기존 모델(로지스틱 회귀)로만 판정**합니다. 오류로 멈추지 않습니다.
> - 정확도: 어려운 리뷰 감성 정확도가 약 89.7%에서 약 85%로 내려갑니다. 이 리뷰 6,349건에서는 ML이 판정하는 1,998건 중 29건의 감성이 달라졌습니다.
> - 확인: API 서버의 `/api/health`와 분류 응답의 `model.finetuned` 값이 `false`가 되고, 테스트 페이지에도 경고가 뜹니다.
> - 복구: 모델이 있는 컴퓨터의 `work/ft/model/` 폴더를 그대로 복사하거나, `python scripts/finetune.py train`(CPU 약 20분)을 실행하세요.

#### 웹 서버 등 다른 코드에서 쓰기

```python
import sys; sys.path.insert(0, "review-analysis/scripts")   # scripts 폴더 경로
import ml_classify
ml_classify.load_model(serving=True)   # 서버 시작 때 한 번 (약 10초: 분류 모델·임베딩 모델·Kiwi 로딩)
ml_classify.classify_reviews([{"content": "재밌는데 렉이 심해요", "rating": 4}])
# → [{"sentiment": "혼합", "topics": {"버그": "부정"}, "source": "ml", "truncated": False}]
```

- `rating`(1~5 정수)은 모델 입력이라 필수입니다. 빠지거나 잘못되면 `ValueError`가 납니다.
- 2,000자를 넘는 내용은 앞부분만 판정하고 `truncated: True`로 표시합니다.
- `serving=True`면 임베딩 캐시를 읽기 전용으로 써서, 요청이 쌓여도 캐시 파일이 커지거나 동시 쓰기로 깨지지 않습니다.
- `work/ml_model.joblib`는 pickle 형식이라 열 때 코드가 실행될 수 있습니다. 직접 학습한 파일만 불러오세요.
- 첫 실행 때 Hugging Face에서 임베딩 모델을 받습니다. 인터넷이 없는 서버라면 모델 캐시(`~/.cache/huggingface`)를 미리 넣고 `HF_HUB_OFFLINE=1`로 실행하세요.

#### 로컬 API 서버 + 테스트 페이지

```powershell
python server/app.py            # http://127.0.0.1:8765 (모델 로딩 약 12초 동안은 503)
```

- `GET /` 테스트 페이지(키보드·스크린리더 대응), `GET /api/health`, `POST /api/classify` (`{"reviews": [{"content", "rating"}]}`, 최대 50건·256KB).
- 모델 실행은 전용 스레드 하나에서만 합니다. 요청 스레드마다 PyTorch를 돌리면 메모리가 계속 늘었습니다(3,250건에 private 2.6GB → 5.1GB).
- 미세조정 모델 포함 기준(2026-11-26 측정, CPU): 메모리 private 약 2.6GB(작업 집합 약 1.9GB)이고 실제 리뷰 4,000건을 동시에 보내는 동안 2.54 → 2.62GB로 거의 유지됐습니다.
- 응답 시간: 규칙으로 판정되는 짧은 리뷰 1건 약 7ms, ML로 판정되는 리뷰 1건 약 190ms, 비슷한 길이의 어려운 리뷰 50건 묶음 약 2초입니다.
- 요청은 순서대로 처리되므로 동시에 몰리면 대기 시간이 늘어납니다. 실제 리뷰 기준 처리량은 초당 약 11~12건이라, 8명이 25건씩 동시에 보내면 대기 시간 중간값이 약 17초였습니다.
- 기본으로 이 컴퓨터(127.0.0.1)에서만 접속을 받습니다. 외부에 공개하려면 HTTPS 프록시 뒤에 두고 `--host 0.0.0.0`으로 실행하세요.

> 현재 커밋된 데이터로 2) → 5)와 ML `predict`를 다시 돌려 보면 결과 파일이 기존과 동일하게 재현됩니다. `analysis.json`만 예외인데, 건수가 같은 키워드끼리 나열 순서가 바뀔 수 있습니다.
