# API 명세 — AI 추론 서비스(백엔드 내부)

[API 명세 색인](README.md)으로 돌아가기.

| 항목 | 내용 |
| --- | --- |
| 관련 업무 | S15P31E105-337, Route 계약 초안 S15P31E105-370 |
| 구현 | AI01~09: `ai/service/`. Route는 별도 서비스이며 운영 HTTP 구현 전 |
| 상태 | 제안, 팀 확인 전 |
| 기준 dev | `a93cc17`, 2026-11-03 |
| 범위 | Spring 백엔드 → AI 서버 내부 계약. 클라이언트 공개 API 아님 |

내부 Spring 백엔드 전용 API다. GitLab API/ERD 계약이 정본이다. 브라우저와 모바일 앱은 AI 서버를 직접 호출하지 않는다.

코스 생성은 아래 [Route 내부 HTTP 계약 초안](#route-코스-생성-내부-http-계약-초안)을 따른다. Route는 [ADR-0019](../../adr/0019-course-generation-backend.md)에 따라 HR 추론 서비스와 **별도 Python 컨테이너**이며, AI01의 모델 상태·AI05/AI09의 경사 fallback·건강정보 동의에 따른 userId 전달 규칙을 Route에 적용하지 않는다. 기존 AI01~09 계약은 유지한다.

## 공통 규약

| 항목 | 규약 |
| --- | --- |
| Base path | `/` |
| Content-Type | `application/json; charset=utf-8` |
| 키·단위 | camelCase, 숫자 단위 접미사 사용. 거리 m, 시간 sec, 페이스 sec/km, 심박 bpm, 속도 m/s, 경사 % |
| 서버 엔티티 ID | 값이 있을 때 논리 양수 `int64`; API 모델과 응답은 정수형. AI09 `userId`는 생략 시 응답에서 null이다. 기존 클라이언트 호환을 위해 입력 십진 숫자 문자열도 현재 구현에서 정수로 변환하지만, 전체 BIGINT 범위의 JSON 숫자/문자열 wire 선택을 확정한 것은 아니다. 숫자 정밀도 보존은 클라이언트 확인 사항 |
| 시간 | UTC ISO 8601 (`Z` 또는 `+00:00`) |
| 호출 주체 | Spring 백엔드. 외부 앱은 백엔드만 호출 |
| 오류 | `{ "code": "...", "message": "...", "details": { ... } }`. 기존 AI03의 `details: null` 허용과 `details={}` 정규화는 전역 변경하지 않았으며 팀 합의 사항으로 남김 |
| 개인정보 로그 | HR·속도·경사·GPS 원본과 요청 본문을 로그로 남기지 않는다 |

### 건강정보 동의에 따른 사용자 ID 전달 (MR !142 리뷰 합의)

백엔드는 호출 직전 건강정보 동의 상태가 '동의'인 사용자만 AI 요청에 `userId`를 넣는다. 철회했거나 동의하지 않은 사용자는 `userId`를 생략한다. 생략 시 AI03·AI04는 개인화·학습 기준 대신 모집단 기준(위험 178 bpm / 지속 163 bpm)을 쓰고, AI09는 평균 기반 계획을 쓴다. 동의 상태는 백엔드 건강정보 동의 API(S15P31E105-250)의 응답을 기준으로 확인한다.

AI01 `/health`는 로드밸런서 probe를 위해 `{status, modelLoaded, modelVersion, models}`를 사용한다. readiness는 필수 모델인 GRU를 기준으로 하며 ODE 상태는 선택 기능의 가용성을 별도로 나타낸다. health 본문은 probe 전용 형식이므로 O11 합의 대상이다.

## AI01 — 준비 상태

`GET /health`

| 응답 필드 | 타입 | 설명 |
| --- | --- | --- |
| `status` | string | GRU 준비 시 HTTP 200 `UP`(ODE 상태와 무관); GRU 미준비 시 HTTP 503 `DOWN` |
| `modelLoaded` | boolean | 기존 계약 호환 필드. GRU 준비 상태 |
| `modelVersion` | string / null | GRU 버전 |
| `models.gru.status` | string | `UP` / `DOWN` |
| `models.gru.modelVersion` | string / null | GRU M3-005 버전 |
| `models.ode.status` | string | `UP` / `DOWN` |
| `models.ode.modelVersion` | string / null | ODE v2.1 variant와 checkpoint SHA 접두사 |

GRU가 준비되면 ODE가 미준비여도 HTTP 200과 `status=UP`, `modelLoaded=true`를 반환한다. ODE 준비 상태는 `models.ode.status`의 `UP`/`DOWN`으로만 알린다. GRU가 미준비이면 ODE 준비 여부와 관계없이 HTTP 503과 `status=DOWN`을 반환한다. 팀 AI 이미지의 HEALTHCHECK와 `infra/ai/check.sh`가 `status=UP` 및 `modelLoaded=true`를 요구하므로 ODE의 선택적 가용성을 전체 서비스 readiness와 분리한다.

## AI02 — 모델 정보

`GET /v1/model-info`

기존 GRU 필드(`modelType`, `modelVersion`, `stepSec`, `windowSec`, `futureSteps`, `horizonsSec`, `requiredMetrics`, `minSamples`, `missingPolicy`, `policyVersion`)를 유지하고 `models`에 GRU와 ODE 정보를 함께 반환한다.

| `models` 필드 | 타입 | 설명 |
| --- | --- | --- |
| `models.gru.status` | string | 준비 상태 |
| `models.gru.modelType` / `modelVersion` | string | `gru` / 실제 모델 버전 |
| `models.gru.horizonsSec` | integer[] | `[30, 60, 120]` |
| `models.gru.personalizationSupported` | boolean | main·nograde 출력층 개인화 지원 여부 |
| `models.gru.personalizationEnabled` | boolean | 스위치·DB·모델이 준비되어 러닝 중 개인화를 읽을 수 있는지 |
| `models.gru.personalizationSchemaVersion` | string | `runway.gru.head.v1` |
| `models.ode.status` | string | `UP` / `NOT_READY` |
| `models.ode.modelType` / `modelVersion` | string | `ODE-v2.1` / variant·SHA |
| `models.ode.variant` | string | 예: `ode_v21_base_epoch20_legacy27` |
| `models.ode.checkpointSha256` | string / null | checkpoint SHA-256 |
| `models.ode.summaryFeatureCount` | integer / null | 선택 checkpoint의 summary feature 수(현재 27) |
| `models.ode.hr0Head` | boolean / null | HR0 head 사용 여부 |
| `models.ode.device` | string / null | `cpu` 또는 `cuda` |
| `models.ode.validatedHorizonSec` | integer | AI05 HR 미리보기 표시 상한(초) |
| `models.ode.sampleIntervalSec` | integer | 30초 |
| `models.ode.horizonsSec` | integer[] | `[30,60,120]` 샘플 시점. 전체 표시 한계는 `validatedHorizonSec` |

`ODEV21_VALIDATED_HORIZON_SEC`가 AI02의 지평을 정한다. AI05는 같은 지평에서 HR 곡선을 자른다. 기본 5400초(90분, 근거: ODE v2.1 1차 base pre-run H*90, C60 vs B_THS_pers 승)이며 ODE_PREVIEW_ENABLED는 기본 `false`다.

### GRU 개인화 설정

| 환경변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GRU_PERSONALIZATION_ENABLED` | `false` | AI06 GRU head 계산과 AI03/AI04 GRU 개인 출력층 사용 스위치. 꺼져 있으면 AI06에서 head를 계산하지 않고 null과 `GRU_PERSONALIZATION_DISABLED`를 반환 |
| `GRU_PERSONALIZATION_MAX_WINDOWS` | `2000` | GRU 개인화에 사용할 최대 학습 window 수. 최신 러닝부터 고르며, 상한을 넘은 window는 결과에 반영되지 않음 |
| `AI_DB_URL` | (없음) | 읽기 전용 PostgreSQL 주소. 비면 AI03/AI04의 DB 개인화 조회는 자동 OFF이며, 개인 계획의 기존 503 동작은 유지 |
| `GRU_PERSONALIZATION_CACHE_TTL_SEC` | `300` | 사용자 head 캐시 시간 |
| `GRU_PERSONALIZATION_EMPTY_CACHE_TTL_SEC` | `60` | 행 없음·개인화 테이블 없음 캐시 시간 |
| `GRU_PERSONALIZATION_CACHE_MAX_USERS` | `1024` | 캐시 최대 사용자 수 |
| `GRU_PERSONALIZATION_DB_TIMEOUT_MS` | `300` | 러닝 중 DB 풀 대기와 statement timeout |

AI03/AI04는 DB head가 없거나 조회할 수 없으면 기본 GRU로 계속 예측하고 경고만 반환한다. 출발 전 개인 계획은 DB 장애를 기존처럼 503으로 반환한다.

## AI03 — 2분 HR 예측

`POST /v1/hr/predict` — GRU M3-005. 팀 README 계약을 유지한다.

| 요청 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `elapsedSec` | number | O | 러닝 시작 후 경과 초 |
| `sessionStartedAt` | string (UTC date-time) / null | X | 러닝 시작시각 |
| `userId` | integer (int64) / null | X | 선택. GRU 개인화 행을 찾을 회원 ID. C11 팀 합의 필요 |
| `history.hrBpm` | (number / null)[] | O | 5초 간격 HR, 마지막 항목은 현재 시점 t0 |
| `history.speedMps` | (number / null)[] | O | 5초 간격 속도 |
| `history.gradePct` | (number / null)[] | O | 5초 간격 경사. 모르면 null |
| `history.segmentId` | integer[] / null | X | 구간 경계 |
| `candidates[]` | object[1..20] | O | pace 후보 |
| `candidates[].futureSpeedMps` | number[24] | O | t0+5초부터 120초까지 속도 계획 |
| `candidates[].futureGradePct` | (number / null)[24] / null | X | 미래 경사. 미지 값은 null |

| 응답 필드 | 타입 | 설명 |
| --- | --- | --- |
| `modelVersion` | string | GRU 모델 버전 |
| `horizonsSec` | integer[3] | `[30, 60, 120]` |
| `predictions[].hrBpm` | number[3] | `[HR@30, HR@60, HR@120]` bpm |
| `predictions[].futureGradeUsed` | boolean | 미래 경사를 모델 입력에 사용했는지 |
| `hrPersonalized` | boolean | `userId`를 보내면 개인 출력층을 사용했는지. `userId`가 없으면 생략 |
| `hrPersonalizationVersion` | integer / null | 사용한 행 버전. 조회 실패면 null, `userId`가 없으면 생략 |

자유러닝에서 과거 또는 미래 경사 정보가 없으면 0% 평지로 계산하고 HTTP 200과 경고를 반환한다(MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`). AI03은 `X-RunWay-Warnings` 헤더에 `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`, `FREE_RUN_HISTORY_GRADE_FILLED_0`를 담는다. 후보별 `futureGradeUsed`는 미래 경사를 모델에 넣었는지 나타내며, flat0로 채운 경사를 사용한 경우 true다.

`userId`가 있고 개인화 조회가 실패하면 `X-RunWay-Warnings`에 경고 코드를 넣고 기본 GRU로 예측한다. GRU 개인화가 설정상 꺼져 있으면(`GRU_PERSONALIZATION_ENABLED=false`, 기본값) 조회하지 않고 경고도 붙이지 않으며 `hrPersonalized=false`만 돌려준다. 경고가 없고 ID가 없으면 기존 응답과 같다. 계약 회귀 예시는 기존 `ai/service/README.md` 본문 요청을 그대로 사용한다. 입력 부족은 과거값으로 채우지 않고 `422 INPUT_INSUFFICIENT`다.

## AI04 — 러닝 중 페이스 결정

`POST /v1/pace/decide` — 정책 v0.4.1(`mpc-v0.4.1`) + GRU. 매 요청은 후보 5개(`anchorPaceSecPerKm` 대비 −10, −5, 0, +5, +10 sec/km)다. AI04 timeout 기본 제안은 3초이며 백엔드는 timeout 뒤 같은 batch를 재시도하지 않고 새 W07 batch에서 판단한다.

- v0.4.1: HR 입력 지연 기준을 15초에서 20초로 바꿈(팀 명세 정렬, S15P31E105-413).

### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `elapsedSec` | number | O | 러닝 경과 sec. DB 정수 변환은 floor 제안 |
| `sessionStartedAt` | string (UTC date-time) / null | X | 세션 시작 시각 |
| `userId` | integer (int64) / null | X | 선택. AI03과 같은 최상위 위치의 회원 ID. C11 팀 합의 필요 |
| `history` | object | O | AI03과 같은 5초 간격 `hrBpm`, `speedMps`, `gradePct`, 선택 `segmentId` |
| `candidates[]` | object[5] | O | `paceSecPerKm`, `futureSpeedMps[24]`, `futureGradePct[24]` |
| `context.sessionId` | integer (int64) | O | 양수 DB 세션 ID |
| `context.stateVersion` | integer | O | 백엔드 세션 상태 버전 |
| `context.runState` | enum | O | `RUNNING` / `PAUSED` |
| `context.mode` | string | O | 러닝 mode. 팀 enum 합의 대기 |
| `context.goal` | object | O | 아래 거리·시간·페이스 필드를 포함하는 목표 객체 |
| `context.goal.targetDistanceM` | integer / null | O | JSON 정수만 허용. 설정하면 양수이며 최대 45000m |
| `context.goal.targetDurationSec` | integer / null | O | JSON 정수만 허용. 설정하면 양수이며 정책의 float 계산 범위를 벗어나면 400 검증 오류 |
| `context.goal.targetPaceSecPerKm` | number / null | O | JSON 정수 또는 실수. 설정하면 유한한 양수이며 소수 둘째 자리까지 |
| `context.goalPreference` | number (`0.5`) | O | v0 공개 API에서는 `0.5` 고정. 다른 값은 `400 VALIDATION_ERROR` |
| `context.plan[]` | object[] / null | X | `startM`, `endM`, `ratio` 구간 |
| `context.anchorPaceSecPerKm` | number | O | 후보 기준 페이스. 백엔드는 러너에게 지금 안내 중인 페이스를 보낸다. 실제 측정 페이스를 넣으면 추천이 튈 수 있다. |
| `context.currentGuidePaceSecPerKm` | number / null | X | 현재 안내 페이스 |
| `context.activeSec` | number | O | 일시정지를 제외한 경과 시간 |
| `context.distanceM` | number | O | 실측 누적 거리 |
| `context.routeProgressM` | number / null | X | 코스 누적 거리 |
| `context.inputAsOf` | string (UTC date-time) | O | 판단에 사용하는 최신 입력 시각 |
| `context.hrReference` | object / null | X | 이전 클라이언트 호환용. 보내도 나이·RHR·HRmax를 기준 계산에 쓰지 않으며 `HR_REFERENCE_INPUT_IGNORED` 경고를 반환한다. |
| `context.lastCoaching` | object / null | X | `coachingId` 양수 int64, `appliedAt` |
| `context.resumedAt` | string (UTC date-time) / null | X | 재개 시각 |
| `context.bpm` | object / null | X | 시험·시연용 목표 BPM 입력. 백엔드는 보내지 않는다(AI가 DB에서 직접 읽음). 보내면 DB를 읽지 않고 이 값을 쓴다. 아래 "목표 BPM (cueBpm)" 참고 |
| `context.bpm.records[]` | object[] (최대 2000) | X | 지난 러닝의 페이스가 일정한 60초 구간. `runNo`(정수 ≥ 1, 클수록 최근, 같은 러닝은 같은 값), `speedMps`(> 0), `cadenceSpm`(> 0), `cueBpm`(그 구간에 켜져 있던 BPM, 큐를 껐으면 null) |
| `context.bpm.firstMinute` | object / null | X | 이번 러닝 첫 1분의 페이스 일정 구간 평균. `speedMps`, `cadenceSpm`, `cueBpm`. 기록 없는 사용자만 쓴다 |
| `includeForecast` | boolean | X | ODE 남은 구간 HR·완주 예상 요청. 기본 false이며 서버 `DECIDE_FORECAST_ENABLED=false`이면 `forecast.status=DISABLED`. 기능이 켜져 있고 ODE 미준비이면 503 오류 |

`context.goal`의 거리·시간은 JSON integer, 페이스는 JSON integer 또는 실수다. 거리·시간에 정수처럼 보이는 실수(예: `5000.0`)도 허용하지 않는다. 숫자 문자열·boolean·비유한 페이스는 받지 않는다. 거리·시간·페이스 중 최대 두 값을 지정하고, 설정한 값은 모두 양수여야 하며 명시 거리 상한은 45000m다. 페이스는 소수 둘째 자리까지다. 시간은 임의의 제품 상한을 추가하지 않으며, 실제 float 계산으로 표현할 수 없는 정수는 정책 오류 500 대신 요청 검증 `400 VALIDATION_ERROR`로 돌린다. 팀 DB `INTEGER` 저장 범위와 API 범위를 같게 둘지는 별도 고려사항이다. 세 목표를 모두 보내거나 그 밖의 목표 검증에 실패하면 AI04의 기존 공개 요청 검증 분류인 `400 VALIDATION_ERROR`를 반환한다. 이는 AI05의 의미 오류 `422 INVALID_GOAL`과 별개다.

일반 예측 경로에서 `history.hrBpm` 마지막 항목은 t0 실측값이어야 한다. 계획이 있고 `activeSec < plan_hold_sec`일 때는 HR 값이 비어 있어도 t0 한 칸만으로 200 `PLAN_HOLD` 계획 페이스를 안내하며 `HISTORY_TOO_SHORT_PLAN_HOLD`를 붙인다. 이때 GRU 예측은 하지 않고 t0 HR이 위험 기준 이상이면 SAFETY를 우선한다. 계획이 없거나 넘겨주기 뒤에는 기존 422 입력 부족 계약을 따른다. 계획이 있다면 첫 AI04 요청은 t=0초부터 할 수 있다. 24개 미래 속도 표본은 5초 간격이다. 자유러닝의 미래 경사는 요청에서 null로 표현하고 AI 내부에서만 0%로 채운다. `futureGradeUsed` 및 경고에 변환 여부를 기록한다.

학습 심박 기준은 최근 `sessionStartedAt` 순서의 최대 20회에서 GOOD HR을 모아 계산한다. 위험 기준은 P98, 지속 기준은 P85이며, 기존 ODE `hr_ref`와 같은 정수 반올림 nearest-rank 방식을 쓴다. ODE의 `hr_ref`·History8 입력 계산은 바꾸지 않는다. `_inputs/population_hr_thresholds.json` 중앙값인 모집단 P98 175 bpm·P85 163 bpm과 개인값을 섞는다. 개인 비중은 러닝 수 0~5회 이상에서 `0`, `0.25`, `0.50`, `0.75`, `0.90`, `1.00`이고 6회 이상도 1.00이다. 섞은 값은 `개인값 × 비중 + 모집단값 × (1 − 비중)`이다.

- **위험 기준 = 섞은 P98 + 3 bpm**(정책 `hr_danger_offset_bpm`, 사용자 확정). +3은 섞은 **뒤에** 한 번만 더한다. 일반화만 쓰면 175 + 3 = **178**이다.
- **지속 기준 = 섞은 P85**(더하지 않음). 일반화만 쓰면 163이다.
- AI04 응답 `pacing.hrDangerBpm`은 +3까지 반영한 값이다. AI06 응답 `hrDangerBpm`·DB `hr_danger_bpm`은 +3 전 개인 P98 원값이다(저장할 때 더하지 않는다).

`userId`가 있으면 AI04는 최신 `user_hr_personalization` 행의 위험·지속 기준과 실제 사용 러닝 수를 읽는다. 결과 캐시는 300초, 행 없음은 60초, DB 제한 시간은 300ms다. 조회 실패는 일반화 값만 쓰고 경고를 붙이며 러닝 판단은 계속한다. 마지막 400m에는 안전 한계(SAFETY)를 위험 기준 + 정책 `final_stretch_extra_bpm`(기본 5 bpm, 일반화만 쓰면 183)까지 올린다. 허용선(SLOW_ONLY)은 위험 기준 그대로다.

### Response

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `traceId` | string / null | 시연용 추적 ID |
| `modelVersion` | string | GRU 버전 |
| `policyVersion` | string | 정책 버전 |
| `status` | string | 정책 결과 상태 |
| `gate` | string / null | 정책 gate |
| `publishSuggested` | boolean | 백엔드가 발행 판단을 이어갈지 |
| `decision` | object / null | 최종 `action`, `chosenIndex`, `recommendedPaceSecPerKm`, `cueBpm`, `predictedHr30Bpm`, `predictedHr60Bpm`, `predictedHr120Bpm`, `routeProgressM`, `basedOnStateVersion`, `expiresAt`, `reason`, `reasonText`. `cueBpm`은 `recommendedPaceSecPerKm`의 목표 BPM(60~220 정수)이며 `PLAN_HOLD`·`GUIDE_PACE`·`EASE_OFF`에 모두 넣는다. 계산하지 못하면 null과 경고 `CUE_BPM_UNAVAILABLE` |
| `candidates[]` | object[] | `paceSecPerKm`, `predHrBpm[3]`, `upperHrBpm[3]`, `passed`, `rejectReason`, `score` |
| `pacing` | object / null | `actualMinusGuideSecPerKm`, `etaSec`, `etaMinusGoalSec`, `hrDangerBpm`(섞은 P98 + 3), `hrSustainBpm`(섞은 P85), `hrThresholdSource`(`POPULATION`/`BLENDED`/`PERSONAL`), `hrThresholdWeight`. 선택: `handoverPhase`(`PLAN_HOLD`/`PLAN_BLEND`/`MPC`), `planWeight`(0~1). |
| `warnings[]` | string[] | 모델·정책 경고 |
| `forecast` | object / null | 요청 및 서버 설정으로 켰을 때 ODE v2.1 남은 거리, 완주 시각, HR 곡선 |
| `hrPersonalized` | boolean | 요청에 `userId`가 있을 때 개인 head 사용 여부 |
| `hrPersonalizationVersion` | integer / null | 적용한 개인화 행 버전. 적용하지 못했으면 null |

`EASE_OFF`·`WALK_ADVISED` 같은 경고가 15초마다 반복될 수 있으므로, 백엔드는 앱에 같은 안내를 반복 표시하지 않도록 권고한다.

`userId`가 없으면 위 두 선택 응답 필드는 생략한다. 사용자 ID가 있고 행이 없거나 사용할 수 없으면 기본 GRU로 계속 판단하고 `warnings[]`에 아래 코드 중 하나를 추가한다. 개인화 로드·적용 실패는 러닝 판단을 막지 않는다.

| 경고 코드 | 뜻 |
| --- | --- |
| `GRU_PERSONALIZATION_NOT_FOUND` | 사용자의 개인화 행 없음 |
| `GRU_PERSONALIZATION_TABLE_MISSING` | GRU 개인화 테이블·컬럼 없음(SQLSTATE 42P01·42703) |
| `GRU_PERSONALIZATION_MODEL_MISMATCH` | 스키마 버전 또는 모델 SHA 불일치 |
| `GRU_PERSONALIZATION_INVALID` | head 배열 모양 또는 값이 잘못됨 |
| `GRU_PERSONALIZATION_UNAVAILABLE` | 개인화를 켰는데(`GRU_PERSONALIZATION_ENABLED=true`) DB 주소 없음·연결·시간 초과·기타 개인화 조회/적용 실패 |

GRU 개인화가 설정상 꺼져 있으면(`GRU_PERSONALIZATION_ENABLED=false`, 기본값) `userId`가 있어도 조회하지 않고 위 경고와 호출별 로그를 내지 않는다. `hrPersonalized=false`, `hrPersonalizationVersion=null`만 돌려준다.

학습 심박 기준 조회도 같은 방식으로 나눈다. `AI_DB_URL`이 아예 없는 환경(설정상 DB 없음)에서는 경고 없이 일반화(모집단) 기준을 쓰고 시작 로그에만 한 번 남긴다. `AI_DB_URL`이 있는데 시작 연결이 실패했거나 조회가 실패하면 일반화 기준으로 계속 판단하고 `HR_THRESHOLD_LOOKUP_UNAVAILABLE`을 붙인다.

일반 예측 경로에서 자유러닝 경사 정보가 없으면 0% 평지로 계산하고 HTTP 200과 경고를 반환한다(MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`). AI04 응답 `warnings[]`에 `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`, `FREE_RUN_HISTORY_GRADE_FILLED_0`를 담는다. 계획이 있는 t0 한 칸 `PLAN_HOLD` 응답은 GRU 예측을 하지 않아 경사를 채우지 않으므로, history 경사가 비어 있어도 이 경고를 붙이지 않는다.

### 러닝 초반 계획 넘겨주기

`context.activeSec`가 `plan_hold_sec`(잠정 60초) 전이면 계획 pace를 유지하고(`PLAN_HOLD`), `plan_blend_end_sec`(잠정 180초)까지 계획 비중 w를 1→0으로 줄이며 MPC와 섞는다(`PLAN_BLEND`). 그 뒤는 기존 MPC다(`MPC`). 결과는 늘 후보 5개 중 하나(섞은 값에 가장 가까운 후보, 같으면 느린 쪽)이고, SAFETY와 심박 gate가 먼저다. 계획 pace는 `context.plan`과 `goal`로 구한 지금 구간 목표 pace이며, 계획이 없으면 현재 안내 pace를 유지한다. 단계는 `pacing.handoverPhase`, `pacing.planWeight`로 알린다. 60/180초는 V2 Val 재생 평가로 조정 예정(잠정)이다.

**고려사항(팀 합의 필요):** 백엔드가 AI04 호출 시 사전 계획 구간 비율(`context.plan`)과 예상 완주시간(`goal.targetDurationSec` = personal-plan `predictedFinishSec`, M-A)을 넘겨야 함. 넘기지 않으면 계획 유지 구간은 현재 안내 pace 유지로 동작한다.

### 목표 BPM (cueBpm)

AI04는 추천 페이스를 사용자의 목표 BPM으로 바꿔 `decision.cueBpm`에 넣는다. 계산은 `ai/bpm/target_bpm.py`를 그대로 쓰며(S15P31E105-416), 근거와 실험 결과는 `ai/bpm/README.md`에 있다.

사용자 기록은 백엔드가 보내지 않고 AI가 읽기 전용 DB(`AI_DB_URL`)에서 직접 만든다(S15P31E105-438, 백엔드 합의).

- 사용자 찾기: `context.sessionId`의 `running_sessions.user_id`.
- 지난 기록: 그 사용자의 완료 러닝(`COMPLETED`, 미삭제, 최근 종료 순 40회)의 `running_metric_samples`를 60초 칸(`elapsed_duration` 기준)으로 묶고, 속도 1.5 m/s 이상·케이던스 120~230 spm 측정만 쓴다. 측정 4개 이상, 속도 변동계수 5% 이하, 케이던스 표준편차 5 spm 이하인 칸만 페이스가 일정한 구간으로 본다.
- 그 구간의 BPM: `session_control_events`의 적용된(`APPLIED`) `SET_BPM`·`COACHING` `target_bpm`을 시간순으로 되짚는다. 러닝 시작 때 처음 튼 BPM은 DB에 남지 않으므로 첫 BPM 변경 전 구간과 구간 안에서 BPM이 바뀐 구간은 쓰지 않는다.
- 이번 러닝 첫 1분: 이번 세션의 첫 일정 구간. 아직 BPM을 바꾼 적이 없으면 `running_sessions.current_bpm`을 그때 BPM으로 본다.
- 캐시: 지난 기록은 사용자별 300초, 첫 1분은 찾으면 세션 동안 기억한다. DB 조회 제한 시간은 한 번에 300ms다.
- DB 권한: `runway_ai`는 `running_metric_samples`의 `running_session_id`·`measured_at`·`elapsed_duration`·`speed`·`cadence`, `session_control_events`의 `session_id`·`action`·`target_bpm`·`result`·`applied_at` 칸만 읽는다(`infra/ai/grant-readonly.sh`). 심박 등 다른 칸은 읽지 않는다.

보정 규칙:

- 기록이 있는 사용자(지난 기록에 쓸 구간이 있음): BPM을 따라간 구간(|케이던스 − 그때 BPM| ≤ 5)만 골라 최근 20회 러닝으로 보정한다. 첫 1분은 쓰지 않는다.
- 기록이 없는 사용자: 평균 보폭으로 계산한다. 첫 1분에 BPM을 따라갔으면 그 1분으로 보정하며, 보정 전보다 3 BPM 이상 차이 날 때만 바꾼다. 같은 세션에서는 같은 첫 1분을 쓰므로 보정이 반복·누적되지 않고, 목표 페이스가 바뀌어도 보정이 이어진다.
- 키는 계약에 없으므로 쓰지 않는다.
- `AI_DB_URL`이 없는 환경은 경고 없이 평균 보폭 BPM을 준다. `AI_DB_URL`이 있는데 시작 연결 또는 조회가 실패하면 평균 보폭 BPM과 `BPM_RECORDS_UNAVAILABLE` 경고를 준다.
- BPM 모듈을 불러오지 못하거나 계산에 실패하면 `cueBpm=null`, `warnings[]`에 `CUE_BPM_UNAVAILABLE`을 넣고 페이스 판단은 그대로 반환한다. 임의의 고정 BPM으로 채우지 않는다.

`context.bpm`은 시험·시연용이다. 요청에 있으면 DB를 읽지 않고 그 값을 쓴다. 예시(`context` 일부):

```json
"bpm": {
  "records": [
    {"runNo": 12, "speedMps": 2.85, "cadenceSpm": 166.0, "cueBpm": 165},
    {"runNo": 13, "speedMps": 3.05, "cadenceSpm": 171.5, "cueBpm": null}
  ],
  "firstMinute": null
}
```

BPM 적용 규칙(팀 합의 N7-2, S15P31E105-462):

- 적용 시점: 백엔드는 코칭을 발행할 때(`publishSuggested=true`)만 `cueBpm`을 워치에 적용한다. AI04는 5초마다 판단하지만, 발행되지 않은 판단의 `cueBpm`은 워치 BPM을 바꾸지 않는다.
- 작은 변화: AI는 같은 지난 기록·같은 추천 페이스면 같은 `cueBpm`을 주므로 따로 거르지 않는다. 안내 페이스가 바뀔 때만 BPM이 바뀐다. 기록이 없는 사용자는 첫 1분 보정이 정해질 때(3 BPM 이상 차이) 한 번 더 바뀔 수 있다.
- 합의 필요: 사용자가 직접 BPM을 바꾼 뒤 `cueBpm`으로 덮어쓸지, `cueBpm=null`일 때 처리(직전 BPM 유지 등).

계산 일치·DB 조회·실제 러닝 재생·끝값 검증은 S15P31E105-456(`ai/service/tests/test_cuebpm_integration.py`, `ai/service/tools/replay_cue_bpm.py`)에 있다.

### 오류

| HTTP·code | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 잘못된 요청 형식·후보 수·단위·범위 |
| `401 UNAUTHORIZED` / `403 FORBIDDEN` | 백엔드 내부 인증·권한 계약에서 처리 |
| `409 STALE_STATE` | 백엔드가 stateVersion 충돌로 판단 요청을 폐기하는 경우 |
| `422 INPUT_INSUFFICIENT` | t0 HR 또는 같은 코스 구간의 필수 HR·속도·경사 부족, 입력 20초 이상 오래됨 |
| `503 MODEL_NOT_READY` | GRU·정책 미준비, 또는 요청된 ODE forecast가 켜져 있지만 ODE 미준비 |
| `500 PREDICTION_FAILED` / `DECISION_FAILED` | 모델 추론·정책 실패 |

AI 서버는 AI04 판단 결과를 DB에 직접 쓰지 않는다. 발행·저장과 stateVersion 재검사는 백엔드가 맡는다.

## AI05 — 출발 전 페이스 계획

`POST /v1/pace/plan` — Planner v1 + ODE HR 미리보기. 입력의 `hr0Bpm`은 받지 않는다. 목표가 있는 코스/자유러닝은 `PLANNED`, 무목표 자유러닝은 `NOT_PROVIDED`다. HR 미리보기 기본은 OFF다.

### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `courseId` | integer (int64) / null | X | 서버 코스 ID |
| `gradeProfile[]` | object[≤450] / null | X | 코스 구간 `startDistanceM`, `endDistanceM`, `gradePercent`, 선택 `basePaceRatio` |
| `targetDistanceM` | integer / null | X | 명시 목표 거리 m. 양수, 최대 45000m |
| `targetDurationSec` | integer / null | X | 목표 시간 sec. 양수 |
| `targetPaceSecPerKm` | number / null | X | JSON integer 또는 실수. 목표 페이스 sec/km. 양수, 소수 둘째 자리까지 |
| `averagePaceSecPerKm` | number / null | X | JSON integer 또는 실수인 사용자 평소 페이스 |
| `goalPreference` | number (`0.5`) | X | v0 공개 API에서는 `0.5` 고정 |
| `userId` | integer (int64) / null | X | 양수 서버 회원 ID. 응답 ID는 정수 |
| `personalization` | object / null | X | 직전 AI06 결과를 사용하려면 `summaryU`, `history8`, `p4`, `hrRefBpm`, `hr0SubBpm` 전달 |
| `supportStartHrMedianBpm` | number / null | X | 1차 checkpoint의 HR0_sub 입력. 없으면 85 bpm |

요청에 HR0를 보낼 수 없다. 거리·시간·페이스 중 최대 두 값만 지정하며, 세 값을 모두 주면 값이 서로 맞더라도 `422 INVALID_GOAL`이다. 목표 거리는 양수이고 45000m 이하여야 한다. 시간도 양수여야 한다. 페이스가 소수 둘째 자리보다 정밀하면 `400 VALIDATION_ERROR`; 값의 조합이 불가능하거나 목표값이 0 이하이면 `422 INVALID_GOAL`이다. 거리·시간은 정수 필드다. AI05 숫자 필드는 JSON integer 또는 실수이며 boolean·숫자 문자열·비유한 수와 잘못된 자료형은 `400 VALIDATION_ERROR`다. 공개 AI05와 AI04의 `goalPreference`는 JSON 숫자 `0.5`만 허용한다. 내부 planner 실험 입력의 0~1 범위는 유지한다.

명시 `targetDistanceM`와 코스 `gradeProfile`의 길이는 별도 값이다. C01은 AI 경로 후보 생성이므로 DB 코스 검색 기준(`targetDistanceM` ±10%)은 더 이상 쓰지 않으며, 입력은 `distanceKm`이고 반환 후보의 `distanceM`은 요청 거리와 정확히 같다고 보장하지 않는다. 현재 AI05 코스 미리보기 구현은 명시 목표 거리와 코스 프로필 끝 거리가 1m 넘게 다르면 `422 INVALID_GOAL`을 반환한다. 세션 문서/C01은 이 동일성 규칙을 정하지 않으므로, 목표가 코스보다 짧거나 긴 경우 미리보기 범위를 어떻게 정할지 backend와 결정해야 한다. 이번 패키지는 코스 ID·검색 기준 거리·실제 코스 거리·목표 거리를 자동으로 같게 만들지 않는다.

45km 상한은 명시 목표 거리에 적용한다. 목표 거리를 생략한 46km 코스도 AI05의 현재 미리보기에서는 허용한다. S01/S08 저장 규칙상 목표 거리가 없고 코스가 45km를 넘으면 backend는 코스 전체를 pace plan 구간 하나로 저장한다. AI05의 더 상세한 `planStatus`, `segments`, `warnings`, `hrPreview` 미리보기 응답은 그대로 유지하며, AI05를 세션 응답이나 저장 결과로 간주하지 않는다.

현재 AI05 미리보기는 목표 입력만으로 기준 pace를 정할 수 없을 때 `averagePaceSecPerKm`로 계획을 만들 수 있다. S01/S08의 초기 저장 계획은 목표값/코스에서 기준을 얻지 못하면 `plan=null`이다. AI05 미리보기를 그대로 저장 계획으로 사용할지, 평소 pace 미리보기만 보일지는 별도 backend 연동 결정이다.

간단한 유효 요청 예 (숫자는 JSON integer):

```json
{"targetDistanceM": 5000, "targetDurationSec": 1650, "goalPreference": 0.5}
```

### Response

| 필드 | 타입 | 설명 / DB 대응 |
| --- | --- | --- |
| `plannerVersion` | string | Planner 구현 버전 |
| `mode` | enum | `COURSE`, `FREE_WITH_GOAL`, `FREE_NO_GOAL` |
| `planStatus` | enum | `PLANNED` / `NOT_PROVIDED` |
| `targetDistanceM` | number / null | 목표 거리 |
| `targetPaceSecPerKm` | number / null | 기준 페이스 |
| `targetPaceSource` | string / null | 기준 페이스 출처 |
| `goalPreference` | number | 적용된 선호도 |
| `recommendedPaceSecPerKm` | number / null | 평균 추천 페이스. `pace_plans.recommended_pace` |
| `cueBpm` | number / null | 현재 계산하지 않음. `pace_plans.cue_bpm`에 null |
| `routeProgressM` | number / null | 출발 전 null. `pace_plans.route_progress` |
| `predictedFinishSec` | integer / null | 페이스 계획 기준 예상 완주 sec |
| `segmentDifficultyRatios[]` | number[] | 코스 terrain-only 난이도 비율. 0m 기준 1km 구간 순서, 마지막은 남은 거리, 올림 개수(최대 45); 양수. 목표 성향과 무관하며 자유러닝은 빈 배열 |
| `segments[]` | object[] | 1km split. 필드 아래 참조 |
| `hrPreview` | object / null | 표시 상태·ODE 버전·검증 지평·30초 HR 곡선 |
| `warnings[]` | object[] | `code`, `message` |

| `segments[]` 필드 | 타입 | DB 대응 |
| --- | --- | --- |
| `segmentSequence` | integer | `pace_plan_segments.segment_sequence` |
| `startDistanceM` | number | `pace_plan_segments.start_distance` |
| `endDistanceM` | number | `pace_plan_segments.end_distance` |
| `recommendedPaceSecPerKm` | number | `pace_plan_segments.recommended_pace` |
| `ratio` | number | plan 설명용 비율. 저장 때 기준 pace를 곱해 절대 페이스를 사용 |
| `gradePercent` | number | AI 분석용 경사. 현재 ERD plan segment 컬럼에는 저장하지 않음 |

`pace_plans`의 행은 응답 plan 필드 1개에 대응하고, `pace_plan_segments`는 각 `segments[]` 항목과 1:1이다. `id`, `session_id`, `pace_plan_id`, `created_at`은 백엔드가 채운다. 변환 예시는 `app.planner.prerun_planner.to_db_rows()`를 참고한다.

### HR 미리보기 규칙

- AI02 `models.ode.validatedHorizonSec`까지만 `hrPreview.points[]`에 표시한다. 기본 설정은 5400초(90분), ODE_PREVIEW_ENABLED 기본 `false`다. 개인 계획(`/v1/pace/personal-plan`)은 이 값으로 계획을 막지 않는다. 예상 완주가 5400초를 넘으면 `warnings`에 `ODE_BEYOND_VALIDATED_HORIZON`을 붙인다.
- 선택된 1차 checkpoint에는 HR0 head가 없어 support 시작 HR 중앙값, 없으면 85 bpm을 HR0_sub로 쓴다.
- 검증 지평 밖 HR은 반환하지 않는다. 미리보기를 끄면 pace plan만 계산하며 예상 HR 목록은 빈 상태다.
- `ODE_PREVIEW_ENABLED=true`인데 ODE가 미준비면 HTTP 200으로 pace plan을 유지하고 `hrPreview.points=[]`로 둔다. 최상위 `warnings[]`에 `{code: "ODE_MODEL_NOT_READY", message: ...}`를 추가한다. ODE 미준비가 pace 계획 계산을 막지 않는다.

### 오류

`400 VALIDATION_ERROR` 잘못된 형식·구간·페이스 정밀도·boolean/숫자 문자열/비유한 숫자, `422 INVALID_GOAL` 양수·목표 개수·명시 목표 거리 상한·조합 검증, `500 PLAN_FAILED` 예상하지 못한 계획 계산 실패다. AI05 목표 도메인 오류는 `422`; AI04는 Pydantic 공개 요청 검증에서 같은 목표 규칙을 `400 VALIDATION_ERROR`로 반환한다. ODE 미리보기 미준비는 pace plan을 유지하는 경고이지 요청 오류가 아니다.

## AI06 — HR 개인화

`POST /v1/hr/personalize` — ODE v2.1. 백엔드가 동의·소유권을 확인한 완료 support session만 보낸다. 이 요청은 비동기화/재시도 없이 동기 계산한다는 패키지 기본값이며 작업 상태 저장은 백엔드가 결정한다.

W07 저장 기록으로 `sessions[]`를 만드는 방법(러닝 선택·5초 재표본화·결측·품질·`hrIsFilled`·`workoutQuality`·DEM 경사)은 [W07 → AI06 변환 규칙](w07-ai06-conversion.md)을 따른다.

### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `userId` | integer (int64) | O | 양수 서버 회원 ID |
| `sessions[]` | object[1..50] | O | 완료 support 러닝 |
| `sessions[].sessionId` | integer (int64) | O | 양수 서버 support 세션 ID |
| `sessions[].sessionStartedAt` | string (UTC date-time) | O | 세션 시작 |
| `sessions[].workoutQuality` | enum | O | `CLEAN`, `USABLE_WITH_FLAGS`, `UNUSABLE` |
| `sessions[].samples[]` | object[25..1441] | O | 5초 간격, 0초부터 시작 |
| `samples[].elapsedSec` | number | O | 세션 시작 후 경과 sec |
| `samples[].hrBpm` | number / null | O | 심박수 bpm |
| `samples[].speedMps` | number / null | O | 속도 m/s |
| `samples[].gradePercent` | number / null | O | 경사 % |
| `samples[].hrQuality`, `speedQuality`, `gradeQuality` | enum | O | `GOOD`, `LOW`, `MISSING` |
| `samples[].hrIsFilled` | boolean | O | 보간/채움 HR 여부 |

### Response

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `schemaVersion` | string | `runway.ode.personalization.v1` |
| `userId` | integer (int64) | 입력 서버 회원 ID. JSON 응답도 정수 |
| `modelVersion` | string | 적합한 ODE 모델·SHA 버전 |
| `createdAt` | string (UTC date-time) | 계산 시각 |
| `supportRunCount` | integer | 입력 지원 러닝 수 |
| `summaryU` | object | ODE 27 또는 28개 특성 이름별 값; 결측은 null |
| `hrRefBpm` | number / null | 과거 support의 HR reference |
| `history8` | number[≤512][5] | History8 입력 행 |
| `p4` | number[4] | support 데이터에 적합한 P4 |
| `hr0SubBpm` | number | support 시작 HR 중앙값, 없으면 85 |
| `warnings[]` | string[] | 입력 부족/적합 관련 안내 |
| `gruPersonalization` | object / null | 선택 GRU head 블록. C12 팀 합의 필요 |

`gruPersonalization` 필드:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `schemaVersion` | string | `runway.gru.head.v1` |
| `modelVersion` | string | 현재 GRU 모델 버전 |
| `modelSha256` | string (64자리) | 현재 GRU 체크포인트 SHA-256 |
| `supportRunCount` | integer | head 계산에 사용한 품질 적합 러닝 수 |
| `supportWindowCount` | integer | 채점 가능한 Support window 수 |
| `head.main.weight` / `head.nograde.weight` | float[3][256] | 고정 GRU 뒤 출력층 weight |
| `head.main.bias` / `head.nograde.bias` | float[3] | 출력층 bias |

AI06 응답에는 기존 ODE 필드와 함께 `hrDangerBpm`(개인 P98 원값, +3 전), `hrSustainBpm`(P85), `hrThresholdRunCount`(실제로 사용한 러닝 수, 최대 20)도 포함한다. `GRU_PERSONALIZATION_ENABLED=false`가 기본이다. 꺼져 있으면 GRU 출력층을 계산하지 않고 `gruPersonalization=null`, `GRU_PERSONALIZATION_DISABLED` 경고를 반환한다. 켜져 있을 때는 `GRU_PERSONALIZATION_MAX_WINDOWS`(기본 2000)에 따라 최신 러닝부터 학습 window를 고른다. 더 오래된 window가 상한에서 빠지면 결과가 달라질 수 있다.

채점 가능한 window가 없으면 `gruPersonalization=null`과 `GRU_PERSONALIZATION_NO_SUPPORT_WINDOWS` 경고를 반환한다. Support 품질은 ODE와 같이 `GOOD`·`LOW`를 유효값, `MISSING`을 결측으로 본다. `UNUSABLE` 러닝은 제외하며 채점 HR은 `hrIsFilled=false`여야 한다. GRU predictor의 평가 mask에 맞춰 허용된 `LOW` HR을 `GOOD`으로 변환한다.

`userId`와 `sessions[].sessionId`는 양수 int64 서버 ID이며 응답의 `userId`도 정수다. legacy 호환용 ID 십진 문자열 입력은 현재 코드에서 정수로 정규화하지만, 그 외 새 AI04/AI05/AI06 숫자 필드는 JSON integer 또는 실수만 허용한다. 팀 전체 BIGINT wire 정책을 정한 것은 아니다. API03의 `history.gradePct`/`futureGradePct`는 유지한다. W07·AI05·AI06의 `gradePercent`는 별도 경계 필드다.

AI06은 `elapsedSec=0`부터 중복 없는 5초 격자 표본을 요구한다. 최신 GitLab W07은 최대 5초 단위 batch 수집을 뜻할 뿐, 각 항목이 균일한 5초 격자이거나 AI06 품질 필드가 같은 뜻이라는 보장은 아니다. 그래서 W07 payload를 그대로 AI06 요청으로 전달할 수 없다. 재표본화·결측·품질 변환은 [W07 → AI06 변환 규칙](w07-ai06-conversion.md)을 따른다(S15P31E105-411). 같은 문서 7절의 열린 질문은 백엔드(S15P31E105-410)와 합의해 확정한다.

ODE 오류 상태 코드는 유지한다. ODE가 준비되지 않았거나 입력·계산이 실패해도 이미 계산한 `gruPersonalization` 블록은 오류 응답에 포함한다. 원본 샘플은 요청 종료 뒤 저장하지 않는다. 백엔드가 ODE와 GRU 블록을 각각 `user_hr_personalization`과 `user_gru_personalization`에 저장하는 방식을 합의한다.

## AI07 — 시연 SSE

`GET /v1/demo/sessions/{sessionRef}/events` — `DEMO_STREAM_ENABLED=false` 기본. 시연 때만 켠다.

| 항목 | 규약 |
| --- | --- |
| 인증 | `Authorization: Bearer <view token>`. query token 거절 |
| 이벤트 | `SNAPSHOT`, `MPC_TRACE`, `COURSE_UPDATE`, `HEARTBEAT` |
| 코스 표시 | `SNAPSHOT.course`와 `COURSE_UPDATE.course`는 `{lengthM, points}` 형식이다. W07 `GPS_POINT.coordinates`와 `altitudeM`로 만든 메모리 내 경로이며, 각 point는 `[longitude, latitude, altitudeM|null, distanceM]`다. 고도 표본이 2개 미만이면 고도 단면은 비워 둔다. 새 W07 위치가 들어오면 `COURSE_UPDATE`로 열린 콘솔을 갱신한다. |
| 전송 | SSE, `Cache-Control: no-cache`, Nginx proxy buffering off |
| trace 전 연결 | 허용된 세션은 trace가 아직 없어도 연결할 수 있다. 이때 `SNAPSHOT.traces`는 빈 배열이며, 코스 데이터가 있으면 snapshot과 이후 `COURSE_UPDATE`로 표시한다. |
| 오류 | 공통 오류 body. 비활성화 503 `DEMO_DISABLED`, 인증 실패 401, 허용되지 않은/없는 세션 404, 429 연결 제한 |

## AI08 — W07 시연 batch 입구

`POST /v1/demo/sessions/{sessionId}/batches` — 시연 전용이며 기본 OFF. 운영 W07 저장 API를 대체하지 않는다.

| 항목 | 규약 |
| --- | --- |
| 인증 | `Authorization: Bearer <ingest token>`; query token 거절 |
| 요청 | W07 JSON batch와 idempotency key/payload hash. 샘플은 5초 간격 |
| 제한 | 본문 32KB, 세션별 초당 2요청 |
| 저장 | 메모리 buffer only. GPS 경로는 시연 화면용 trace/SNAPSHOT에만 포함하며 서버 로그나 녹화 파일로 저장하지 않는다. |
| 재시도 | 429 응답에 `Retry-After: 1`; 동일 ID·동일 본문만 허용 |
| 오류 | 공통 오류 body. 비활성화 503 `DEMO_DISABLED`, 인증 실패 401, 세션 없음 404, 제한 429 |

## AI09 — 개인 페이스 계획

`POST /v1/pace/personal-plan` — **팀 계약 제안**. 코드 기준으로 코스와 선택 목표에 대한 페이스 계획을 계산한다. AI 서비스가 DB를 직접 쓰지 않는다.

### Request Body

허용하는 최상위 입력은 필수 `courseId`와 선택 `userId`, `selectedGoal`뿐이다. 추가 필드는 `400 VALIDATION_ERROR`로 거절한다. `courseId`와 값이 있는 `userId`는 양수 int64이며, 현재 코드는 기존 호환을 위해 십진 숫자 문자열도 정수로 정규화한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `userId` | integer (int64) / null | X | 건강정보 동의 사용자만 보냄. 생략 또는 null이면 개인 데이터를 조회하지 않고 평균 기반 계획(`personalized=false`, `USER_ID_NOT_PROVIDED`)을 쓴다 |
| `courseId` | integer (int64) | O | 계획할 ACTIVE 코스 ID |
| `selectedGoal` | object / null | X | 선택 목표. 생략하면 코스 거리로 계획한다. 내부에 정의된 필드 외에는 허용하지 않는다 |
| `selectedGoal.targetDistanceM` | integer / null | X | 목표 거리(m). |
| `selectedGoal.targetDurationSec` | integer / null | X | 목표 완주 시간(초). |
| `selectedGoal.targetPaceSecPerKm` | number / null | X | 목표 페이스(초/km). |
| `selectedGoal.goalPreference` | number | X | 현재 공개값은 `0.5`로 고정한다. 생략 시 `0.5` |

### Response

`segments`는 1 km 단위와 마지막 잔여 거리로 나눈다. `paceSecPerKm`와 `paceRatio`는 소수 둘째 자리까지 반올림한다. `paceRatio`는 각 구간 페이스를 계획 전체의 거리 가중 평균 페이스로 나눈 값이다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `planStatus` | string | `EXPERIMENTAL` 또는 `AVERAGE_BASED` |
| `userId` | integer (int64) / null | 요청 사용자 ID. 요청에서 생략했으면 null |
| `courseId` | integer (int64) | 요청 코스 ID |
| `courseVersion` | string | 계획에 사용한 코스 버전 |
| `modelVersion` / `policyVersion` | string | 사용 모델·정책 버전 |
| `personalized` | boolean | 개인 ODE 경로는 true, 평균 기반 경로는 false |
| `planSource` | string | `PERSONAL_ODE_HR_BALANCE`, `POPULATION_MEDIAN_ODE`, `POPULATION_EMPTY_G0_ODE` 또는 모집단 계획의 출처 |
| `policyValidated` / `hr0Used` | boolean | 현재 응답은 두 값 모두 false |
| `hrReferenceBpm` / `hrReferenceSource` | number / string / null | 계획에 사용한 심박 기준과 출처 |
| `meanPredictedHrBpm` / `peakPredictedHrBpm` | number / null | ODE 개인 계획의 예측 평균·최고 심박 |
| `maxHrReferenceDeviationBpm` / `hrReferenceBandBpm` | number / null | 심박 기준에서 가장 벗어난 정도와 비교 band |
| `hrReferenceBandSatisfied` | boolean / null | 예측 구간이 심박 기준 band 안에 드는지 여부 |
| `hrReferenceValidated` | boolean | 심박 기준 예측의 검증 여부. 현재 실험 경로는 false |
| `paceSearchSupportScope` | string / null | 페이스 탐색 근거 범위 |
| `paceSearchGridStepMps` | number / null | 페이스 탐색 속도 격자 간격(m/s) |
| `paceSearchBoundaryHit` | boolean / null | 탐색 결과가 속도 범위 끝에 닿았는지 여부 |
| `personalizationBundleSha256` | string / null | 사용한 개인화·평균 묶음 checksum |
| `personalizationSupportCutoffAt` / `personalizationBundleCreatedAt` | string / null | 개인화 Support 데이터 기준 시각·묶음 생성 시각 |
| `odeCheckpointSha256` / `odeSummaryStatsSha256` | string / null | 사용한 ODE checkpoint·통계 checksum |
| `validatedHorizonSec` | number / null | ODE 검증 지평(초). 시간 상한은 아니며 초과 계획에는 경고를 붙인다 |
| `populationMeanPaceSecPerKm` | number / null | 모집단 평균 계획 페이스 |
| `populationSourceScope` / `populationDatasetVersion` | string / null | 모집단 계획 출처·dataset 버전 |
| `trainSubjectCount` / `trainRunCount` | integer / null | 평균 묶음에 사용한 학습자·러닝 수 |
| `courseProfileCoverage` | number / null | 모집단 계획의 코스 프로파일 coverage (0~1) |
| `targetDistanceM` | number | 계획 거리(m) |
| `targetPaceSecPerKm` | number | 목표 또는 거리 가중 계획 평균 페이스(초/km) |
| `predictedFinishSec` | integer | 반올림된 구간 페이스로 계산한 완주 시간(초) |
| `segments[]` | object[] | 구간별 계획 페이스 |
| `segments[].sequence` | integer | 1부터 시작하는 구간 순서 |
| `segments[].startDistanceM` / `endDistanceM` | number | 구간 시작·끝 거리(m) |
| `segments[].lengthM` | number | 구간 길이(m) |
| `segments[].paceSecPerKm` | number | 구간 페이스(초/km), 소수 둘째 자리 |
| `segments[].paceRatio` | number | 전체 거리 가중 평균 대비 구간 페이스 비율, 소수 둘째 자리 |
| `warnings[]` | string[] | 경고 코드와 provenance 값 |

`userId`가 생략되거나 null이면 AI09는 사용자 개인화와 사용자 HR 기준을 조회하지 않는다. 기존 신규 사용자와 같은 평균 기반 경로를 사용해 `userId=null`, `planStatus=AVERAGE_BASED`, `personalized=false`와 `USER_ID_NOT_PROVIDED`, `AVERAGE_BASED_RECOMMENDATION`, `PERSONALIZED=false` 경고를 반환한다. 개인화 행이 없는 동의 사용자도 `AVERAGE_BASED`와 `personalized=false`를 반환하지만 `USER_ID_NOT_PROVIDED`는 붙이지 않는다. 평균 경로의 실험 스위치, ODE 및 평균 묶음이 준비되지 않으면 기존 `503 PERSONAL_PLAN_NOT_READY`를 반환한다. 클라이언트는 평균 기반 계획을 개인화 완료로 표시하지 않는다.

코드에서 만드는 경고는 `USER_ID_NOT_PROVIDED`, `PERSONALIZATION_TABLE_MISSING`, `COURSE_GRADE_PROFILE_MISSING`, `FREE_RUN_GRADE_POLICY_<mode>_PROVISIONAL`, `ODE_GRADE_FILLED_0`, `FINAL_PARTIAL_30S_CELL_HR_HOLD_LAST_OBSERVED_SAMPLE`, `HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN`, `PACE_SEARCH_SUPPORT=<scope>`, `PACE_SEARCH_DOMAIN_BOUNDARY_HIT_BEST_EFFORT`, `ODE_BEYOND_VALIDATED_HORIZON`, `PLAN_SEARCH_BUDGET_LIMITED`, `PLAN_FIRST_SEGMENT_CAPPED`, `PACE_SEARCH_GRID_STEP_MPS=<value>`, `POLICY_UNVALIDATED_NO_SAFETY_CLAIM`, `PERSONALIZATION_SUPPORT_CUTOFF_NOT_PROVEN`, `HR0_NOT_MEASURED_SUPPORT_MEDIAN_USED`, `AVERAGE_BASED_RECOMMENDATION`, `PERSONALIZED=false`, `POPULATION_MODE=<mode>`, `TRAIN_SUBJECTS=<count>`, `TRAIN_RUNS=<count>`, `COURSE_PROFILE_COVERAGE=<value>`, `FITREC_RESEARCH_ONLY_NOT_FOR_PRODUCT_OR_REDISTRIBUTION`, `ODE_SPEED_CALIB_SCALE=<s>`, `ODE_SPEED_REF_SOURCE=HISTORY|TRAIN_DEFAULT`, `SPEED_REF_LOOKUP_UNAVAILABLE`, `TARGET_HR_CALIB_GLOBAL_RATIO=<g>`, `TARGET_HR_CALIB_K=<k>`, `TARGET_HR_CALIB_HISTORY_RUNS=<n>`, `TARGET_HR_HISTORY_LOOKUP_UNAVAILABLE`, `RUNNER_BASELINE_SOURCE=<DISTANCE_TIME|PACE|LEVEL_PRESET|LEVEL_FALLBACK>`, `RUNNER_BASELINE_KIND=<TYPED|LEVEL>`, `RUNNER_BASELINE_WEIGHT=<w>`, `RUNNER_BASELINE_PAST_RUNS=<n>`, `RUNNER_BASELINE_RECORD_IMPLAUSIBLE_LEVEL_USED`, `RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT`, `RUNNER_PROFILE_NOT_SET`, `RUNNER_PROFILE_INVALID`, `RUNNER_PROFILE_TABLE_MISSING`, `RUNNER_PROFILE_LOOKUP_UNAVAILABLE`, `RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE`이다. 경고는 해당 데이터·계획 경로에서만 붙는다.

**속도 반응 보정(S15P31E105-402).** 출발 전 계획이 실제 러닝보다 빨랐던 문제를 줄이기 위해 AI09는 ODE에 넣는 속도만 `v' = v_ref + s·(v − v_ref)`로 바꾼다(기본 s=1.45, `PERSONAL_PLAN_SPEED_CALIB_SCALE`). 요청·응답 필드는 바뀌지 않는다. 응답 페이스·완주시간과 탐색 범위 검사는 원래 속도 기준이다. v_ref는 동의 사용자의 `running_sessions`에서 계획 시각 이전에 끝난 완료 러닝 최근 20회의 `total_distance / moving_duration` 중앙값이며, 기록이 없거나 조회할 수 없으면 V2 Train 기본값 3.4704 m/s를 쓴다. 같은 변경에서 ODE checkpoint를 속도 반응 미세조정본(λ=1)으로 바꿔 `modelVersion`이 `ode_v21_base_epoch20_legacy27:737334a7d77a`가 된다. 이전 모델로 만든 개인화 행은 AI06을 다시 호출하기 전까지 평균 기반 계획을 받는다. V2 Val 완주시간 절대 오차는 평균 280.1초에서 241.3초로 줄었다. s=1.0이면 보정층만 꺼진다.

**신규 사용자 첫 계획 기준(S15P31E105-403).** 요청 형식은 바꾸지 않는다. `userId`가 있고 `selectedGoal`에 시간·pace 목표가 없으면 AI09는 `user_profiles`(U06·U07: `running_level`, `average_pace`, `distance`, `duraction`)를 읽어 초기 목표 완주시간을 정한다. 거리·시간이 있으면 그 기록을, pace만 있으면 수준 기준 거리(초급 3 km·중급 5 km·상급 10 km)를 그 pace로 달린 기록으로 보고 Riegel `T × (D_코스 / D_기록)^1.06`으로 코스 거리에 맞춘다. pace 3′00″–10′00″/km·거리 1–50 km·시간 5분–6시간 밖이면 수준 기준(3 km 20:00, 5 km 30:00, 10 km 55:00)으로 대체한다. 저장값이 수준 기준과 같으면(프론트가 수준 선택 때 미리 채운 값) "수준만"으로 본다. 목표 pace가 탐색 범위(1.7638–4.1272 m/s) 밖이면 경계로 자른다. ODE는 지금처럼 목표 없이 한 번만 풀어 완주시간 T_ode와 경사에 따른 구간 pace 모양을 얻는다. T = w·T_기준 + (1−w)·T_ode, w = k/(n+k)로 섞고, 구간 pace에 공통 배율 T/T_ode를 곱한다(목표 시간 경로와 같은 반올림·보존 규칙). n은 `running_sessions`에서 402 v_ref와 같은 조건(COMPLETED, 미삭제, 계획 시각 이전 종료, 2시간 이하, 이동 속도 0.5–8 m/s)을 통과한 지난 러닝 수이며 상한 없이 센다. n=0이면 기준 100%다. k는 기록 입력 5, 수준만 3이다(env `PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED`·`_K_LEVEL`). 사전 등록 1-SE 규칙은 기록 입력 20이었으나, fold 최저가 5–8이고 실제 입력은 검증에 쓴 실제 첫 러닝보다 덜 정확하다고 보아 사용자 결정으로 5로 바꿨다. 배율 조정 뒤 HR이 기준 band를 벗어나면 목표 경로처럼 막지 않고 `HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN`을 붙인다. V2 Val 판정은 보류(완주시간 개선 CI가 0 포함)였고 사용자 입력을 쓰는 제품 결정으로 채택했다. 프로필 조회 실패·없음은 기존 동작으로 계속하고 경고만 붙인다. `planStatus`·`personalized`·`planSource`는 바뀌지 않는다. `PERSONAL_PLAN_RUNNER_BASELINE_ENABLED=false`면 예전 동작이다.

경사 정보가 없으면 0% 평지로 계산하고 HTTP 200과 경고를 반환한다(MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`). AI09 응답 `warnings[]`에는 `COURSE_GRADE_PROFILE_MISSING`, `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`, `ODE_GRADE_FILLED_0`가 담긴다. 코스 러닝 경사 저장은 S15P31E105-319에서 처리하며, unknown 정책과 GPS 고도 활용은 MVP 이후 과제다.

### 설정

| 설정 | 역할 |
| --- | --- |
| `AI_DB_URL` | 읽기 전용 DB에서 ACTIVE 코스를 조회하고, `userId`가 있을 때만 사용자 개인화·학습 심박 기준을 조회한다. `userId`가 없으면 사용자 조회는 하지 않는다. 설정 또는 필요한 조회에 문제가 있으면 계획을 만들 수 없으며 해당 오류를 반환한다 |
| `PERSONAL_PLAN_EXPERIMENTAL_ENABLED` | 기본 `false`. ODE 개인 계획과 평균 묶음 계획 경로를 켠다 |
| `PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO` / `PERSONAL_PLAN_TARGET_HR_K` / `PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE` | 계획 목표 심박 보정(S15P31E105-377). 목표 = 비율 × P85 지속 기준. 비율은 일반화 값(기본 0.9422)과 개인 값(`running_sessions` 완료 러닝 최근 20회 `average_heart_rate` 중앙값 ÷ P85 × 배율 c, 기본 1.0126 = V2 Train에서 맞춘 평균 HR 정의 차이 보정)을 n/(n+k)(기본 k=5. 사전 등록 1-SE 값 20 대신 403 기록 입력 k=5에 맞춘 사용자 결정)로 섞고 0.80~1.05로 자른다. 지난 러닝이 없거나 조회에 실패하면 일반화 값만 쓴다(조회 실패 경고 `TARGET_HR_HISTORY_LOOKUP_UNAVAILABLE`). `GLOBAL_RATIO=1.0`, `K=inf`면 보정 전과 같다. 응답 경고 `TARGET_HR_CALIB_*`로 적용 값을 알린다 |
| `ODEV21_CHECKPOINT_PATH` / `ODEV21_SUMMARY_STATS_PATH` 및 각 SHA 변수 | ODE runtime 모델·통계 파일과 checksum. ODE 계획 경로를 사용할 때 필요 |
| `ODEV21_POPULATION_BUNDLE_PATH` / `ODEV21_POPULATION_BUNDLE_SHA256` | 신규 사용자 평균 묶음 파일과 필수 SHA-256. 시작 때 형식·hash·ODE modelVersion을 확인한다 |
| `PERSONAL_PLAN_POPULATION_MODE` | `median_bundle`(기본), `empty`, `off`. 평균 묶음 기반 신규 사용자 경로 선택 |
| `PERSONAL_PLAN_RUNNER_BASELINE_ENABLED` | 기본 `true`. 목표 없는 요청에 `user_profiles` 기준을 초기 목표로 쓴다. `false`면 예전 동작. `runway_ai`에 `user_profiles`·`running_sessions` SELECT가 필요하다(`infra/ai/grant-readonly.sh`) |
| `PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED` / `PERSONAL_PLAN_RUNNER_BASELINE_K_LEVEL` | 가입 기준 혼합 강도 k(기본 5 / 3). 0 이상 유한한 숫자가 아니면 시작 실패 |
| `HEAVY_MAX_CONCURRENCY` / `HEAVY_QUEUE_WAIT_SEC` | AI05·AI09 계획 대기열의 동시 실행 수와 대기 한도. 넘으면 `503 AI_BUSY`와 `Retry-After`를 반환한다 |

### 오류

| HTTP | code | 발생 조건 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | JSON 형식·ID·허용하지 않은 요청 필드 |
| 404 | `COURSE_NOT_FOUND` | ACTIVE 코스 조회 결과가 없음 |
| 422 | `INVALID_GOAL`, `COURSE_DATA_MISMATCH`, `COURSE_GRADE_UNAVAILABLE` | 목표·코스 거리·경사 정보가 유효하지 않음 |
| 422 | `GOAL_OUTSIDE_PACE_SEARCH_SUPPORT`, `PERSONAL_PLAN_NOT_FEASIBLE`, `PERSONAL_PLAN_GOAL_NOT_PRESERVED`, `POPULATION_PLAN_GOAL_NOT_PRESERVED` | 목표가 탐색 범위를 벗어나거나 계획 제약·시간 보존을 만족하지 못함 |
| 422 / 503 | `PERSONAL_PLAN_PREDICTION_INVALID` | ODE 개인 계획 예측 출력·상태가 유효하지 않음 |
| 503 | `PERSONALIZATION_NOT_SUPPORTED` | ODE 모델이 필요한 개인화 계획 입력을 지원하지 않음 |
| 422 | `PLAN_HORIZON_TOO_SHORT` | 완주 전 평가 가능한 완전한 30초 ODE cell이 하나도 없음 |
| 503 | `AI_DB_UNAVAILABLE` | DB 조회 실패 또는 시간 초과 |
| 503 | `PERSONAL_PLAN_NOT_READY` | DB·ODE·평균 계획 데이터 또는 실험 설정이 준비되지 않음 |
| 503 | `AI_BUSY` | 공용 계획 대기열의 최대 대기 시간을 넘김 |

모든 오류는 공통 `{code, message, details}` 형식을 따른다. 이는 현재 코드의 동작을 정리한 **팀 계약 제안**이며, 백엔드 저장 필드·클라이언트 표시는 별도 합의가 필요하다.

### DB 대응

AI 서비스는 아래 데이터를 읽고, AI09 계획 결과를 DB에 직접 저장하지 않는다. 저장은 백엔드가 담당한다.

| 구분 | AI09 필드·테이블 | DB 대응·비고 |
| --- | --- | --- |
| 저장 후보 | `targetPaceSecPerKm` | `pace_plans.recommended_pace` (`NUMERIC(10,2)`). 구간 페이스는 소수 둘째 자리까지 반올림하지만, 최상위 값은 목표 페이스 또는 거리 가중 평균이므로 저장 시 두 자리 반올림 규칙을 백엔드에서 확인한다 |
| 저장 후보 | `segments[].sequence`, `startDistanceM`, `endDistanceM`, `paceSecPerKm` | `pace_plan_segments.segment_sequence`, `start_distance`, `end_distance`, `recommended_pace` (`INTEGER`, `NUMERIC(12,2)`, `NUMERIC(12,2)`, `NUMERIC(10,2)`) |
| 세션 연결 | AI09 요청·응답에는 `session_id` 없음 | `pace_plans.session_id`는 `NOT NULL`; 백엔드 세션 ID가 필요하며 저장 시점은 별도 합의 필요 |
| 대응 컬럼 없음 | `segments[].paceRatio`, `segments[].lengthM`, `warnings[]`, `planSource` 및 출처·provenance 정보 | 현재 `pace_plans`·`pace_plan_segments`에 대응 컬럼 없음 |
| AI 조회 | `courses` | 현재 조회는 `id`, `distance`, `elevation_profile`, `status`, `updated_at`을 사용. `schema.sql`의 `courses` 테이블에 정의됨 |
| AI 조회 | `user_hr_personalization` | AI09는 `userId`가 있을 때만 `user_id` 기준 최신 행의 `personalization_version`, `schema_version`, `model_version`, `support_run_count`, `summary_u_json`, `history8_json`, `p4_json`, `hr0_sub_bpm`, `hr_ref_bpm`, `hr_danger_bpm`, `hr_sustain_bpm`, `hr_threshold_run_count`, `created_at`을 조회한다. 속도 보정이 켜져 있으면 `running_sessions`에서 같은 `user_id`의 `total_distance`, `moving_duration`, `elapsed_duration`을 `status='COMPLETED'`, `deleted_at IS NULL`, `ended_at` ≤ 계획 시각 조건으로 최근 20행까지 읽는다(S15P31E105-402). 목표 심박 보정(k가 `inf`가 아닐 때)은 같은 테이블에서 같은 조건에 경과 900~5,400초, 거리 3,000 m 이상, `average_heart_rate` 30~240 bpm 조건을 더해 `average_heart_rate`, `elapsed_duration`, `total_distance`를 최근 20행까지 읽는다(S15P31E105-377, 같은 SELECT 권한). AI 읽기 계정의 `running_sessions` SELECT 권한은 AI CD의 `infra/ai/grant-readonly.sh`가 개인화 테이블 대기 전에 준다. ERD V10 반영 대상이며, 현재 `schema.sql` 스냅샷에는 테이블 정의가 없음 |

`schema.sql` 기준 컬럼은 `pace_plans.recommended_pace NUMERIC(10,2)`, `pace_plans.session_id BIGINT NOT NULL`, `pace_plan_segments.segment_sequence INTEGER`, `start_distance NUMERIC(12,2)`, `end_distance NUMERIC(12,2)`, `recommended_pace NUMERIC(10,2)`다. ERD V10에는 `user_hr_personalization`만 반영하고, `user_gru_personalization` 등 나머지 제안은 필요할 때 검토한다.

## Route 코스 생성 내부 HTTP 계약 초안

**상태: S15P31E105-370 제안, 2026-11-04. Route 담당(AI) 확인 전. Route 서비스는 이 초안에 맞춰 구현됨(S15P31E105-381, `ai/route_service/API.md`), 운영 배포 전. 백엔드 어댑터 구현(S15P31E105-423, 2026-11-05).** 공개 계약은 [C01 생성 후속 초안](courses.md#코스-생성-후속-필요-사항)이며 클라이언트는 백엔드만 호출한다. 아래 URL·메타데이터·오류·시간 상한은 담당자와 확인한 뒤 실연동한다.

### Route 서비스 경계와 URL

| 항목 | 제안 |
| --- | --- |
| Origin | 배포에서 정하는 Route 전용 내부 주소. HR 추론 `ai/service` 주소와 분리. 백엔드는 `BACKEND_ROUTE_BASE_URL`로 받는다(423). 호스트·포트는 배포 업무에서 확정 |
| 생성 | `POST /internal/v1/routes/recommendations`, JSON. 이 경로는 **신규 운영용 초안**이며 현재 데모 경로가 아님 |
| readiness | `GET /internal/v1/ready`, 준비 시 `200 {"ready":true}`, 미준비 시 `503 {"ready":false}` 제안. 모델명이 아닌 그래프·환경 데이터·필요 DEM 및 Gate 사용 가능 여부 기준. 외부 공개 없음 |
| 호출·데이터 | 백엔드만 내부 네트워크로 호출. 회원 JWT·userId·HR·페이스·건강정보를 보내지 않음. 저장소·사용자 DB 접근과 코스 저장은 하지 않음 |
| 공간 출력 | 경로는 WGS84 `[lat,lon]` 좌표열로만 반환. DEM 고도 목록·100m 경사·GeoJSON Z는 반환하지 않음. 후보 순위·거리와 설명 메타데이터(요약·추천 이유·주의 문구·점수·항목별 점수, 응답 전체 안내)는 아래 성공 응답으로 반환한다. 설명 문구·점수 제공은 AI 팀 회신으로 확인(2026-11-05) |
| 책임 | Route는 생성·점수·Gate·후보 내 dedupe와 요약·추천 이유·주의 문구 생성. 백엔드는 공개 입력 검증·좌표 변환·DEM 조회·경사 계산·선택 저장. 백엔드는 설명 문구를 별도로 생성(LLM 포함)하거나 다시 쓰지 않는다. Route는 `flat` 선호 점수 계산에 DEM을 내부 사용 가능 |

readiness 통과 직후에도 요청 시점에는 실패할 수 있으므로 생성 응답의 `NOT_READY`도 처리한다. 인증·내부 네트워크 통제 구현은 별도 배포 범위이며, 단순히 `/internal` 경로라는 이유로 보호됐다고 보지 않는다. 원본 GPS·본문·인증 헤더·에러 debug를 로그에 남기지 않고 상태·지연·후보 개수 등 비민감 지표만 기록한다.

### Route 요청과 정규화

Route 요청은 기존 데모 모델과의 변환을 줄이기 위해 **이 서비스에 한해 snake_case**를 제안한다. 위 AI01~09의 camelCase 공통 규약은 변경하지 않는다. BE는 검증·정규화한 값만 보내며 Route도 경계에서 타입·유한수·범위·커버리지를 검증한다. 잘못된 내부 입력을 공개 사용자 검증 오류로 전가하지 않는다.

| C01 / 백엔드 | Route 요청 | 규칙 |
| --- | --- | --- |
| `latitude` / `longitude` | `lat` / `lon` | 필수 유한 number, 위도 -90~90·경도 -180~180. 생성 작업 영역이 extract에 들어오는지 별도 확인 |
| `distanceKm` | `distance_km` | 필수 number, 1~15. Route는 기존처럼 목표 m로 환산. `target_m`을 중복 입력하지 않음 |
| `shape` | `shape` | 필수 정규화 문자열 `loop/out_and_back/point_to_point` |
| `endLatitude` / `endLongitude` | `end_lat` / `end_lon` | 편도에서만 두 필드를 필수 전달. 나머지 shape에서는 생략. 출발→도착 방향 보존 |
| `seed` | `seed` | 필수 integer, 1~10,000,000. BE에서 기본 1 적용. 내부 generator의 다른 기본 seed를 사용하지 않음 |
| `filters` | `filters` | 아래 9개 키 모두 boolean으로 명시. BE가 null·누락을 false로 정규화. 추가 키 거절 제안 |

```json
{
  "lat": 35.1796,
  "lon": 129.0756,
  "distance_km": 5.0,
  "shape": "loop",
  "seed": 1,
  "filters": {
    "river": true,
    "beach": false,
    "park": true,
    "trail": false,
    "pedestrian": false,
    "avoid_major_road": true,
    "avoid_steps": false,
    "avoid_tunnel": false,
    "flat": false
  }
}
```

### Route 선호와 저장 태그 매핑

| C01 filters 키 | Route filters 키 | 현재 Route 선호 변환 | 저장 enum과의 관계 |
| --- | --- | --- | --- |
| `river` | `river` | true면 강변 가중치 5 | `RIVERSIDE` 의미 대응, 실제 경로 증거 필요 |
| `beach` | `beach` | true면 해변 가중치 5 | `BEACH` 의미 대응, 실제 경로 증거 필요 |
| `park` | `park` | true면 공원 가중치 5 | `PARK` 의미 대응, 실제 경로 증거 필요 |
| `trail` | `trail` | true면 트레일 가중치 5 | 대응 enum 없음 |
| `pedestrian` | `pedestrian` | true면 보행 친화 가중치 5 | 대응 enum 없음. `URBAN`으로 치환하지 않음 |
| `avoidMajorRoad` | `avoid_major_road` | true면 회피 가중치 5 | 대응 enum 없음 |
| `avoidSteps` | `avoid_steps` | true면 회피 가중치 5 | 대응 enum 없음 |
| `avoidTunnel` | `avoid_tunnel` | true면 회피 가중치 5 | 대응 enum 없음 |
| `flat` | `flat` | true면 `difficulty=flat`, false면 `difficulty=any` | 대응 enum 없음. 저장 경사는 백엔드가 별도 계산 |

false는 반대 환경 선호가 아니라 해당 조건 미사용이다. 가중치 5는 현행 `route_demo/app_runway.py::_prefs` 참고값이며 계약을 고정 점수나 조건 충족 보장으로 해석하지 않는다. 저장 enum 정본은 `PARK/RIVERSIDE/URBAN/BEACH/TRACK`이다. 입력 선호·설명 문구로 태그를 자동 저장하거나 `URBAN/TRACK`을 추정하지 않는다. 실제 경로 기반 태깅 자료·임계값은 후속 합의이며 이 초안은 feature 벡터·환경 비율을 반환하도록 요구하지 않는다.

### Route 성공 응답과 좌표 변환

`200`의 최소 허용 필드는 아래와 같다. 후보 수는 1~3개이며 Gate `enforce` 통과 후보만 반환한다. 0개는 `NO_ROUTE` 오류다. 총점과 항목별 점수는 아래 필드로 반환하며, OSM edge/node ID·`candidate_id`·feature 벡터·`details`·raw DEM(`elevation_profile_m`)·디버그는 반환하지 않는 안이다.

| 내부 필드 | 타입·조건 | 백엔드 공개 응답 조합 |
| --- | --- | --- |
| `routes` | array, 1~3개, 순위 오름차순 | `courses`로 변환. 같은 좌표열을 복제해 3개를 채우지 않음 |
| `routes[].rank` | integer, 1부터 연속 | 공개 `index=rank-1`. 영속 ID로 사용하지 않음 |
| `routes[].coords` | number[][], 2D `[lat,lon]` 2점 이상 | 각 `[lat,lon]`을 `[lon,lat]`으로 한 번 교환해 GeoJSON `LineString` 생성. 점·방향 보존 |
| `routes[].distance_m` | 양의 유한 number | `distanceM`, 소수 둘째 자리 반올림. 목표 대비 ±10% 이내 확인. 경로 좌표와의 길이 일치 오차는 공개 초안의 미확정 사항 참조 |
| `routes[].summary` | string, 비어 있지 않음 | 공개 `summary`. 한 줄 요약(예: "강변을 많이 지나는 코스예요.") |
| `routes[].reasons` | string[], 빈 배열 허용 | 공개 `reasons`. 추천 이유 목록(예: "강변 구간이 40%예요"). 현행 데모는 최대 4개 |
| `routes[].caveats` | string[], 빈 배열 허용 | 공개 `caveats`. 주의 문구(예: "계단이 1곳 있어요") |
| `routes[].score` | 유한 number | 공개 `score`. 규칙 기반 총점이며 `score_terms[].contribution`의 합 |
| `routes[].score_terms` | object[], 빈 배열 허용 | 공개 `scoreTerms`. 각 항목 `term`(string)·`label`(string)·`group`(string)·`feature_value`(유한 number)·`weight`(유한 number)·`contribution`(유한 number)을 camelCase로 바꿔 전달. 평지 선호 점수 `difficulty_flat` 포함 |
| `notices` | string[], 빈 배열 허용 | 공개 `notices`. 응답 전체 안내(예: "이 주변은 공원 정보가 일부만 있어요"). 스냅·후보 부족·선호 정보 부족 안내 포함 |
| `next_seed` | integer, 요청 seed+24 | `nextSeed`. 상한 초과 시 더 보기 중단, 요청 입력 상한은 유지 |

예: 내부 `coords=[[35.1796,129.0756],[35.1803,129.0786]]`는 공개 `coordinates=[[129.0756,35.1796],[129.0786,35.1803]]`로 변환한다. 단순 배열 뒤집기로 경로 진행 방향을 바꾸지 않는다.

백엔드는 null·NaN/Infinity·축 범위·2D·점 수·후보 수/순위·중복 후보·거리 허용 범위·next_seed·필수 문자열/배열 타입을 검사한다(423 구현: 좌표 길이와 `distance_m` ±5%, 폐곡선 첫/끝 1m 이내, `score_terms`의 `term`·`label`·`group` 각 100자 이내). `loop/out_and_back`의 폐곡선, 스냅된 시작·편도 도착이 요청점에서 최대 250m 이내인지도 확인한다. 4개 후보·좌표축 뒤바뀜·잘못된 거리 등 한 항목이라도 틀리면 전체를 `ROUTE_INVALID_RESPONSE`로 처리하고 잘못된 일부를 버려 성공시키지 않는다. 크기 상한은 아래 표를 따르며, 넘으면 `ROUTE_INVALID_RESPONSE`로 처리한다. 무제한 버퍼링은 허용하지 않는다.

#### Route 응답 크기 상한

2026-11-05 AI 팀 제안 값이다. 실측 최대는 요약 35자, 좌표 576점, 응답 41KB였다.

| 항목 | 상한 |
| --- | --- |
| 응답 본문 | 256KB. 백엔드는 이 크기를 넘게 읽지 않음 |
| 후보별 `coords` | 3,000점 |
| `summary` | 100자 |
| `reasons`·`caveats`(후보별), `notices`(응답 전체) | 각 20개. 문구 1개당 100자(백엔드 제안, AI 팀 확인 필요). 현행 Route는 개수를 자르지 않으며 최악값이 `caveats` 12개(`explain.py`, 환경 필터 5종)·`notices` 9개(`app/main.py`)·`reasons` 4개라 이를 넉넉히 포함하는 방어 상한이다. 백엔드는 넘는 문구를 잘라 받지 않는다(경고 문구 누락 방지). 빈 문자열 항목은 백엔드가 빼고 받는다(423) |
| `score_terms` | 20개(백엔드 제안, AI 팀 확인 필요. 현행 최대 13개 수준) |

**설명 문구 생성 주체는 Route다.** AI 팀 회신(2026-11-05)에 따라 현행 `runway_routing/explain.py`가 만드는 `summary`·`reasons`·`caveats`와 `scorer.py`의 `score`·`terms`(데모 응답 `score_terms`), 응답 전체 `notices`를 그대로 받는다. 2026-11-04에 정한 "백엔드 LLM 추천 이유 생성" 안은 폐기한다. 백엔드는 문구를 일반 텍스트로만 전달하고 번역·재작성·HTML 해석을 하지 않는다. `score_terms[].term`은 열린 문자열 집합이다(현행 예: `distance_fit`, `river`, `avoid_major_road`, `difficulty_flat`, `repeated_edge_penalty`, `running_suitability`). 백엔드는 알 수 없는 `term`을 오류로 보지 않으며, 항목 타입·유한수만 검사한다. 점수는 같은 요청 안의 후보 설명용이며 선호·모드에 따라 가중치가 달라지므로 요청 간 비교·저장·백엔드 재정렬에 쓰지 않는다. 순위는 `rank`를 따른다. 편도·왕복의 `shape_notes`, `turnaround`, `start/end` 스냅 정보는 이번 초안 반환 필드가 아니며 필요하면 별도 합의한다.

모든 후보가 검증되면 백엔드가 DEM 조회와 공개 계약의 100m `elevationProfile`을 Route 설명·점수와 조합한다. 생성 호출·DEM 처리를 DB 쓰기 트랜잭션이나 잠금 안에서 수행하지 않는다. C01 자체에는 DB 쓰기가 없으며, 선택 저장은 별도 검증·짧은 저장 트랜잭션의 책임이다. 후보 응답의 고도·경사·환경 태그를 클라이언트가 조작해 저장하는 경로를 만들지 않는다.

### Route 오류 매핑

운영용 오류는 non-2xx와 `{code,message,details}`를 제안한다. readiness만 위 probe 전용 형식이다. 허용 목록에 없는 내부 code·HTTP 조합, 파싱 실패, **HTTP 200인데 오류 본문**은 `ROUTE_INVALID_RESPONSE`로 취급한다. 내부 요청의 400/422는 BE 어댑터 결함 또는 계약 불일치이므로 공개 400으로 그대로 전달하지 않는다.

| 내부 HTTP·code / 장애 | 공개 HTTP·code | 공개 `details.reason` |
| --- | --- | --- |
| 422 `OUT_OF_AREA`, `OUT_OF_APP_RANGE` | 422 `INVALID_SEARCH` | 같은 reason |
| 422 `NO_ROAD_NEARBY` | 422 `INVALID_SEARCH` | `NO_ROAD_NEARBY` |
| 422 `DESTINATION_TOO_FAR` | 422 `INVALID_SEARCH` | `DESTINATION_TOO_FAR` |
| 422 `END_SNAP_PE1/PE2/PE4/PE5` | 422 `INVALID_SEARCH` | `NO_ROAD_NEARBY` (도착점 안내 message) |
| 422 `NO_ROUTE`, `USABILITY_GATE_ALL_FAILED` | 422 `INVALID_SEARCH` | `NO_ROUTE` |
| 503 `NOT_READY` | 503 `SERVICE_UNAVAILABLE` | `ROUTE_NOT_READY` |
| 503 `BUSY` | 503 `SERVICE_UNAVAILABLE` | `ROUTE_BUSY` |
| 503 `TIMEOUT` 또는 BE의 전체 HTTP deadline 초과 | 503 `SERVICE_UNAVAILABLE` | `ROUTE_TIMEOUT` |
| 500 `INTERNAL`, `SAFETY_CHECK`, `SNAP_NODE_NOT_IN_GENERATION_GRAPH`; 503 `UNAVAILABLE`; 연결 실패 | 503 `SERVICE_UNAVAILABLE` | `ROUTE_UNAVAILABLE` |
| 내부 400/그 밖의 422, 잘못된/알 수 없는 응답 | 503 `SERVICE_UNAVAILABLE` | `ROUTE_INVALID_RESPONSE` |

`DESTINATION_TOO_FAR` 내부 `details`에는 `min_target_km`, `alternatives_from_km`(허용할 경우 유한 양수)을 제안하지만, 공개 v1 초안은 reason만 노출한다. 최소 거리 안내를 공개 필드로 늘리는 것은 FE 확인 후 별도 확정한다. 백엔드는 상류의 자유 형식 message/debug/details를 그대로 반사하지 않는다. 500·503·502/504 등 proxy 오류의 미등록 조합도 상류 계약 오류로 처리하고 원본 본문을 노출하지 않는다.

위 표는 Route 호출 오류의 매핑이다. Route 성공 후 DEM 미준비는 공개 `503 SERVICE_UNAVAILABLE/GRADE_NOT_READY`, 처리 중 확인된 DEM I/O·의존 데이터 접근 실패는 `503 SERVICE_UNAVAILABLE/GRADE_UNAVAILABLE`로 구분한다. **백엔드 C01 전체 20초 예산이 먼저 소진되면 단계에 관계없이 `503 SERVICE_UNAVAILABLE/GENERATION_TIMEOUT`**이며 고정 message는 `코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.`다. 반면 Route HTTP 15초가 먼저 소진되면 위 `ROUTE_TIMEOUT`을 사용한다. 상세·시간 순서 예시는 [공개 실패 초안](courses.md#실패와-시간-예산-초안)을 따른다. 이 두 백엔드 경사/전체 예산 실패를 정상 Route 응답 오류로 분류하지 않는다.

### Route 시간 예산·동시성과 재시도

[공개 시간 예산](courses.md#실패와-시간-예산-초안)의 12/15/20/25/30초 제안과 함께 적용한다. Route는 대기를 포함한 요청 처리 전체 12초를 넘기지 않는 안이다. 리눅스 실측 최악 처리 시간은 4.5초다(2026-11-05 AI 팀). 단일 프로세스에서 현재 pipeline은 thread-safe하지 않으므로 동일 인스턴스 병렬 실행을 허용하지 않으며, 계산 중간 취소는 어렵다. 그래서 아래처럼 늦게 끝날 계산을 처음부터 시작하지 않는다.

| 규칙 | 내용 |
| --- | --- |
| 대기열 | 실행 1건 + 대기 1건까지만 받는다. 그 이상은 즉시 `503 BUSY`(AI 팀 제안). 381 구현은 실행 슬롯을 최대 1초 기다리고 못 잡으면 `BUSY`(대기열 없음) |
| 시작 조건 | Route가 요청을 받은 시각부터 12초 예산을 센다. 대기 후 계산을 시작하는 시점에 남은 예산이 **6초**(실측 최악 4.5초 + 여유) 미만이면 시작하지 않고 `503 TIMEOUT`. AI 팀은 "deadline이 지났으면 TIMEOUT"을 제안했고, 시작 후 BE 15초 이후에 끝나는 낭비 계산을 막기 위해 백엔드가 남은 예산 기준을 보완 제안했다(AI 팀 확인 필요) |
| 실행 중 | 시작한 계산은 끝까지 실행한다. BE가 15초에 포기한 뒤 끝난 결과는 버린다. 시작 조건으로 이런 경우를 줄인다 |

작업 슬롯이 1개이므로 처리량은 약 4.5초당 1건이다. MVP 기준으로 두고, worker 수·메모리 상한은 배포/최적화 담당(S15P31E105-380·381)과 동시 요청 실측 후 정한다.

백엔드는 요청 헤더 `X-Request-Deadline`(epoch ms)에 "우리 마감 − 6초"를 보내, 그 시각이 지났으면 Route가 계산을 시작하지 않고 `503 TIMEOUT`을 반환하게 한다(381 구현, 423 연동). BE→Route는 연결 최대 1초를 포함한 **전체 호출 15초**, C01은 DEM·직렬화 포함 전체 20초 제안이다. 단순 socket read timeout만 설정해 전체 deadline을 대신하지 않는다. 실행 중인 동기 CPU 작업이 즉시 취소된다고 가정하지 않으며, 위 대기열·시작 조건으로 남는 계산을 제한한다. 현행 데모 lock만으로는 대기열 상한과 시작 조건이 없으므로 운영 Route에서 구현·검증해야 한다.

C01 전체 deadline에서는 부분 후보를 반환하지 않는다. 백엔드는 남은 Route/DEM 작업 취소·점유 자원 회수를 처리하고 늦은 결과를 폐기하며, 정상 응답 직렬화 전에도 남은 예산을 확인해야 한다. 이미 실행 중인 작업이 즉시 멈춘다고 가정하지 않고 이 경로를 별도 검증한다. 실패 후 자동 재호출·후보 저장·백그라운드 저장은 하지 않는다.

BE 자동 재시도는 **0회**다. `NOT_READY/BUSY/TIMEOUT/500/연결 실패` 모두 같은 공개 요청에서 재호출하지 않는다. readiness 재확인으로 본 요청을 무한 대기시키지 않는다. Route/DEM 미준비 시 스텁·평지·다른 생성기로 자동 fallback하지 않는다. 사용자가 다시 요청할 수 있으나 기존 실행이 남을 수 있어 admission 제한이 필요하다. 생성 주체 전환은 ADR-0019의 합의·검증 후 어댑터를 교체하는 별도 작업이다.

### Route 현행 데모와의 차이·담당 확인

근거는 기준 dev `b992b9e`의 `ai/workspace/seongyun/route/route_demo/app_runway.py` 및 `ROUTE_TECHNICAL_GUIDE.md` 2·14·17·20절이다. `analysis/runway_route_api.py`는 과거 후보 생성 진입점이며 현재 TOP3 HTTP 데모 계약으로 혼동하지 않는다.

| 구분 | 현재 데모 | 이번 운영용 제안 |
| --- | --- | --- |
| URL·probe | `/api/recommend`, `/api/status` | 별도 origin의 `/internal/v1/routes/recommendations`, `/internal/v1/ready` |
| 입력 | snake_case, 자체 기본값·Pydantic 모델 | 위 표로 명시적으로 정규화·검증된 내부 요청 |
| 성공·고도 | `ok`, routes·reasons·scores/features/edges·`elevation_profile_m`·debug 등 | 위 routes·summary/reasons/caveats·score/score_terms·notices·next_seed. 고도/경사·식별자·features/details/edges·debug 제외 |
| 오류 | 다수 HTTP 200 `{ok:false,error:...}`, 일부 500/503 | non-2xx 오류 표, 원본 debug 미노출 |
| 실행 제한 | pipeline lock으로 직렬화. 대기·전체 deadline을 보장하지 않음 | 실행 1건·대기 1건, 남은 예산 6초 미만이면 시작 전 TIMEOUT, 12초 처리 상한 검증 필요 |
| 경사 | DEM 프로파일을 응답할 수 있음 | 백엔드가 고도 조회·100m 경사 계산. Route는 평지 선호 계산만 내부 사용 |

Route 담당 확인: **일부 완료.** 2026-11-05 370 리뷰에 대한 AI 팀 회신으로 설명·점수 메타데이터 범위를 확인했다. C01 응답에 후보별 `summary`(한 줄 요약)·`reasons`(추천 이유)·`caveats`(주의 문구)·`score`/`score_terms`(총점과 평지 점수를 포함한 항목별 점수), 응답 전체 `notices`를 추가하며, 추천 이유는 Route가 이미 생성해 제공할 수 있다. 같은 날 추가 회신으로 다음을 협의했다.

- 크기 상한: 위 [응답 크기 상한](#route-응답-크기-상한) 표. 문구 1개당 길이와 `score_terms` 개수는 백엔드 제안이라 확인 필요.
- 시간: 실측 최악 4.5초, 실행 1건·대기 1건과 시작 전 TIMEOUT 방식. 남은 예산 6초 기준은 백엔드 보완 제안이라 확인 필요.
- 왕복 반환점(`turnaround`): 화면 표시가 필요해지면 그때 추가.
- 서비스 지역: 백엔드 부산 사각형 검증 대신 Route `OUT_OF_AREA` 기준.
- 전국 확장: MVP는 부산으로 가고, 지역별 데이터 선택·결과 확인은 이후 [S15P31E105-433](https://ssafy.atlassian.net/browse/S15P31E105-433)에서 진행.

남은 확인 항목은 URL/본문, shape별 오류 매핑, Gate enforce·snap·거리 기준, 위 두 가지 보완 제안이다. “경로만 반환”은 공간 데이터가 coords뿐이라는 안이다. 실제 확인자·일자·합의/수정 내용을 남기기 전 Jira 370의 담당 확인 완료 조건은 충족하지 않는다. 이 문서 리뷰용 AI 에이전트 검토를 Route 담당자의 확인으로 대신하지 않는다.

## DB 대응 요약

| AI 응답 | DB 테이블·컬럼 |
| --- | --- |
| AI05 `recommendedPaceSecPerKm` | `pace_plans.recommended_pace` |
| AI05 `cueBpm` | `pace_plans.cue_bpm` |
| AI05 `routeProgressM` | `pace_plans.route_progress` |
| AI05 `segments[].segmentSequence` | `pace_plan_segments.segment_sequence` |
| AI05 `segments[].startDistanceM` / `endDistanceM` | `pace_plan_segments.start_distance` / `end_distance` |
| AI05 `segments[].recommendedPaceSecPerKm` | `pace_plan_segments.recommended_pace` |
| AI04 `elapsedSec` | `coaching_decisions.elapsed_duration`; 패키지 권고는 `floor()` |
| AI04 decision·version | `coaching_decisions` 저장 여부/버전 컬럼은 O4~O6 합의 필요 |
| AI06 response JSON | ERD V10 `user_hr_personalization`; 최신 행의 HR 기준·ODE 개인화 입력을 저장 |
| AI06 `gruPersonalization` | `user_gru_personalization`은 V10에 포함하지 않으며 필요할 때 별도 검토 |
| AI09 `segments[]`·계획 metadata | AI 서비스는 DB에 쓰지 않음. `pace_plans`·`pace_plan_segments`에 저장할 필드와 `personalized=false` 표시 규칙(C12)은 팀 계약 제안 |

## 백엔드 호출 순서

1. **S01 / S08**: 잠금 안에서 AI05를 동기 호출하지 않는다. 백엔드는 추천 페이스를 목표 페이스 → 목표 시간 ÷ 목표 거리 → 목표 시간 ÷ 코스 거리 순으로 직접 계산한다. 구간 비율은 `SegmentDifficultyProvider` 구현 Bean이 코스별로 미리 계산·저장된 `segmentDifficultyRatios`를 읽는다. AI05는 계획 표시와 사전 난이도 계산에 쓸 수 있지만 잠금 경로의 원격 의존성으로 두지 않는다.
2. **W07 → AI04**: 백엔드가 batch를 저장한 뒤 최신 history/context와 5개 후보를 만들어 AI04를 호출한다. 백엔드가 stateVersion을 다시 확인하고 필요한 결정만 저장·발행한다. timeout 후 오래된 본문을 재전송하지 않는다.
3. **러닝 종료 → AI06**: 백엔드가 동의된 support 세션을 모아 개인화 요청을 보낸다. 버전 JSON 저장·재시도·실패 상태는 별도 백엔드 계약으로 결정한다.
4. **시연 전용**: Demo player → AI08, 브라우저 console → AI07. 실제 앱/백엔드 동작과 분리한다.

## 팀 합의 목록과 이 패키지 기본값

| ID | 합의 주제 | 패키지 기본값 | 상태 |
| --- | --- | --- | --- |
| N1 | AI04 요청·응답 계약 | 시연 설계 필드와 policy v0.4.0 학습 심박 기준 반영 | v6_8_2 반영 |
| N2 | batch 저장·후보/context·AI04·DB 저장 순서 | W07 저장 후 백엔드가 AI04 호출, 버전 재검사·DB 저장 | 제안 |
| N3 | AI07 SSE·trace·buffer 정책 | 세션 허용목록, 메모리 ring buffer, 만료/재접속은 demo 설정 | 제안 |
| N4 | 컨테이너·콘솔·Nginx 경로 | 기존 infra 내부 `runway_service`, host port 없음, demo 경로 예시만 제공 | 제안 |
| N5 | W07 demo 앱 upload 주소·token 설정 | 시연 입구만 두고 앱 전환은 범위 밖 | 합의 필요 |
| N6 | 재생 데이터 출처·세션 ID·보존 | prototype Val 사본만 로컬 재생, 원본 기록 저장 없음 | 제안 |
| N7-1 | 학습 HR 기준 | 최근 20회 GOOD HR의 P98·P85를 모집단 중앙값과 정책 비중으로 섞는다. 위험 기준 = 섞은 P98 + 3(일반화 178), 지속 기준 = 섞은 P85 | v6_8_2 반영 |
| N7-2 | cueBpm | AI04는 추천 페이스의 정수 BPM(60~220)을 반환한다(S15P31E105-416). BPM 모듈 로드·계산 실패 때만 null + `CUE_BPM_UNAVAILABLE`이며, 이때 필수 `targetBpm`을 넣는 COACHING 명령 처리(현재 BPM 유지 등)는 백엔드 합의가 필요하다. 사용자 기록은 백엔드가 보내지 않고 AI가 DB에서 직접 읽는다(S15P31E105-438, 합의). 백엔드는 코칭 발행(`publishSuggested=true`) 때만 `cueBpm`을 적용하고, 작은 BPM 변화는 따로 거르지 않는다(S15P31E105-462, 합의) | 기록 조회·적용 시점 합의, 수동 변경 덮어쓰기·null 처리 합의 필요 |
| N7-3 | 러닝 mode enum | AI05 `COURSE/FREE_WITH_GOAL/FREE_NO_GOAL`; AI04 입력 문자열 유지 | 잠정 |
| N7-4 / O1 | 자유러닝 경사 null vs 0 | MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`; 경사 정보가 없으면 0% 평지 계산 후 HTTP 200과 경로별 경고 반환. 코스 경사 저장은 S15P31E105-319, unknown 정책·GPS 고도 활용은 MVP 이후 | flat0 MVP 기본값 합의(MR !142 리뷰) |
| N7-5 | AI04 timeout | 3초, timeout 후 재시도 없이 다음 batch | 제안 |
| N7-6 / O2 | HRmax source | 나이 공식·HRR 경로를 기준 계산에서 제거. 마지막 400m는 안전 한계만 위험 기준 + 5 bpm(허용선은 위험 기준) | v6_8_2 반영 |
| N7-7 | 목표 시간 기준 | MPC policy v0.4.0의 일시정지 제외 activeSec | 제안 |
| N8 | 워치 demo 실시간 전송 | 기본 OFF, 5초 batch, 실기기 테스트는 별도 | 합의 필요 |
| O1 | 자유러닝 경사 의미 | N7-4 처리 | flat0 MVP 기본값 합의(MR !142 리뷰) |
| O2 | HRmax ERD 출처 | N7-6 처리 | 제안 |
| O3 | GOOD 판정·최근 20회 P98/P85 | AI06의 GOOD 표본 품질 필드와 `sessionStartedAt` 순서를 사용 | v6_8_2 반영 |
| O4 | 5초 판단·trace·저장·발행 주기 | 계산과 저장/발행 분리, 발행 판단만 백엔드 저장 | 합의 필요 |
| O5 | decision=null·EASE_OFF 저장 | EASE_OFF pace는 실제 pace +30 sec/km. 어떤 decision을 저장할지는 백엔드 합의 필요 | 제안 |
| O6 | model/policy 버전 저장 | nullable 컬럼 2개 추가 제안; migration은 합의 전 | 제안 |
| O7 | plan ratio와 절대 페이스 변환 | 기준 목표 pace×ratio, DB에는 sec/km 절대값 | 제안 |
| O8 | AI05 모델·goal 조합·HR 지평 | Planner v1, 코스/목표 있는 자유러닝 계획, HR 미리보기 기본 OFF, 켜면 90분(5400초) 설정. 개인 계획은 **시간 상한 없음**: 예상 완주가 90분(평가로 확인된 범위)을 넘으면 경고 `ODE_BEYOND_VALIDATED_HORIZON`, `validatedHorizonSec`=5400은 정보용. 계산 안전장치는 코스 45 km(422 `INVALID_GOAL`)와 탐색 예산(`PERSONAL_PLAN_SEARCH_BUDGET_CELLS`, 넘으면 탐색을 줄이고 경고 `PLAN_SEARCH_BUDGET_LIMITED`). MVP 이식 후 점검·보완 | 제안 |
| O9 | AI06 vector 차원·저장·전달 | versioned JSON, 다음 요청은 백엔드가 AI05 personalization으로 전달 가능; ERD V10에는 `user_hr_personalization`만 반영하고 나머지 제안은 필요할 때 검토 | V10 범위 합의 |
| C11 | AI03/AI04 GRU 개인화 | GRU 개인 출력층 조회는 MVP 이후 선택. `GRU_PERSONALIZATION_ENABLED=false` 기본 | MVP 이후 |
| C12 | AI06 GRU 출력층 저장 | GRU 개인화 블록 저장은 MVP 이후 선택. `user_gru_personalization`은 ERD V10에 포함하지 않고 필요할 때 검토 | V10 미포함(MVP 이후 필요 시) |
| C13 | AI04 HR 입력·응답 | `context.hrReference` 선택화·무시 경고, pacing 학습 기준 필드, `userId`가 있을 때 학습 기준 조회 | v6_8_2 반영 |
| O10 | elapsedSec integer 저장 | `floor()` | 제안 |
| O11 | health probe와 공통 오류 | 팀 HEALTHCHECK가 `status=UP`·`modelLoaded=true`를 요구해 DEGRADED를 제거; ODE는 `models.ode.status=UP/DOWN`으로 확인; probe 전용 body 유지 | 합의 필요 |
| O12 | 배포 모델 버전 | GRU M3-005 + ODE v2.1 1차 epoch20; 2차 variant는 env swap | 사용자가 정한 기본값 |
| O13 | AI07/AI08 오류·상태 code | bearer 인증, `{code,message,details}`, 비활성화 503·401/404/429 | 제안 |
| O14 | AI04 timeout/500/503 retry와 중복 | 다음 W07 batch의 최신 입력에서 재판단, 같은 입력 자동 retry 없음 | 제안 |
| O15 | 인스턴스 자원·동시 처리량 | 단일 worker 예시; memory/CPU/GPU 부하 검증 후 제한 합의 | 합의 필요 |
| AI09 | 개인 페이스 계획 요청·응답 및 신규 사용자 표시 | 건강정보 동의 사용자만 `userId`를 보내며, 생략 시 개인 조회 없이 평균 경로(`AVERAGE_BASED`, `personalized=false`) 사용; AI 서비스는 DB에 저장하지 않음 | userId 선택 입력·동의 규칙 합의(MR !142 리뷰) |
