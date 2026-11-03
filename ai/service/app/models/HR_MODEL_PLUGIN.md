# 팀원 HR 모델 끼우는 법 (HR_MODEL_PLUGIN)

러닝 중 AI03(`/v1/hr/predict`)·AI04(`/v1/pace/decide`)는 `app/models/base.py`의 `HRModel` 모양만 쓴다. GRU 대신(또는 GRU 다음에) 다른 HR 모델을 붙일 때 **서비스 코드를 고치지 않고** 환경변수로 끼운다.

## 1. 환경변수

| 이름 | 예 | 설명 |
| --- | --- | --- |
| `HR_MODEL_TYPE` | `pacebpm` | 모델 계열 이름(소문자). `gru`가 아니면 아래 플러그인이 필요 |
| `HR_MODEL_PLUGIN` | `pacebpm_adapter:load` | `모듈:팩토리`. 팩토리는 `load(settings) -> HRModel` |
| `HR_MODEL_PLUGIN_DIR` | `../workspace/<이름>/src` | 모듈을 찾을 폴더(상대 경로는 `ai/service/` 기준) |
| `HR_MODEL_PATH`, `HR_MODEL_SHA256`, `HR_DEVICE`, `TORCH_NUM_THREADS` | | 팩토리가 `settings`에서 그대로 읽어 쓰면 된다 |
| `MPC_MARGIN_TABLE_PATH` | `app/policy/data/margin_pacebpm.json` | **AI04에 필수.** 아래 4절 |

## 2. 모델이 지켜야 할 모양

```python
import numpy as np
from app.models.base import ModelInfo

class PaceBpmModel:
    info = ModelInfo(
        model_type="pacebpm",            # HR_MODEL_TYPE과 같아야 함
        model_version="pacebpm-<체크포인트 sha 앞 8자리>",
        window_sec=360,                  # 실제로 읽는 과거 길이(초)
        min_samples=1,                   # t0 구간에 필요한 최소 완전 칸 수(1 이상)
        missing_policy={"history": "...", "hr0": "...", "futureGrade": "..."},  # /v1/model-info에 그대로 노출
    )                                    # horizons_sec는 기본 (30, 60, 120) 그대로

    def predict(self, batch: dict) -> np.ndarray:   # → [N, 3]
        ...

def load(settings):
    return PaceBpmModel(...)
```

### 입력 `batch` (후보 N개를 묶은 dict, 5초 간격, 마지막 칸이 t0)

| 키 | 모양 | 단위·규칙 |
| --- | --- | --- |
| `hr` | `[N, L]` float32 | bpm. 빈 값 NaN. 마지막 칸(t0)은 서비스가 실측값 존재를 보장 |
| `speed` | `[N, L]` | m/s. 빈 값 NaN |
| `grade` | `[N, L]` | %. 빈 값 NaN. **자유러닝**(history 경사 전부 null)이고 `FREE_RUN_GRADE_POLICY`가 `unknown`/`flat0`이면 전부 0 |
| `segment` | `[N, L]` int 또는 `None` | 구간 번호. 주어지면 t0와 같은 구간만 쓰는 것이 기존 규칙 |
| `elapsed_s` | `[N]` | t0의 러닝 시작 후 경과 초 |
| `future_speed` | `[N, 24]` | 후보별 t0+5초~t0+120초 계획 속도(m/s), 빈 값 없음 |
| `future_grade` | `[N, 24]` | 후보별 미래 경사(%). 모르는 후보는 그 행 전체가 NaN (자유러닝이고 정책이 기본값 `flat0`이면 0, `unknown`이면 NaN) |
| `session_start_s` | `[N]` 또는 `None` | 러닝 시작 UTC epoch 초 |

L(과거 칸 수)은 요청마다 다르다(최대 `MAX_HISTORY`). 모델이 필요한 길이만 잘라 쓴다.

### 출력

- `np.ndarray` 모양 **`[N, 3]`**, 후보 순서 그대로, **절대 심박(bpm)** `[HR@30초, HR@60초, HR@120초]`.
- 모두 유한해야 한다. 아니면 API가 `500 PREDICTION_FAILED`를 낸다.
- 서비스는 sync 라우트를 스레드풀에서 부르므로 `predict`가 동시에 불릴 수 있다. 내부 상태를 바꾸면 GRU 어댑터처럼 lock을 건다.

## 3. 시작할 때 자동 확인 (`app/models/__init__.py: check_hr_model`)

`info`가 `ModelInfo`인지, `info.model_type == HR_MODEL_TYPE`, `horizons_sec == (30, 60, 120)`, `min_samples >= 1`, 그리고 합성 배치(N=2, L=12, 한 후보는 미래 경사 NaN)에서 유한한 `[2, 3]`을 내는지 본다. 실패하면 서비스가 모델 없이 뜨고 `/health`는 503을 반환한다(로그에 원인). **이것은 규격 확인이지 예측 품질 검증이 아니다.**

## 4. AI04(GRU+MPC 판단)에 쓰려면

MPC 정책은 모델 계열별 잔차 여유 표(`margin_<계열>.json`, 27칸: horizon 3 × 속도 방향 3 × 경사 3)를 쓴다. 표의 `model` 값 앞부분(`-` 앞)이 `HR_MODEL_TYPE`과 같아야 정책이 로드된다(`app/policy/__init__.py`). 표가 없거나 계열이 다르면 정책이 없어 AI04는 `503 MODEL_NOT_READY`, AI03만 동작한다. 표는 그 모델의 Val 잔차 분위수로 만들어야 한다(GRU 표 재사용 금지).

## 5. 아직 정해지지 않은 것 — 개인화

지금 `batch`에는 **사용자 식별자나 개인화 파라미터가 없다**(AI03/AI04 요청에 userId가 없고, GRU도 `personalized=False`로 예측). "페이스별 개인 bpm" 모델이 사용자별 값을 쓰려면 다음 중 하나를 팀이 정해야 한다.

1. 같은 러닝의 history만으로 그 자리에서 적응(계약 변경 없음).
2. 백엔드가 개인화 값을 요청에 실어 보냄 → AI03/AI04 요청 필드 추가(팀 API 계약 변경).
3. AI 서비스가 userId로 직접 조회 → 요청에 userId 추가 + DB 접근(인프라·보안 결정).

2·3은 계약 변경이므로 이 슬롯에는 넣지 않았다.

## 6. 끼운 뒤 확인 순서

1. `HR_MODEL_TYPE`/`HR_MODEL_PLUGIN`/`HR_MODEL_PLUGIN_DIR` 지정 후 서비스 시작 → `/health` UP, `/v1/model-info`의 `modelType`·`modelVersion` 확인.
2. `tests/test_hr_model_plugin.py`와 같은 방식으로 팩토리 단위 테스트 추가.
3. AI04까지 쓸 경우 그 모델 계열 여유 표를 `MPC_MARGIN_TABLE_PATH`로 지정하고 `/v1/pace/decide` 200 확인.
