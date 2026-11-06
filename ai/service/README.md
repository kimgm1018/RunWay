# RunWay AI 추론 서버 (FastAPI)

RunWay AI 추론용 **내부 API 서버**다. 앱이 직접 부르지 않고 **백엔드(Spring) 서버만** 부른다([ADR-0004](../../docs/adr/0004-python-fastapi-ai-service.md)).

- 이 릴리스의 AI03·AI04 HR 예측은 팀 HF 저장소의 GRU M3-005 체크포인트를 사용한다.
- AI04 정책 v0.4.2(`mpc-v0.4.2`, 설정 파일 이름은 `policy_v03.json` 그대로)은 학습 심박 기준과 GRU의 2분 HR 예측을 사용한다. 요청 때만 ODE 남은 구간 forecast를 추가할 수 있다.
- AI05는 Planner v1, AI06은 ODE v2.1과 학습 심박 기준을 계산한다. GRU 개인 출력층은 MVP 기본값에서 계산하지 않는다.
- AI01 readiness는 GRU 기준이다. GRU가 준비되면 ODE 상태와 관계없이 200 (`UP`), GRU가 미준비면 503 (`DOWN`)이다. ODE 가용성은 `models.ode.status`의 `UP`/`DOWN`으로 따로 확인한다.
- AI07·AI08 시연 기능은 `DEMO_STREAM_ENABLED=false`가 기본이다. W07 GPS 표본은 AI07 SSE의 코스·고도 표시용 메모리 데이터로만 사용하며 서버 로그/파일에 저장하지 않는다.
- ODE 1차 epoch20 checkpoint는 Amendment 2보다 앞선 27개 summary feature 구조다. 서비스 로더는 이 27특징 구조만 불러온다(28특징 Amendment 2 코드는 MVP 패키지에서 뺐다).

전체 AI01~AI09 계약, N/O 합의 항목, DB 매핑은 [`docs/design/api/ai-service.md`](../../docs/design/api/ai-service.md)를 참고한다.

## 요약 (배포용)

| 항목 | 값 |
| --- | --- |
| Python | 3.12 |
| 실행 위치 | `ai/service/` |
| 실행 명령 | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| 포트 | 8000 (`--port`로 변경) |
| 상태 확인 | `GET /health` → GRU 준비 시 200 `UP` 및 `modelLoaded=true`, GRU 미준비 시 503 `DOWN` |
| 의존성 | `requirements.txt` (테스트는 `requirements-dev.txt`) |
| 모델 파일 | GRU·ODE weight, 통계, 평균 계획 묶음 (Git에 없음), 정책 설정 `app/policy/data/margin_gru.json` (Git 포함) |
| 필요한 코드 | `ai/service/` + `ai/workspace/doyeon/gru/src/` (GRU predictor) |
| 비밀값 | 모델 다운로드 때 HF 읽기 권한 `HF_TOKEN`이 필요하다. 서비스 실행 시 다운로드 토큰은 필요하지 않다. |
| 장치 | GRU는 CPU, ODE는 `ODEV21_DEVICE=cpu|cuda` (기본 `cpu`) |

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

모델 weight와 평균 묶음은 Git에 넣지 않는다. 기본 설치는 비공개 Hugging Face 저장소에서 네 파일을 모두 받는다.

| 항목 | 값 |
| --- | --- |
| 저장소 | `AnSeongYun/runway-hr-models` (비공개, 읽기 권한 필요) |
| revision | `e44028f7a5cebbed1070094f8e2a081a03c1f523` |
| 설치 파일 | GRU `models/gru_final.pt`; ODE·통계·평균 묶음 `models/ode/` |
| 다운로드 | `scripts/fetch_models.sh` (Linux) 또는 `scripts/fetch_models.ps1` (Windows) |

기본 HF 모드에서는 `HF_TOKEN`에 저장소 읽기 권한이 있어야 한다. 토큰은 환경변수로 주입하고 Jenkins에서는 credential binding을 사용한다. 스크립트는 토큰을 명령줄 인자·파일·로그에 남기지 않는다. 받은 각 파일은 임시 파일에서 SHA-256을 확인한 뒤 설치한다. 세부 경로와 SHA는 [`models/README.md`](models/README.md)를 참고한다.

예전 로컬 ODE 복사 방식은 `ODEV21_SOURCE_MODE=local`과 `ODEV21_SOURCE_CHECKPOINT`, `ODEV21_SOURCE_STATS`, `ODEV21_POPULATION_BUNDLE_SOURCE`로 선택할 수 있다. 이 모드에서 GRU는 예전 공개 주소를 사용한다. `GRU_MODEL_URL`을 지정하면 해당 URL을 사용하며 Authorization 헤더를 보내지 않는다.

`HR_MODEL_SHA256`을 설정하면 서버가 시작할 때 SHA256을 확인하고, 다르면 모델을 로드하지 않는다(`/health` 503).

ODE만 준비되지 않으면 `/health`는 팀 HEALTHCHECK 계약에 맞춰 `200`, `status: UP`, `modelLoaded: true`를 반환하고 `models.ode.status: DOWN`으로 ODE 미준비를 알린다. 이때 GRU 기반 AI03·AI04는 계속 사용할 수 있다. AI06은 기존대로 `503 MODEL_NOT_READY`이며, 계산 가능한 GRU 블록은 오류 응답에 함께 반환한다. 켜 둔 AI04 forecast도 `503 MODEL_NOT_READY`를 반환한다. AI05는 페이스 계획을 계속 반환하고 HR 미리보기를 생략하며 `ODE_MODEL_NOT_READY` warning을 붙인다.

## 3. 환경변수

배포 환경변수 예시는 [`infra/ai/.env.example`](../../infra/ai/.env.example). 런타임 상대 경로는 `ai/service/` 기준이다. 배포에서는 GRU·ODE SHA를 고정하고 `ODEV21_DEVICE=cpu`를 사용한다.
release_v4의 `infra/ai/compose.yaml`은 `ODE_PREVIEW_ENABLED`와 `DECIDE_FORECAST_ENABLED`를 앱에 전달하며 기본값은 `false`다. `deploy.sh`는 Compose를 `--env-file /dev/null`로 실행하므로 이 값과 ODE 파일/SHA는 배포 프로세스 환경에 export해야 한다. 운영 기본값은 두 기능 모두 OFF다.

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `RUNWAY_MODEL_HF_REPO` | `AnSeongYun/runway-hr-models` | 모델 다운로드 저장소. 필요하면 배포 환경에서 재정의한다 |
| `RUNWAY_MODEL_HF_REVISION` | `e44028f7a5cebbed1070094f8e2a081a03c1f523` | 모델 다운로드 고정 revision |
| `ODEV21_HF_DIR` | `ode_v21_speedcal_b_lam1` | ODE checkpoint·통계·평균 묶음이 있는 HF 폴더. 이전 base는 `ode_v21_stage1_base`. 다른 ODE checkpoint는 이 값과 revision·SHA 세 개(`ODEV21_CHECKPOINT_SHA256`, `ODEV21_SUMMARY_STATS_SHA256`, `ODEV21_POPULATION_BUNDLE_SHA256`)를 함께 바꿔 고른다 |
| `HF_TOKEN` | HF 모드에서 필수 | 비공개 저장소 읽기 권한. Jenkins credential로 주입하며 실제 값은 파일에 저장하지 않는다 |
| `ODEV21_SOURCE_MODE` | `hf` | `hf`는 네 파일을 HF에서 받으며 `local`은 ODE checkpoint·통계·평균 묶음을 로컬 경로에서 복사한다. `local`은 HF_TOKEN을 요구하지 않는다 |
| `ODEV21_SOURCE_CHECKPOINT` | (local 모드에서 필수) | 로컬 ODE checkpoint 원본 경로 |
| `ODEV21_SOURCE_STATS` | (local 모드에서 필수) | 로컬 ODE summary stats 원본 경로 |
| `ODEV21_POPULATION_BUNDLE_SOURCE` | (local 모드에서 필수) | 로컬 평균 묶음 원본 경로 |
| `GRU_MODEL_URL` | (없음) | 지정하면 GRU에 사용할 직접 URL. 호환용 override이며 Authorization 헤더를 보내지 않는다 |
| `GRU_MODEL_SHA256` | `db59d414…3887fe` | 다운로드한 GRU 파일 검증 기본값 |
| `HR_MODEL_TYPE` | `gru` | 모델 종류. gru 외 모델은 아래 플러그인 두 값과 같은 계열의 MPC 여유 표가 필요 ([`app/models/HR_MODEL_PLUGIN.md`](app/models/HR_MODEL_PLUGIN.md)) |
| `HR_MODEL_PLUGIN` | (없음) | gru 외 모델의 `모듈:팩토리`. 팩토리(settings)가 HRModel을 돌려주며 시작 시 `[N, 3]` 출력 규격을 확인 |
| `HR_MODEL_PLUGIN_DIR` | (없음) | 위 모듈을 찾을 폴더(sys.path 앞에 추가) |
| `AI_DB_URL` | (없음) | 개인 계획과 AI04 학습 기준 조회에 쓰는 PostgreSQL **읽기 전용** 접속 문자열. AI04 학습 기준 조회는 실패해도 일반화 기준으로 계속 판단한다(`HR_THRESHOLD_LOOKUP_UNAVAILABLE`). 값이 아예 없으면 설정상 DB 없음으로 보고 경고 없이 일반화 기준을 쓰며 시작 로그에만 한 번 남긴다. 개인 계획 DB 오류는 503이다. GRU 개인화 DB 조회는 스위치가 켜져 있고 DB 주소가 있을 때만 사용한다. 주소·비밀번호는 로그에 남기지 않는다. |
| `GRU_PERSONALIZATION_ENABLED` | `false` | AI06 GRU head 계산과 AI03/AI04 GRU 개인 출력층 사용 스위치. 꺼져 있으면 AI06은 head를 계산하지 않고 `null`과 `GRU_PERSONALIZATION_DISABLED`를 반환한다. AI03/AI04는 `userId`가 와도 조회·경고·호출별 로그 없이 기본 GRU로 예측하고 `hrPersonalized=false`만 돌려준다(시작 로그 한 번). 켰는데 DB 주소가 없거나 조회에 실패하면 `GRU_PERSONALIZATION_UNAVAILABLE` 등 경고를 붙인다. |
| `GRU_PERSONALIZATION_MAX_WINDOWS` | `2000` | GRU 개인화 학습에 사용할 최대 window 수. 최신 러닝부터 선택한다. 상한을 넘는 과거 window는 계산에서 빠져 결과가 달라질 수 있다. |
| `GRU_PERSONALIZATION_CACHE_TTL_SEC` | `300` | 사용자 GRU head 캐시 시간(초) |
| `GRU_PERSONALIZATION_EMPTY_CACHE_TTL_SEC` | `60` | 개인화 행 없음·테이블 없음 캐시 시간(초) |
| `GRU_PERSONALIZATION_CACHE_MAX_USERS` | `1024` | 메모리 캐시 최대 사용자 수 |
| `GRU_PERSONALIZATION_DB_TIMEOUT_MS` | `300` | 러닝 중 GRU head 조회의 풀 대기·SQL 제한 시간(ms) |
| `HEAVY_MAX_CONCURRENCY` | `1` | 계획 줄(AI05 `/v1/pace/plan`, AI09 `/v1/pace/personal-plan`)의 프로세스 동시 실행 수 |
| `HEAVY_PERSONALIZE_MAX_CONCURRENCY` | `1` | 개인화 줄(AI06 `/v1/hr/personalize`)의 동시 실행 수. 계획 줄과 따로라 개인화(약 25초)가 돌고 있어도 계획은 기다리지 않는다. 두 줄이 겹치면 메모리 최고치가 늘 수 있다 |
| `HEAVY_QUEUE_WAIT_SEC` | `30` | 무거운 요청이 자기 줄에서 기다릴 최대 시간(두 줄 공통). 넘으면 `503 AI_BUSY`와 `Retry-After`를 돌려준다 |
| `PERSONAL_PLAN_EXPERIMENTAL_ENABLED` | `false` | 개인 ODE 계획 실험 기능 |
| `PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN` | `true` | 첫 구간 과속 방지(출발 HR이 낮게 잡혀 첫 km가 탐색 최고 속도에 붙는 문제). 제약 없이 최적화한 뒤 첫 1 km가 나머지 구간 거리가중 평균 pace보다 빠르면 **첫 km만** 그 평균으로 올린다(나머지 그대로). 목표 시간이 있으면 같은 공통 배율로 완주시간을 맞추고 ODE로 다시 평가한다. 바뀌면 경고 `PLAN_FIRST_SEGMENT_CAPPED`. 부작용: 나머지가 오르막이면 첫 km도 그 평균까지 늦춘다 |
| `PERSONAL_PLAN_SEARCH_BUDGET_CELLS` | `70000` | 개인 계획 탐색 계산 예산(ODE 30초 rollout 칸 총수, 결정적). 넘을 긴 코스만 탐색을 줄이고(반복 축소 → 이웃 1 km 구간 묶음) 경고 `PLAN_SEARCH_BUDGET_LIMITED`. 기본값은 CPU 1스레드에서 42.195 km ≤10초, 10 km 이하는 도입 전과 같은 결과 |
| `PERSONAL_PLAN_SPEED_CALIB_SCALE` | `1.45` | AI09가 ODE에 넣는 속도만 `v' = v_ref + s·(v − v_ref)`로 바꾸는 속도 반응 보정 s. `1.0`이면 보정 전 계획과 bit 단위로 같고 러닝 기록도 읽지 않는다(되돌리기). 0 초과 3 이하가 아니면 시작 실패 |
| `PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS` | `3.4704` | 완료 러닝 기록이 없을 때 쓰는 v_ref(V2 Train 이동 속도 중앙값, m/s). 0.5~8.0 밖이면 시작 실패 |
| `FREE_RUN_GRADE_POLICY` | `flat0` | 자유러닝(history 경사 전부 null) 처리: `reject`(팀 기존 계약, 422) / `unknown` / `flat0`(0% 평지). 아래 "자유러닝 경사 처리" 참고 |
| `HR_MODEL_PATH` | `models/gru_final.pt` | 체크포인트 경로 |
| `HR_MODEL_SHA256` | (없음) | 주면 시작할 때 체크포인트 SHA256 확인 |
| `HR_GRU_SRC_DIR` | `../workspace/doyeon/gru/src` | GRU predictor 코드 폴더 |
| `HR_DEVICE` | `cpu` | `cpu` 또는 `cuda` |
| `TORCH_NUM_THREADS` | `1` | CPU 추론 스레드 수 |
| `MPC_MARGIN_TABLE_PATH` | `app/policy/data/margin_gru.json` | MPC 잔차 여유 표 |
| `ODEV21_CHECKPOINT_PATH` | `models/ode/ode_epoch_020.pt` | 앱 기본 경로. 배포(`infra/ai/.env.example`의 `/models/ode/ode_epoch_020.pt`)·`scripts/fetch_models.*`·test-artifacts와 같은 이름이다. env가 없고 이 파일이 없을 때만 예전 이름 `models/ode/model_epoch_020.pt`를 읽는다. 빈 값을 주면 ODE를 찾지 않는다. |
| `ODEV21_CHECKPOINT_SHA256` | `737334a7…50dee3b` | 시작 시 ODE SHA 검증. S15P31E105-402/406 속도 반응 미세조정 checkpoint(λ=1, 이전 base `ba767a64…b14061`) |
| `ODEV21_SUMMARY_STATS_PATH` | `models/ode/ode_summary_stats.json` | 앱 기본 경로. 배포(`/models/ode/ode_summary_stats.json`)와 같은 이름이다. env가 없고 이 파일이 없을 때만 예전 이름 `models/ode/summary_stats.json`을 읽는다. |
| `ODEV21_SUMMARY_STATS_SHA256` | `9251e04e…e4e066` | 시작 시 통계 SHA 검증 |
| `ODEV21_POPULATION_BUNDLE_PATH` | (없음) | 신규 사용자 평균 묶음 JSON(`population_bundle_v2train_median.json`). 다운로드 파일은 `models/ode/`에 설치한다. 비면 평균 계획 없음(503 `POPULATION_MEAN_MODEL_NOT_CONFIGURED`) |
| `ODEV21_POPULATION_BUNDLE_SHA256` | (런타임에서 설정) | 묶음 sha256. 다운로더 기본값은 `bb156848…06dcb6`(새 checkpoint의 Train p4 중앙값으로 다시 만든 묶음, 이전 `9dcb5f4c…7ef1`); 다르면 시작 실패. 묶음 `modelVersion`이 ODE runtime과 다르면 시작 실패 |
| `PERSONAL_PLAN_POPULATION_MODE` | `median_bundle` | 개인화 행이 없거나 `userId`가 생략된 경우: `median_bundle`(묶음 payload로 같은 ODE 계획, `AVERAGE_BASED`·`planSource=POPULATION_MEDIAN_ODE`) / `empty`(P4·history·요약을 비운 G0, `POPULATION_EMPTY_G0_ODE`) / `off`(기존 503). 사용자 ID가 없으면 사용자 HR 기준을 조회하지 않고 모집단 학습 기준을 쓴다. 정확도는 V2 Val에서 B_THS와 동률이라 우위를 주장하지 않는다 |
| `ODEV21_DEVICE` | `cpu` | ODE 장치 (`cpu` 또는 `cuda`) |
| `ODEV21_TORCH_THREADS` | `1` | ODE CPU 추론 스레드 수 |
| `ODEV21_PRERUN_FAST` | `true` | AI09 사전 계획 ODE 빠른 경로(`app/models/ode/prerun_fast.py`: 같은 shape·같은 입력 캐시, numpy 산술 + torch.pow 적분). 결과는 원래 경로와 bit 단위로 같고, 첫 요청에서 자가 검사가 다르면 스스로 꺼진다. `false`면 원래 경로 |
| `ODEV21_WARMUP_ENABLED` | `true` | ODE가 준비됐을 때 서버 시작 중 Adam 1단계를 실행해 첫 개인화 호출의 지연 import를 미리 끝냄 |
| `ODEV21_VALIDATED_HORIZON_SEC` | `5400` | ODE 검증 지평(초, 90분). AI02 보고값과 HR 미리보기 표시 범위. 근거: ODE v2.1 1차 base pre-run H*90, C60 vs B_THS_pers 승. **개인 계획에는 시간 상한이 없다**: 90분을 넘는 계획도 내고 경고 `ODE_BEYOND_VALIDATED_HORIZON`을 붙이며 응답 `validatedHorizonSec`=5400은 정보용이다(MVP 이식 후 점검·보완 예정). 계산 안전장치는 코스 45 km·1 km 구간 45개(넘으면 422 `INVALID_GOAL`) |
| `ODE_PREVIEW_ENABLED` | `false` | AI05 HR 미리보기 표시 여부 |
| `DECIDE_FORECAST_ENABLED` | `false` | AI04 ODE 완주 forecast 허용 여부 |
| `DEMO_STREAM_ENABLED` | `false` | AI07·AI08 시연 기능 |

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

- GRU predictor 코드는 기존 `ai/workspace/doyeon/gru/src/`를 빌드 이미지에 복사한다. Dockerfile의 build context는 저장소 루트다. ODE v2.1 서비스 코드는 `ai/service/app/models/ode/`에 vendored 되어 있다.
- 모델 파일은 `scripts/fetch_models.sh` 또는 `scripts/fetch_models.ps1`로 가져오고 SHA-256을 확인한다. weight·summary stats는 Git에 넣지 않는다.
- 서버 시작 시 GRU와 ODE를 한 번 로드한다. readiness는 GRU를 기준으로 한다. ODE가 없어도 GRU가 준비되면 `/health`는 200 `UP`, `modelLoaded=true`이며 `models.ode.status=DOWN`으로 표시한다. GRU가 준비되지 않으면 503 `DOWN`이다.
- 테스트: `pip install -r requirements-dev.txt` 후 `ai/service/`에서 `pytest`. GRU·ODE checkpoint가 없으면 실제 checkpoint 검증은 건너뛴다.

## 6. API (내부)

상세 필드 표는 [`docs/design/api/ai-service.md`](../../docs/design/api/ai-service.md)를 따른다. 이 파일의 예시는 AI 스켈레톤 호출법을 보여 주며, 팀 계약 정본은 GitLab `dev` 기준 API/ERD 문서다.

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버·모델 상태 |
| GET | `/v1/model-info` | GRU·ODE 버전, 필요한 입력(`requiredMetrics`), 과거 길이(`windowSec`), `minSamples`, ODE 검증 지평 |
| POST | `/v1/hr/predict` | pace 후보별 30·60·120초 뒤 심박 예측, 선택 `userId` GRU 개인화 |
| POST | `/v1/pace/decide` | 정책 v0.4.2 + GRU 판단, 선택 학습 HR 기준 조회, ODE forecast는 선택 |
| POST | `/v1/pace/plan` | Planner v1 출발 전 페이스 계획 |
| POST | `/v1/hr/personalize` | ODE summary u·History8·P4와 선택 GRU 출력층 개인화 |
| GET | `/v1/demo/sessions/{sessionRef}/events` | AI07 시연 SSE (`DEMO_STREAM_ENABLED=false` 기본) |
| POST | `/v1/demo/sessions/{sessionId}/batches` | AI08 W07 시연 입구 (`DEMO_STREAM_ENABLED=false` 기본) |

### release_v3 공유 계약 요약

- 서버 회원·코스·세션 ID는 논리 양수 int64다. 현재 API 모델은 JSON 정수를 사용하고 응답 ID도 정수로 반환한다. 기존 호환을 위해 ID 입력의 십진 숫자 문자열은 정수로 바꾸지만, 전체 BIGINT 범위의 JSON 숫자/문자열 전송 정책을 확정한 것은 아니다. 이번에 정렬한 AI04 Goal 및 AI05/AI06 숫자 필드는 JSON number만 받으며 숫자처럼 생긴 문자열을 허용하지 않는다. AI03의 기존 입력 검증은 변경하지 않았다.
- AI04/AI05 공개 `goalPreference`는 v0 값 `0.5`로 고정한다. 내부 MPC/Planner 실험은 `0..1` 범위를 유지한다.
- AI05 거리·시간 목표는 정수, 목표 페이스는 소수 둘째 자리까지다. 거리·시간·페이스 중 최대 두 값만 허용하며, 명시 목표거리는 `45000m` 이하이다. 의미상 잘못된 목표는 AI05에서 `422 INVALID_GOAL`, AI04의 입력 검증은 기존 분류대로 `400 VALIDATION_ERROR`다.
- AI04 거리·시간 필드는 JSON 정수만 받는다(정수값을 가진 JSON 실수도 거절). 거리·시간·페이스는 각각 양수, 목표 거리는 최대 `45000m`, 페이스는 소수 둘째 자리까지이며 전체 목표는 최대 두 개다. 부동소수점 계산으로 표현할 수 없는 큰 시간 정수는 임의의 제품 상한 없이 입력 검증 `400`으로 거절한다. DB `INTEGER` 상한을 API 계약으로 사용할지는 고려사항이다.
- AI06 응답 `userId`는 양수 int64 정수로 반환한다. 내부 ODE 모델의 문자열 key 경계에는 `str(userId)`로 변환한다.
- **MVP 이후 선택(C11):** AI03/AI04의 GRU 개인 출력층 적용. `userId`가 있어도 기본값에서는 GRU 개인 행을 읽지 않는다. AI04가 학습 HR 기준을 찾을 때는 `userId`를 사용할 수 있다.
- **MVP 이후 선택(C12):** AI06 응답의 `gruPersonalization` 저장. 기본 OFF에서는 출력층을 계산하지 않고 null과 `GRU_PERSONALIZATION_DISABLED`를 반환한다.
- **C13:** AI04 `context.hrReference`는 선택 입력으로 두고, 응답 `pacing`의 학습 HR 기준 필드와 함께 계약에 반영한다.
- 경사 필드는 API 경계마다 구분한다. AI03은 `gradePct`/`futureGradePct`, W07·AI05·AI06은 `gradePercent`를 유지한다.
- W07 batch가 균일한 5초 AI06 표본이나 AI06 품질 필드로 바로 쓸 수 있다고 보장하지 않는다. 재표본화·품질 변환은 backend와 합의하기 전 구현하지 않는다.
- AI03 오류 응답과 전역 오류 처리기는 변경하지 않았다. 팀 공통 `details={}`와 AI03의 `details:null` 허용 차이는 합의 사항이다.

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

예시(요청 가능한 JSON):

```text
{
  "elapsedSec": 995,
  "sessionStartedAt": "2026-10-30T09:00:00Z",
  "history": {"hrBpm": [148, 149, null, 151], "speedMps": [3.0, 3.1, 3.0, 3.1], "gradePct": [0.5, 0.4, 0.6, 0.5], "segmentId": [0, 0, 0, 0]},
  "candidates": [
    {"futureSpeedMps": [3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0], "futureGradePct": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]},
    {"futureSpeedMps": [3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2], "futureGradePct": null}
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
| 422 | `INPUT_INSUFFICIENT` | t0 심박이 없거나, t0와 같은 구간에 심박·속도·경사가 모두 있는 칸이 `minSamples`보다 적음. 가짜 값으로 채우지 않는다. 단 자유러닝(history 경사 전부 null)은 `FREE_RUN_GRADE_POLICY`가 `reject`가 아니면 경사 없이 심박·속도만 센다 |
| 503 | `MODEL_NOT_READY` | 모델 로드 실패·준비 전 |
| 500 | `PREDICTION_FAILED` | 모델 출력이 비정상(NaN 등) |

```json
{"code": "INPUT_INSUFFICIENT", "message": "t0 심박이 없습니다.",
 "details": {"fields": [{"name": "history.hrBpm", "reason": "마지막 칸(t0) 심박이 필요합니다"}]}}
```

### 자유러닝 경사 처리 (`FREE_RUN_GRADE_POLICY`, 기본값 `flat0`)

history의 `gradePct`가 **전부** null이면 자유러닝으로 본다(코스 러닝 중 일부 칸만 빈 경우는 기존 규칙 그대로 그 칸을 뺀다). GRU는 과거 경사를 항상 입력으로 읽으므로(경사 없는 M3-006도 *미래* 경사만 안 읽음) 자유러닝의 과거 경사는 모델 입력에서만 0%로 채운다.

| 값 | 과거 경사 | 미래 경사 null인 후보 | `futureGradeUsed` |
| --- | --- | --- | --- |
| `reject` | 채우지 않음 → 422 `INPUT_INSUFFICIENT` (팀 기존 계약) | — | — |
| `unknown` | 0%로 채움 | 그대로 null → 경사 없는 모델 M3-006 | `false` |
| `flat0` (**기본값**) | 0%로 채움 | 0% 평지로 채움 → 메인 모델 M3-005 | `true` |

자유러닝으로 처리하면 AI04는 `warnings`에, AI03은 JSON 계약을 바꾸지 않도록 응답 헤더 `X-RunWay-Warnings`에 `FREE_RUN_GRADE_POLICY_<값>_PROVISIONAL`, `FREE_RUN_HISTORY_GRADE_FILLED_0`을 넣는다. 코스 없이 달리면 거절하지 않고 0% 평지로 본다(사용자 확정 2026-11-02, 기본값 `flat0`). 이것은 팀 기존 README·테스트(경사 부족 시 422, 가짜 값 미사용)와 다른 **계약 변경**이라 팀에 알려야 한다. 기존 동작이 필요하면 `FREE_RUN_GRADE_POLICY=reject`, 경사 없는 모델을 쓰려면 `unknown`. 경고 이름 `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`은 그대로 둔다. 단, 계획이 있는 t0 한 칸 `PLAN_HOLD` 응답은 GRU 예측을 하지 않아 경사를 채우지 않으므로 이 두 경고를 붙이지 않는다(v6_8_1).

나중에 경사 가정·심박 가중(예: 0.2~0.25)을 실험해 고도화 예정(지금은 구현하지 않음).

### AI04 응답 시간과 동시 처리 (S15P31E105-440)

2026-11-05 측정. CPU 1개, uvicorn worker 1, 스레드 1, 실제 GRU(`db59d414`), 합성 데이터 기준이다.

| 조건 | 결과 |
| --- | --- |
| AI04 1회 | p50 12~20 ms, p99 14~27 ms. history 1~1440칸·plan 유무에 따른 차이는 거의 없음. 1칸 `PLAN_HOLD` 약 3 ms, 시작 뒤 첫 호출 약 55 ms |
| 5초 주기 AI04만 | 200명까지 p99 1초 이하, 약 250~300명부터 3초 초과 |
| AI09·AI06 연속 실행 동시 | AI04 50명 p99 0.58 s, 100명에서 1.1%가 3초 초과. AI09 3→7~11 s, AI06 27→53~78 s로 느려짐 |
| 메모리 RSS | 평소 330~400 MB, 과부하 최대 836 MB(한도 1 GiB) |
| AI06·AI09 단독 | AI06(30분 러닝 8회) 약 27 s, AI09(10 km) 약 3 s |
| DB 조회(스텁, 50명) | 정상 p99 74 ms / 쿼리 100 ms면 p50 3.98 s / DB 응답 없음이면 p50 12.0 s |

- 운영 기준은 컨테이너(1 vCPU)당 동시 러닝 50명이다.
- keep-alive 기본 5초가 5초 호출 주기와 겹쳐 드물게 연결이 끊긴다. `--timeout-keep-alive 15` 또는 백엔드 유휴 연결 정리 4초 이하로 대응한다.
- `app/bpm_lookup.py`의 `CachedDbBpmLookup`과 `app/hr_threshold_lookup.py`의 `CachedDbHrThresholdLookup`은 DB 호출 중 프로세스 공용 lock을 잡고 실패를 캐시하지 않아 DB 지연이 AI04 전체 지연이 된다. 수정 방향: DB 호출을 lock 밖으로, 세션 조회 캐시, 실패 30초 차단.

### 러닝 초반 계획 넘겨주기 (AI04)

출발 직후에는 GRU에 쓸 심박 기록이 거의 없어 예측 오차가 크다(출발 0초 MAE: GRU 33.9 bpm, ODE 8.0 bpm). 그래서 처음에는 사전 계획 pace를 따르고 점점 MPC로 넘긴다. 기준은 `context.activeSec`(t, 초)다.

| 구간 | 단계(`pacing.handoverPhase`) | 추천 pace |
| --- | --- | --- |
| t < `plan_hold_sec` (60) | `PLAN_HOLD`, w = 1 | 계획 pace에 가장 가까운 후보 |
| `plan_hold_sec` ≤ t < `plan_blend_end_sec` (180) | `PLAN_BLEND`, w = 1 − (t − 60)/120 | w × 계획 pace + (1 − w) × MPC pace에 가장 가까운 후보 |
| t ≥ `plan_blend_end_sec` | `MPC`, w = 0 | 기존 MPC 결과 그대로 |

- 계획 pace: `context.plan`과 목표가 있으면 지금 구간의 목표 pace(MPC `progress()`의 `pace_req`). 계획이 없거나(자유러닝) 목표에 닿을 수 없으면 `currentGuidePaceSecPerKm`(없으면 `anchorPaceSecPerKm`)를 유지한다.
- 심박이 먼저다. SAFETY(EASE_OFF)와 gate `SLOW_ONLY`는 MPC 결정을 그대로 쓴다. 그 밖에는 gate·`UPPER_OVER_ALLOW`·`HR_STALE`·`ACCEL_IN_HOLD`를 통과한 후보 안에서만 고른다.
- 결과는 늘 후보 5개(−10/−5/0/+5/+10) 중 하나다. 같은 거리면 느린 쪽. 계획이 고른 경우 `decision.reason`은 `PLAN_HOLD`/`PLAN_BLEND`다.
- `pacing.planWeight`에 w를 넣는다. 설정은 `app/policy/policy_v03.json`의 `plan_hold_sec`, `plan_blend_end_sec`(0 ≤ hold ≤ end). **`0, 0`이면 꺼짐**이고 응답·결정이 기존과 완전히 같다(`pacing`에 두 필드도 없음).
- 60/180초는 **잠정**이다. V2 Val 재생 평가로 조정 예정.

### 개인 계획 DB 조회 (`AI_DB_URL`)

`/v1/pace/personal-plan` 요청은 `{courseId, userId?, selectedGoal?}`만 받는다. 백엔드는 건강정보 동의 사용자에만 `userId`를 넣고, 철회·미동의 사용자는 생략한다. `userId`가 생략되거나 null이면 AI 서비스는 사용자 개인화·HR 기준을 조회하지 않고 평균 기반 계획(`USER_ID_NOT_PROVIDED`)을 반환한다. AI 서비스는 필요한 데이터를 직접 읽는다(`app/db_lookup.py`, SQL은 바인딩 파라미터만):

| 무엇 | 테이블·컬럼 | 비고 |
| --- | --- | --- |
| 코스 거리·경사 | `courses.distance`, `elevation_profile`, `status`, `updated_at` | ACTIVE만. 없거나 MERGED/BLOCKED면 404. 고도 형식은 [`COURSE_ELEVATION_PROFILE_PROPOSAL.md`](../../docs/design/db/proposals/COURSE_ELEVATION_PROFILE_PROPOSAL.md). 경사 찾는 순서는 아래 "코스 경사 출처" |
| 개인화·학습 심박 | `user_hr_personalization` 최신 `personalization_version` | **팀 DB에 없는 제안 테이블**. `userId`가 있는 동의 사용자만 조회한다. 행이 없거나 ID를 생략하면 모집단 학습 심박 기준으로 평균 묶음(`PERSONAL_PLAN_POPULATION_MODE`) 계획을 만든다. HR 강도 기준은 P85 지속 기준이며 출처는 `LEARNED_POPULATION`, `LEARNED_BLENDED`, `LEARNED_PERSONAL`이다. 테이블·컬럼이 아직 없으면 경고 `PERSONALIZATION_TABLE_MISSING`을 붙인다. 연결 실패·시간 초과는 503 `AI_DB_UNAVAILABLE` |
| 평소 이동 속도(v_ref) | `running_sessions.total_distance`, `moving_duration`, `elapsed_duration`, `status`, `deleted_at`, `ended_at` | `userId`가 있는 동의 사용자만, 속도 보정이 켜져 있을 때만 읽는다. 아래 "출발 전 계획 속도 보정". AI 읽기 계정의 `running_sessions` SELECT 권한은 AI CD의 `infra/ai/grant-readonly.sh`가 개인화 테이블 대기 전에 준다. 권한이 없거나 조회가 실패하면 계획을 막지 않고 Train 기본값과 경고 `SPEED_REF_LOOKUP_UNAVAILABLE`을 쓴다 |
| 제외한 입력 | `users.birth_date`, `daily_health_metrics.rhr_bpm` | AI는 두 값을 읽지 않는다. 나이 공식과 RHR·Karvonen 기준은 계산에서 제거했다. |

DB 오류·시간 초과는 503 `AI_DB_UNAVAILABLE`(원문 미노출).

### 출발 전 계획 속도 보정 (S15P31E105-402)

출발 전 계획이 실제 러닝보다 빨랐다. ODE가 같은 사람 안에서 빨리 달릴 때의 HR 상승을 실제보다 작게 보기 때문이다(V2 Val 속도→HR 기울기 비율 0.71). 그래서 AI09는 ODE에 넣는 속도만 바꾼다(`app/speed_calibration.py`).

- 식: `v' = v_ref + s·(v − v_ref)`, s=1.45(`PERSONAL_PLAN_SPEED_CALIB_SCALE`). v_ref 근처의 HR 수준은 그대로이고 속도 차이에 대한 HR 반응만 커진다. 탐색 범위 검사·출력 페이스·완주시간은 원래 v 기준이다. 바뀐 속도가 탐색 하한보다 낮아지면 하한에서 멈추고, 이미 하한보다 느린 칸은 낮추지 않는다.
- v_ref: 그 사용자의 `running_sessions` 중 `status='COMPLETED'`, `deleted_at IS NULL`, `ended_at` ≤ 계획 시각인 러닝을 `ended_at` 최근 순으로 최대 20회 골라 `total_distance / moving_duration`의 중앙값을 쓴다. `total_distance`·`moving_duration`이 0·NULL이거나 이동 속도가 0.5~8.0 m/s 밖이거나 2시간을 넘는 러닝은 뺀다(SQL `SPEED_REF_SQL`). 쓸 러닝이 없으면 `PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS`(3.4704)를 쓴다. 연구 하네스의 정의(출발 이전 최근 20회 거리÷이동 시간 중앙값)와 같다.
- 보정이 켜져 있으면 `warnings`에 `ODE_SPEED_CALIB_SCALE=1.45`와 `ODE_SPEED_REF_SOURCE=HISTORY|TRAIN_DEFAULT`가 붙는다.
- ODE checkpoint도 같은 사람 두 러닝의 평균 HR 차이를 맞추는 손실(λ=1)로 V2 Train 전체 미세조정한 것으로 바꿨다(S15P31E105-406 최종, SHA `737334a7…`, 구조·형식은 base와 같다). `modelVersion`은 `ode_v21_base_epoch20_legacy27:737334a7d77a`가 되고, 평균 묶음도 새 checkpoint로 다시 만들었다(P4만 다름). 이전 모델로 만든 개인화 행은 AI06을 다시 호출하기 전까지 평균 기반 계획을 받는다.
- 근거(V2 Val 161회/30명, 개인 목표 P5 기준 완주시간 절대 오차 평균): base 280.1초 → 보정층만 247.3초 → 새 checkpoint + 보정층 241.3초. 재생 HR MAE와 러닝 중 예측(R20)은 사전 등록 기준(+0.3 bpm) 안이다. V2 Test는 쓰지 않았다.
- 되돌리기: 보정층만 끄려면 `PERSONAL_PLAN_SPEED_CALIB_SCALE=1.0`(변환과 러닝 기록 조회를 모두 건너뛴다). 이전 checkpoint는 `RUNWAY_MODEL_HF_REVISION=11a3d0cce3062c84aa7ffee1740a93d204462190`, `ODEV21_HF_DIR=ode_v21_stage1_base`, `ODEV21_CHECKPOINT_SHA256=ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061`, `ODEV21_POPULATION_BUNDLE_SHA256=9dcb5f4c2aa7281de732b4a5fe64fb658f8acebc9f1b35389a71a7fe2b877ef1`로 다시 받는다(`SOURCES.json`의 `previousOde`).

### 학습 심박 기준

- 개인 위험 기준은 최근 러닝 GOOD 심박 분포의 P98, 개인 지속 기준은 P85다. `sessionStartedAt` 최신순으로 최대 20회를 고르고, 표본은 기존 ODE `hr_ref`와 같은 정수 반올림 nearest-rank 방식으로 계산한다. ODE의 `hr_ref`와 History8 입력 계산은 그대로 둔다.
- 모집단 P98은 175 bpm, P85는 163 bpm이다. 값은 `_inputs/population_hr_thresholds.json`의 중앙값이며 `policy_v03.json`에 반영했다(`provisional=false`).
- 개인 비중은 러닝 0~6회에서 각각 `0`, `0.25`, `0.50`, `0.75`, `0.90`, `1.00`, `1.00`이다. 섞은 값은 개인값×비중 + 모집단값×(1−비중)이다.
- **위험 기준 = 섞은 P98 + `hr_danger_offset_bpm`(정책 JSON, 기본 3 bpm).** +3은 섞은 **뒤에** 한 번만 더한다(사용자 확정). 그래서 일반화만 쓰면 위험 기준은 178이다. 지속 기준(섞은 P85)에는 더하지 않는다.
  - AI04 응답 `pacing.hrDangerBpm`은 +3까지 반영한 실제 판단 기준이다.
  - AI06 응답 `hrDangerBpm`과 DB `hr_danger_bpm`은 +3 전의 개인 P98 원값이다. AI04가 섞은 뒤 더하므로 백엔드는 그대로 저장한다(미리 더하면 두 번 더해진다).
- AI04 `context.hrReference`는 선택 입력이다. 예전 클라이언트가 보내면 계속 받지만 기준 계산에 쓰지 않고 `HR_REFERENCE_INPUT_IGNORED` 경고를 반환한다. 응답 `pacing`에는 `hrDangerBpm`, `hrSustainBpm`, `hrThresholdSource`(`POPULATION`/`BLENDED`/`PERSONAL`), `hrThresholdWeight`가 있다.
- `userId`가 있으면 최신 `user_hr_personalization` 행의 세 HR threshold 컬럼을 300초 캐시하고, 행 없음은 60초, DB 제한 시간은 300ms다. 조회 실패 시 일반화 값만 쓰고 `HR_THRESHOLD_LOOKUP_UNAVAILABLE` 경고를 반환하며 러닝 판단은 계속한다. `AI_DB_URL` 자체가 없으면(설정상 DB 없음) 경고 없이 일반화 값을 쓰고 시작 로그에만 한 번 남긴다. `AI_DB_URL`이 있는데 시작 연결이 실패한 경우는 조회 실패로 보고 경고를 붙인다.
- 마지막 400m에서는 안전 한계(SAFETY)를 위험 기준 + 정책 `final_stretch_extra_bpm`(기본 5 bpm)으로 올린다(일반화만 쓰면 178 + 5 = 183). 허용선(SLOW_ONLY gate)은 위험 기준 그대로다. 옛 정책의 "허용선 = hard, 안전 한계 = HRmax"에서 HRmax 자리만 바꾼 것이다.
- 계획이 있는 첫 요청은 t=0초부터 호출해도 된다. 한 칸 기록이면 GRU 예측 없이 `PLAN_HOLD` 계획 페이스를 돌려주고 `HISTORY_TOO_SHORT_PLAN_HOLD`를 붙인다. 이 응답에는 자유러닝 경고를 붙이지 않는다. 그 한 칸의 심박이 위험 기준 이상이면 SAFETY를 우선한다.
- 요청 `anchorPaceSecPerKm`에는 현재 러너에게 안내 중인 페이스를 넣는다. 실제 측정 페이스를 넣으면 후보 기준이 바뀌어 안내 페이스가 튈 수 있다.
- `EASE_OFF`·`OVERPACE` 같은 판단·경고가 15초마다 반복될 수 있으므로, 백엔드는 앱에 같은 안내를 반복 표시하지 않도록 권고한다.

**코스 경사 출처** (`DbCourseLookup.get_course`, 앞에서부터 처음 성공한 것을 쓴다)

| 순서 | `gradeSource` | 내용 |
| --- | --- | --- |
| 1 | `COURSE_STORED_GRADE` | 백엔드가 코스 저장 때 계산해 `courses.elevation_profile`에 넣은 100 m 경사 목록(`[{startDistanceM, endDistanceM, gradePercent}]`, S15P31E105-319). `ElevationProfileStoredGradeSource`가 같은 행에서 읽으며 `app/main.py`에서 켠다(S15P31E105-371). 모든 원소가 정확히 세 키·숫자 값이고, 0 m부터 끊김 없이, 450개 이하, 마지막 끝 = 코스 거리(±1 m)여야 쓴다. 아니면 다음 단계 |
| 2 | `COURSE_ELEVATION_PROFILE` | `courses.elevation_profile`이 예전 원시 고도 형식(숫자 배열 또는 `{distanceM, elevationM}`)이면 AI가 100 m 경사를 계산(호환 경로) |
| 3 | `ROUTE_ELEVATION_SOURCE` | GPS+DEM 자리(구현 없음) |
| 4 | `MISSING` | 0% 평지 한 구간. `FREE_RUN_GRADE_POLICY`를 따른다 |

저장 경사 구현은 `app/db_lookup.py`의 `ElevationProfileStoredGradeSource`이며 추가 SQL 없이 `COURSE_SQL` 결과 행을 변환한다.

### 러닝 중 GRU 개인화 (MVP 이후 선택)

- AI03 `/v1/hr/predict`와 AI04 `/v1/pace/decide`에 선택 최상위 `userId`를 둔다. AI04도 최상위에 두어 공통 요청 모델을 쓰고, `context`에는 세션 상태를 둔다. ID가 없으면 기존 예측·응답과 같고 개인화 경고도 없다.
- AI03은 요청에 `userId`가 있으면 응답에 `hrPersonalized`와 `hrPersonalizationVersion`을 포함한다. 경고는 기존 `X-RunWay-Warnings` 헤더에 쉼표로 붙인다. AI04는 같은 두 값을 최상위에 넣고 경고 코드를 `warnings[]`에 넣는다.
- AI06은 기존 ODE 필드를 유지하고 선택 블록 `gruPersonalization`을 더한다. `schemaVersion`은 `runway.gru.head.v1`; 모델 SHA-256, Support 러닝·채점 가능 window 수, `head.main`·`head.nograde`의 weight `[3,256]`와 bias `[3]`을 담는다. 채점할 window가 없으면 null과 `GRU_PERSONALIZATION_NO_SUPPORT_WINDOWS`를 반환한다. 백엔드가 ODE와 GRU 블록을 각각 저장한다.
- Support 품질은 ODE 규칙을 따른다. `CLEAN`·`USABLE_WITH_FLAGS` 러닝만 쓰고 `UNUSABLE`은 제외한다. 각 값은 finite이며 quality가 `GOOD` 또는 `LOW`일 때 유효하고 `MISSING`이면 비운다. 채점 정답은 측정 HR이고 `hrIsFilled=false`여야 한다. GRU predictor가 정답에 `GOOD`만 허용하므로 허용된 `LOW` HR은 입력 경계에서 `GOOD`으로 바꿔 ODE와 같은 채점 범위를 만든다.
- GRU 출력층은 Support로 계산하지만 predictor 기본 상태에는 넣지 않는다. 러닝 중에는 현재 체크포인트 SHA·스키마·head 모양·유한값이 모두 맞을 때만 요청 하나 동안 적용하고, 끝나면 기본 상태로 되돌린다.
- 개인화 조회 실패는 러닝 중 기본 GRU 예측을 막지 않는다. 경고: `GRU_PERSONALIZATION_NOT_FOUND`, `GRU_PERSONALIZATION_TABLE_MISSING`, `GRU_PERSONALIZATION_MODEL_MISMATCH`, `GRU_PERSONALIZATION_INVALID`, `GRU_PERSONALIZATION_UNAVAILABLE`. DB 오류가 503인 출발 전 개인 계획과 다르게, 러닝 중에는 안전 안내를 먼저 반환한다.
- `GRU_PERSONALIZATION_ENABLED=false`가 기본이다. MVP에서 GRU 개인화는 사용하지 않으며 C11·C12는 MVP 이후 선택 항목이다. 꺼져 있으면 위 경고는 붙지 않는다(조회 자체를 하지 않음). 위 경고는 켠 상태의 실패만 뜻한다.
- 현재 정책 버전은 `policy_v03.json`/`mpc-v0.4.2`이다. 응답 `decision.coachingLevel`(OK/CAUTION/DANGER)과 위험 감속 하한 11:07/km는 `docs/design/api/ai-service.md` "코칭 단계"를 따른다(S15P31E105-504). `PLAN_HOLD` 60초 → `PLAN_BLEND` 180초 → MPC 단계에서는 심박 안전 gate를 항상 적용한다.

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
| `examples/` | **옛 예시**(40분 상한 때 실제 실행 결과). `validatedHorizonSec: 2400`·"40분까지" 문구는 지금 동작(상한 없음, 90분 넘으면 경고)과 다르다 |
| `models/` | weight는 Git 제외, model README와 `.gitignore`는 Git 포함 |
| `app/policy/data/` | `margin_gru.json` 정책 설정 (Git 포함) |
