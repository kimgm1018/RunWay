# RunWay HR Predictor: Personalized Transformer + Session Context (안성윤)

「HR Predictor 테스트」 인계용 실행 패키지입니다. 이 폴더와 Hugging Face에서 받은 checkpoint 1개로 아래 흐름을 CPU에서 실행합니다.

**load → Support personalization → Query predict → reset**

- 모델 weight(`.pt`)는 **Git에 없습니다** (13장).
- 건강·위치 데이터, 실험 로그, 실험 결과도 들어 있지 않습니다.

| 경로 | 내용 |
| --- | --- |
| `predictor.py` | `Predictor`: `personalize()` · `predict()` · `reset()` (+ `save_state()` / `load_state()`), 입력 변환 helper |
| `smoke_test.py` | 합성 데이터로 load → personalize → predict → reset 자동 검증 (CPU) |
| `ptv2/` | 학습 코드 원본 11개 파일. 수정 금지: SHA256이 `config/model_config.json`의 `code_sha256`과 다르면 load 실패 |
| `config/model_config.json` | 모델 구조, 학습·적응 설정, 입력 계약 상수, 학습 코드 SHA256 |
| `config/final_checkpoint.json` | Hugging Face checkpoint 정보 (repository URL, 파일 이름, SHA256, seed, step) |
| `artifacts/session_context_stats.json` | Session Context 정규화 통계 (V2 Train 전용). load 때 checkpoint 값과 같은지 확인 |
| `artifacts/input_scaling.json` | 고정 입력 스케일 상수 (참고용, 코드는 `ptv2/config.py` 값을 씀) |
| `requirements.txt` | 추론 의존성 |

---

## 1. 모델 구조

Small Personalized Action-Conditioned Transformer (`ptv2`, preset `small`) + Session Context v1. 파라미터는 165,793개입니다.

```
past 24 rows (t0-115s .. t0)    [(hr-142)/22, hr_is_filled, speed, 10*v_speed, elapsed/1200] -> Linear(5->64)
future 24 rows (t0+5 .. t0+120) [speed, 10*v_speed, elapsed/1200]                        -> Linear(3->64)
  + learned position (48) + token type (past / future)
  + z_proj(z12),  z12 = [Personal4 (4) | History8 (8)]
  + session_proj(clip((S - train_mean) / train_std, ±5)),  S = Session Context [10]   (Linear 10->32, GELU, Linear 32->64)
-> Pre-Norm TransformerEncoder (d_model 64, 4 heads, 3 layers, FF 256, GELU, dropout 0.1) + LayerNorm
   (48 토큰 양방향 attention, 미래 토큰에는 HR이 없음)
-> 미래 24개 hidden -> Linear(64->1) x 22 = ΔHR
HR = HR0 + ΔHR  (미래 24칸),  출력 = 그중 +30 / +60 / +120초 칸 (index 5 / 11 / 23)
```

- `v_speed` = 수직 속도 대리값 `speed · sin(atan(grade/100))` (m/s). 모델은 grade(%)를 직접 받지 않고 이 값으로 받습니다.
- Personal4: 4차원 개인 벡터 (Train 피험자별 embedding, `max_norm 5`).
- History8 encoder: Support 세션 10초 행 `[L, 5]`에서 8차원을 계산합니다.
  - Conv1d(5→32, k5) → GELU → Conv1d(32→32, k5) → GELU → 유효 행 평균 → Linear(32→8)
- 코드는 `ptv2/model.py`(`PersonalizedActionTransformer`), 하이퍼파라미터는 `config/model_config.json`에 있습니다.

## 2. 왜 이 구조인가

- **행동 조건부 예측**: 서비스 MPC는 "이 pace 계획이면 HR이 어떻게 되나"를 묻습니다.
  - 미래 속도·경사 계획이 24개 토큰으로 직접 들어가고, 과거 토큰과 함께 self-attention으로 처리됩니다.
  - 같은 t0에서 후보 계획만 바꿔 batch 행으로 넣으면 후보별 HR이 한 번에 나옵니다.
- **궤적 출력**: 미래 24칸 전체를 한 번에 예측합니다. HR@30·60·120이 같은 궤적 위에 있어 서로 모순되지 않습니다.
- **작게 분리된 개인화**: 사람별 차이는 Personal4(4개 숫자)와 History8(Support 기록에서 계산)로만 들어갑니다.
  - 공유 weight는 고정합니다.
  - 새 사용자는 4개 숫자만 적응하므로 CPU에서 빠르게 끝나고, 사용자끼리 상태가 섞이지 않습니다.
- **Session Context**: 과거 120초만으로는 모르는 "이번 세션의 상태"를 10개 요약값으로 더합니다. 지금까지의 HR 수준·변동, 페이스·지형 경향, 추세가 여기에 들어갑니다.

## 3. 입력 feature와 shape / unit

### `predict(batch)`: Query 창 N개

- N = 창 수 (예: 같은 t0의 pace 후보 5개)
- L = **이번 세션 첫 칸부터 t0 칸까지** 5초 칸 수 (마지막 칸 = t0, L ≥ 24)

| key | shape | 단위 | 필수 | 의미 / 결측 처리 |
| --- | --- | --- | --- | --- |
| `elapsed_s` | [N] | 초 | ✔ | t0의 세션 시작 후 경과 시간 |
| `hr` | [N, L] 또는 길이 다른 1-D N개 | bpm | ✔ | 세션 시작~t0 HR. canonical `hr_bpm` 그대로 (LOCF로 채운 값 포함). 마지막 칸 = HR0. 과거 24칸은 유효해야 함, 그 앞 칸은 NaN 가능 |
| `speed` | hr와 같음 | m/s | ✔ | 세션 시작~t0 속도 |
| `grade` | hr와 같음 | % | ✔ | 세션 시작~t0 관측 경사 |
| `future_speed` | [N, 24] | m/s | ✔ | 5장 |
| `future_grade` | [N, 24] | % | ✔ | 5장, 11장 |
| `session_start_s` | [N] | UTC epoch 초 | 개인화 ON일 때 ✔ | Query 세션 시작 시각. 이 시각 **전에 끝난** Support 세션만 History로 씀 |
| `hr_is_filled` | hr와 같음 | bool | 권장 | canonical LOCF 플래그. 미지정 → 전부 측정값으로 봄, 원소 NaN → True |
| `hr_quality` / `speed_quality` / `grade_quality` | hr와 같음 | str 또는 bool | 선택 | 문자열이면 GOOD·LOW만 유효. 미지정 → 유한값 전부 유효 |
| `segment` | hr와 같음 | int | 선택 | segment_id. t0 앞 24칸은 t0와 같은 segment여야 함. 미지정 → 전부 같은 segment |
| `row_elapsed_s` | hr와 같음 | 초 | 선택 | 칸별 경과 시간. 미지정 → t0에서 5초씩 거꾸로 이어진 칸으로 가정 |

- [N, L] 배열은 앞쪽을 NaN으로 채워도 됩니다. hr·speed·grade가 모두 NaN인 앞 칸은 버립니다.
- canonical 행 DataFrame이 있으면 helper로 batch를 만들 수 있습니다.
  - `session_from_frame()`: canonical 행 → 세션 dict
  - `query_batch_from_session(session, t0_list)`: 세션 dict → batch. t0 뒤 행은 batch에 들어가지 않습니다.
- 넣지 않는 값(키 자체가 없음): t0 이후 실제 HR, 미래 HR 통계, 세션 전체 평균, 세션 최종 거리·시간.

### 모델 내부 입력 (predictor가 위 batch에서 계산)

| 묶음 | 내용 | 단위 / 스케일 |
| --- | --- | --- |
| 과거 토큰 24개 | t0-115초 ~ t0 (5초 칸): HR, LOCF 여부, 속도, 수직 속도, 경과 시간 | `(hr-142)/22`, 0/1, m/s, `10×m/s`, `elapsed_s/1200` |
| 미래 토큰 24개 | t0+5초 ~ t0+120초 계획: 속도, 수직 속도, 경과 시간 (HR 없음) | m/s, `10×m/s`, `elapsed_s/1200` |
| HR0 | t0 칸 HR (과거 마지막 칸), 출력 기준점 | bpm |
| Personal4 | 4차원 (7장, 8장) | — |
| History8 | Support 세션 10초 행 ≤ 512개에서 계산한 8차원 | 행: `(hr-142)/22, elapsed/1200, speed, v_speed, log1p(경과 일수)` |
| Session Context | 10개 (4장) | Train mean/std 정규화, ±5 clip |

## 4. Session Context feature

- **범위**: 이번 세션의 첫 칸 ~ t0 칸(포함), 세션 안 모든 segment. t0 이후 칸과 세션 전체 값은 쓰지 않습니다.
- 코드: `ptv2/session_context.py` (`window_summaries`), 버전 `session_context_v1`.

| # | feature | 단위 | 계산 행 | 의미 |
| --- | --- | --- | --- | --- |
| 1 | `hr_mean` | bpm | HR 유효 칸 | 이번 세션 평균 HR 수준 |
| 2 | `hr_std` | bpm | HR 유효 칸 | HR 변동 폭 |
| 3 | `hr_min` | bpm | HR 유효 칸 (누적 최소) | 워밍업 바닥 / 회복 수준 |
| 4 | `hr_max` | bpm | HR 유효 칸 (누적 최대) | 지금까지 최고 강도 |
| 5 | `speed_mean` | m/s | 속도·경사 유효 칸 | 평균 페이스 |
| 6 | `speed_std` | m/s | 속도·경사 유효 칸 | 페이스 변동 |
| 7 | `vspeed_mean` | m/s | 속도·경사 유효 칸 | 수직 속도 평균 (오르막/내리막 경향) |
| 8 | `vspeed_std` | m/s | 속도·경사 유효 칸 | 지형 기복 |
| 9 | `hr_slope_per_min` | bpm/분 | HR 유효 칸 | 세션 첫 칸 기준 HR 추세 (OLS 기울기) |
| 10 | `speed_slope_per_min` | (m/s)/분 | 속도·경사 유효 칸 | 페이스 추세 |

- HR 유효 칸 = HR 유한값 & `hr_quality` GOOD/LOW. LOCF 칸도 포함하며, 과거 토큰과 같은 기준입니다.
- **결측**: 유효 칸이 0개인 feature는 frozen Train mean으로 채웁니다.
- **정규화**: 모델 안에서 `(x − mean) / std`를 계산한 뒤 ±5로 자릅니다.
  - mean/std는 V2 Train 전용 통계입니다.
  - 같은 값이 `artifacts/session_context_stats.json`과 checkpoint(`session_mean` / `session_std`) 두 곳에 있고, predictor가 load 때 둘이 같은지 확인합니다.

## 5. future_speed / future_grade

| key | shape | 단위 | 칸 |
| --- | --- | --- | --- |
| `future_speed` | [N, 24] | m/s | t0+5초, t0+10초, …, t0+120초 |
| `future_grade` | [N, 24] | % | 같은 칸 |

- 둘 다 NaN·Inf를 허용하지 않습니다 (ValueError).
- `future_grade`는 predictor 안에서 `speed · sin(atan(grade/100))`(수직 속도)로 바뀌어 들어갑니다.
- 후보 pace 비교: 같은 t0의 창을 후보 수만큼 반복하고, `future_speed` 행만 후보 계획으로 바꿉니다 (14장 예제).
- 미래 경사를 모르면 11장을 따릅니다.

## 6. Support personalization 방식

`p.personalize(support_sessions)`에 사용자 1명의 Support 세션을 list로 한 번에 넣습니다. 세션마다 dict 하나입니다.

| key | shape | 단위 | 필수 | 설명 |
| --- | --- | --- | --- | --- |
| `session_id` | str | — | 권장 | 같은 시작 시각일 때 정렬용 |
| `start_time_s` | float | UTC epoch 초 | ✔ | 세션 시작 시각 |
| `end_time_s` 또는 `duration_s` | float | 초 | ✔ | 끝난 세션만 History에 씀 |
| `elapsed_s` | [L] | 초 | ✔ | 5초 칸 경과 시간 (segment 안에서 5초 간격) |
| `segment_id` | [L] | — | 선택 | 없으면 0 |
| `hr` | [L] | bpm | ✔ | canonical `hr_bpm` (LOCF 값 포함) |
| `hr_is_filled` | [L] | bool | 권장 | LOCF 플래그 (NaN → True) |
| `speed` / `grade` | [L] | m/s / % | ✔ | `speed_mps` / `grade_observed_pct` |
| `hr_quality` / `speed_quality` / `grade_quality` | [L] | str 또는 bool | 권장 | GOOD·LOW만 유효 |

**Support 창 (학습 창 규칙 그대로)**

- 과거 24칸 HR·속도·경사가 유효하고, 미래 24칸 속도·경사가 유효하고, +30/+60/+120초 HR이 유효해야 합니다.
- t0는 30초 anchor이고, HR0는 측정값이거나 LOCF 10초 이하여야 합니다.
- 세션 시작 순 → 칸 순으로 정렬해 **처음 2,560개(= 20 × 128)** 만 씁니다.

**적응 설정**

- Personal4 1행을 population prior에서 시작해 Adam으로 적응합니다: lr 0.05, **20 update**, batch 128, grad clip 5.
- 손실 = 미래 24칸 HR L1 + 0.001·‖Personal4‖², `max_norm 5`.
- `ptv2/adapt.py`, `config/model_config.json`의 `adapt_config`와 같은 설정입니다.

**History 원천**

- 각 Support 세션의 10초 행을 씁니다: 각 segment 첫 칸부터 한 칸 건너 고르고, 그중 HR·속도·경사가 유효한 행만 남깁니다.
- Support 창의 History = 그 세션 시작 전에 끝난 다른 Support 세션들입니다.
- canonical DataFrame이 있으면 `session_from_frame(frame, start_time_s=..., end_time_s=...)`가 Support dict를 만들어 줍니다.

## 7. 개인화 시 실제로 바뀌는 값

| 바뀌는 것 | 바뀌지 않는 것 |
| --- | --- |
| ① **Personal4 1행 (4개 숫자)**: 공유 모델 복사본에서 이 1행만 적응 | 공유 Transformer·History encoder·head weight (load 때 digest 저장, personalize 후 `verify_shared_unchanged()`로 확인) |
| ② **History8 원천**: Support 세션의 10초 행 (메모리에 저장) | checkpoint 파일, `checkpoints/` 폴더 |
| | Query 예측: `predict()`는 읽기만 함, 앞선 Query는 다음 Query의 History에 안 들어감 |

- History8은 학습되는 값이 아닙니다. Query마다 고정 encoder가 History 원천(Query 시작 전에 끝난 Support 세션, 마지막 512행)에서 다시 계산합니다.
- 상태는 `Predictor` 객체 메모리에만 있습니다.
- 파일로 남기려면 `save_state(path)` / `load_state(path)`를 씁니다 (JSON). checkpoint 파일·폴더에는 쓰지 못하게 막혀 있습니다.

## 8. Personalization ON / OFF

| | Personal4 | History8 입력 | 과거 토큰 · Session Context · 미래 계획 |
| --- | --- | --- | --- |
| **ON**: `personalize()` 후 `predict(batch)` | Support로 적응한 값 | `session_start_s` 전에 끝난 Support 세션의 10초 행 | 사용 |
| **OFF**: `predict(batch, personalized=False)`, 또는 `personalize()` 전 / `reset()` 후의 `predict()` | population prior | no-history sentinel (`[1, 5]` 전부 −1) | 사용 |

- OFF에서도 현재 Query 세션의 t0 이전 causal 입력은 그대로 씁니다 (과거 24칸, 세션 시작~t0 Session Context).

## 9. Cold-start 기본 상태

Support가 없는 신규 사용자는 **OFF와 같은 계산**입니다 (`reset()` 직후, 또는 `personalize()`를 부르지 않은 상태).

| 항목 | 기본값 |
| --- | --- |
| Personal4 | population prior `[0.0342, 0.0092, −0.0467, −0.0026]` = Train 학습 피험자 549명의 Personal4 평균 (checkpoint `personal4_init`, load 때 다시 계산해 확인) |
| History8 | no-history sentinel에서 계산된 값 |
| Session Context | 현재 세션 시작~t0 값 (개인화와 무관) |

## 10. reset 방법

```python
p.reset()          # 사용자 상태 삭제 → population(= OFF = Cold-start) 상태
```

- 사용자 1명의 흐름은 `personalize(그 사람 Support)` → 그 사람 Query 창 전부 `predict()` → `reset()`입니다.
- `personalize()`도 부를 때마다 먼저 이전 상태를 버립니다. 그래도 다음 사용자 전에는 `reset()`을 부르세요.
- reset 후에는 Personal4가 prior, History는 없음, 출력은 population과 같습니다 (smoke test가 확인).

## 11. future grade를 모를 때

- 이 모델에는 학습된 grade 결측 정책이 없습니다. future-grade dropout이나 0-mask로 학습하지 않았습니다.
- 경로가 확정되지 않아 미래 경사를 모르면 `future_grade`에 **0.0(평지) 24칸을 명시**해서 넣습니다. 수직 속도 0, 즉 "평지 계획"과 같습니다.
- `future_grade`에 NaN을 넣으면 predictor가 ValueError를 냅니다. 결측 처리를 임의로 만들지 않기 위해서입니다.
- 과거·현재 경사(`grade`)는 관측값을 그대로 넣습니다.

## 12. 출력

`np.ndarray [N, 3]`, float64, bpm, **절대 HR** `[HR@30, HR@60, HR@120]`. t0 뒤 30·60·120초 값입니다.

## 13. Hugging Face checkpoint

모델 weight는 GitLab이 아니라 Hugging Face에서 관리합니다. **GitLab clone만으로는 checkpoint가 없습니다.**

| 항목 | 값 |
| --- | --- |
| Hugging Face repository URL | https://huggingface.co/AnSeongYun/runway-hr-predictor-transformer (**private**: 접근 권한이 있는 HF 계정 필요) |
| checkpoint 파일 | `ptv2_sessionctx_v1_seed1729_step130000.pt` (692,017 bytes) |
| SHA256 | `b1049b04905651886fe2eed9bd2b2ee77126997e8a4e1804992a5361f839c789` |
| format | `runway_hr_predictor_v1`, `torch.load(weights_only=True)`로 읽음 |
| seed | 1729 |
| step | 130,000 |
| Best Personalized Val Mean MAE | 2.7560 |

같은 정보가 `config/final_checkpoint.json`에 있고, smoke test는 받은 파일의 SHA256이 이 값과 같은지 확인합니다.

1. 위 repository에서 `ptv2_sessionctx_v1_seed1729_step130000.pt`를 내려받습니다. 저장 경로는 자유입니다 (예: `~/models/hr_transformer/`).
   - 브라우저: repository 페이지 → Files and versions → 파일 다운로드 (HF 로그인 상태).
   - 명령: 직접 링크 `https://huggingface.co/AnSeongYun/runway-hr-predictor-transformer/resolve/main/ptv2_sessionctx_v1_seed1729_step130000.pt` (private이라 HF read token 필요).
2. SHA256을 확인합니다. 위 값과 같아야 합니다.

   ```bash
   sha256sum ~/models/hr_transformer/ptv2_sessionctx_v1_seed1729_step130000.pt
   ```

3. 받은 경로를 `--checkpoint`(명령) 또는 `Predictor(경로)`(Python)로 넘깁니다. 기본 경로는 없습니다.

## 14. 실행 명령

명령은 이 폴더 안에서 실행합니다. `CKPT`는 13장에서 받은 파일 경로입니다.

```bash
pip install -r requirements.txt
```

```bash
CKPT=~/models/hr_transformer/ptv2_sessionctx_v1_seed1729_step130000.pt
```

```bash
python predictor.py --checkpoint "$CKPT"
```

checkpoint를 load하고 `ptv2` 코드 SHA·config·Session Context 통계가 일치하는지 확인한 뒤, 모델 요약(seed, step, 파라미터 수)을 출력합니다.

```bash
python smoke_test.py --checkpoint "$CKPT"
```

`--checkpoint`가 없거나 파일이 없으면 exit code 2로 끝납니다. 확인하는 항목은 아래와 같고, 모두 통과하면 마지막 줄에 `SMOKE OK`가 나옵니다.

1. checkpoint SHA256
2. load
3. 합성 Support → personalize
4. Query predict: `[N, 3]`, NaN·Inf 없음
5. read-only
6. OFF
7. reset 후 population 상태
8. 사용자 격리
9. 상태 저장
10. 입력 검증
11. future grade 0 입력
12. CPU 지연

옵션: `--device cuda`, `--threads 4`.

Python에서는 아래처럼 씁니다. `df_s`, `meta`, `df_q`, `q_start_s`는 테스트 데이터의 canonical 5초 행 DataFrame과 세션 메타 값입니다.

```python
import numpy as np
from predictor import Predictor, session_from_frame, query_batch_from_session

p = Predictor("/home/me/models/hr_transformer/ptv2_sessionctx_v1_seed1729_step130000.pt")   # HF에서 받은 경로, CPU
print(p.info["seed"], p.info["step"], p.checkpoint_sha256)   # 1729 130000 b1049b04...

# 사용자 A: Support → personalize
support = [session_from_frame(df_s, start_time_s=meta.start_s, end_time_s=meta.end_s) for df_s, meta in support_A]
p.personalize(support, user_id="A")

# Query: 같은 t0에서 pace 후보 5개
query = session_from_frame(df_q, start_time_s=q_start_s)
one = query_batch_from_session(query, [1200.0])                 # t0 = 1200초, 기록된 미래 속도·경사
batch = {k: (v * 5 if isinstance(v, list) else np.repeat(v, 5, axis=0)) for k, v in one.items()}
batch["future_speed"] = one["future_speed"] * np.array([0.9, 0.95, 1.0, 1.05, 1.1], np.float32)[:, None]

hr = p.predict(batch)                                            # ON:  [5, 3] = HR@30 / HR@60 / HR@120
hr_off = p.predict(batch, personalized=False)                   # OFF
hr_g0 = p.predict(dict(batch, future_grade=np.zeros((5, 24), np.float32)))   # 미래 경사 모름 (11장)

p.reset()                                                        # 다음 사용자 전에
```

## 15. 필요한 dependency

| 항목 | 값 |
| --- | --- |
| Python | 3.12 |
| 패키지 (`requirements.txt`) | `torch==2.14.1`, `numpy==2.5.2`, `pandas==3.1.0`, `pyarrow==26.0.0` |
| GPU | 필요 없음 (기본 `device="cpu"`) |

- CPU 전용 torch는 이렇게 설치합니다.

  ```bash
  pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
  ```

- `pyarrow`는 `ptv2` import 때 필요합니다. 추론 중에 parquet 파일을 읽지는 않습니다.
- 학습 환경(W&B, 학습 데이터)은 필요 없습니다.

## 16. Known issues

- **미래 경사를 모를 때 (11장)**: 0 입력은 "평지 계획"일 뿐, 학습된 결측 표현이 아닙니다. 경사를 알 때보다 정확도가 떨어질 수 있습니다.
- **미래 속도 조건 차이**: 학습 때 future speed는 기록된 실제 속도 궤적이었습니다.
  - 일정한 후보 pace(상수 24칸)는 학습 분포와 다릅니다.
  - pace 차이가 작으면 후보 간 HR 차이도 작게 나올 수 있습니다.
- **거부되는 창**: 아래 창은 학습 창 규칙에 없어서 ValueError로 거부하고 예측값을 만들지 않습니다. 호출 측에 대체 처리가 필요합니다.
  - 과거 24칸에 무효 HR·속도·경사가 있는 창
  - t0 앞 24칸 안에 segment 경계가 있는 창 (세션·segment 시작 후 첫 115초 포함)
- **`hr_is_filled`를 안 주면** 모든 칸을 측정값으로 봅니다. LOCF 칸 토큰과 Support HR0 정책에 영향을 주므로 canonical 값이 있으면 꼭 넣으세요.
- **`row_elapsed_s`를 안 주면** 끊김 없는 5초 칸으로 가정합니다. segment 사이에 시간 간격이 있으면 Session Context 기울기가 조금 달라집니다.
- **여러 계정이 묶인 사용자**: 넘겨받은 Support 전체를 한 사람으로 봅니다.
- **CPU 지연**: torch 스레드 수에 따라 다릅니다 (`--threads N`으로 고정).
- **checkpoint 형식**: predictor는 학습 checkpoint 원본 형식(`ptv2_stage3_ckpt_v1`)도 읽을 수 있지만, 그 형식은 `weights_only=False`가 필요합니다. 인계에는 13장의 파일만 쓰세요.
