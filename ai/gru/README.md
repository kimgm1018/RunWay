# GRU HR 예측 — 학습·검증 코드

인계용 모델 폴더(체크포인트, 예측 코드, 모델 설명)는 `ai/workspace/doyeon/gru/`에 있다. 모델 설명과 사용법은 그 폴더의 README를 본다.
이 폴더는 그 모델을 만들고 검증한 코드다. 실험 기록은 W&B `imdoyeon-sw-/runway-hr`와 팀 시트 도연 탭에 있다.

| 파일 | 역할 |
| --- | --- |
| `train.py` | 학습. 매 epoch val 평가, best 저장, W&B 기록 (`--flat-prob`, `--no-future-grade` 등) |
| `data.py` · `model.py` | 데이터 읽기·v1/v2 분할·정규화·샘플 생성, 모델 구조 |
| `predictor.py` | 예측 함수 (인계 폴더 `src/predictor.py`와 같은 파일) |
| `rehearsal.py` | 테스트 T1~T6 규칙을 val에 적용한 리허설 |
| `tune_personalize.py` | 개인화 L2 비교 |
| `eval_personal.py` · `eval_adapt.py` | 예전 개인화 평가 (사후 보정 / 미세조정) |
| `measure.py` | 저장된 모델의 지연 시간·What-if 측정 |

리허설 예 (GPU 서버, `~/workspace/doeyon`):

```bash
CUDA_VISIBLE_DEVICES=1 python rehearsal.py --checkpoint ~/runway-runs/M3-005/best.pt --nograde-checkpoint ~/runway-runs/M3-006/best.pt --out ~/runway-runs/rehearsal_val_final.json
```
