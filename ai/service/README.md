# RunWay AI 추론 서버 (FastAPI)

HR 예측 모델의 추론 결과를 반환하는 **내부 API 서버**다. 앱이 직접 부르지 않고 **백엔드(Spring) 서버만** 부른다([ADR-0004](../../docs/adr/0004-python-fastapi-ai-service.md)).

- 현재 모델: GRU HR Predictor(M3-005 + M3-006, [`ai/workspace/doyeon/gru`](../workspace/doyeon/gru/README.md))
- 최종 모델은 11/3 HR Predictor 선발 테스트 뒤 확정한다. 모델은 `HR_MODEL_TYPE`으로 고르고, API 형식은 모델과 관계없이 같다.
- 이번 구성에는 사용자별 개인화가 없다. 모든 예측은 기본(population) 상태다.

## 요약 (배포용)

| 항목 | 값 |
| --- | --- |
| Python | 3.12 |
| 실행 위치 | `ai/service/` |
| 실행 명령 | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| 포트 | 8000 (`--port`로 변경) |
| 상태 확인 | `GET /health` → 200 `{"status":"UP"}`, 모델 로드 실패 시 503 |
| 의존성 | `requirements.txt` (테스트는 `requirements-dev.txt`) |
| 모델 파일 | `models/gru_final.pt` (Git에 없음, Hugging Face에서 받음) |
| 필요한 코드 | `ai/service/` + `ai/workspace/doyeon/gru/src/` (GRU predictor) |
| 비밀값 | 없음 |
| GPU | 필요 없음 (CPU 추론, 요청 1건 수~수십 ms) |

## 1. 설치

```bash
cd ai/service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

CPU 전용 서버·컨테이너는 torch CPU 빌드를 먼저 설치하면 용량이 작다.

```bash
pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
```

## 2. 모델 파일 준비

체크포인트는 Git에 넣지 않고 Hugging Face 공개 저장소에서 받는다.

| 항목 | 값 |
| --- | --- |
| 저장소 | `doyeonkoo/runway-hr-gru` |
| 파일 | `gru_final.pt` (4.8MB) |
| SHA256 | `db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe` |
| 둘 위치 | `ai/service/models/gru_final.pt` (`HR_MODEL_PATH`로 변경) |

```bash
curl -L -o models/gru_final.pt https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt
```

```bash
sha256sum models/gru_final.pt
```

`HR_MODEL_SHA256`을 설정하면 서버가 시작할 때 SHA256을 확인하고, 다르면 모델을 로드하지 않는다(`/health` 503).

## 3. 환경변수

모두 기본값이 있어 설정하지 않아도 로컬에서 실행된다. 예시는 [`.env.example`](.env.example). 상대 경로는 `ai/service/` 기준이다.

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `HR_MODEL_TYPE` | `gru` | 모델 종류 |
| `HR_MODEL_PATH` | `models/gru_final.pt` | 체크포인트 경로 |
| `HR_MODEL_SHA256` | (없음) | 주면 시작할 때 체크포인트 SHA256 확인 |
| `HR_GRU_SRC_DIR` | `../workspace/doyeon/gru/src` | GRU predictor 코드 폴더 |
| `HR_DEVICE` | `cpu` | `cpu` 또는 `cuda` |
| `TORCH_NUM_THREADS` | `4` | CPU 추론 스레드 수 |

## 4. 실행

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`.env` 파일로 환경변수를 주려면 `python-dotenv`를 설치하고(`requirements-dev.txt`에 포함) `--env-file .env`를 붙인다. 컨테이너에서는 환경변수로 직접 주입한다.

확인:

```bash
curl http://localhost:8000/health
```

API 문서(OpenAPI): `http://localhost:8000/docs`

## 5. Docker·CI 참고

- GRU predictor 코드가 `ai/workspace/doyeon/gru/src/`에 있어서, 이미지에 `ai/service/`와 이 폴더를 함께 넣어야 한다. 빌드 context를 `ai/`로 잡거나 두 폴더를 복사하고 `HR_GRU_SRC_DIR`을 이미지 안 경로로 지정한다. 모델이 확정되면 모델 코드를 `ai/service/` 안으로 옮길 예정이다.
- 모델 파일은 빌드할 때 Hugging Face에서 받거나 볼륨으로 넣는다. 공개 저장소라 토큰이 필요 없다.
- 서버 시작 시 모델을 한 번 로드한다(CPU 수 초). readiness는 `/health`가 200인지로 판단한다.
- 테스트: `pip install -r requirements-dev.txt` 후 `ai/service/`에서 `pytest`. 모델 파일이 없으면 실제 모델 테스트 1개는 건너뛴다.

## 6. API (내부, 초안)

백엔드 담당자와 확정하기 전의 초안이다. 필드 이름은 백엔드 API 명세처럼 camelCase이고 단위를 이름에 붙인다.

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버·모델 상태 |
| GET | `/v1/model-info` | 모델 버전, 필요한 입력(`requiredMetrics`), 과거 길이(`windowSec`), `minSamples`, 결측 처리(`missingPolicy`) |
| POST | `/v1/hr/predict` | pace 후보별 30·60·120초 뒤 심박 예측 |

### POST /v1/hr/predict

5초 간격. `history`의 마지막 칸이 t0(지금)이다. 모델은 t0와 같은 구간의 최근 6분(72칸)만 쓰므로 그보다 길게 보낼 필요는 없다(최대 1440칸).

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `elapsedSec` | number | O | t0의 러닝 시작 후 경과 시간(초) |
| `sessionStartedAt` | string (date-time, UTC) / null | | 러닝 시작 시각. 개인화 모델용(현재 GRU는 쓰지 않음) |
| `history.hrBpm` | (number / null)[] | O | 심박(bpm). 마지막 칸(t0) 필수 |
| `history.speedMps` | (number / null)[] | O | 속도(m/s) |
| `history.gradePct` | (number / null)[] | O | 경사(%) |
| `history.segmentId` | integer[] / null | | 칸별 구간 번호. 주면 t0와 같은 구간만 쓴다(권장) |
| `candidates[]` | object[] | O | pace 후보 1~20개 |
| `candidates[].futureSpeedMps` | number[24] | O | t0+5초 ~ t0+120초 속도 계획(m/s) |
| `candidates[].futureGradePct` | (number / null)[24] / null | | 같은 칸 경사(%). **모르면 null**(자유러닝) → 미래 경사 없이 학습한 모델로 예측. 0을 넣으면 "평지"로 본다 |

예시(`…`는 생략 표시이며 실제로는 `futureSpeedMps`·`futureGradePct`가 각 24칸이다):

```text
{
  "elapsedSec": 995,
  "sessionStartedAt": "2026-10-30T09:00:00Z",
  "history": {"hrBpm": [148, 149, null, 151], "speedMps": [3.0, 3.1, 3.0, 3.1], "gradePct": [0.5, 0.4, 0.6, 0.5], "segmentId": [0, 0, 0, 0]},
  "candidates": [
    {"futureSpeedMps": [3.0, 3.0, …], "futureGradePct": [0.5, 0.5, …]},
    {"futureSpeedMps": [3.2, 3.2, …], "futureGradePct": null}
  ]
}
```

응답 200:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `modelVersion` | string | 예측한 모델 버전 (추천 기록에 함께 저장 권장) |
| `horizonsSec` | integer[] | `[30, 60, 120]` |
| `predictions[].hrBpm` | number[3] | 후보 순서대로 `[HR@30, HR@60, HR@120]` 절대 심박(bpm) |
| `predictions[].futureGradeUsed` | boolean | 미래 경사를 읽은 모델로 예측했는지 |

```json
{"modelVersion": "gru-m3-005+m3-006-db59d414", "horizonsSec": [30, 60, 120],
 "predictions": [{"hrBpm": [152.1, 154.3, 156.8], "futureGradeUsed": true},
                 {"hrBpm": [153.0, 156.2, 159.4], "futureGradeUsed": false}]}
```

### 오류

본문은 백엔드 공통 오류 형태 `{code, message, details}`를 따른다. 건강 데이터 원본 값은 오류에 넣지 않는다.

| HTTP | code | 언제 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | JSON 형식·필수 필드·길이 불일치(history 칸 수, 미래 24칸)·음수 속도·후보 수 |
| 422 | `INPUT_INSUFFICIENT` | t0 심박이 없거나, t0와 같은 구간에 심박·속도·경사가 모두 있는 칸이 `minSamples`보다 적음. 가짜 값으로 채우지 않는다 |
| 503 | `MODEL_NOT_READY` | 모델 로드 실패·준비 전 |
| 500 | `PREDICTION_FAILED` | 모델 출력이 비정상(NaN 등) |

```json
{"code": "INPUT_INSUFFICIENT", "message": "t0 심박이 없습니다.",
 "details": {"fields": [{"name": "history.hrBpm", "reason": "마지막 칸(t0) 심박이 필요합니다"}]}}
```

### 확정이 필요한 것 (백엔드와 협의)

- 타임아웃: 백엔드가 기다릴 최대 시간(코칭 입력 20초 유효성 안에서)
- 개인화: 사용자별 개인화 API(`/v1/hr/personalize`)와 개인화 state 저장 위치
- 인증: 내부망 접근 제한만 쓸지, 서버 간 토큰을 둘지
- 후보 수·호출 주기 상한

## 7. 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `app/main.py` | FastAPI 앱, 엔드포인트, 오류 처리, 요청 → 모델 입력 변환 |
| `app/schemas.py` | 요청·응답 형식과 검증 |
| `app/config.py` | 환경변수 |
| `app/models/` | 모델 공통 모양(`base.py`)과 모델별 어댑터(`gru.py`). 모델 추가 시 `__init__.py`에 갈래 추가 |
| `tests/` | API 테스트 (가짜 모델 + 실제 GRU) |
| `models/` | 체크포인트 두는 곳 (Git 제외) |
