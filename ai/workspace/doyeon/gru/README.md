# RunWay HR Predictor — GRU (구도연)

HR Predictor 테스트 인계용 폴더다. 이 폴더만 받으면 **모델 로드 → Support로 개인화 → Query 예측 → reset**까지 할 수 있다. 건강·위치 데이터는 들어 있지 않다.

러닝 중 t0까지의 기록과 앞으로 2분의 속도·경사 계획을 받아 **30초·60초·120초 뒤 심박(bpm)**을 예측한다. 같은 구조의 GRU 두 개를 미래 경사를 아는지에 따라 골라 쓴다.

- **미래 경사를 알 때** (코스러닝, 저장된 길, 시험 T1·T2·T3·T5): M3-005
- **미래 경사를 모를 때** (처음 달리는 자유러닝, 시험 T4): M3-006 (미래 경사 없이 학습)

두 모델은 최종 checkpoint 파일 하나(`gru_final.pt`)에 함께 들어 있다. 이 파일은 Git에 없고 Hugging Face에서 받는다.

## 체크포인트 받기

| 항목 | 값 |
| --- | --- |
| Hugging Face 저장소 | `doyeonkoo/runway-hr-gru` (공개) — https://huggingface.co/doyeonkoo/runway-hr-gru |
| 파일 | `gru_final.pt` (4.8MB) |
| SHA256 | `db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe` |
| 받을 위치 | 이 폴더의 `model/gru_final.pt` |

```bash
pip install huggingface_hub
```

```bash
python -c "from huggingface_hub import hf_hub_download; hf_hub_download('doyeonkoo/runway-hr-gru', 'gru_final.pt', local_dir='model')"
```

huggingface_hub 없이 받으려면 이 주소에서 직접 내려받아 `model/gru_final.pt`로 저장한다: https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt

받은 뒤 SHA256이 위 값과 같은지 확인한다(`sha256sum model/gru_final.pt`, Windows는 `certutil -hashfile model\gru_final.pt SHA256`).

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `model/gru_final.pt` | 최종 checkpoint (Hugging Face에서 받음). `main` = M3-005(미래 경사 사용), `nograde` = M3-006(미래 경사 안 씀). 각각 가중치 + 학습 설정 + 정규화 값 |
| `model/model_config.json` | 최종 config (구조, 입력, 정규화 값, 학습 설정, 개인화 설정, grade-missing 정책) |
| `src/predictor.py` | `load()`, `personalize()`, `predict()`, `reset()`, `save_state()`, `load_state()` |
| `src/model.py` · `src/data.py` | 모델 구조, 학습과 같은 입력 처리 코드 (predictor가 import) |
| `src/smoke_test.py` | 실행 확인 (가짜 입력) |
| `FREEZE.json` | checkpoint·config·코드 SHA256, seed, val 성적 |
| `requirements.txt` | Python 라이브러리 버전 |

학습·검증 코드(`train.py`, `rehearsal.py`, `tune_personalize.py` 등)는 저장소 `ai/gru/`에 있다.

## 실행 환경

- Python 3.12 (학습 서버 3.12.15). **CPU만으로 실행된다.** GPU 필요 없음.
- `pip install -r requirements.txt` (torch 2.14.1 · numpy 2.5.2 · pandas 3.1.0)

## 바로 실행 확인

명령은 모두 이 폴더 안에서 실행한다 (GitLab `ai/workspace/doyeon/gru/`).

```bash
python src/smoke_test.py
```

모델 로드, `[5, 3]` 출력, NaN/Inf 없음, 경사 모름 처리, 개인화 ON/OFF, reset 후 상태 없음, 상태 저장·복원, 과거가 짧은 window, CPU 지연(후보 5개 요청 p95)을 확인하고 마지막 줄에 `OK`가 나온다.

팀 GPU 서버에서 GPU 없이(CPU, `CUDA_VISIBLE_DEVICES=""`) 실행한 결과: 14개 항목 모두 OK, personalize 1.21초, 요청 1건(후보 5개) p50 6.7ms · p95 8.5ms. 노트북 CPU(Windows)에서도 14개 모두 OK, p95 11.4ms.

## 사용법

```python
import sys; sys.path.insert(0, "src")
from predictor import load

p = load()                                   # model/gru_final.pt (M3-005 + M3-006), CPU
p.personalize(support_runs)                  # 사용자 1명의 Support 러닝으로 개인화 (ON)
hr = p.predict(batch)                        # np.ndarray [N, 3] = [HR@30, HR@60, HR@120] (bpm)
hr_off = p.predict(batch, personalized=False)  # Personalization OFF (상태는 그대로 둠)
p.save_state("states/user_A.pt")             # (선택) 개인화 결과 저장
p.reset()                                    # 다음 사용자 전에 반드시 호출
```

### 호출 순서 (테스트)

```
p = load()                                   # 시작은 OFF(기본) 상태

# Personalized 사용자 한 명마다
p.reset()                                    # 앞사람 개인화 지우기
p.personalize(이 사람의 Support)              # ON (사람마다 한 번)
on  = p.predict(이 사람의 Query window)       # T1 ON. T2·T3·T4도 이 상태로 예측
off = p.predict(같은 Query window, personalized=False)   # T1 OFF → 개인화 Gain = OFF − ON

# Cold-start 사용자
p.reset()                                    # 기본 상태 (Support 없음)
cold = p.predict(이 사람의 window)            # T5
```

- 사람이 바뀔 때마다 먼저 `reset()`을 부른다. 앞사람의 개인화가 남지 않는다.
- `personalize()`는 부를 때마다 이전 상태를 버리고 기본 상태에서 새로 맞춘다. 사람마다 한 번만 부르면 되고, 그 사람의 Query는 몇 번에 나눠 예측해도 된다.
- Query window나 예측 결과로 `personalize()`를 다시 부르지 않는다.
- `predict(..., personalized=False)` 대신 `reset()` 후 `predict()`로 OFF를 재도 결과가 같다.

### Support 러닝 형식 (`personalize(support_runs)`)

러닝마다 dict 하나인 list. 5초 간격.

| 키 | shape · 단위 | 설명 |
| --- | --- | --- |
| `elapsed_s` | [L] · 초 | 러닝 시작 후 경과 시간 |
| `hr` | [L] · bpm | 심박 (canonical `hr_bpm`). 값이 없는 칸만 NaN |
| `speed` | [L] · m/s | 속도 |
| `grade` | [L] · % | 경사. 키가 없으면 0%로 본다 |
| `segment` | [L] (선택) | 구간 번호(segment_id). 주면 구간마다 따로 자른다 |
| `session_id` | str (선택) | 러닝 구분 |

canonical 시계열 DataFrame(`session_id`, `segment_id`, `elapsed_s`, `hr_bpm`, `speed_mps`, `grade_observed_pct`, 선택 `hr_is_filled`, `hr_quality`)이나 DataFrame 리스트도 받는다. `hr_is_filled`·`hr_quality`가 있으면 실제로 잰(GOOD, 보간 아님) 심박만 정답으로 쓴다.

### 예측 입력 형식 (`predict(batch)`)

N = window 수(예: candidate 5개), L = 이번 러닝 시작부터 t0까지 5초 칸 수(마지막 칸이 t0).

| 키 | shape · 단위 | 설명 |
| --- | --- | --- |
| `hr` | [N, L] 또는 길이 다른 1차원 배열 N개 · bpm | 러닝 시작~t0 심박. **t0 칸 = HR0**(실제 측정값이어야 함). 앞쪽 빈 칸·결측은 NaN |
| `speed` | 같음 · m/s | 러닝 시작~t0 속도 |
| `grade` | 같음 · % | 러닝 시작~t0 경사 |
| `segment` | 같음 (선택, 권장) | 칸별 segment_id. 주면 t0와 같은 구간만 쓴다(학습과 같음) |
| `elapsed_s` | [N] · 초 | t0의 러닝 시작 후 경과 시간 |
| `future_speed` | [N, 24] · m/s | t0+5초 ~ t0+120초 속도 계획 |
| `future_grade` | [N, 24] · % 또는 `None` | 같은 칸 경사. **모르면 `None`(또는 NaN)** → M3-006으로 예측 (7절) |

window마다 dict 하나인 list(`hr`·`speed`·`grade`·`elapsed_s`·`segment_id`·`future_speed`·`future_grade` 키)도 받는다.

## 모델 설명

### 1. 어떤 모델인가

`src/model.py`의 `HorizonGRU`: 2층 GRU(hidden 256, 층 사이 dropout 0.2) + 출력층 `Linear(256 → 3)`. 모델 하나에 파라미터 597,507개.

- 입력은 시간순 96칸(과거 72칸 + 미래 24칸, 5초 간격)이고, 칸마다 값 5개를 읽는다.
- GRU가 96칸을 끝까지 읽은 마지막 상태(256개)를 출력층에 넣어 3개 값을 낸다.
- 출력은 **지금 심박(HR0)에서의 변화량**이다. predictor가 bpm으로 바꾸고 HR0를 더한다.
- M3-006은 구조·입력이 같고, 모델 안에서 미래 경사 24칸을 항상 0으로 비우고 읽는다(`mask_future_grade`).

### 2. 왜 이 모델을 골랐나

- **심박은 늦게 반응한다.** 속도를 바꿔도 심박은 수십 초에 걸쳐 따라온다. GRU는 과거 6분의 심박·속도·경사 흐름과 미래 2분 계획을 순서대로 읽어 지연과 누적 효과를 직접 배운다.
- **변화량을 예측해서 사람마다 다른 심박 수준에 덜 흔들린다.** 같은 속도라도 사람마다 심박 수준이 다른데, 그 차이 대부분이 HR0로 흡수된다.
- **학습 때 미래 속도 처리 비교** (val 리허설, 같은 window):

  | 모델 | 학습 때 미래 속도 | T1 ON | 일정한 pace 입력 MAE | T3-A 역전 @120 |
  | --- | --- | --- | --- | --- |
  | M3-001 | 2분 평균으로 평평하게 | 2.829 | 3.69 | 0.22% |
  | M3-004 | 실제 속도 그대로 | 2.654 | 3.92 | 1.83% |
  | **M3-005** | **샘플마다 50%는 평평하게, 50%는 실제 그대로** | **2.661** | **3.71** | **0.62%** |

  T1은 실제 미래 속도로 채점하는데 M3-005는 M3-004와 비슷하다(0.02 차이는 seed 편차 수준). MPC가 넣는 일정한 pace 계획에서는 M3-001 수준을 유지하고, pace 반응 역전도 M3-004보다 적다. (개인화 L2는 M3-001·M3-004 0.1, M3-005 0.03)

### 3. 사용하는 feature와 이유

| # | feature | 과거 칸 | 미래 칸 | 왜 쓰나 |
| --- | --- | --- | --- | --- |
| 1 | 속도 (m/s) | 실제 측정값 | 계획 속도 | 심박을 움직이는 가장 큰 원인. 미래 칸은 MPC가 바꿔 보는 값 |
| 2 | 경사 (%) | 실제 측정값 | 계획 경사 (M3-006은 항상 비움) | 오르막에서는 같은 속도라도 심박이 더 오른다 |
| 3 | 심박 (bpm) | 실제 측정값 | 0 (모름) | 지금까지의 심박 흐름과 사람별 수준. 미래 심박은 넣지 않는다 |
| 4 | 과거 표시 | 1 | 0 | 실제 기록인지, 계획(또는 빈칸)인지 구분 |
| 5 | 경과 시간 | 러닝 시작 후 초 | t0+5~+120초 | 같은 속도라도 러닝 후반엔 심박이 더 높다(drift). 120분에서 자르고 600으로 나눔 |

- **현재 Query 러닝에서 쓰는 정보:** t0와 같은 구간(segment)의 최근 72칸(6분) 원본과 t0 시점의 경과 시간.
- 러닝 시작부터의 누적 통계(평균 심박 등)는 쓰지 않는다. t0 이후 심박, 세션이 끝나야 아는 값(전체 평균, 총 거리·시간)도 쓰지 않는다.

### 4. 주요 parameter

| 구분 | 값 |
| --- | --- |
| lookback | 72칸 = 6분 |
| 미래 | 24칸 = 2분, 예측 시점 +30·+60·+120초 |
| GRU | 2층, hidden 256, dropout 0.2 |
| 학습 | Adam, 학습률 0.001 → cosine 감소, 10 epoch, batch 256, seed 42 |
| 손실 | L1, 실제 측정된 정답 심박만 (`hr_is_filled=False`, `hr_quality=GOOD`) |
| 학습 샘플 | 구간 시작 30초 뒤부터 1분 간격, 1,970,678개 (Train 566명) |
| 미래 속도 섞기 | `--flat-prob 0.5`: 샘플마다 50% 확률로 미래 속도 24칸을 그 평균으로 바꿔 학습 |
| best 선택 | Val에서 실제 미래 속도 MAE가 가장 낮은 epoch (두 모델 모두 epoch 10) |
| 개인화 | 출력층만 조정, Adam 학습률 0.001, 100 step, L2 0.03 (Val에서 0~0.3 비교해 선택) |

학습 명령 (저장소 `ai/gru/`, GPU 서버):

```bash
CUDA_VISIBLE_DEVICES=1 python train.py --run-name M3-005 --data-dir ~/data/fitrec/fitrec_v1 --split-path ~/data/fitrec/splits/fitrec_hr_v2.json --n-files 25 --flat-prob 0.5 --select-by actual --use-elapsed --hidden 256 --seed 42 --cosine --dropout 0.2 --epochs 10 --hist 72 --elapsed-clip 7200
```

M3-006은 같은 명령에 `--run-name M3-006 --no-future-grade`만 다르다.

### 5. 입력 처리 (학습과 같다)

1. t0와 같은 구간에서 심박·속도·경사 중 빈 값(NaN)이 있는 칸을 뺀다.
2. 최근 72칸을 남긴다. 72칸보다 짧으면 앞을 빈칸(값 0, 과거 표시 0)으로 채운다. **과거가 짧다고 window를 빼지 않는다.**
3. 경사를 -30~+30%로 자른다.
4. Train 평균·표준편차로 정규화한다(값은 `model/model_config.json`).
5. 모델 입력 `(N, 96, 5)`를 만든다. 미래 속도는 받은 값을 그대로 쓴다.

## 개인화

### Support(약 80%)로 개인화하는 방법 — `personalize(support_runs)`

1. Support 러닝에서 학습과 같은 방식으로 샘플을 만든다(30초 간격).
2. GRU는 그대로 두고, 샘플마다 GRU 마지막 상태(256개)와 실제 심박 변화량(정답)을 구한다.
3. 출력층만 그 사람에게 맞춘다.
   - 손실: `실제로 잰 정답에 대한 L1 오차 + 0.03 × (출력층 − 기본 출력층)²`
   - Adam(학습률 0.001), 100 step
   - L2 항은 기록이 적은 사람이 몇 개 러닝에 과하게 맞춰지지 않게 하는 브레이크다.
4. M3-005와 M3-006에 각각 같은 Support로 1~3을 한다.
5. 쓸 수 있는 샘플이 없으면(Support가 비었거나 정답이 모두 결측) 기본 상태로 둔다.

사람당 GPU 약 0.9초(Val 108명 96초), CPU에서는 Support 양에 따라 수 초.

### 개인화할 때 실제로 바뀌는 값

- 모델마다 **출력층 `head.weight` (3×256)와 `head.bias` (3)**, 771개 숫자. 두 모델 합쳐 1,542개.
- GRU 가중치(모델마다 596,736개)와 정규화 값은 바뀌지 않는다.
- 즉 "같은 러닝 상황(GRU 상태)을 보고 이 사람은 심박이 얼마나 더/덜 오르는지"를 시점별로 다시 맞춘다.

### 개인화된 값을 저장하는 곳

- predictor 객체 안의 두 모델 출력층에 끼워진다. 파일에 자동으로 쓰지 않는다.
- `personalize()`는 같은 값을 state(`{"main": (weight, bias), "nograde": (weight, bias)}`)로도 돌려준다.
- 저장·복원:
  - 파일로 저장: `p.save_state("states/user_A.pt")`
  - 다시 끼우기: `p.load_state("states/user_A.pt")` 또는 `p.load_state(state)`
- 기본 출력층(population)은 `p.base`에 따로 보관한다.

### Query(약 20%)에서는 예측만 한다 — `predict(batch)`

- 지금 끼워진 출력층으로 예측만 한다(`torch.no_grad`). 개인화 상태를 바꾸지 않는다.
- Query 러닝이나 앞선 Query 결과로 개인화를 다시 하지 않는다.
- 현재 Query 러닝에서는 t0까지 관측된 값만 쓴다.

### Personalization OFF

- 출력층을 Train으로 학습한 기본 출력층(population)으로 쓴 상태다. `predict(batch, personalized=False)` 또는 `reset()` 후 `predict(batch)`.
- 같은 window를 같은 입력으로 예측하고, 현재 Query 러닝의 t0까지 기록도 그대로 쓴다.

### Cold-start 기본 상태

- Support가 없으므로 `personalize()`를 부르지 않는다(`reset()` 상태). OFF와 같은 population 상태다.
- 현재 러닝의 t0까지 기록과 future speed·grade는 그대로 쓴다.

## future grade를 모를 때 (T4) — grade-missing 정책

**`future_grade`를 `None`으로 주거나 한 칸이라도 NaN이면, 미래 경사 없이 학습한 M3-006으로 예측한다.**

- M3-006은 과거 경사(t0까지 측정값)와 미래 속도는 쓰고, 미래 경사만 항상 비워서 학습했다. "경사를 모를 때 평균적으로 심박이 어떻게 되는지"를 직접 배운 모델이다.
- 한 batch에 경사를 아는 window와 모르는 window가 섞여 있어도 window마다 모델을 골라 원래 순서로 돌려준다.
- **T4에서는 `future_grade=None`(또는 NaN)으로 넘겨야 이 정책이 적용된다.** 0이 든 배열을 넘기면 "앞으로 평지"라는 실제 값으로 보고 M3-005로 예측한다.

정책을 고른 근거 (val 리허설, 개인화 ON, 경사를 알 때 M3-005는 2.661):

| 경사 모를 때 방식 | Mean MAE | @30 / @60 / @120 |
| --- | --- | --- |
| M3-005 + 미래 경사 0%(평지)로 채우기 | 3.493 | 2.72 / 3.60 / 4.16 |
| M3-005 + t0 직전 30초 평균 경사 이어 쓰기 | 3.573 | 2.58 / 3.60 / 4.54 |
| M3-005 + t0 직전 60초 평균 경사 이어 쓰기 | 3.569 | 2.62 / 3.61 / 4.48 |
| **M3-006 (미래 경사 없이 학습)** | **3.090** | **2.38 / 3.14 / 3.75** |

## 출력 `[HR30, HR60, HR120]`

`[N, 3]` float, bpm, **절대 심박**: `[HR@30, HR@60, HR@120]` = t0 뒤 30·60·120초의 예측 심박수. 모델이 변화량을 내고 `predict()`가 HR0(입력 `hr`의 마지막 칸)를 더해서 낸다.

## Freeze 정보

| 항목 | 값 |
| --- | --- |
| 작성자 | 구도연 |
| Model ID | M3-005 (W&B `imdoyeon-sw-/runway-hr` run `0watjhko`) + M3-006 (run `8ml7kzek`) |
| 모델 구조 | HorizonGRU 2층 hidden 256 × 2개 (경사 앎 / 경사 모름), 출력 = HR0 + 예측 변화량 |
| Final checkpoint | `model/gru_final.pt` (Hugging Face `doyeonkoo/runway-hr-gru`). M3-005·M3-006 모두 epoch 10 |
| SHA256 | `db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe` (`FREEZE.json`에 원본 M3-005 `8a648df4…` · M3-006 `b73c256b…`도 기록) |
| Git commit | GitLab `S15P31E105` 저장소 `ai/workspace/doyeon/gru/` (이 폴더를 올린 커밋: `git log -1 -- ai/workspace/doyeon/gru`). 코드 버전은 `FREEZE.json`의 code_sha256 |
| seed | 42 |
| 학습 데이터 | Split V2 `fitrec_hr_v2.json` Train(train 그룹 앞 80% 러닝), 샘플 1,970,678개. Val로 checkpoint·hyperparameter 선택, Test 미사용 |
| scaler / normalization | Train 평균·표준편차 표준화 (속도·경사·심박). 값은 체크포인트와 `model/model_config.json` |
| 결측 처리 | 입력 칸에 NaN이 있으면 그 칸을 빼고 최근 72칸, 부족하면 앞을 빈칸 표시로 채움. 미래 경사 결측은 M3-006 |
| 최종 config | `model/model_config.json` |

## val 자가 점검 (Split V2 val, 테스트 규칙대로, test 미사용)

`ai/gru/rehearsal.py`로 T1~T6 규칙을 V2 **val**에 적용했다. 채점 window는 t0 앞 120초·뒤 120초가 같은 구간에 끊김 없이 있고, HR0·정답이 실제 측정값인 window다(30초 간격).

| 테스트 | 결과 |
| --- | --- |
| T1 Personalized (108명 · 1,866러닝 · 47,217 window) | MAE 2.18 / 2.69 / 3.11, **Mean 2.661** (Persistence 4.317) · OFF 2.745 → 개인화 Gain **0.085** · User P90 4.79 |
| T2 가속 / 감속 (11,026 / 11,046 window) | Mean 2.904 / 3.008 · 120초 방향 정확도 85.5% / 82.9% |
| T3-A Pace 후보 (46,495 window) | Speed reversal @60 0.21% · @120 0.62% · 민감도 0.72 bpm / 10 sec/km · 무반응률 17.1% |
| T3-B Grade ±2%p | Grade reversal @60 0.23% · @120 0.55% |
| T4 미래 경사 모름 (M3-006) | Mean 3.090 (T1 대비 +0.429) |
| T5 Cold-start (9명 중 8명 · 193 window) | MAE 2.02 / 3.00 / 3.47, **Mean 2.832** (Persistence 3.285) |
| T6 Latency (요청 1건 = 후보 5개, CPU, 200회) | p50 8.4ms · **p95 9.3ms → PASS** |
| NaN / Inf | 없음 |

## 알려진 문제

- **경사 모를 때 정확도**: M3-006은 경사를 알 때보다 Mean MAE가 0.43 나쁘다(3.090 vs 2.661).
- **M3-006의 pace 반응**: 미래 속도만 바꾸면 역전 @120 5.0%, 무반응률 24.8%, 민감도 0.36 bpm/10 sec/km. 자유러닝에서 MPC가 pace 후보를 구분하는 힘이 코스러닝보다 약하다.
- **Pace 후보 무반응 (T3-A)**: M3-005도 후보 ±10 sec/km 사이 HR@120 차이가 0.5 bpm 미만인 window가 17%다.
- **입력 심박**: 학습은 canonical `hr_bpm`(값이 비면 앞 값으로 채운 LOCF 포함)을 입력으로 썼다. 과거 심박에 NaN이 많으면 그 칸이 빠져 학습 때보다 과거가 짧아진다.
- **segment**: `segment`를 안 주면 t0 앞쪽에 끊긴 구간이 있어도 이어진 것으로 보고 읽는다.
