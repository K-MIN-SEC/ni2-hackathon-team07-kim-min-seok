# 미세조정 모델 재현 확인 (다른 PC)

2026-11-27. 저장소만 받은 PC에서 미세조정 모델을 다시 만들고, 분류 서버가 그 모델로 판정하는지 확인한 기록입니다.

## 왜 필요했나
- `work/ft/model/`(약 420MB)은 git에 없어서, 저장소를 새로 받으면 서버가 경고 후 **기존 모델로만** 판정합니다(어려운 리뷰 감성 약 85%).
- 문서의 89.7%는 `work/ml_eval.json`에 저장된 교차검증 결과라, 받은 PC에서 미세조정 모델이 실제로 쓰이는지는 따로 확인해야 했습니다.

## 한 일
| 단계 | 내용 | 결과 |
|---|---|---|
| 1. 환경 | `.venv` (Python 3.13), `torch==2.15.0` CPU + `requirements.txt` | 설치 정상. 문서는 3.12 기준이지만 3.13에서도 동작 |
| 2. 학습 | `python scripts/finetune.py train` | 약 12분, `work/ft/model/` 생성 |
| 3. 재현성 | 단계별 손실을 원본 `work/logs/ft_train.log`와 비교 | 50~350 단계 손실 **모두 동일** (0.923 → 0.253) |
| 4. 서버 | `python server/app.py` → `/api/health` | `finetuned: true`, "미세조정 모델 사용 중", 로딩 19초 |

학습 로그: `work/logs/ft_train_local.log`

## 샘플 판정 (`POST /api/classify`, 5건 0.27초)
| 리뷰 | 별점 | 감성 | 주제 | 판정 |
|---|---:|---|---|---|
| 재밌는데 렉이 심해요 | 4 | 혼합 | 버그: 부정 | ml |
| 환불 잘해줌 고객센터 빠름 | 5 | 긍정 | 과금·운영: 긍정 | ml |
| 업데이트 후에 계속 튕기네요 고쳐주세요 | 5 | 부정 | 버그: 부정 | ml |
| 좋와요 쟈미잇어요 | 5 | 긍정 | 일반: 긍정 | rule (오타·은어 사전) |
| 이번 업데이트 괜찮을지 걱정되네요 | 4 | 긍정 ✗ | 콘텐츠: 긍정 | rule |

- 개선 사례("환불 잘해줌"을 긍정, 별점 5점 불만을 부정)는 맞게 판정합니다.
- 마지막 "걱정" 리뷰는 규칙이 확신해 ML까지 가지 않고 틀렸습니다. 정리 문서 '한계'의 걱정·응원 문제와 같습니다.

## 주의
- 이번 확인은 **미세조정 모델이 서버에 반영되는지**에 대한 것입니다. 정확도(89.7%)를 새로 측정하지는 않았습니다. 학습한 모델은 전체 라벨로 학습해서 같은 데이터로 다시 재면 의미가 없고, 다시 재려면 `python scripts/finetune.py cv`(겹마다 10~15분)가 필요합니다.
- Windows에서 Hugging Face 캐시 심볼릭 링크 경고가 나오지만 동작에는 문제가 없습니다.

## 다른 PC에서 다시 하려면
```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe scripts\finetune.py train
.venv\Scripts\python.exe -X utf8 server\app.py
```
