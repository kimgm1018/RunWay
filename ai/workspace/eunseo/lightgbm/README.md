# RunWay HR Predictor — LightGBM (박은서)

노션 「HR Predictor 테스트」 인계용 폴더입니다. 이 폴더만 받으면 **모델 로드 → Support로 개인화 → Query 예측 → reset**까지 할 수 있습니다. 건강·위치 데이터는 들어 있지 않습니다.

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `model/model_30s.txt` · `model_60s.txt` · `model_120s.txt` | LightGBM 모델 3개 (30·60·120초 예측, 합계 약 105MB). **GitLab에는 없고** Hugging Face에서 받습니다 (아래 「모델 받기」) |
| `model/features.txt` | 특징 이름과 순서 (253개) |
| `model/model_config.json` | 최종 config (특징 버전, 과거 칸 수, 하이퍼파라미터, 부스팅 횟수, seed) |
| `src/predictor.py` | `HRPredictor`: `personalize()` · `predict()` · `reset()` |
| `src/data.py` · `features.py` · `history.py` | 학습과 같은 특징 계산 코드 (predictor가 import) |
| `src/smoke_test.py` | 실행 확인 (가짜 입력) |
| `FREEZE.json` | checkpoint SHA256, 코드 SHA256, seed, val 성적 |
| `requirements.txt` | Python 라이브러리 버전 |

## 실행 환경

- Python 3.12 (학습 서버 3.12.15), **CPU만** 씁니다. GPU 필요 없음.
- `pip install -r requirements.txt` (lightgbm 4.7.0 · numpy · pandas · pyarrow)

## 모델 받기 (Hugging Face)

모델 파일 3개는 Hugging Face private 저장소 [ashleyprk/runway-lgbm-hr-predictor](https://huggingface.co/ashleyprk/runway-lgbm-hr-predictor)에 있습니다. 접근 권한이 필요하면 박은서에게 요청하세요. 서버 `~/workspace/eunseo/lightgbm/model/`에는 이미 들어 있어 받을 필요가 없습니다.

```bash
pip install -U huggingface_hub
hf auth login   # 본인 Hugging Face 토큰 입력
hf download ashleyprk/runway-lgbm-hr-predictor model_30s.txt model_60s.txt model_120s.txt --local-dir model
```

받은 뒤 SHA256이 `FREEZE.json`과 같은지 확인합니다. 파일 5개 모두 `True`여야 합니다.

```bash
python -c "import hashlib,json;f=json.load(open('FREEZE.json'));print({k:hashlib.sha256(open(k,'rb').read()).hexdigest()==v for k,v in f['sha256'].items()})"
```

## 바로 실행 확인

명령은 모두 이 폴더 안에서 실행합니다 (GitLab `ai/workspace/eunseo/lightgbm/` 또는 서버 `~/workspace/eunseo/lightgbm/`).

```bash
python src/smoke_test.py --model-dir model
```

모델 로드, 개인화 ON/OFF, `[5, 3]` 출력, NaN/Inf 없음, reset 후 상태 없음, CPU 지연(후보 5개 요청 p95)을 출력하고 마지막 줄에 `OK`가 나옵니다.

## 사용법

```python
import sys; sys.path.insert(0, "src")
from predictor import HRPredictor

p = HRPredictor("model")              # 모델 로드 (CPU)
p.personalize(support_runs)           # 사용자 1명의 Support 러닝으로 개인화 (아래 형식)
hr = p.predict(batch)                 # np.ndarray [N, 3] = [HR@30, HR@60, HR@120] (bpm)
hr_off = p.predict(batch, personalized=False)   # Personalization OFF
p.save_state("states/user_A.json")    # (선택) 개인화 결과 저장
p.reset()                             # 다음 사용자 전에 반드시 호출
```

- 사용자 1명 = `personalize()` → 그 사람 Query 창 전부 `predict()` → `reset()`.
- `personalize()`는 부를 때마다 이전 상태를 버리고 새로 만듭니다. `reset()` 뒤에는 상태가 `None`이라 Cold-start와 같습니다.
- 상태는 `HRPredictor` 객체 안(`p.state`)에만 있고 파일에 자동으로 쓰지 않습니다. 이전 사용자 상태가 넘어가지 않게 사용자마다 `reset()`하거나 새 `HRPredictor`를 만드세요.

### Support 러닝 형식 (`personalize(support_runs)`)

`support_runs`는 러닝마다 dict 하나인 list입니다.

| 키 | shape · 단위 | 설명 |
| --- | --- | --- |
| `start_time_s` | float · UTC epoch 초 | 러닝 시작 시각 |
| `duration_s` | float · 초 | 러닝 길이 (끝 시각 = 시작 + 길이) |
| `elapsed_s` | [L] · 초 | 러닝 시작 후 경과 시간 (5초 칸) |
| `hr` | [L] · bpm | GOOD 측정값만, 나머지 NaN |
| `speed` | [L] · m/s | GOOD 측정값만, 나머지 NaN |
| `session_id` | str (선택) | 끝 시각이 같은 러닝의 순서용 |

Support는 사용 가능 러닝(workout_quality CLEAN · USABLE_WITH_FLAGS) 전부를 넣으면 됩니다. 실제로 쓰는 것은 Query 러닝 시작 전에 끝난 것 중 최근 5개입니다.

### 예측 입력 형식 (`predict(batch)`)

N = 창 수(예: candidate 5개), L = 이번 러닝 시작부터 t0까지 5초 칸 수(마지막 칸이 t0).

| 키 | shape · 단위 | 설명 |
| --- | --- | --- |
| `hr` | [N, L] 또는 길이 다른 1차원 배열 N개 · bpm | 러닝 시작~t0 HR. **t0 칸 = HR0**. GOOD 값만, 나머지 NaN. [N, L] 배열이면 앞쪽 빈 칸을 NaN으로 채움 |
| `speed` | 같음 · m/s | 러닝 시작~t0 속도 |
| `grade` | 같음 · % | 러닝 시작~t0 경사 |
| `segment` | 같음 (선택, 권장) | 칸별 segment_id. 주면 t0와 다른 segment 칸을 과거 48칸에서 결측으로 봄(학습과 같음) |
| `elapsed_s` | [N] · 초 | t0의 러닝 시작 후 경과 시간 |
| `future_speed` | [N, 24] · m/s | t0+5초 ~ t0+120초 속도 계획 (5초 칸) |
| `future_grade` | [N, 24] · % | 같은 칸 경사. **모르면 0** |
| `session_start_s` | [N] · UTC epoch 초 | 이번 러닝 시작 시각 (앞선 러닝 선택·경과 일수) |

- 과거는 t0 전 240초(48칸)를 원값으로 쓰고, 이번 러닝 처음부터 t0까지 누적값(최고·최저·평균 HR, HR-속도 기울기)도 씁니다. 그래서 과거 24칸만이 아니라 **러닝 시작부터 t0까지** 넣어야 합니다. 러닝이 끝나야 아는 값(세션 평균·총 거리 등)은 쓰지 않습니다.
- t0 이후 실제 HR은 입력에 없습니다.

### 출력

`[N, 3]` float, bpm, **절대 HR**: `[HR@30, HR@60, HR@120]` = t0 뒤 30·60·120초의 예측 심박수. 모델 3개가 각각 `HR(t0+k) − HR0`를 예측하고 `predict()`가 HR0(입력 `hr`의 마지막 칸)를 더해서 냅니다.

## 모델 설명

### 어떤 모델, 왜

- **LightGBM GBDT 회귀**, 예측 시점마다 모델 1개 (30·60·120초, 총 3개). 손실 `regression_l1`(MAE) — 평가 지표가 MAE이고 HR 튐에 덜 끌려갑니다.
- 고른 이유: 표 형태 특징에서 학습·추론이 빠르고(CPU 수 ms), 결측(NaN)을 그대로 다루며, 어떤 특징이 쓰였는지 볼 수 있습니다. GRU·Transformer와 같은 입력으로 비교하는 기준 모델 역할도 합니다.
- 예측 대상은 절대 HR이 아니라 **HR0 대비 변화량**입니다. 사람마다 다른 HR 수준을 빼고 "앞으로 얼마나 오르내리나"만 배우게 해서 오차가 작았습니다.

### 특징 (features_v7, 253개)

| 묶음 | 특징 | 왜 |
| --- | --- | --- |
| 과거 원값 | `hr/speed/grade_lag0..47` (t0 전 240초, 5초 칸) | 최근 HR 흐름과 속도·경사 변화 |
| 과거 요약 | 30·60·120·240초 HR 평균·표준편차·변화, 속도 평균·변화 | 추세를 칸 하나보다 안정적으로 |
| 미래 계획 요약 | 30·60·120초 미래 속도 평균, 경사 평균·최대, 현재 대비 속도 변화 | 각 예측 시점까지 운동 강도 |
| 미래 속도 원값 | `fut_speed_c0..c23` (5초 칸별 미래 속도) | GRU·Transformer와 같은 입력 조건, ramp 같은 속도 변화 모양 |
| 러닝 진행·데이터 상태 | 경과 시간, 유효 칸 수, 결측 칸 수 | 러닝 초반(워밍업)과 결측 구간 구분 |
| HR 노이즈 대응 | 중앙값 평활 HR, 튐 크기, 5초 최대 변화, 튐 횟수, 결측을 건너 본 HR 끊김 | 센서 튐에 덜 흔들리게 |
| 이번 러닝 누적 | 러닝 시작~t0 HR 최고·최저·평균, 시작 대비, HR-속도 기울기, "이 속도면 HR이 여기쯤" 차이 | 과거 240초만으로 모르는 오늘 컨디션 |
| 노력·회복 | 경사 보정 속도의 최근 정점과 회복, 노력으로 설명 안 되는 HR 상승, 미래 노력 − 과거 노력 | 오르막·서지 뒤 HR 회복, 피로 |
| **개인화 (Support)** | 14개: 앞선 러닝 수·경과 일수, 평소 평균·최대 HR, 평소 HR-속도 기울기 + 파생(지금 HR − 평소 평균, 평소 워밍업 곡선 대비 지금 HR과 30·60·120초 동안 평소 상승폭, 평소 초반 속도 대비 지금 속도, 평소 HR-속도 직선으로 본 지금·60·120초 HR − 지금 HR) | 사람마다 다른 HR 수준·반응 |

### 주요 파라미터

`objective=regression_l1` · `learning_rate=0.05` · `num_leaves=63` · `min_data_in_leaf=200` · `feature_fraction=0.8` · `bagging_fraction=0.8` (`bagging_freq=1`) · 부스팅 6000회 고정(early stopping 없음, 30·60·120초 모두 6000) · seed 42 · 과거 48칸 · train 창 간격 30초.

## 개인화

| 질문 | 답 |
| --- | --- |
| Support 약 80%로 어떻게 개인화하나 | Support 러닝마다 요약(30초 칸별 HR 곡선 0~600초, HR-속도 합계, 평균·최대 HR, 초반 5분 속도)을 만들고, Query 러닝 시작 전에 끝난 **최근 5개**를 합칩니다. 다시 학습하지 않습니다. |
| 실제로 바뀌는 값 | **모델 파라미터는 안 바뀝니다.** 입력 특징 `prev_*`(평소 HR 수준·HR-속도 관계·워밍업 곡선·앞선 러닝 수·경과 일수)와 그 파생 특징만 사람마다 달라집니다. |
| 개인화 결과 저장 위치 | `HRPredictor.state` (메모리의 dict: Support 러닝별 요약 숫자 + 끝 시각). 필요하면 `save_state(path)` / `load_state(path)`로 JSON 저장·불러오기. |
| Query 20%에서는 | `predict()`만 부릅니다. `predict()`는 상태를 읽기만 하고 바꾸지 않으므로 Query나 앞선 Query 결과가 개인화에 들어가지 않습니다. |
| Personalization OFF | `predict(batch, personalized=False)`: `prev_*`를 전부 결측(앞선 러닝 0개)으로 둡니다. 이번 러닝 누적값(`run_*`)은 그대로 씁니다(현재 러닝 입력이라). |
| Cold-start 기본 상태 | 상태 없음(`reset()` 직후 또는 `personalize()` 안 부름) = OFF와 같음. 학습 데이터에 앞선 러닝이 없는 창이 있어서 모델이 결측 갈래로 예측합니다. population 통계를 따로 넣지 않습니다. |
| reset | `p.reset()` → `p.state = None`. 다음 사용자 `personalize()` 전에 꼭 부르세요. |

## future grade를 모를 때 (T4)

`future_grade`에 **0(평지)** 24칸을 넣습니다. NaN을 넣어도 돌아가지만(결측 갈래) 테스트 T4 정의(grade=0)와 맞추려고 0을 기준으로 합니다.

## Freeze 정보

| 항목 | 값 |
| --- | --- |
| 작성자 | 박은서 |
| Model ID | EXP-20261030-01 (LightGBM, features_v7) |
| 이전 모델 | EXP-20261029-04 (10/29 freeze). 10/30 교체: 테스트 조건대로 다시 학습, val 자가 점검 T1 Mean 2.830 → 2.818 |
| 모델 구조 | LightGBM GBDT 회귀 3개 (30·60·120초), 손실 L1, 출력 = HR0 + 예측 변화량 |
| Final checkpoint | `model/model_30s.txt` · `model_60s.txt` · `model_120s.txt` (Hugging Face private 저장소 `ashleyprk/runway-lgbm-hr-predictor` main, 업로드 커밋 `70f1c085`) |
| SHA256 | `FREEZE.json` 참고 (model_30s `e1ea453a…` · model_60s `e95783cb…` · model_120s `b4b66c62…`) |
| Git commit | GitLab `S15P31E105` 저장소 `ai/workspace/eunseo/lightgbm/` (이 폴더를 올린 커밋: `git log -1 -- ai/workspace/eunseo/lightgbm`). 같은 폴더가 팀 GPU 서버 `~/workspace/eunseo/lightgbm/`에도 있음. 코드 버전은 `FREEZE.json`의 code_sha256 |
| seed | 42 |
| 학습 데이터 | Split V2 `fitrec_hr_v2.json` train 100%, 창 5,219,248개. 사람마다 뒤 20% 러닝(Train Temporal Holdout)도 학습에 넣고, 그 러닝의 앞선 러닝 특징(`prev_*`)은 앞 80% 러닝으로만 만듦(테스트의 Support → Query와 같은 조건). Val·Test 사용자 미사용 |
| scaler / normalization | 없음 (트리 모델) |
| 결측 처리 | GOOD이 아닌 값은 NaN으로 넣음. LightGBM이 결측 갈래를 학습함 |
| 최종 config | `model/model_config.json` |

## val 자가 점검 (Split V2 val, 테스트 규칙대로, test 미사용)

노션 T1~T6 규칙(Support로만 개인화, 채점 창 = 과거 24칸·미래 24칸이 다 있고 HR0·정답이 측정값인 창)을 V2 **val**에 그대로 적용한 결과입니다(`selfcheck_protocol.py`). test는 열지 않았습니다.

| 테스트 | 결과 |
| --- | --- |
| T1 Personalized (108명 · 1,890러닝 · 159,283창) | MAE 2.21 / 2.85 / 3.39, **Mean 2.818** (Persistence 3.872) · OFF 2.873 → 개인화 Gain **0.055** · 사람별 Mean MAE P90 4.81 |
| T2 가속 / 감속 (34,634 / 35,073창) | Mean 3.165 / 3.208 · 120초 방향 정확도 80.7% / 79.5% |
| T3-A Pace 후보 (156,999창) | Speed reversal @60 0.14% · @120 0.54% · 민감도 0.52 bpm / 10 sec/km (@120 중앙값) · 무반응률 23.1% |
| T3-B Grade ±2%p | Grade reversal @60 0.10% · @120 0.63% |
| T4 미래 경사 0 | Mean 3.248 (T1 대비 +0.430) |
| T5 Cold-start (9명 · 750창) | MAE 2.30 / 2.83 / 3.30, **Mean 2.808** (Persistence 3.231) |
| T6 Latency (요청 1건 = 후보 5개, 200회, LightGBM 4스레드) | p50 11.4ms · **p95 11.9ms → PASS** · personalize 1회 약 0.2초 |
| NaN / Inf | 0 (모든 채점 창에 예측 반환, 과거가 240초 미만인 창도 결측 칸으로 예측) |

학습 경로와 같은지: V2 val 사람별 첫 Query 러닝 + Cold-start 러닝 12,707창에서 특징·예측이 학습 코드와 완전히 같음(예측 차이 0.0, `check_predictor.py`).

## 알려진 문제

- **부스팅 횟수 고정**: early stopping 없이 6000회로 고정했습니다. 직전 모델(EXP-20261029-04, holdout으로 early stopping)도 세 모델 모두 상한 6000회에 닿아서 같은 횟수로 두었습니다.
- **미래 경사 의존 (T4)**: 미래 경사를 0으로 넣으면 T1 대비 Mean MAE가 약 0.43 나빠집니다.
- **Pace 후보 무반응 (T3-A)**: 트리 모델이라 예측이 계단식입니다. 후보 ±10 sec/km 사이에서 HR@120 차이가 0.5bpm 미만인 창이 약 24%입니다. 역전은 1% 미만입니다.
- **입력 길이**: 러닝 시작부터 t0까지 칸을 넣어야 학습과 같습니다. 과거 24칸만 넣으면 돌아가지만 240초 원값·이번 러닝 누적값이 달라져 성능이 떨어집니다.
- **segment·시작 시각**: `segment`를 안 주면 끊긴 곳 근처 창(val 약 3%)에서 학습과 입력이 달라집니다. `session_start_s`를 안 주면 Support 전체를 앞선 러닝으로 보고 경과 일수는 결측입니다.
- **val 성적 두 가지**: 학습 로그·`FREEZE.json`의 val 성적(2.48 / 3.19 / 3.80, 전체 val 창)과 위 자가 점검(T1 채점 창만)은 채점 창이 달라 숫자가 다릅니다. 둘 다 Support만으로 개인화했습니다.
