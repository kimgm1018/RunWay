# API 명세 — AI 추론 서비스(백엔드 내부)

[API 명세 색인](README.md)으로 돌아가기.

| 항목 | 내용 |
| --- | --- |
| 관련 업무 | S15P31E105-337, Route 계약 초안 S15P31E105-370 |
| 구현 | AI01~10: `ai/service/`. Route는 별도 서비스이며 운영 HTTP 구현 전 |
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

AI01 `/health`는 로드밸런서 probe를 위해 `{status, modelLoaded, modelVersion, models}`를 사용하고, 진단용 `components`를 덧붙인다(S15P31E105-487). readiness는 필수 모델인 GRU를 기준으로 하며 ODE 상태는 선택 기능의 가용성을 별도로 나타낸다. health 본문은 probe 전용 형식이므로 O11 합의 대상이다.

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
| `components.gru` / `components.ode` | string | `UP` / `DOWN`. 위 모델 상태 요약 |
| `components.aiDb` | string | `CONFIGURED`(AI_DB_URL 설정, 시작 시 조회기 초기화 실패 없음) / `CONNECT_FAILED`(설정됐지만 초기화 실패) / `NOT_CONFIGURED`. 시작 때 실제 DB 연결 probe는 하지 않으므로 `CONFIGURED`가 연결 성공을 보장하지 않는다 |
| `components.personalPlan.enabled` | boolean | `PERSONAL_PLAN_EXPERIMENTAL_ENABLED` 설정 상태. false면 AI09는 `503 PERSONAL_PLAN_NOT_READY` |
| `components.personalPlan.populationMode` | string | 평균 묶음 경로 모드(`median_bundle`, `empty`, `off`) |
| `components.personalPlan.populationBundleLoaded` | boolean | 시작 때 평균 묶음을 읽어 검증했는지 여부 |
| `components.cueBpm` | string | `UP` / `DOWN` / `DISABLED`. 목표 BPM 계산기 상태 |
| `components.groupPace.enabled` | boolean | `GROUP_PACE_ENABLED` 설정 상태. 배포 설정에서 켬, false로 끌 수 있음. false이면 AI10은 `503 GROUP_PACE_DISABLED` |

`components`는 진단 정보이며 `status`, `modelLoaded`, HTTP 200/503 판정에 영향을 주지 않는다. 설정값·URL·경로는 반환하지 않는다. GRU가 준비되면 ODE가 미준비여도 HTTP 200과 `status=UP`, `modelLoaded=true`를 반환한다. ODE 준비 상태는 `models.ode.status`의 `UP`/`DOWN`으로만 알린다. GRU가 미준비이면 ODE 준비 여부와 관계없이 HTTP 503과 `status=DOWN`을 반환한다. 팀 AI 이미지의 HEALTHCHECK와 `infra/ai/check.sh`가 `status=UP` 및 `modelLoaded=true`를 요구하므로 ODE의 선택적 가용성을 전체 서비스 readiness와 분리한다.

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
| `GRU_GB_PERSONALIZATION_ENABLED` | `false`(코드) / `true`(배포 compose) | ODE식 GRU 개인 보정 g·b(S15P31E105-641). 켜면 AI06이 `summaryU`에 `gruGain`·`gruOffsetBpm`·`gruSupportN`을 넣고, AI04·AI10이 학습 심박 기준선 행에서 읽어 기본 GRU 출력에 `hr0 + g·(pred − hr0) + b`로 적용. 꺼져 있으면 출력이 이전과 같음 |
| `GRU_GB_MAX_WINDOWS` | `3000` | AI06 g·b 계산 최대 window 수(최신 러닝부터) |
| `AI_DB_URL` | (없음) | 읽기 전용 PostgreSQL 주소. 비면 AI03/AI04의 DB 개인화 조회는 자동 OFF이며, 개인 계획의 기존 503 동작은 유지 |
| `BPM_LOOKUP_CACHE_ENABLED` | `true` | AI04 목표 BPM 세션 캐시. 첫 1분을 찾은 세션은 세션 SQL을 다시 읽지 않고, 일정 구간이 없을 때는 BPM 변경 기록을 읽지 않음. `false`면 매 호출 예전 조회 경로 그대로(결과는 같음) |
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

`POST /v1/pace/decide` — 정책 v0.5.0(`mpc-v0.5.0`) + GRU. 매 요청은 후보 9개(`anchorPaceSecPerKm` 대비 −30, −20, −10, 0, +10, +20, +30, +45, +60 sec/km, 그룹 페이스 AI10과 같음)다. AI04 timeout 기본 제안은 3초이며 백엔드는 timeout 뒤 같은 batch를 재시도하지 않고 새 W07 batch에서 판단한다.

**응답 시간·동시 처리(S15P31E105-440, 2026-11-05 측정).** CPU 1개, uvicorn worker 1, 스레드 1, 실제 GRU(`db59d414`), 합성 데이터 기준이다. AI04 1회는 p50 12~20 ms, p99 14~27 ms로 history 1~1440칸·plan 유무에 따른 차이는 거의 없다(1칸 `PLAN_HOLD`는 약 3 ms, 시작 뒤 첫 호출은 약 55 ms). 5초 주기 동시 사용자는 AI04만 받으면 200명까지 p99 1초 이하이고 약 250~300명부터 3초를 넘는다. 같은 프로세스에서 AI09·AI06이 쉬지 않고 돌면 50명 p99 0.58 s, 100명에서 1.1%가 3초를 넘는다. **백엔드 호출 기준: timeout 3초, 세션당 동시 1건, timeout·연결 오류·5xx는 재시도 없이 다음 W07 batch로 넘긴다. 컨테이너(1 vCPU)당 동시 러닝 50명이 계획 기준이다.** uvicorn 기본 keep-alive 5초와 5초 호출 주기가 겹쳐 드물게 연결이 끊기므로 백엔드 유휴 연결 정리를 4초 이하로 두거나 AI 실행 명령에 `--timeout-keep-alive 15`를 준다. 단, 목표 BPM 조회(S15P31E105-438)와 학습 심박 기준 조회는 DB를 부르는 동안 프로세스 공용 lock을 잡고 실패를 캐시하지 않는다. 스텁 DB 실측(50명)은 DB 정상 p99 74 ms, 쿼리 100 ms면 p50 3.98 s·70.8%가 3초 초과, DB 응답 없음이면 p50 12.0 s·98.9%가 3초 초과였다(응답은 200 + `BPM_RECORDS_UNAVAILABLE`). S15P31E105-500에서 두 조회의 DB 호출을 lock 밖으로 뺐다(캐시를 읽고 쓸 때만 lock). 세션 조회 캐시와 실패 차단은 아직 없다.

- v0.4.1: HR 입력 지연 기준을 15초에서 20초로 바꿈(팀 명세 정렬, S15P31E105-413).
- v0.4.2: 코칭 단계 `decision.coachingLevel` 추가, OK면 목표보다 앞서도 늦추지 않음, 위험 감속 권고 하한(걷기 경계 11:07/km), `WALK_ADVISED` 삭제(S15P31E105-504). 위험 감속 권고가 안내보다 빨라지지 않게 고친 것(S15P31E105-497)도 이 버전부터 반영된 것으로 본다.
- v0.4.3: 넘친 만큼 늦추기·빨라지기, 감속 쿨다운 120초, 안내 미준수 처리, 위험 감속 권고를 실측 기준으로(S15P31E105-506).
- v0.5.0: 페이스 선택을 그룹 페이스 AI10과 같은 규칙·같은 코드(`app/pace_selector.py`)로 바꿈. 후보 9개, 두 번째 GRU 호출 없음, 목표보다 앞선다는 이유의 감속(`SLOW_DOWN_GOAL`)과 계획 넘겨주기 선택(`PLAN_HOLD`/`PLAN_BLEND` 사유) 없음(S15P31E105-624). 아래 "페이스 선택".

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
| `context.guidePaceSetAt` | string (UTC date-time) / null | X | 안내 페이스가 마지막으로 바뀐 시각. 단계만 바뀐 발행(같은 페이스)으로는 바뀌지 않는다. 감속 쿨다운·빨라지기 간격·안내 미준수 판단에 쓴다. 없으면 `lastCoaching.appliedAt`을 쓴다(S15P31E105-506). 백엔드는 APPLIED 코칭 중 현재 추천 페이스 streak의 시작 `applied_at`을 보낸다(S15P31E105-516) |
| `context.activeSec` | number | O | 일시정지를 제외한 경과 시간 |
| `context.distanceM` | number | O | 실측 누적 거리 |
| `context.routeProgressM` | number / null | X | 코스 누적 거리 |
| `context.inputAsOf` | string (UTC date-time) | O | 판단에 사용하는 최신 입력 시각 |
| `context.hrReference` | object / null | X | 이전 클라이언트 호환용. 보내도 나이·RHR·HRmax를 기준 계산에 쓰지 않으며 `HR_REFERENCE_INPUT_IGNORED` 경고를 반환한다. |
| `context.lastCoaching` | object / null | X | `coachingId` 양수 int64, `appliedAt`. `guidePaceSetAt`가 없으면 `appliedAt`을 안내가 바뀐 시각으로 쓴다(S15P31E105-506) |
| `context.resumedAt` | string (UTC date-time) / null | X | 재개 시각 |
| `context.bpm` | object / null | X | 시험·시연용 목표 BPM 입력. 백엔드는 보내지 않는다(AI가 DB에서 직접 읽음). 보내면 DB를 읽지 않고 이 값을 쓴다. 아래 "목표 BPM (cueBpm)" 참고 |
| `context.bpm.records[]` | object[] (최대 2000) | X | 지난 러닝의 페이스가 일정한 60초 구간. `runNo`(정수 ≥ 1, 클수록 최근, 같은 러닝은 같은 값), `speedMps`(> 0), `cadenceSpm`(> 0), `cueBpm`(그 구간에 켜져 있던 BPM, 큐를 껐으면 null) |
| `context.bpm.firstMinute` | object / null | X | 이번 러닝 첫 1분의 페이스 일정 구간 평균. `speedMps`, `cadenceSpm`, `cueBpm`. 기록 없는 사용자만 쓴다 |
| `includeForecast` | boolean | X | ODE 남은 구간 HR·완주 예상 요청. 기본 false이며 서버 `DECIDE_FORECAST_ENABLED=false`이면 `forecast.status=DISABLED`. 기능이 켜져 있고 ODE 미준비이면 503 오류 |

`context.goal`의 거리·시간은 JSON integer, 페이스는 JSON integer 또는 실수다. 거리·시간에 정수처럼 보이는 실수(예: `5000.0`)도 허용하지 않는다. 숫자 문자열·boolean·비유한 페이스는 받지 않는다. 거리·시간·페이스 중 최대 두 값을 지정하고, 설정한 값은 모두 양수여야 하며 명시 거리 상한은 45000m다. 페이스는 소수 둘째 자리까지다. 시간은 임의의 제품 상한을 추가하지 않으며, 실제 float 계산으로 표현할 수 없는 정수는 정책 오류 500 대신 요청 검증 `400 VALIDATION_ERROR`로 돌린다. 팀 DB `INTEGER` 저장 범위와 API 범위를 같게 둘지는 별도 고려사항이다. 세 목표를 모두 보내거나 그 밖의 목표 검증에 실패하면 AI04의 기존 공개 요청 검증 분류인 `400 VALIDATION_ERROR`를 반환한다. 이는 AI05의 의미 오류 `422 INVALID_GOAL`과 별개다.

일반 예측 경로에서 `history.hrBpm` 마지막 항목은 t0 실측값이어야 한다. 계획이 있고 `activeSec < plan_hold_sec`일 때는 HR 값이 비어 있어도 t0 한 칸만으로 200 `PLAN_HOLD` 계획 페이스를 안내하며 `HISTORY_TOO_SHORT_PLAN_HOLD`를 붙인다. 이때 GRU 예측은 하지 않고 t0 HR이 위험 기준 이상이면 SAFETY를 우선한다. 계획이 없거나 넘겨주기 뒤에는 기존 422 입력 부족 계약을 따른다. 계획이 있다면 첫 AI04 요청은 t=0초부터 할 수 있다. 24개 미래 속도 표본은 5초 간격이다. 자유러닝의 미래 경사는 요청에서 null로 표현하고 AI 내부에서만 0%로 채운다. `futureGradeUsed` 및 경고에 변환 여부를 기록한다.

학습 심박 기준은 최근 `sessionStartedAt` 순서의 최대 20회에서 GOOD HR을 모아 계산한다. 이때 5초 표본으로 구한 이동 거리 1 km·이동 시간(0.5 m/s 이상 표본) 10분 미만이거나 이동 평균 페이스가 12'00"/km보다 느린(걷기) 러닝은 뺀다(S15P31E105-901, 거리·시간 하한은 AI09 v_ref와 같은 상수). 러닝 수(`hrThresholdRunCount`)와 아래 혼합 비중은 뺀 뒤 수로 정하며 0회면 모집단 값만 쓴다. 12'00"은 V2 Personalized Val 러닝 9,828회 중 0.43%만 이보다 느린 값이다. 위험 기준은 P98, 지속 기준은 P85이며, 기존 ODE `hr_ref`와 같은 정수 반올림 nearest-rank 방식을 쓴다. ODE의 `hr_ref`·History8 입력 계산은 바꾸지 않는다. `_inputs/population_hr_thresholds.json` 중앙값인 모집단 P98 175 bpm·P85 163 bpm과 개인값을 섞는다. 개인 비중은 러닝 수 0~5회 이상에서 `0`, `0.25`, `0.50`, `0.75`, `0.90`, `1.00`이고 6회 이상도 1.00이다. 섞은 값은 `개인값 × 비중 + 모집단값 × (1 − 비중)`이다.

- **위험 기준 = 섞은 P98 + 3 bpm**(정책 `hr_danger_offset_bpm`, 사용자 확정). +3은 섞은 **뒤에** 한 번만 더한다. 일반화만 쓰면 175 + 3 = **178**이다.
- **지속 기준 = 섞은 P85**(더하지 않음). 일반화만 쓰면 163이다.
- 개인 바닥(S15P31E105-901): 섞기 전 개인 P98은 140, 개인 P85는 125 bpm보다 낮게 쓰지 않는다(이미 저장된 낮은 값에도 적용). V2 Personalized Val 실제 러너 108그룹의 개인 P98 최솟값 145·P85 최솟값 127이라 정상 러너 값은 바뀌지 않는다. AI06 응답·DB 값은 바닥 적용 전 원값이다.
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
| `decision` | object / null | 최종 `action`, `chosenIndex`, `recommendedPaceSecPerKm`, `cueBpm`, `predictedHr30Bpm`, `predictedHr60Bpm`, `predictedHr120Bpm`, `routeProgressM`, `basedOnStateVersion`, `expiresAt`, `reason`, `reasonText`, `coachingLevel`. `coachingLevel`은 코칭 단계 `OK`/`CAUTION`/`DANGER`(아래 "코칭 단계", 없어도 되는 칸). `cueBpm`은 `recommendedPaceSecPerKm`의 목표 BPM(60~220 정수)이며 `PLAN_HOLD`·`GUIDE_PACE`·`EASE_OFF`에 모두 넣는다. 계산하지 못하면 null과 경고 `CUE_BPM_UNAVAILABLE` |
| `candidates[]` | object[] | `paceSecPerKm`, `predHrBpm[3]`, `upperHrBpm[3]`, `passed`, `rejectReason`, `score` |
| `pacing` | object / null | `actualMinusGuideSecPerKm`, `etaSec`, `etaMinusGoalSec`, `hrDangerBpm`(섞은 P98 + 3), `hrSustainBpm`(섞은 P85), `hrThresholdSource`(`POPULATION`/`BLENDED`/`PERSONAL`), `hrThresholdWeight`. 선택: `handoverPhase`(`PLAN_HOLD`/`PLAN_BLEND`/`MPC`), `planWeight`(0~1), `gruPersonalWeight`(GRU 개인 g·b 비중 n/(n+50), 미적용 0)·`gruSupportN`(반영 러닝 수) — 두 값은 `GRU_GB_PERSONALIZATION_ENABLED=true`이고 `userId`가 있을 때만 들어간다. |
| `warnings[]` | string[] | 모델·정책 경고 |
| `forecast` | object / null | 요청 및 서버 설정으로 켰을 때 ODE v2.1 남은 거리, 완주 시각, HR 곡선 |
| `hrPersonalized` | boolean | 요청에 `userId`가 있을 때 개인 head 사용 여부 |
| `hrPersonalizationVersion` | integer / null | 적용한 개인화 행 버전. 적용하지 못했으면 null |

`EASE_OFF`·`OVERPACE` 같은 판단·경고가 15초마다 반복될 수 있으므로, 백엔드는 앱에 같은 안내를 반복 표시하지 않도록 권고한다.

`EASE_OFF`(위험 심박 감속 권고)의 `recommendedPaceSecPerKm` = max(안내, min(최근 실측 pace + 30, 걷기 경계)) sec/km다. 안내는 `currentGuidePaceSecPerKm`, 걷기 경계는 `walk_speed_mps` 1.5 m/s = 666.7초/km(11:07)다. 안내가 없으면 min(실측(없으면 `anchorPaceSecPerKm`) + 30, 걷기 경계)다. 기록이 한 칸뿐인 경로도 같다.

- 러너가 안내대로 달리면 안내 + 30이다. 안내를 따르지 않고 빠르게 달리면 권고가 안내에 머물러 같은 안내를 다시 알린다(S15P31E105-506). 예전 max(실측, 안내) + 30(S15P31E105-497)은 러너가 무시하는 동안 30초마다 안내만 30초씩 느려졌다(합성 시뮬레이션 5:30 → 11:07).
- 감속 권고는 지금 안내보다 빠르지 않고(S15P31E105-497), 이어져도 걷기 경계보다 느려지지 않는다(S15P31E105-504). 걷기·멈춤 권고는 두지 않으며 `WALK_ADVISED` 경고는 없앴다.
- 처음 위험이 되면 단계가 `DANGER`로 바뀌므로 페이스가 같아도 백엔드가 알린다(S15P31E105-503). 위험이 이어지면 코칭 없이 2분이 지날 때 백엔드가 지금 안내를 다시 보낸다(아래 "백엔드와의 관계").

### 페이스 선택

S15P31E105-624(v0.5.0). 개인 코칭도 그룹 페이스 AI10과 **같은 선택 규칙·같은 코드**(`ai/service/app/pace_selector.py`)를 쓴다. 예전 후보(±5·±10초/km)는 GRU 2분 예측 차이가 0.4~1.2 bpm뿐이라 여유(4.9~7.5 bpm) 안에 묻혀 사실상 지금 심박만으로 결정됐다(S15P31E105-495).

- 후보: 기준 G(`anchorPaceSecPerKm`, 지금 안내) + (−30, −20, −10, 0, +10, +20, +30, +45, +60)초/km. GRU는 9개 + 실측 1행을 **한 번** 부른다.
- 상한: 늦추는 후보는 2분 뒤 예측 + 감속 여유 `hr_slow_margin_120_bpm`(그 후보의 미래 경사 칸: 평지 4.89, 오르막 5.98, 내리막 6.65, 모름 7.46 bpm). 유지·빠른 후보는 세 지평선마다 예측 + 잔차 여유 표(최근 실측 속도 대비 방향·경사)의 최대.
- 통과: 상한 < 허용선(`pacing`의 P85~P98 사이 진행률 곡선, 마지막 400 m는 위험 기준). 빨라지는 후보는 허용선 − 3 bpm도 통과해야 한다.
- 지금 안내가 통과하지 못하면 통과하는 **가장 빠른 느린 후보**, 없으면 가장 느린 후보(+60)다(`SLOW_DOWN_HR`). 걷기 경계(11:07)보다 느려지면 하한에서 멈추고 `coachingLevel=DANGER`로 올린다(이때 `chosenIndex=null`, `predictedHr*Bpm`은 고른 후보의 예측).
- 지금 안내가 통과하면 목표에 필요한 페이스(`goal`·`plan`으로 구한 값)까지, 30초/km 안에서 통과하는 가장 빠른 후보로 한 번에 올린다(`SPEED_UP_GOAL`, 마지막 400 m면 `SPRINT`). 목표가 없거나 닿을 수 없거나(`GOAL_UNREACHABLE`) 입력이 늦으면(`HR_STALE`) 올리지 않는다. 목표보다 앞선다는 이유로는 늦추지 않는다.
- 쿨다운: 안내가 바뀐 뒤(`guidePaceSetAt`, 없으면 `lastCoaching.appliedAt`)와 재개(`resumedAt`) 뒤 120초는 바꾸지 않는다(`reason=HOLD`, 심박이 허용선 이상이면 `reasonText` "심박 반응 대기…", `coachingLevel=CAUTION`). 위험 심박은 정책 앞단의 SAFETY(`EASE_OFF`)가 쿨다운과 무관하게 먼저 낸다.
- 워밍업: `activeSec` 180초 전에는 +10초/km까지만 늦춘다. 10초/km 미만 변화는 유지다.
- AI04 전용 보정(리드 결정 2026-11-10, AI10은 그대로):
  - 감속 기준: 러너가 안내보다 느리면(최근 실측 pace > 안내) 느린 후보는 max(안내, 실측) + (10, 20, 30, 45, 60)초/km이다. 이 행들은 같은 GRU 호출에 덧붙여 예측하고, 고르면 `chosenIndex=null`, `predictedHr*Bpm`은 그 페이스의 예측이다. 응답 `candidates[]`는 요청 9개 그대로다.
  - 위험: 안내 그대로 후보의 2분 예측 자체(여유 없이)가 허용선 이상이면 쿨다운 중에도 늦추고 출발 180초 +10 상한도 걸지 않는다.
- 응답 `candidates[]`는 요청 후보 9개 그대로이고, 각 `passed`는 위 통과 규칙(빠른 후보는 −3 bpm 포함), `rejectReason`은 `UPPER_OVER_ALLOW` 또는 `SAFETY`, `score`는 선택에 쓴 상한 − 허용선(음수일수록 여유, 표시용)이다.
- 정책 설정의 `hr_slow_steps_sec_per_km`, `speed_up_steps_sec_per_km`, `early_slow_cap_*`, `hr_slow_cooldown_sec`, `hold_sec`는 v0.5.0 선택에 쓰지 않는다(호환을 위해 검증만 유지). 쿨다운·워밍업 값은 AI10과 같은 상수다.

**안내 미준수**(AI04 전용, 그대로)
- 심박 감속이 필요한데(`SLOW_ONLY`) 러너가 안내보다 `not_following_sec_per_km`(10초/km) 이상 빠르면, 안내를 더 늦추지 않고 같은 안내를 다시 알리며 단계를 한 칸 올린다(보통 CAUTION → DANGER). `reason=SLOW_DOWN_HR`, `publishSuggested=true`, 경고 `GUIDE_NOT_FOLLOWED`, `reasonText`는 "안내를 따르지 않음…".
- 안내가 바뀐 뒤 `not_following_grace_sec`(60초)는 러너가 따라올 시간으로 두고 판단하지 않는다. 그 뒤로는 쿨다운 중에도 같게 둔다.
- 위험 단계(`EASE_OFF`)는 위 실측 기준 공식으로 같은 효과를 낸다.

**비교(S15P31E105-624)**: 같은 입력에서 이전(v0.4.3)과 새 규칙의 허용선 초과 시간·10분당 페이스 변경 수·목표 대비 평균 감속·결정이 다른 수는 S15P31E105-624 MR 본문에 남긴다. V2 Val 40회(폐루프): 허용선 초과 2.85% → 3.73%, 10분당 변경 0.85 → 0.65회, 같은 입력 결정 30.5% 다름. 리드 실기기 6회: 목표 대비 평균 감속 +95 → +20초/km.

아래 표는 v0.4.3(S15P31E105-506) 때의 기록이다.

**합성 러너 시뮬레이션** (`ai/service/tools/simulate_hr_loop.py`, 실제 GRU, 15분, 백엔드 30초 발행 간격·단계 변경 발행(503) 흉내, 러너 심박은 합성 수식: 속도 기울기 25 bpm/(m/s)로 60초/km 감속이 2분 뒤 −11 bpm, 시간 상수 40초, 허용선 163)

| 상황 | 수정 전(v0.4.2) 페이스 메시지(+단계 변경) / 허용선 넘은 시간 / 최고 심박 / 가장 느린 안내 | v0.4.3 |
| --- | --- | --- |
| 평지, 심박 drift 0.6 bpm/분 | 10(+8) / 0초 / 158.0 / 6:20 | 5(+3) / 0초 / 158.0 / 6:25 |
| 평지, 심박 drift 1.5 bpm/분 | 26(+1) / 0초 / 158.9 / 7:40 | 7(+5) / 0초 / 158.9 / 7:35 |
| 700~1300 m 오르막 6% 뒤 평지 | 16(+2) / 185초 / 166.2 / 6:25 | 5(+2) / 0초 / 159.7 / 7:40 |
| 안내 무시(늘 5:30, drift 1.5) | 29(+0) / 661초 / 179.5 / 11:07 | 2(+13) / 661초 / 179.5 / 6:00 |

- 시간 상수 60초나 기울기 30에서도 같은 방향이다. 출발 3분 제한을 끄면 메시지가 1~2개 늘고 처음에 더 늦췄다.
- 언덕에서 최고 심박이 허용선보다 꽤 낮은데 7:40까지 늦춘 것은 GRU가 큰 감속의 효과를 실제보다 작게 예측하기 때문이다(495 재학습 대상).
- 안내 무시에서 단계 변경 13회는 단계만 바뀐 발행이 `lastCoaching.appliedAt`을 새로 써서 미준수 유예(60초)가 다시 시작되며 DANGER·CAUTION이 오간 것이다. 백엔드가 `guidePaceSetAt`(페이스가 바뀐 시각)을 보내면 1회로 줄었다.
- 합성 심박이라 숫자는 방향을 보는 용도다. 실제 러너가 안내를 따른 기록으로는 확인하지 못했다.
- 바꾸지 않은 것: 요청 후보(백엔드 −10~+10 그대로), 여유 표(`margin_gru.json`), 목표 −30 후보.

**백엔드와의 관계** (S15P31E105-503 병합 코드 기준)
- 단계 변경 발행은 `publishSuggested=true`일 때만 한다. 안내 미준수와 위험 감속 권고는 `publishSuggested=true`라 같은 페이스여도 단계가 바뀌면 알린다. 쿨다운 중 `HOLD`는 `false`라 보내지 않는다.
- 위험이나 안내 미준수가 이어져 페이스·단계가 같으면 새로 보내지 않고, 코칭 없이 2분이 지나면 백엔드가 지금 안내를 다시 보낸다(`reevaluationDue`). 따로 재알림 규칙은 필요 없다.
- `guidePaceSetAt`(S15P31E105-516): 백엔드가 안내 페이스가 마지막으로 바뀐 시각을 보낸다(단계만 바뀐 발행으로는 바꾸지 않음, 인계 I-4). 보내지 않으면 단계만 바뀐 발행도 `lastCoaching.appliedAt`을 새로 써서 안내 미준수 유예(60초)가 다시 시작되고, 무시가 이어질 때 DANGER·CAUTION이 오간다.

### 코칭 단계 (coachingLevel)

`decision.coachingLevel`은 러너의 심박 상태로 코칭을 세 단계로 나눈다(S15P31E105-504). 안내 페이스를 러너 페이스로 옮기지는 않는다. 백엔드 저장·전달·발행은 S15P31E105-503이다.

| 값 | 판정 | `recommendedPaceSecPerKm` |
| --- | --- | --- |
| `OK` | 아래 둘 다 아님. 러너가 안내보다 빨라도 막지 않는다 | 보통 지금 안내 그대로. 목표보다 앞서 있다는 이유로는 늦추지 않는다. 목표에 뒤처지면 올리는 판단(`SPEED_UP_GOAL`)은 그대로 |
| `CAUTION` | 안내 페이스로도 예측 상한이 허용선 이상(`SLOW_DOWN_HR` gate), 과속 감지 `OVERPACE`, 또는 러너가 지금 실측 속도로 2분 달릴 때의 예측 상한이 허용선 이상 | 안내로 돌아오라는 뜻. 추천은 MPC 판단 그대로라 보통 지금 안내이고, 안내 페이스로도 허용선 이상이면 통과하는 가장 빠른 느린 후보로 늦춘다(`SLOW_DOWN_HR`, 쿨다운 중이면 안내 유지) |
| `DANGER` | 위험 심박(`action=EASE_OFF`, `status=SAFETY`), 심박 감속이 걷기 경계 하한에 닿음, 또는 심박 감속이 필요한데 러너가 안내를 따르지 않음(S15P31E105-506) | 위 감속 권고, 하한 페이스, 또는 같은 안내 |

- 실측 속도 예측: 요청 후보 9개는 그대로 두고, 안내 그대로 후보(`anchorPaceSecPerKm`)를 복사해 미래 속도만 최근 실측 평균 속도로 바꾼 행을 GRU 배치에 덧붙여 같은 호출로 예측한다. 여유분(margin)과 경사는 그 후보와 같은 칸을 쓴다. 실측 속도가 걷기 경계 미만이면 덧붙이지 않는다.
- 설정: `policy_v03.json`의 `actual_pace_check_enabled`(기본 true). 배포에서 환경변수 `AI04_ACTUAL_PACE_CHECK_ENABLED=true|false`로 바꿀 수 있다. 끄면 실측 속도 예측을 하지 않고, `CAUTION`은 `SLOW_DOWN_HR` gate와 `OVERPACE`로만 정한다. GRU가 작은 페이스 차이를 잘 구분하지 못하는 문제가 해결되기 전에는 운영에서 결과를 보고 켤지 정한다.
- 기록이 한 칸뿐인 경로(예측 없음)는 실측 심박이 위험 기준 이상이면 `DANGER`, 아니면 `OK`다. 판단이 없으면(`decision=null`, `NOT_RUNNING` 등) 단계도 없다.
- OK와 CAUTION은 추천 페이스가 같을 수 있다. 백엔드는 단계가 바뀌면 페이스·BPM이 같아도 발행하기로 한다(S15P31E105-503).

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

미래 경사를 모르면(자유러닝) GRU는 평지(0%)로 예측하지만, 상한의 여유분(margin)은 여유 표(`policy/data/margin_gru.json`)에서 그 지평선·방향의 모든 경사 칸 중 가장 큰 값을 쓴다(`residual_margin.py`, 경고 `GRADE_UNKNOWN`). 120초 기준 평지 칸보다 1.5~3.3 bpm 크다. 평지 칸을 쓰자는 의견(인계 I-24)이 있었으나 정책 담당의 검증에서 이쪽이 더 정확해 유지한다(2026-11-06 확인).

### 러닝 초반 계획 넘겨주기

`pacing.handoverPhase`, `pacing.planWeight`는 `context.activeSec` 기준 단계(`plan_hold_sec` 60초 전 `PLAN_HOLD`, `plan_blend_end_sec` 180초까지 `PLAN_BLEND`, 그 뒤 `MPC`)를 알리기만 한다. v0.5.0부터는 고르는 후보를 바꾸지 않는다(S15P31E105-624). 출발 직후에는 백엔드 기준 페이스가 계획 구간 pace이고, 심박이 허용선 아래면 그대로 유지하며, 출발 180초 동안은 감속을 +10초/km까지만 한다(위 "페이스 선택"의 워밍업). 기록이 한 칸뿐인 `PLAN_HOLD` 경로(예측 없음)는 그대로다.

**고려사항(팀 합의 필요):** 백엔드가 AI04 호출 시 사전 계획 구간 비율(`context.plan`)과 예상 완주시간(`goal.targetDurationSec` = personal-plan `predictedFinishSec`, M-A)을 넘겨야 함. 넘기지 않으면 계획 유지 구간은 현재 안내 pace 유지로 동작한다.

### 목표 BPM (cueBpm)

AI04는 추천 페이스를 사용자의 목표 BPM으로 바꿔 `decision.cueBpm`에 넣는다. 계산은 `ai/bpm/target_bpm.py`를 그대로 쓰며(S15P31E105-416), 근거와 실험 결과는 `ai/bpm/README.md`에 있다.

사용자 기록은 백엔드가 보내지 않고 AI가 읽기 전용 DB(`AI_DB_URL`)에서 직접 만든다(S15P31E105-438, 백엔드 합의).

- 사용자 찾기: `context.sessionId`의 `running_sessions.user_id`.
- 지난 기록: 그 사용자의 완료 러닝(`COMPLETED`, 미삭제, 최근 종료 순 40회)의 `running_metric_samples`를 60초 칸(`elapsed_duration` 기준)으로 묶고, 속도 1.5 m/s 이상·케이던스 120~230 spm 측정만 쓴다. 측정 4개 이상, 속도 변동계수 5% 이하, 케이던스 표준편차 5 spm 이하인 칸만 페이스가 일정한 구간으로 본다.
- 그 구간의 BPM: `session_control_events`의 적용된(`APPLIED`) `SET_BPM`·`COACHING` `target_bpm`을 시간순으로 되짚는다. 러닝 시작 때 처음 튼 BPM은 DB에 남지 않으므로 첫 BPM 변경 전 구간과 구간 안에서 BPM이 바뀐 구간은 쓰지 않는다.
- 이번 러닝 첫 1분: 이번 세션의 첫 일정 구간. 아직 BPM을 바꾼 적이 없으면 `running_sessions.current_bpm`을 그때 BPM으로 본다.
- 캐시: 지난 기록은 사용자별 300초, 첫 1분은 찾으면 세션 동안 기억한다. DB 조회 제한 시간은 한 번에 300ms다.
- 세션 캐시(`BPM_LOOKUP_CACHE_ENABLED`, 기본 켬): `user_id`는 바뀌지 않고 `current_bpm`은 첫 1분을 찾기 전에만 쓰므로, 첫 1분을 찾은 세션은 세션 조회를 다시 하지 않는다(세션 최대 1024개, 3600초 만료). 일정 구간이 아직 없으면 BPM 변경 기록도 읽지 않는다. 결과는 끈 경로와 같다.
- DB 권한: `runway_ai`는 `running_metric_samples`의 `running_session_id`·`measured_at`·`elapsed_duration`·`speed`·`cadence`, `session_control_events`의 `session_id`·`action`·`target_bpm`·`result`·`applied_at` 칸만 읽는다(`infra/ai/grant-readonly.sh`). BPM 조회는 위 칸만 쓴다. 시연 콘솔·워치 화면 실시간 측정값(S15P31E105-912)만 추가로 `heart_rate`·`is_hr_measured`·`total_distance` 칸을 읽는다(AI07, 부여·롤백 절차는 AI07 표 '실시간 측정값'). 경사·진행 거리·기기·ID 칸은 읽지 않는다.

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
- 예외(S15P31E105-421): 2분 재평가에서 현재 BPM이 아직 없으면(출발 직후) `publishSuggested=false`여도 AI 판단의 페이스·`cueBpm`을 보내 첫 BPM을 정한다. `publishSuggested=false`이고 현재 BPM이 있으면 현재 안내 페이스·BPM을 유지한다.
- 사용자 BPM(S15P31E105-421, 2026-11-05 확정): 러닝 시작 뒤 사용자가 직접 바꾼 BPM이 적용되면 그 러닝이 끝날 때까지 `cueBpm`으로 덮어쓰지 않는다(출발 전 선택은 제외).
- `cueBpm=null`(S15P31E105-421, 2026-11-05 확정): 현재 BPM을 유지하고, 현재 BPM도 없으면 그 코칭을 보내지 않는다.
- 상세는 [백엔드 호출 구현](#백엔드-호출-구현-s15p31e105-421).

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

### 백엔드 호출 구현 (S15P31E105-421)

백엔드(`SessionCoachingService`·`CoachingInputAssembler`·`AiPaceDecideHttpClient`)는 아래처럼 AI04를 호출한다. 팀 합의 표의 해당 항목(N2·N7-2·N7-5·O5·O14)에 대한 백엔드 기준이다.

| 항목 | 백엔드 기준 |
| --- | --- |
| 호출 시점 | 새 W07 batch 저장 커밋 뒤(중복 ACK 제외), 폰의 S10 구독이 있는 세션만. 세션당 직전 호출 시작 후 15초가 지나야 다시 부른다. 판단 실행은 2개 스레드이며 같은 세션은 동시에 하나만 판단한다 |
| 호출 전 입력 확인 | `running_metric_samples` 최근 30분을 5초 칸으로 묶어 칸마다 지표별 마지막 값을 쓴다. 입력 기준시각(`inputAsOf`)은 심박·속도의 최신 측정시각과 t0 표본(경과초가 가장 큰 표본)의 측정시각 중 가장 오래된 시각이며, 서버 시각보다 늦으면 서버 시각으로 본다. t0 칸의 실측 심박이 없거나 `inputAsOf`가 12초 이상 지났으면 호출하지 않는다. 20초 유효시간에서 발행 하한(남은 5초)과 호출 상한(3초)을 뺀 값이다 |
| `elapsedSec`·`activeSec` | t0 표본의 `elapsed_duration`. 워치 Health Services의 active duration이라 일시정지를 제외한 값이다 |
| `mode` | 코스 있음 `COURSE`, 목표 있음 `FREE_WITH_GOAL`, 없음 `FREE_NO_GOAL`(N7-3 잠정) |
| `anchorPaceSecPerKm`(=`currentGuidePaceSecPerKm`) | 마지막 APPLIED 코칭의 추천 페이스 → 현재 거리의 계획 구간 페이스 → 계획 추천 페이스 → 목표 페이스 → 최근 60초 실측 평균 페이스 순. 120~1800초/km를 벗어나면 호출하지 않는다 |
| `guidePaceSetAt` | APPLIED 코칭을 최신순으로 보며 현재 추천 페이스와 같은 streak의 시작 `applied_at`. 적용 코칭이 없으면 null. `lastCoaching`은 최신 APPLIED 한 건 그대로(S15P31E105-516) |
| `plan` | 최신 `pace_plans`의 구간. `ratio = 구간 페이스 ÷ 계획 추천 페이스`(O7) |
| 코스 진행거리·미래 경사 | 워치가 `routeProgressM`을 보내지 않으므로 저장값이 없으면 누적 거리를 코스 거리 안으로 잘라 쓴다. 후보마다 t0+5k초 위치의 `courses.elevation_profile` 100m 경사를 넣고, 한 칸이라도 범위 밖이면 null. 자유러닝은 null |
| `userId` | 건강정보 동의 사용자만(동의하지 않으면 자동 코칭 자체를 하지 않는다). `context.bpm`·`hrReference`는 보내지 않는다 |
| 시간 상한·실패 | 연결 1초, 전체 3초. timeout·연결 실패·4xx·5xx·응답 형식 위반은 저장 없이 끝내고 재시도하지 않는다. 로그에는 HTTP 상태·`code`·실패 종류만 남긴다 |
| 확정 | 세션 잠금 아래에서 `stateVersion`이 호출 때와 같고 `decision.basedOnStateVersion`과도 같은지, 발행 전제(RUNNING·워치 기록·동의·그룹 미종료·미확정 명령 없음)를 다시 확인한다 |
| 발행 규칙 | `decision=null`·`NOT_RUNNING`은 저장하지 않는다. 2분 재평가 시점에 `publishSuggested=true`면 AI 판단을 보내고, `false`면 AI가 고른 페이스 대신 **현재 안내 페이스·현재 BPM을 그대로** 유지 안내로 보낸다(작은 차이가 쌓여 안내가 한쪽으로 밀리지 않게, 2026-11-05 사용자 확정). 현재 BPM이 아직 없으면(출발 직후) AI 판단을 그대로 보내 BPM을 처음 정한다. 이어지는 `EASE_OFF`가 현재 안내보다 10초/km 미만으로만 느리면 2분 재평가에서도 현재 안내를 유지한다. 유지 안내에는 AI 예측 심박을 저장하지 않는다(단계는 AI 값을 저장). 2분 전에는 `publishSuggested=true`이고 (페이스 또는 BPM이 현재 안내와 다르거나, APPLIED 마지막 코칭의 `coachingLevel`과 AI `coachingLevel`이 둘 다 non-null이며 다를 때) 보낸다. AI가 안내 페이스를 바꾼 `GUIDE_PACE`는 바로 보낸다(페이스 변경의 120초 쿨다운·10초/km 유지는 AI04가 한 곳에서 맡는다, S15P31E105-624). 페이스가 그대로이고 단계·BPM만 바뀌는 발행은 마지막 적용(시작·재개·코칭) 후 30초가 지나야 한다. 한쪽 단계가 null이면 단계 변경으로 보지 않는다(S15P31E105-503). 첫 `EASE_OFF`는 30초 제한의 예외이며, 직전에 보낸 코칭도 `EASE_OFF`였으면 30초를 지키고 현재 안내보다 10초/km 이상 느릴 때만 보낸다(직전 종류는 서버 메모리에 기억, 재시작 시 초기화. 2026-11-05 사용자 확정) |
| BPM | 러닝 시작 뒤 사용자가 직접 바꾼 BPM(`SET_BPM`, 적용시각 ≥ 시작시각)이 적용된 적이 있으면 AI `cueBpm` 대신 현재 BPM을 러닝이 끝날 때까지 유지한다(페이스 안내는 계속, 2026-11-05 사용자 확정). `cueBpm=null`이면 현재 BPM으로 보내고, 현재 BPM도 없으면 보내지 않는다(N7-2 백엔드 기준). 작은 BPM 변화는 백엔드가 따로 거르지 않는다(AI는 같은 지난 기록·같은 추천 페이스면 같은 `cueBpm`을 준다, S15P31E105-462 합의) |
| 저장 | `coaching_decisions`에 `elapsed_duration=elapsedSec`, 추천 페이스, 보낸 BPM, 예측 심박 30/60/120, `route_progress=decision.routeProgressM`, `based_on_state_version`, `expires_at = min(생성 + 20초, inputAsOf + 20초, decision.expiresAt)`, `coaching_level=decision.coachingLevel`(없으면 null). 남은 유효시간이 5초 미만이면 보내지 않는다. `EASE_OFF`도 같은 방식으로 저장한다(O5 백엔드 기준). model/policy 버전은 저장하지 않는다(O6 미적용) |
| 설정 | `BACKEND_AI_BASE_URL`(`runway.coaching.ai.base-url`). AI06(`runway.ai.hr.base-url`)과 같은 HR 추론 서버 주소 변수를 함께 쓴다. 코스 추천 Route는 `BACKEND_ROUTE_BASE_URL`로 별도다. 비면 기동은 하고 자동 코칭을 하지 않는다. 더미 추천으로 대체하지 않는다 |

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
| `gradeFilledRunCount` | integer | 사용한 support 러닝 중 경사를 0%로 채운 러닝 수 |
| `gradeMissingRatio` | number | 사용한 support 러닝 전체 행 중 원래 경사가 결측인 행 비율. 소수점 넷째 자리까지 반올림하며 행이 없으면 0.0 |
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

`GRU_GB_PERSONALIZATION_ENABLED=true`(기본 false, S15P31E105-641)이면 AI06이 같은 호출에서 기본 GRU의 support 예측으로 개인 g·b를 계산해 `summaryU` 객체 안에 `gruGain`(0.5~2.0), `gruOffsetBpm`(±8), `gruSupportN`(쓴 러닝 수)을 추가한다. 응답 최상위 필드는 바뀌지 않으며, 백엔드는 `summaryU`를 그대로 `user_hr_personalization.summary_u_json`에 저장하므로 DB migration·백엔드 변경이 없다. ODE는 `summaryU`의 정해진 27개 이름만 읽는다. 계산에 실패하면 세 키를 넣지 않고(AI04·AI10은 보정 없음) 로그만 남긴다.

채점 가능한 window가 없으면 `gruPersonalization=null`과 `GRU_PERSONALIZATION_NO_SUPPORT_WINDOWS` 경고를 반환한다. Support 품질은 ODE와 같이 `GOOD`·`LOW`를 유효값, `MISSING`을 결측으로 본다. `UNUSABLE` 러닝은 제외하며 채점 HR은 `hrIsFilled=false`여야 한다. GRU predictor의 평가 mask에 맞춰 허용된 `LOW` HR을 `GOOD`으로 변환한다.

`userId`와 `sessions[].sessionId`는 양수 int64 서버 ID이며 응답의 `userId`도 정수다. legacy 호환용 ID 십진 문자열 입력은 현재 코드에서 정수로 정규화하지만, 그 외 새 AI04/AI05/AI06 숫자 필드는 JSON integer 또는 실수만 허용한다. 팀 전체 BIGINT wire 정책을 정한 것은 아니다. API03의 `history.gradePct`/`futureGradePct`는 유지한다. W07·AI05·AI06의 `gradePercent`는 별도 경계 필드다.

AI06은 `elapsedSec=0`부터 중복 없는 5초 격자 표본을 요구한다. 최신 GitLab W07은 최대 5초 단위 batch 수집을 뜻할 뿐, 각 항목이 균일한 5초 격자이거나 AI06 품질 필드가 같은 뜻이라는 보장은 아니다. 그래서 W07 payload를 그대로 AI06 요청으로 전달할 수 없다. 재표본화·결측·품질 변환은 [W07 → AI06 변환 규칙](w07-ai06-conversion.md)을 따른다(S15P31E105-411). 같은 문서 7절의 열린 질문은 백엔드(S15P31E105-410)와 합의해 확정한다.

ODE 오류 상태 코드는 유지한다. ODE가 준비되지 않았거나 입력·계산이 실패해도 이미 계산한 `gruPersonalization` 블록은 오류 응답에 포함한다. 원본 샘플은 요청 종료 뒤 저장하지 않는다. 백엔드가 ODE와 GRU 블록을 각각 `user_hr_personalization`과 `user_gru_personalization`에 저장하는 방식을 합의한다.

### 경사(grade) 결측 처리

유효한 경사가 없는 러닝도 개인화에 사용할 수 있다. 기존 전처리에서 제외되는 러닝에만 경사 보완을 시도한다. 경사 값이 유한하지 않거나 품질이 `GOOD`·`LOW`가 아닌 행을 0%(평지), 품질 `LOW`로 채운 뒤 다시 검사한다. 통과한 러닝은 요약·이력·P4 적합·출발 HR 계산에 온전히 포함한다. 개인 P98·P85 계산은 이 입력 검사(시작 심박·60초 안 속도+경사)를 요구하지 않는다(S15P31E105-901). 5초 격자와 위 러닝 기준(1 km·이동 10분·12'00"/km)만 통과하면 GPS·경사 없는 워치 러닝(걸음 기반 거리)도 쓴다.

보완한 러닝이 하나라도 사용되면 기존 경고 뒤에 `GRADE_FILLED_0`을 붙인다. 성공 응답에는 `gradeFilledRunCount`와 `gradeMissingRatio`를 항상 포함한다. 기존에 통과하던 고도 있는 러닝의 계산값과 경사 결측에 대한 30초 LOCF(이전 값 유지)·잘라내기 규칙은 바꾸지 않는다. 출발 HR·속도·2분 이상 조건을 만족하는 러닝이 하나도 없으면 여전히 422 `INPUT_INSUFFICIENT`를 반환한다.

백엔드에서 코스 경사로 채우는 방식은 백엔드와 합의할 후보.

## AI07 — 시연 SSE

`GET /v1/demo/sessions/{sessionRef}/events` — `DEMO_STREAM_ENABLED=false` 기본. 시연 때만 켠다.

| 항목 | 규약 |
| --- | --- |
| 인증 | `Authorization: Bearer <view token>`. query token 거절. 단 `sessionRef=latest`는 시연 대상 회원 목록(`userAllowlist`)이 비어 있지 않을 때 토큰 없이 열린다(S15P31E105-900, 랜딩 Live). 이때 이전 기록 목록(`sessions`·`SESSIONS`)은 싣지 않는다. 숫자 세션·그룹 키·`h<id>` 지난 기록은 토큰 필요, 틀린 토큰은 401 |
| 이벤트 | `SNAPSHOT`, `MPC_TRACE`, `COURSE_UPDATE`, `HEARTBEAT`, `SESSION_SWITCH`(latest만), `LIVE_METRICS`(`liveMetricsSec`가 켜져 있을 때만) |
| latest 따라가기 | 진행 중 러닝(마지막 판단이 개인 30초·그룹 90초 이내) 중 그룹런 우선, 다음 가장 최근 시작을 보여 준다. 새 러닝 시작·보던 러닝 종료 때 `SESSION_SWITCH {sessionId\|null}`를 보내고 닫는다(콘솔은 바로 다시 연결). 진행 중인 것이 없으면 `SNAPSHOT {sessionId: null, waiting: true}` 뒤 새 러닝을 기다린다 |
| 실시간 측정값 | S15P31E105-912. 판단(`MPC_TRACE`) 주기 사이에 콘솔·워치 시연 화면 숫자가 멈추지 않게, 시연 대상 회원의 최신 심박·실제 페이스·거리를 `LIVE_METRICS {runners:[{label, hrBpm, speedMps, paceSecPerKm, distanceM, elapsedSec, measuredAt}]}`로 보낸다. **기본 꺼짐.** 시연 설정 `liveMetricsSec`(null=끔, 3~30초, 권장 5)가 있고 `userAllowlist`가 정해졌을 때만 켠다(목록이 null이면 꺼짐). **설정값이 범위 밖·문자열·bool이면 시연 설정 전체가 거부되어 시연 기능(콘솔·워치 화면) 전체가 꺼진다.** 옛 이미지는 모르는 키를 무시하므로 설정을 이미지보다 먼저 넣어도 안전하다. 콘솔 SSE가 연결돼 있는 동안만, 시연 버퍼에 이미 기록된 세션만 AI 읽기 전용 DB로 `running_metric_samples` 최근 행을 읽는다. 개인 세션은 버퍼 기록만으로는 대상 회원인지 알 수 없어(AI08 시연 batch는 회원을 확인하지 않음) `running_sessions.user_id`가 `userAllowlist` 안일 때만 읽고, 확인하지 못하면 읽지 않는다. 그룹은 참가자 중 `userAllowlist` 회원만 지도와 같은 `러너 N` 라벨로 읽고, 목록 밖 회원은 세션도 찾지 않는다. 한 러너의 조회 실패는 다른 러너를 막지 않으며, 이번 대상에서 사라진 라벨은 지운다. `hrBpm`은 최근 15초 안에 측정된 심박만(없으면 null), `speedMps`·`paceSecPerKm`은 최근 60초 속도 평균(724 '실제' 기준과 같음, 정지면 `paceSecPerKm` null), `distanceM`은 최근 30초 안의 마지막 누적 거리. 값이 바뀔 때만 보내고 `SNAPSHOT.liveMetrics`로 첫 값을 준다(꺼져 있으면 키 없음, `h<id>` 지난 기록에는 없음). `HEARTBEAT`는 그대로 15초마다 나간다. 회원 ID·세션 ID는 싣지 않고 로그에도 남기지 않는다. DB 오류·지연은 실시간 측정값 경고 1회 뒤 무시하고 판단 SSE는 계속 보낸다(DB 계층의 `AI_DB_UNAVAILABLE` 경고는 실패마다 남는다. GRANT가 없으면 `sqlstate 42501`). 지도 조회와 같은 DB 연결 1개를 번갈아 쓰며, 1초 안에 얻지 못하면 그 주기는 건너뛰고 마지막 값을 둔다. 기존 이벤트·필드는 바뀌지 않는다(모르는 이벤트는 옛 화면이 무시). **공개 범위:** 토큰 없는 `latest`에도 실린다. `userAllowlist`에 넣는 운영자가 해당 회원의 동의를 책임지고, 동의를 철회하면 목록에서 빼고 AI를 재기동한다. **권한 부여:** `heart_rate`·`is_hr_measured`·`total_distance` 열 권한은 master 배포 때 AI CD(`Jenkinsfile.ai-cd`)가 `grant-readonly.sh`를 자동 실행해 `runway_ai`에 준다(`liveMetricsSec`가 꺼져 있어도 부여됨). **롤백:** 912 이전 커밋으로 되돌리기 전에 먼저 `REVOKE SELECT (heart_rate, is_hr_measured, total_distance) ON public.running_metric_samples FROM runway_ai;`를 실행한다(옛 스크립트가 `heart_rate` 미부여를 검사해 배포를 멈춘다). 또는 `infra/ai/deploy.sh`로 이전 이미지를 직접 지정한다 |
| 연결 상한 | 세션당 화면 50개(대기 연결도 같은 상한), 넘으면 429 |
| 코스 표시 | `SNAPSHOT.course`와 `COURSE_UPDATE.course`는 `{lengthM, points}` 형식이다. W07 `GPS_POINT.coordinates`와 `altitudeM`로 만든 메모리 내 경로이며, 각 point는 `[longitude, latitude, altitudeM|null, distanceM]`다. 고도 표본이 2개 미만이면 고도 단면은 비워 둔다. 새 W07 위치가 들어오면 `COURSE_UPDATE`로 열린 콘솔을 갱신한다. |
| 전송 | SSE, `Cache-Control: no-cache`, Nginx proxy buffering off |
| trace 전 연결 | 허용된 세션은 trace가 아직 없어도 연결할 수 있다. 이때 `SNAPSHOT.traces`는 빈 배열이며, 코스 데이터가 있으면 snapshot과 이후 `COURSE_UPDATE`로 표시한다. |
| 오류 | 공통 오류 body. 비활성화 503 `DEMO_DISABLED`, 인증 실패 401, 허용되지 않은/없는 세션 404, 429 연결 제한 |

### 시연 설정 파일의 계정 전용 키 (S15P31E105-913)

`DEMO_CONFIG_PATH`가 가리키는 `demo_config.json` 최상위의 **선택** 키다. 모두 없으면 이전과 동작이 완전히 같다. 대상은 `userAllowlist` 회원뿐이다. 운영 서버의 파일 수정과 AI 재시작은 사람이 한다(코드·AI 에이전트가 하지 않는다).

| 키 | 형식·기본값 | 효과 |
| --- | --- | --- |
| `hrThresholdOverrides` | 객체, 기본 없음. 키는 **userId 문자열**(`"11"`, 양의 정수, `"011"`·공백 불가). 값은 `{"sustainBpm": 163, "dangerBpm": 178}`; `dangerBpm` 생략 시 `sustainBpm + 15`. 둘 다 35~220 bpm이고 `sustainBpm < dangerBpm`. 키는 반드시 `userAllowlist`에 있어야 한다(없거나 목록이 null이면 거부) | 그 회원은 DB 학습값·모집단 섞기·위험 오프셋(+3)·준비도 보정(`READINESS_ADJUST_ENABLED`)을 모두 쓰지 않고 이 값을 허용선(진행률 0)·위험선으로 쓴다. 개인 러닝(AI04 decide, 1칸 PLAN_HOLD 포함)·그룹런(AI10)·시연 콘솔 trace가 같은 값을 보인다. AI10의 허용선은 진행률에 따라 `sustainBpm`에서 `dangerBpm`까지 오른다. 응답 `hrThresholdSource`는 `PERSONAL`, 비중 1.0이며 준비도 필드(`readiness*`)는 null이다. GRU 개인 g·b 예측 보정은 이 키와 무관하다 |
| `speedUpStepSec` | 10 / 20 / 30, 기본 10 | 시연 회원이 낀 그룹의 여유 가속 1회 폭(초/km). 10의 배수만 허용한다(후보 페이스 간격) |
| `speedUpCalmSec` | 30~300초, 기본 60(`GROUP_PACE_AHEAD_STREAK`×30) | 여유 확인 기간. 각 회원의 최근 이 시간 실측 심박이 모두 허용선 − 여유 기준 아래여야 한다 |
| `speedUpMarginBpm` | 0~40 bpm, 기본 `GROUP_PACE_AHEAD_MARGIN_BPM`(15) | 여유 기준 |
| `speedUpWarmupSec` | 0~3600초, 기본 60 (기존 S15P31E105-728) | 출발 뒤 여유 가속 대기 시간 |
| `speedUpForceAfterSec` | 0~600초, 기본 없음(끔). `null`도 끔 (S15P31E105-915) | 시연 회원이 낀 `TOGETHER` 그룹은 출발 후 이 시간이 지난 첫 판단에서 **여유 가속을 강제로 한 번** 낸다(아래) |

**강제 여유 가속(`speedUpForceAfterSec`).** 시연 회원(`userAllowlist`)이 한 명이라도 낀 `TOGETHER` 그룹이 `elapsedSec ≥ speedUpForceAfterSec`이고 현재 공동 페이스가 출발 추천 페이스 − `speedUpStepSec`(미설정 시 30)보다 느리면, 기존 선택(감속·유지·여유 가속 막힘)과 관계없이 **출발 추천 페이스 − `speedUpStepSec`**(예: 540 → 510)로 한 번 올린다. 심박 누락(`NOT_ALL_HR`)·여유 부족(`NO_MARGIN`·`NOT_STEADY`)·쿨다운·대기·이전 `HR_LIMIT` 감속은 보지 않으며, 출발 직후 감속으로 현재 페이스가 출발보다 느려진 경우에도 목표는 같다. `reason`은 기존 `AHEAD`, 응답 필드는 바뀌지 않는다(콘솔 trace의 `group.ahead.forced=true`와 `forceAhead`가 이 경우를 표시하고, 콘솔 카드는 일반 여유 가속(▲ 페이스 올림)으로 뜬다). `GROUP_PACE_AHEAD_ENABLED`와 무관하게 동작한다.

- **안전장치**: 참가자 중 한 명이라도 **가장 최근 실측 심박이 그 회원의 위험선(`hrThresholdOverrides`의 `dangerBpm` 포함) 이상**이면 내지 않는다(`forceAhead.blockedBy=DANGER_HR`). 위험선은 AI10 판단에 쓰인 회원별 값이다.
- **한 번만**: 이미 `현재 ≤ 출발 − step`이면 내지 않고, 강제 시각 이후 페이스가 한 번이라도 바뀌었으면(우리 가속이거나 그 뒤 안전 감속) 다시 내지 않아 감속과 싸우지 않는다. 판단이 약 30초 간격이므로 `speedUpWarmupSec`와 같은 시각(권장 60)을 넣으면 출발 후 약 69초 판단에서 난다.
- 막힌 이유는 trace `forceAhead.blockedBy`(`WAITING`·`DANGER_HR`·`ALREADY_FAST`·`ALREADY_FORCED`·`GOAL_MODE`·`NO_START_PACE`)로 본다. 설정이 없거나 시연 회원이 없으면 `forceAhead` 항목도 없고 기존과 같다.
- **시연 뒤 삭제**: 시연이 끝나면 `speedUpForceAfterSec`를 지우고 AI를 재시작한다. 남겨 두면 시연 회원이 낀 모든 그룹런이 출발 후 그 시각에 강제 가속된다.

여유 가속 시연 값 3종은 `speedUpWarmupSec`와 같이 `userAllowlist` 회원이 한 명이라도 낀 그룹에만 적용하고, 다른 그룹은 환경변수 기본값(10초/km·60초·15 bpm·대기 180초)을 쓴다. 출발 페이스보다 최대 30초/km 한도와 쿨다운 120초는 바꾸지 않는다.

잘못된 값(범위 밖·형식 오류·`hrThresholdOverrides` 회원 값 객체의 알 수 없는 필드·`userAllowlist` 밖 회원)은 `ValueError`로 거부한다. 단 **파일 최상위의 알 수 없는 키(키 이름 오타 포함)는 거부되지 않고 무시**되어 기본 동작(DB 학습값·10초/km)으로 남는다. 키 이름은 아래 표·JSON과 글자 단위로 맞춰 쓰고, 적용 여부는 시작 로그 `시연 계정 설정: 고정 n명, 가속 폭 …·확인 …·여유 …·대기 …`(회원 ID·bpm 값은 싣지 않음)와 아래 사전 검증 출력으로 확인한다.

**이 거부는 시연 기능 전체를 끈다.** 설정 파일 읽기가 실패하면 기존 구조대로 AI 로그에 `시연 기능을 끕니다: DEMO_CONFIG_PATH (ValueError)`만 남기고 시연 콘솔·기록이 모두 꺼진다. 이때 AI04·AI10 판단 자체는 계속 동작하지만 고정 기준(`hrThresholdOverrides`)은 적용되지 않는다. 같은 파일의 **다른 시연 키(`liveMetricsSec`·`speedUpWarmupSec` 등)의 오류도 고정 기준을 함께 끈다.**

운영 적용 예(kkm=11, anjjong000=12) — `/models/ode/demo/demo_config.json`에 다음 키를 **합친다. 이 조각으로 파일 전체를 바꾸면 안 된다**(필수 키 `live`가 없어 `KeyError`로 시연 전체가 꺼진다). 조각의 `userAllowlist`는 기존 값 그대로다.

```json
{
  "userAllowlist": [2, 11, 12],
  "hrThresholdOverrides": {
    "11": {"sustainBpm": 163, "dangerBpm": 178},
    "12": {"sustainBpm": 168, "dangerBpm": 183}
  },
  "speedUpStepSec": 30,
  "speedUpCalmSec": 30,
  "speedUpMarginBpm": 10
}
```

`userAllowlist`에 있는 회원이 낀 그룹은 모두 시연 가속 값을 받는다(userId 2가 낀 그룹 포함). 고정 기준이 없는 회원은 DB 학습 허용선 기준으로 판단하되 시연 가속 값(한 번에 30초/km·여유 10 bpm)이 적용된다.

적용 순서와 사전 검증(설정은 AI 시작 시 한 번만 읽으므로 파일 수정만으로는 반영되지 않는다).

1. 운영 파일을 백업한다(예: `demo_config.json.bak-<날짜>`).
2. 키를 합친다. 새 키를 모르는 이전 이미지는 거부 없이 무시하므로 이미지 배포보다 먼저 넣어도 시연이 꺼지지 않는다.
3. 새 이미지로 배포·재시작하기 전에 같은 이미지에서 파일을 읽어 본다: `python -c "from pathlib import Path; from app.demo.config import load_demo_config; c=load_demo_config(Path('/models/ode/demo/demo_config.json')); print(sorted(c.hr_threshold_overrides), c.speed_up_step_sec, c.speed_up_calm_sec, c.speed_up_margin_bpm, c.speed_up_warmup_sec)"` → 기대 출력 `[11, 12] 30 30.0 10.0 60.0`. 예외가 나면 재시작하지 않는다.
4. 재시작 후 로그에 `시연 기능을 끕니다`가 없고 `시연 계정 설정: 고정 2명, 가속 폭 30·확인 30·여유 10·대기 60`이 있는지 확인한다.
5. 운영 env에 `GROUP_PACE_ENABLED=true`, `GROUP_PACE_AHEAD_ENABLED=true`가 켜져 있는지 확인한다(compose 기본은 false). 리허설에서 trace `reference.hrSustainBpm`이 163/168, 그룹 trace `ahead.stepSec`가 30인지 본다. 실제 모델에서 AHEAD가 안 나오면 `ahead.blockedBy`로 이유를 본다.

**시연 뒤 되돌리기.** 고정 기준이 남아 있으면 시연 회원 두 명의 실제 러닝에서도 DB 학습값과 준비도 보정(낮은 날 최대 6 bpm)이 계속 꺼진 상태다. 시연이 끝나면(2026-11-18 발표 직후) 운영 담당자가 `hrThresholdOverrides`와 `speedUpStepSec`·`speedUpCalmSec`·`speedUpMarginBpm`·`speedUpForceAfterSec` 키를 지우거나 백업 파일로 복원하고 AI를 재시작한 뒤, 시작 로그가 `고정 0명, 가속 폭 기본·확인 기본·여유 기본`(강제 항목 없음)인지 확인한다.

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

`POST /v1/pace/personal-plan` — **팀 계약 제안**. 코드 기준으로 코스와 선택 목표에 대한 페이스 계획을 계산한다. AI 서비스가 DB를 직접 쓰지 않는다. OpenAPI 응답 모델은 `PersonalPlanResponse`다.

**백엔드 출발 전 계획 연동(2026-11-06 결정, S15P31E105-442·-297·-487).** 출발 전 구간 계획은 별도 비율 API(공유 패키지의 AI10안) 없이 AI09 하나로 만든다. 백엔드는 아래 경우에만 AI09를 호출한다.

| 러닝 | 목표 | 백엔드 동작 |
| --- | --- | --- |
| 코스 | 없음 | AI09 응답의 `segments[].paceSecPerKm`를 그대로 쓴다 |
| 코스 | 있음(시간 또는 페이스) | 목표 시간·페이스는 백엔드 값을 유지하고, 구간 페이스 = 목표 페이스 × `segments[].paceRatio`. AI09를 쓸 수 없으면 AI05 `segmentDifficultyRatios`, 그다음 균등 분배 |
| 자유러닝 | 거리만 | `courseId` 없이 `selectedGoal.targetDistanceM`만 보내 AI09 평지 계획(S15P31E105-486)을 받는다 |
| 자유러닝 | 거리+페이스 / 없음 | AI 호출 없음 |

`paceRatio`는 0.85 이상 1.20 이하이고 거리 가중 평균이 1(±1e-6)이므로, 목표 페이스 × `paceRatio`를 소수 둘째 자리로 반올림한 구간 페이스는 AI09의 `paceSecPerKm`와 구간별 0.01초/km 안에서 같고 전체 시간은 목표 시간과 같다(반올림 차이 제외).

### Request Body

선택 헤더 `X-Request-Deadline`은 epoch milliseconds 정수 문자열이다(Route 연동과 같은 형식). 백엔드는 "호출 시작 시각 + 전체 호출 상한"을 보낸다. 정수가 아니면 `400 VALIDATION_ERROR`(필드 이름 `X-Request-Deadline`)다. 마감이 대기열에 들어가기 전, 또는 대기열 슬롯을 얻은 뒤 계산을 시작하기 직전에 이미 지났으면 계산하지 않고 `503 DEADLINE_EXCEEDED`를 반환한다. 이미 시작한 계산은 중단하지 않는다. 헤더가 없으면 마감 검사를 하지 않는다. 백엔드의 세션 생성·목표 변경 호출은 재시도를 포함한 전체 상한 40초를 쓰고, 재시도에도 첫 시도와 같은 전체 마감을 보낸다. 같은 클라이언트를 쓰는 그룹 공동 페이스 계산(GroupPaceService)도 같은 상한을 적용받는다(S15P31E105-533, [sessions.md](sessions.md) "목표 검증·초기 계획·동의"의 초기 계획과 같은 값).

허용하는 최상위 입력은 `courseId`, `userId`, `selectedGoal`뿐이다. 추가 필드는 `400 VALIDATION_ERROR`로 거절한다. `courseId`가 있으면 코스 러닝, 없으면(생략 또는 null) 자유러닝이다. `courseId`와 값이 있는 `userId`는 양수 int64이며, 현재 코드는 기존 호환을 위해 십진 숫자 문자열도 정수로 정규화한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `userId` | integer (int64) / null | X | 건강정보 동의 사용자만 보냄. 생략 또는 null이면 개인 데이터를 조회하지 않고 평균 기반 계획(`personalized=false`, `USER_ID_NOT_PROVIDED`)을 쓴다 |
| `courseId` | integer (int64) / null | 코스 러닝 O | 계획할 ACTIVE 코스 ID. 생략 또는 null이면 자유러닝(아래) |
| `selectedGoal` | object / null | X | 선택 목표. 생략하면 코스 거리로 계획한다. 내부에 정의된 필드 외에는 허용하지 않는다 |
| `selectedGoal.targetDistanceM` | integer / null | 자유러닝 O | 목표 거리(m). 코스 러닝이면 코스 거리와 같아야 하고, 자유러닝이면 이 거리(1~45,000 m)로 계획한다 |
| `selectedGoal.targetDurationSec` | integer / null | X | 목표 완주 시간(초). |
| `selectedGoal.targetPaceSecPerKm` | number / null | X | 목표 페이스(초/km). |
| `selectedGoal.goalPreference` | number | X | 현재 공개값은 `0.5`로 고정한다. 생략 시 `0.5` |

**탐색 범위 밖 목표 페이스(S15P31E105-498).** ODE 페이스 탐색 범위는 FitRec v1 Train 속도 1.7638~4.1272 m/s(242.3~567.0초/km)이며 V2로 검증된 범위가 아니다. 목표 페이스가 이 범위 밖이어도(예: 3:30, 12:00/km) 거절하지 않는다. 구간 비율 0.85~1.20이 모두 탐색 범위 안에 드는 가장 가까운 페이스(빠른 목표는 285.06초/km, 느린 목표는 472.46초/km)로 ODE 계획을 찾아 구간 모양(비율)을 얻고, 그 모양을 실제 목표 페이스로 다시 맞춘다. 범위 경계 페이스 그대로 탐색하면 고르지 않은 구간이 모두 범위를 벗어나 균일 계획만 나온다. 구간 비율 0.85~1.20 제한과 완주시간 = 목표 시간 규칙은 같다. 응답은 200이고 `targetPaceSecPerKm`는 실제 목표 페이스이며 경고 `GOAL_OUTSIDE_VALIDATED_PACE_RANGE`가 한 번 붙는다. 예측 심박 값은 최종 계획을 ODE로 다시 돌린 결과지만 범위 밖 속도는 검증되지 않았다. 범위 안 목표의 응답은 바뀌지 않는다. 백엔드는 목표 페이스 범위를 따로 검사할 필요가 없다.

**자유러닝(목표 거리만, S15P31E105-486).** `courseId` 없이 `selectedGoal.targetDistanceM`이 오면 코스를 조회하지 않고 그 거리를 경사 0%(평지)로 계획한다. 나머지 계산(개인 속도 보정 s=1.45, 신규 사용자 기준, 목표 심박 보정 k=5·c=1.0126, 구간 비율 0.85~1.20 제한)은 코스 러닝과 같다. 응답의 `courseId`·`courseVersion`은 null이고, `warnings` 맨 앞에 `FREE_RUN_FLAT_GRADE`, `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`, `ODE_GRADE_FILLED_0`가 붙는다. 시간·페이스 목표를 함께 보내면 코스 러닝처럼 목표 시간을 지킨다(백엔드 규칙상 자유러닝 거리+페이스는 AI를 부르지 않는다). 코스 조건부 학습 평균 계획(`COURSE_CONDITIONAL_TRAIN_MEAN`) 경로는 자유러닝에 쓰지 않는다. `courseId`도 `targetDistanceM`도 없으면 `400 VALIDATION_ERROR`(필드 `selectedGoal`)로 거절한다. 거리가 1~45,000 m 밖이면 `422 INVALID_GOAL`, `FREE_RUN_GRADE_POLICY=reject`이면 `422 COURSE_GRADE_UNAVAILABLE`이다. 코스 러닝 요청의 응답은 바뀌지 않는다.

```json
{"userId": 73, "selectedGoal": {"targetDistanceM": 5000}}
```

### Response

`segments`는 1 km 단위와 마지막 잔여 거리로 나눈다. `paceSecPerKm`는 소수 둘째 자리, `paceRatio`는 소수 여섯째 자리까지 `ROUND_HALF_UP`으로 반올림한다. `paceRatio`는 반올림 전 구간 페이스를 계획 전체의 거리 가중 평균 페이스(목표가 있으면 목표 페이스)로 나눈 값이다.

**구간 비율 제한(S15P31E105-487).** `paceRatio`는 항상 0.85 이상 1.20 이하이고 거리 가중 평균이 1이다. 계획 비율 r_i가 범위를 벗어나면 모든 구간에 같은 배율 λ를 곱한 뒤 범위로 자른 값 clamp(λ·r_i)를 쓰고, 거리 가중 평균이 1이 되는 λ를 찾는다(꺾이는 점을 이분법으로 좁힌 뒤 그 구간에서 정확히 계산). 모든 값이 1인 계획이 범위 안에 있으므로 해는 항상 있고, 이 단계 때문에 계획이 실패하지 않는다. 그다음 구간 페이스 = 평균 페이스 × 제한 비율로 다시 계산하므로 반올림 전 전체 시간은 바뀌지 않는다. 범위 안의 계획은 예전과 같은 페이스다. 잘림이 있었으면 경고 `SEGMENT_RATIO_CLAMPED`를 한 번 붙이고, HR band 판정은 최종 계획 재생 결과로 다시 정한다. 목표가 있으면 두 자리 반올림 오차로 `predictedFinishSec`가 목표 시간과 1초 어긋나는 경우 반올림 경계에 가까운 구간부터 올림·내림 방향만 바꿔 목표 시간과 같게 맞춘다(바꾼 구간도 반올림 전 값과 0.01초/km 안).

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `planStatus` | string | `EXPERIMENTAL` 또는 `AVERAGE_BASED` |
| `userId` | integer (int64) / null | 요청 사용자 ID. 요청에서 생략했으면 null |
| `courseId` | integer (int64) / null | 요청 코스 ID. 자유러닝이면 null |
| `courseVersion` | string / null | 계획에 사용한 코스 버전. 자유러닝이면 null |
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
| `predictedFinishSec` | integer | 반올림된 구간 페이스로 계산한 완주 시간(초). 목표가 있으면 목표 시간과 같다 |
| `segments[]` | object[] | 구간별 계획 페이스 |
| `segments[].sequence` | integer | 1부터 시작하는 구간 순서 |
| `segments[].startDistanceM` / `endDistanceM` | number | 구간 시작·끝 거리(m) |
| `segments[].lengthM` | number | 구간 길이(m) |
| `segments[].paceSecPerKm` | number | 구간 페이스(초/km), 소수 둘째 자리 |
| `segments[].paceRatio` | number | 전체 거리 가중 평균(목표 페이스) 대비 구간 페이스 비율. 0.85~1.20, 거리 가중 평균 1±1e-6, 소수 여섯째 자리 |
| `warnings[]` | string[] | 경고 코드와 provenance 값 |

`userId`가 생략되거나 null이면 AI09는 사용자 개인화와 사용자 HR 기준을 조회하지 않는다. 기존 신규 사용자와 같은 평균 기반 경로를 사용해 `userId=null`, `planStatus=AVERAGE_BASED`, `personalized=false`와 `USER_ID_NOT_PROVIDED`, `AVERAGE_BASED_RECOMMENDATION`, `PERSONALIZED=false` 경고를 반환한다. 개인화 행이 없는 동의 사용자도 `AVERAGE_BASED`와 `personalized=false`를 반환하지만 `USER_ID_NOT_PROVIDED`는 붙이지 않는다. 평균 경로의 실험 스위치, ODE 및 평균 묶음이 준비되지 않으면 기존 `503 PERSONAL_PLAN_NOT_READY`를 반환한다. 클라이언트는 평균 기반 계획을 개인화 완료로 표시하지 않는다.

코드에서 만드는 경고는 `USER_ID_NOT_PROVIDED`, `PERSONALIZATION_TABLE_MISSING`, `COURSE_GRADE_PROFILE_MISSING`, `FREE_RUN_GRADE_POLICY_<mode>_PROVISIONAL`, `ODE_GRADE_FILLED_0`, `FINAL_PARTIAL_30S_CELL_HR_HOLD_LAST_OBSERVED_SAMPLE`, `HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN`, `PACE_SEARCH_SUPPORT=<scope>`, `PACE_SEARCH_DOMAIN_BOUNDARY_HIT_BEST_EFFORT`, `ODE_BEYOND_VALIDATED_HORIZON`, `PLAN_SEARCH_BUDGET_LIMITED`, `PLAN_FIRST_SEGMENT_CAPPED`, `PACE_SEARCH_GRID_STEP_MPS=<value>`, `POLICY_UNVALIDATED_NO_SAFETY_CLAIM`, `PERSONALIZATION_SUPPORT_CUTOFF_NOT_PROVEN`, `HR0_NOT_MEASURED_SUPPORT_MEDIAN_USED`, `AVERAGE_BASED_RECOMMENDATION`, `PERSONALIZED=false`, `POPULATION_MODE=<mode>`, `TRAIN_SUBJECTS=<count>`, `TRAIN_RUNS=<count>`, `COURSE_PROFILE_COVERAGE=<value>`, `FITREC_RESEARCH_ONLY_NOT_FOR_PRODUCT_OR_REDISTRIBUTION`, `ODE_SPEED_CALIB_SCALE=<s>`, `ODE_SPEED_REF_SOURCE=HISTORY|TRAIN_DEFAULT`, `SPEED_REF_LOOKUP_UNAVAILABLE`, `TARGET_HR_CALIB_GLOBAL_RATIO=<g>`, `TARGET_HR_CALIB_K=<k>`, `TARGET_HR_CALIB_HISTORY_RUNS=<n>`, `TARGET_HR_HISTORY_LOOKUP_UNAVAILABLE`, `SEGMENT_RATIO_CLAMPED`, `GOAL_OUTSIDE_VALIDATED_PACE_RANGE`, `FREE_RUN_FLAT_GRADE`, `RUNNER_BASELINE_SOURCE=<DISTANCE_TIME|PACE|LEVEL_PRESET|LEVEL_FALLBACK>`, `RUNNER_BASELINE_KIND=<TYPED|LEVEL>`, `RUNNER_BASELINE_WEIGHT=<w>`, `RUNNER_BASELINE_PAST_RUNS=<n>`, `RUNNER_BASELINE_RECORD_IMPLAUSIBLE_LEVEL_USED`, `RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT`, `RUNNER_PROFILE_NOT_SET`, `RUNNER_PROFILE_INVALID`, `RUNNER_PROFILE_TABLE_MISSING`, `RUNNER_PROFILE_LOOKUP_UNAVAILABLE`, `RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE`이다. 경고는 해당 데이터·계획 경로에서만 붙는다.

**속도 반응 보정(S15P31E105-402).** 출발 전 계획이 실제 러닝보다 빨랐던 문제를 줄이기 위해 AI09는 ODE에 넣는 속도만 `v' = v_ref + s·(v − v_ref)`로 바꾼다(기본 s=1.45, `PERSONAL_PLAN_SPEED_CALIB_SCALE`). 요청·응답 필드는 바뀌지 않는다. 응답 페이스·완주시간과 탐색 범위 검사는 원래 속도 기준이다. v_ref는 동의 사용자의 `running_sessions`에서 계획 시각 이전에 끝난 완료 러닝 최근 20회의 `total_distance / moving_duration` 중앙값이며(이동 10분·1 km 미만 기록은 빼고 센다, S15P31E105-785), 기록이 없거나 조회할 수 없으면 V2 Train 기본값 3.4704 m/s를 쓴다. 같은 변경에서 ODE checkpoint를 속도 반응 미세조정본(λ=1)으로 바꿔 `modelVersion`이 `ode_v21_base_epoch20_legacy27:737334a7d77a`가 된다. 이전 모델로 만든 개인화 행은 AI06을 다시 호출하기 전까지 평균 기반 계획을 받는다. V2 Val 완주시간 절대 오차는 평균 280.1초에서 241.3초로 줄었다. s=1.0이면 보정층만 꺼진다.

**신규 사용자 첫 계획 기준(S15P31E105-403).** 요청 형식은 바꾸지 않는다. `userId`가 있고 `selectedGoal`에 시간·pace 목표가 없으면 AI09는 `user_profiles`(U06·U07: `running_level`, `average_pace`, `distance`, `duraction`)를 읽어 초기 목표 완주시간을 정한다. 거리·시간이 있으면 그 기록을, pace만 있으면 수준 기준 거리(초급 3 km·중급 5 km·상급 10 km)를 그 pace로 달린 기록으로 보고 Riegel `T × (D_코스 / D_기록)^1.06`으로 코스 거리에 맞춘다. pace 3′00″–10′00″/km·거리 1–50 km·시간 5분–6시간 밖이면 수준 기준(3 km 20:00, 5 km 30:00, 10 km 55:00)으로 대체한다. 저장값이 수준 기준과 같으면(프론트가 수준 선택 때 미리 채운 값) "수준만"으로 본다. 목표 pace가 탐색 범위(1.7638–4.1272 m/s) 밖이면 경계로 자른다. ODE는 지금처럼 목표 없이 한 번만 풀어 완주시간 T_ode와 경사에 따른 구간 pace 모양을 얻는다. T = w·T_기준 + (1−w)·T_ode, w = k/(n+k)로 섞고, 구간 pace에 공통 배율 T/T_ode를 곱한다(목표 시간 경로와 같은 반올림·보존 규칙). n은 `running_sessions`에서 402 v_ref와 같은 조건(COMPLETED, 미삭제, 계획 시각 이전 종료, 2시간 이하, 이동 속도 0.5–8 m/s, 이동 10분·1 km 이상)을 통과한 지난 러닝 수이며 상한 없이 센다. n=0이면 기준 100%다. k는 기록 입력 5, 수준만 3이다(env `PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED`·`_K_LEVEL`). 사전 등록 1-SE 규칙은 기록 입력 20이었으나, fold 최저가 5–8이고 실제 입력은 검증에 쓴 실제 첫 러닝보다 덜 정확하다고 보아 사용자 결정으로 5로 바꿨다. 배율 조정 뒤 HR이 기준 band를 벗어나면 목표 경로처럼 막지 않고 `HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN`을 붙인다. V2 Val 판정은 보류(완주시간 개선 CI가 0 포함)였고 사용자 입력을 쓰는 제품 결정으로 채택했다. 프로필 조회 실패·없음은 기존 동작으로 계속하고 경고만 붙인다. `planStatus`·`personalized`·`planSource`는 바뀌지 않는다. `PERSONAL_PLAN_RUNNER_BASELINE_ENABLED=false`면 예전 동작이다.

경사 정보가 없으면 0% 평지로 계산하고 HTTP 200과 경고를 반환한다(MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`). AI09 응답 `warnings[]`에는 `COURSE_GRADE_PROFILE_MISSING`, `FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL`, `ODE_GRADE_FILLED_0`가 담긴다. 코스 러닝 경사 저장은 S15P31E105-319에서 처리했다. AI09는 백엔드가 `courses.elevation_profile`에 저장한 100m 경사 목록(`[{startDistanceM, endDistanceM, gradePercent}]`, [courses.md](courses.md#elevationprofile-100m-경사-구조))을 그대로 계획 경사로 쓴다(`COURSE_STORED_GRADE`, S15P31E105-371). 이 형식이 아니거나 연속·끝 거리 검사를 통과하지 못하면 예전 원시 고도 해석, 그다음 경사 없음 순으로 넘어간다. unknown 정책과 GPS 고도 활용은 MVP 이후 과제다.

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
| 400 | `VALIDATION_ERROR` | JSON 형식·ID·허용하지 않은 요청 필드, `courseId`와 `selectedGoal.targetDistanceM`이 모두 없음 |
| 404 | `COURSE_NOT_FOUND` | ACTIVE 코스 조회 결과가 없음 |
| 422 | `INVALID_GOAL`, `COURSE_DATA_MISMATCH`, `COURSE_GRADE_UNAVAILABLE` | 목표·코스 거리·경사 정보가 유효하지 않음 |
| 422 | `PERSONAL_PLAN_NOT_FEASIBLE`, `PERSONAL_PLAN_GOAL_NOT_PRESERVED`, `POPULATION_PLAN_GOAL_NOT_PRESERVED` | 목표가 탐색 범위를 벗어나거나 계획 제약·시간 보존을 만족하지 못함 |
| 422 / 503 | `PERSONAL_PLAN_PREDICTION_INVALID` | ODE 개인 계획 예측 출력·상태가 유효하지 않음 |
| 503 | `PERSONALIZATION_NOT_SUPPORTED` | ODE 모델이 필요한 개인화 계획 입력을 지원하지 않음 |
| 422 | `PLAN_HORIZON_TOO_SHORT` | 완주 전 평가 가능한 완전한 30초 ODE cell이 하나도 없음 |
| 503 | `AI_DB_UNAVAILABLE` | DB 조회 실패 또는 시간 초과 |
| 503 | `PERSONAL_PLAN_NOT_READY` | DB·ODE·평균 계획 데이터 또는 실험 설정이 준비되지 않음 |
| 503 | `AI_BUSY` | 공용 계획 대기열의 최대 대기 시간을 넘김 |
| 503 | `DEADLINE_EXCEEDED` | `X-Request-Deadline`이 계산 시작 전에 지남. 계산하지 않음 |

400 `VALIDATION_ERROR`에는 `X-Request-Deadline` 헤더 형식 오류도 포함한다. 모든 오류는 공통 `{code, message, details}` 형식을 따른다. 이는 현재 코드의 동작을 정리한 **팀 계약 제안**이며, 백엔드 저장 필드·클라이언트 표시는 별도 합의가 필요하다.

### DB 대응

AI 서비스는 아래 데이터를 읽고, AI09 계획 결과를 DB에 직접 저장하지 않는다. 저장은 백엔드가 담당한다.

| 구분 | AI09 필드·테이블 | DB 대응·비고 |
| --- | --- | --- |
| 저장 후보 | `targetPaceSecPerKm` | `pace_plans.recommended_pace` (`NUMERIC(10,2)`). 구간 페이스는 소수 둘째 자리까지 반올림하지만, 최상위 값은 목표 페이스 또는 거리 가중 평균이므로 저장 시 두 자리 반올림 규칙을 백엔드에서 확인한다 |
| 저장 후보 | `segments[].sequence`, `startDistanceM`, `endDistanceM`, `paceSecPerKm` | `pace_plan_segments.segment_sequence`, `start_distance`, `end_distance`, `recommended_pace` (`INTEGER`, `NUMERIC(12,2)`, `NUMERIC(12,2)`, `NUMERIC(10,2)`) |
| 세션 연결 | AI09 요청·응답에는 `session_id` 없음 | `pace_plans.session_id`는 `NOT NULL`; 백엔드 세션 ID가 필요하며 저장 시점은 별도 합의 필요 |
| 대응 컬럼 없음 | `segments[].paceRatio`, `segments[].lengthM`, `warnings[]`, `planSource` 및 출처·provenance 정보 | 현재 `pace_plans`·`pace_plan_segments`에 대응 컬럼 없음. 목표가 있는 코스 러닝은 백엔드가 목표 페이스 × `paceRatio`로 `pace_plan_segments.recommended_pace`를 계산한다 |
| AI 조회 | `courses` | 현재 조회는 `id`, `distance`, `elevation_profile`, `status`, `updated_at`을 사용. `schema.sql`의 `courses` 테이블에 정의됨 |
| AI 조회 | `user_hr_personalization` | AI09는 `userId`가 있을 때만 `user_id` 기준 최신 행의 `personalization_version`, `schema_version`, `model_version`, `support_run_count`, `summary_u_json`, `history8_json`, `p4_json`, `hr0_sub_bpm`, `hr_ref_bpm`, `hr_danger_bpm`, `hr_sustain_bpm`, `hr_threshold_run_count`, `created_at`을 조회한다. 속도 보정이 켜져 있으면 `running_sessions`에서 같은 `user_id`의 `total_distance`, `moving_duration`, `elapsed_duration`을 `status='COMPLETED'`, `deleted_at IS NULL`, `ended_at` ≤ 계획 시각 조건으로 최근 20행까지 읽는다(S15P31E105-402). 목표 심박 보정(k가 `inf`가 아닐 때)은 같은 테이블에서 같은 조건에 경과 900~5,400초, 거리 3,000 m 이상, `average_heart_rate` 30~240 bpm 조건을 더해 `average_heart_rate`, `elapsed_duration`, `total_distance`를 최근 20행까지 읽는다(S15P31E105-377, 같은 SELECT 권한). AI 읽기 계정의 `running_sessions` SELECT 권한은 AI CD의 `infra/ai/grant-readonly.sh`가 개인화 테이블 대기 전에 준다. ERD V10 반영 대상이며, 현재 `schema.sql` 스냅샷에는 테이블 정의가 없음 |

`schema.sql` 기준 컬럼은 `pace_plans.recommended_pace NUMERIC(10,2)`, `pace_plans.session_id BIGINT NOT NULL`, `pace_plan_segments.segment_sequence INTEGER`, `start_distance NUMERIC(12,2)`, `end_distance NUMERIC(12,2)`, `recommended_pace NUMERIC(10,2)`다. ERD V10에는 `user_hr_personalization`만 반영하고, `user_gru_personalization` 등 나머지 제안은 필요할 때 검토한다.

## AI10 — 그룹 공동 페이스

`POST /v1/group/pace` · S15P31E105-584. 실제로 달리는 전원을 기준으로 공동 페이스를 고른다. 한 명만 힘들어도 자동으로 제외하지 않는다. AI04 개인 코칭 동작은 그대로다.

### Request Body

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `groupRunId` | integer | 그룹런 ID. 양수 int64 |
| `currentGroupPaceSecPerKm` | number | 현재 공동 페이스 G. 유한한 양수, sec/km |
| `goalPaceSecPerKm` | number / null | 방장 목표 페이스. 있으면 회복 가속의 한계. 유한한 양수 |
| `startRecommendedPaceSecPerKm` | number / null | 출발 전에 확정한 추천 공동 페이스. 목표가 없을 때 회복 가속의 한계. 유한한 양수 |
| `elapsedSec` | number | 그룹 시작 후 경과 초. 유한한 0 이상 값 |
| `progressRatio` | number / null | 선택 진행률(0~1). 백엔드가 그룹 목표 거리 대비 진행 거리로 계산, 없으면 0. 생략·null의 기본값은 null이며 계산 시 0.0을 사용한다. 유한한 값만 허용하며 범위를 벗어나면 [0, 1]로 보정 |
| `now` | datetime | 쿨다운 계산용 UTC 시각. 시간대 필수 |
| `lastChange` | object / null | 마지막 실제 변경. 서버가 저장하지 않고 호출자가 전달 |
| `lastChange.direction` | string | `SLOW` / `FAST` |
| `lastChange.changedAt` | datetime | 마지막 변경 UTC 시각. 시간대 필수이며 `now` 이후는 불가 |
| `participants` | array | 1명 이상. 인원 상한 없음 |
| `participants[].userId` | integer / null | 동의자의 AI06 심박 기준 조회용 ID. 미동의자는 생략하거나 null |
| `participants[].active` | boolean | 실제로 달리는지 여부. 일시정지·종료·지연·불참자는 보내지 않거나 false |
| `participants[].history` | object | AI03·AI04의 `History`와 동일. 5초 간격 `hrBpm`, `speedMps`, `gradePct` 및 선택 `segmentId`. 배열 길이는 같아야 하며 결측은 null |
| `participants[].futureGradePct` | array / null | 앞으로 2분의 경사 24칸. null 또는 빈 칸이 하나라도 있으면 경사 모름 |
| `paceMode` | string | 선택. `TOGETHER`(기본, 생략과 같음) / `GOAL`(목표 페이스 모드, S15P31E105-680). 아래 "목표 페이스 모드". 그 밖의 값은 `400 VALIDATION_ERROR` |

선택 필드는 생략해도 null로 처리한다. 미동의자는 `userId`와 심박을 보내지 않는다. `userId`가 없거나 심박 기록이 전부 null이면 속도 기록만 사용하며, 심박 기준 DB와 GRU 개인화는 조회하지 않는다. 최근 측정 기준 페이스는 AI04와 같은 최근 12칸(60초) 속도의 결측 제외 평균을 `1000 / speed`로 바꾼 값이다. 심박 판단은 AI04와 같은 t0 심박·완전 history 칸 수 검사를 통과해야 한다. 판단 가능한 심박도 기준 페이스도 없는 참가자는 제외하고 `PARTICIPANT_DATA_UNUSABLE`을 붙인다.

### Response

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `groupPaceSecPerKm` | number | 반환 공동 페이스, sec/km |
| `changed` | boolean | 현재와 차이가 10초/km 이상이고 변경 제한을 통과했는지 여부 |
| `direction` | string | `SLOW` / `FAST` / `HOLD` |
| `reason` | string | `HR_LIMIT` / `RECOVERED` / `COOLDOWN` / `WARMUP_CAP` / `FLOOR` / `SMALL_CHANGE` / `NO_DATA` / `AHEAD`(여유 가속, `direction=FAST`, 아래 절) |
| `strugglingCount` | integer | 실제 반환 페이스에서 심박 상한이 개인 허용선 이상인 심박 판단 참가자 수 |
| `excludedCount` | integer | 전달된 참가자 중 active=false 또는 데이터 부족으로 판단에서 제외한 수. 호출자가 보내지 않은 인원은 셀 수 없음 |
| `paceOnlyCount` | integer | active=true 중 userId가 없거나 심박 기록이 없는 참가자 수. 속도도 없어 제외한 참가자를 포함 |
| `warnings` | string[] | `GRADE_UNKNOWN`, `HR_THRESHOLD_LOOKUP_UNAVAILABLE` 등 AI04 기준 조회 경고, `PARTICIPANT_DATA_UNUSABLE`, `RECOVERY_CAP_MISSING` |
| `modelVersion` | string | 기본 GRU 모델 버전 |

### 선택 규칙

1. 후보는 G−30, G−20, G−10, G, G+10, G+20, G+30, G+45, G+60의 9개다. 0 이하 페이스는 쓰지 않는다. 심박 참가자 × 후보를 기본 GRU로 한 번에 예측하며, 256개 창을 넘으면 내부에서 나눈다. 사용자별 GRU 출력층 조회는 하지 않는다. 미래 속도는 후보의 `1000 / pace`로 일정하게 두고, 미래 경사 모름은 추론에서 0% 평지로 채운다. 과거 경사는 AI04의 flat0 경로와 같다.
2. AI04의 AI06 기준 조회·러닝 횟수별 모집단 혼합과 `allow_at`을 재사용한다. DB가 없거나 조회가 실패하면 AI04와 같은 모집단 기준으로 대체한다. 백엔드가 계산한 `progressRatio`를 [0, 1]로 보정해 모든 참가자의 `allow_at`에 전달한다. 생략·null이면 0.0으로 계산한다. 허용선은 진행률에 따라 혼합된 지속~위험 심박 기준 사이에서 움직이며, 경과 시간만으로 진행률을 추정하지 않는다.
3. 느린 후보는 120초 예측 + AI04와 같은 `hr_slow_margin_120_bpm`의 경사별 여유분(FLAT 4.89, UP 5.98, DOWN 6.65, UNKNOWN 7.46 bpm)을 쓴다. G와 빠른 후보는 AI04처럼 후보 속도와 최근 6칸(30초) 측정 속도 평균의 차이로 방향을 분류해 30·60·120초 예측 + 각 여유값의 최댓값을 쓴다. 6칸이 안 되거나 결측이 있으면 방향 모름으로 가장 큰 방향 셀을 쓴다. 미래 경사는 24칸 평균으로 분류한다. 경사 모름은 추론의 평지 가정과 별개로 느린 후보에는 UNKNOWN 여유분을, G와 빠른 후보에는 해당 방향·시간의 가장 큰 여유 셀을 쓴다.
4. 상한 < 허용선이면 통과한다. 회복 가속 후보는 상한 < 허용선−3 bpm이어야 한다. 속도만 쓰는 참가자는 기준 페이스보다 30초/km **초과** 빠른 후보만 막는다. G보다 느려지는 후보는 이 규칙으로 막지 않는다.
5. G에서 한 명이라도 통과하지 못하면 전원이 통과하는 가장 빠른 느린 후보를 고른다(`HR_LIMIT`). 없으면 `FLOOR`로 늦춘다: 아래 6의 위험 기준에 해당하면 G+60, 아니면 한 번에 G+30까지만 늦추고 다음 판단에서 더 늦춘다(S15P31E105-751). 한 명만 실패해도 포함한다. G에서 전원이 통과하면 G−30 이상 G 미만 범위에서 한 번에 최대 30초/km까지, 목표 페이스 또는 목표가 없을 때 출발 전 추천 페이스보다 빠르지 않고 전원이 허용선−3 bpm 기준을 통과하는 가장 빠른 후보를 고른다(`RECOVERED`). 두 한계가 모두 없으면 현재를 유지하고 `RECOVERY_CAP_MISSING`을 붙인다.
6. 마지막 변경부터 120초 미만이면 방향과 관계없이 현재를 유지한다(`COOLDOWN`). 단 G에서 누군가의 **여유값을 더하기 전** 120초 예측이 혼합된 위험 기준 이상이면 감속은 허용한다. 또 `lastChange.direction`이 `FAST`(직전 변경이 가속: `AHEAD`·`RECOVERED`)이면 허용선을 넘는 감속(`HR_LIMIT`·`FLOOR`)은 쿨다운을 기다리지 않는다(S15P31E105-751). 정확히 120초면 제한하지 않는다.
7. `elapsedSec` < 180이면 감속은 최대 +10초/km다(`WARMUP_CAP`). 위험으로 쿨다운을 벗어난 경우에도 적용한다. 제한 후 반환 페이스에서 `strugglingCount`를 다시 센다.
8. 현재와 차이가 10초/km 미만이면 현재를 유지한다(`HOLD`, `changed=false`, `SMALL_CHANGE`). 정확히 10초는 변경한다. 회복 가능한 후보가 없어 유지하는 경우도 `SMALL_CHANGE`다. 활성 참가자 전원에게 쓸 수 있는 데이터가 없으면 HTTP 200, 현재 페이스, `HOLD`, `NO_DATA`를 반환한다.

### 여유 가속 (`reason=AHEAD`)

S15P31E105-728. 기존 회복은 목표 또는 출발 추천 페이스까지만 올린다. `GROUP_PACE_AHEAD_ENABLED=true`(코드 기본 false, 끄면 출력이 이전과 같음)이면 위 규칙이 페이스를 바꾸지 않은 판정에서만 다음을 모두 만족할 때 한 번에 10초/km 빠르게 올린다. 시연 회원이 낀 그룹은 시연 설정으로 1회 폭·여유 확인 기간·여유 기준을 바꿀 수 있다(S15P31E105-913, [시연 설정 파일의 계정 전용 키](#시연-설정-파일의-계정-전용-키-s15p31e105-913)). 아래 3·4번의 기본값이 그 값으로 바뀐다.

1. `paceMode`가 `GOAL`이 아니다(목표 페이스 모드는 목표가 상한).
2. 전달된 참가자 전원이 심박으로 판단된다(`excludedCount`·`paceOnlyCount` 0).
3. 전원의 G와 G−10 후보 상한이 허용선 − `GROUP_PACE_AHEAD_MARGIN_BPM`(기본 15) 아래다.
4. 연속 조건: AI10은 상태를 저장하지 않으므로 "연속 N번 판정" 대신 각 회원의 실측 심박이 최근 N×30초(`GROUP_PACE_AHEAD_STREAK`, 기본 2 → 60초) 동안 같은 선 아래였는지 본다. 그 구간 칸의 절반 이상이 측정돼 있어야 한다.
5. 출발 뒤 `GROUP_PACE_AHEAD_WAIT_SEC`(기본 180초)가 지났다. 시연 설정 `userAllowlist` 회원이 참가자에 있으면 시연 설정 `speedUpWarmupSec`(기본 60초)를 쓴다. 목록이 null이면 쓰지 않는다.
6. 마지막 변경 뒤 120초가 지났고 위험 심박이 아니다. `startRecommendedPaceSecPerKm`이 있어야 하며, 결과는 그보다 최대 30초/km 빠르게까지다.

백엔드는 `reason`을 문자열로만 검사하고 저장하지 않으므로 새 값으로 바뀌는 동작은 없다.

시연 설정 `speedUpForceAfterSec`가 있으면 시연 회원이 낀 `TOGETHER` 그룹은 위 3·4·6번 조건과 관계없이 출발 후 그 시각에 한 번 출발 페이스 − 폭으로 올린다(S15P31E105-915, 심박 위험선 이상이면 제외). 이 경우도 `reason=AHEAD`다. 자세한 규칙은 시연 설정 파일의 계정 전용 키 절을 따른다.

### 목표 페이스 모드 (`paceMode=GOAL`)

S15P31E105-680. 방장이 출발 전에 고른 모드다. `goalPaceSecPerKm`가 없으면 `TOGETHER`와 같게 계산한다. `TOGETHER`이거나 생략하면 출력은 이전과 비트 단위로 같다.

1. 후보·예측·응답 형식·`strugglingCount`(허용선 기준)는 위와 같다.
2. 판정선을 허용선 대신 회원별 **위험 심박**으로 바꿔 같은 선택 규칙(5~8)을 쓴다. 상한은 여유값 없는 예측이다. G와 느린 후보는 기존 위험 조건(6)과 같은 120초 예측을, 빠른(회복) 후보는 30·60·120초 예측의 최댓값을 쓴다. 따라서 G에서 누군가의 120초 예측이 위험 심박 이상일 때만 늦추며(`HR_LIMIT`/`FLOOR`), 주의·허용선 초과만으로는 늦추지 않는다. 30·60초 예측은 늦춰도 거의 변하지 않아 감속 판정에 쓰지 않는다(연속 `FLOOR` 방지).
3. 회복 가속의 한계는 항상 목표 페이스다. 목표보다 빠르게 올리지 않는다.
4. 위험 감속은 쿨다운(6)을 벗어나고 워밍업 상한(7)도 적용하지 않는다.
5. 백엔드는 모드가 `GOAL`일 때만 이 필드를 보낸다. 이전 버전 AI는 모르는 필드를 무시하므로 배포 순서와 관계없이 요청이 실패하지 않는다.

### 설정·호출 주기·오류

`GROUP_PACE_ENABLED`는 배포 설정에서 켬, false로 끌 수 있음. 코드 수준 기본값은 false다. false이면 공통 오류 형식으로 `503 GROUP_PACE_DISABLED`를 반환한다. `/health`의 `components.groupPace.enabled`로 설정 상태를 확인하며 readiness 판정에는 영향을 주지 않는다. 모델·정책 미준비는 `503 MODEL_NOT_READY`, 잘못된 요청은 `400 VALIDATION_ERROR`, 잘못된 GRU 출력은 `500 PREDICTION_FAILED`다.

호출자는 **그룹당 최소 30초 간격**으로 호출하고, 실제 변경 시각·방향을 저장해 다음 `lastChange`에 넣는다. AI10은 상태를 저장하거나 호출 간격을 자체 제한하지 않는다. 기존 무거운 요청 대기열과 스레드 실행을 사용한다(`HEAVY_MAX_CONCURRENCY`, `HEAVY_QUEUE_WAIT_SEC`, 초과 시 `503 AI_BUSY`). GRU는 기존 기본 예측 경로를 사용하며 별도 전역 잠금을 추가하지 않는다.

구현 참고: Pydantic 2.14.1(저장소 고정 버전)의 [시간대 필수 datetime](https://github.com/pydantic/pydantic/blob/v2.14.1/docs/api/standard_library_types.md)과 [모델 검증](https://github.com/pydantic/pydantic/blob/v2.14.1/docs/concepts/validators.md)을 Context7으로 확인했다(2026-11-09).

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
| 대기열 | 실행 1건 + 대기 1건까지만 받는다. 그 이상은 즉시 `503 BUSY`(AI 팀 제안). 491 반영 후 실행 슬롯을 기본 최대 8초(`ROUTE_LOCK_WAIT_S`) 기다리고 못 잡으면 `BUSY`, 요청 마감이 더 가까우면 그때까지만 기다린 뒤 `TIMEOUT`(대기 요청 수 상한 없음) |
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

## Route 썸네일 지도 바탕 내부 계약

[S15P31E105-612](https://ssafy.atlassian.net/browse/S15P31E105-612), [ADR-0022](../../adr/0022-osm-course-thumbnail-basemap.md). 백엔드 전용 내부 API다. 코스 저장 뒤와 서버 기동 시 일괄 채우기에서 백엔드가 호출해 받은 지형지물로 썸네일 PNG를 그린다. 세부 구현·상수는 [Route API.md](../../../ai/route_service/API.md)를 따른다.

- **요청:** `POST /internal/v1/basemaps`, `{"bbox": [west, south, east, north], "detail": "thumb" | "full", "meters_per_pixel": number}`(WGS84, 기본 `thumb`). `meters_per_pixel`(0 초과 100 이하, 선택)은 썸네일 그림의 축척으로, 그림에서 보이지 않을 작은 건물(1.5 px²보다 작음)·산책로(5 m/px 초과)·이면도로(8 m/px 초과)를 빼는 데 쓴다. 없으면 bbox 폭/600. 서쪽<동쪽, 남쪽<북쪽, 한 변 8 km 이하, 경도·위도 폭 각 1° 이하. 코스 경로 자체는 보내지 않는다. 백엔드는 `full`만 쓴다.
- **처리(`full`):** 전국 OSM 자료(`store/network` 도로, `store/envcache/layers.gpkg` 강·물·해안·해변·공원·녹지)와 건물 자료(`buildings/buildings.gpkg`)를 bbox로 자르고 단순화한다. 해안선(육지 왼쪽·바다 오른쪽)으로 바다 면(`sea`)을 만든다. 개수 99개 제한은 없고, 상세 요청은 한 번에 1개만 처리한다(다른 요청은 최대 8초 기다린 뒤 `503 BUSY`). 지형지물 40,000개·좌표 300,000개·응답 약 7.5 MB 상한을 넘으면 작은 건물부터 뺀다. 읽기 전용이며 추천 엔진 lock을 잡지 않고 외부 인터넷을 쓰지 않는다. 건물 자료가 없거나 읽을 수 없으면(손상·레이어 없음) 건물 없이 `buildings_available: false`로 응답한다. 오류 로그에는 좌표·경로를 남기지 않는다.
- **성공 200(`full`):** `{"osm_data_timestamp", "buildings_available": bool, "buildings_osm_data_timestamp", "features": [{"kind", "geometry", "road_class"(도로), "height_m"(건물)}]}`. kind는 `sea`·`green`·`park`·`beach`·`water`·`river`·`coast`·`road`·`building`. `thumb`은 기존 99개 이하 응답이다.
- **오류:** 기존 Route 오류 형식. `400 VALIDATION_ERROR`(bbox·detail 형식·크기), `422 OUT_OF_AREA`(전국 자료 범위 밖), `503 NOT_READY`·`UNAVAILABLE`·`BUSY`, `500 INTERNAL`.
- **백엔드 처리:** 그림에 보이는 땅 영역 + 여백 8%(축마다 7.9 km·1° 이하)로 요청한다. 서버 기동 시 일괄 채우기는 Route `GET /internal/v1/ready`가 준비될 때까지 기다린 뒤 시작한다. 연결 1초·요청 15초·응답 8 MB 상한. 성공이면 PNG를 그려 저장, `OUT_OF_AREA`면 그림 없이 저장, 그 밖의 실패·형식 오류는 저장하지 않는다. 기동 시 일괄 채우기 중 Route가 잠깐 멈춘 실패(연결 실패·시간 초과·5xx)는 대기열이 빈 뒤 1분(`backfill-retry-delay`) 기다려 한 번 더 시도하고, 그래도 실패하거나 저장 이벤트에서 실패한 코스는 다음 기동 때 다시 시도한다. 일괄 채우기 작업 사이에는 2초(`backfill-interval`)를 쉬고, 새로 저장한 코스를 먼저 처리한다.
- **건물 자료:** Geofabrik 한국 OSM에서 `tools/data/national/build_buildings.py`로 만든 `buildings.gpkg`(EPSG:4326, `height_m`)와 `metadata.json`을 전국 자료 마운트의 `buildings/`에 둔다. 2026-11-10 운영 서버에 1,383,390동(OSM 2026-11-08 기준)을 추가했다.

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
   - **코스 구간 난이도 비율 사전 계산(S15P31E105-297, 2026-11-06 확정):** 비율은 코스 지형만으로 정한다(AI 팀 답, S15P31E105-442 본문 2026-11-05). 생성 코스 저장(C10·내부 저장)이 커밋되면 백엔드 전용 실행기가 트랜잭션 밖에서 AI05를 한 번 호출한다. 요청은 `courseId`, 저장 경사 `gradeProfile`(`courses.elevation_profile` 그대로), 기준 `targetPaceSecPerKm=360`이며 `userId`는 보내지 않는다(비율은 목표와 무관하고 기준 페이스는 AI05 필수 입력을 채우는 값). 응답 `segmentDifficultyRatios` 개수가 ⌈코스 거리/1000⌉이고 모두 양수일 때만 `plannerVersion`과 함께 `course_segment_difficulties`에 저장한다. 별도 상·하한은 두지 않는다. 응답 `warnings`에 `COURSE_PACE_RATIO_MISSING`이 있으면 경사가 반영되지 않은 균등 값이므로 저장하지 않는다. 경사 없는 코스·ACTIVE가 아닌 코스·구간 1개 이하(비율 미사용)·45km 초과 코스·이미 저장된 코스는 호출하지 않는다. AI05는 경사 끝 거리로 비율 개수를 정하므로 ⌈경사 끝/1000⌉이 ⌈코스 거리/1000⌉과 다른 코스(경사 끝은 코스 거리 ±0.99m 허용)도 호출하지 않는다. 시간 상한은 연결 1초·전체 45초(AI 계획 대기열 대기 30초보다 길게)이고 실행기는 AI 기본 동시 실행 수에 맞춰 1개 스레드다. 재시도하지 않는다. 실패·형식 위반은 저장하지 않고, 같은 경로를 다시 저장하면 다시 시도한다. 기능 배포 전에 저장된 코스의 일괄 계산(백필)은 후속이다.
   - **현재 한계:** AI05 비율은 경사 구간 `basePaceRatio`(Route 제공 예정)의 거리 가중 평균이다. 이 값을 만드는 곳이 없고 `courses.elevation_profile`에도 저장하지 않으므로 지금 AI05는 모든 비율을 1.0으로 주고 `COURSE_PACE_RATIO_MISSING` 경고를 붙인다. 백엔드는 이 응답을 저장하지 않으므로 현재 세션 계획은 균등 분배다. AI05가 경고 없이 경사 비율을 주게 되면 백엔드 변경 없이 그 뒤 저장(재사용 포함)되는 코스부터 반영된다.
2. **W07 → AI04**: 백엔드가 batch를 저장한 뒤 최신 history/context와 9개 후보를 만들어 AI04를 호출한다. 백엔드가 stateVersion을 다시 확인하고 필요한 결정만 저장·발행한다. timeout 후 오래된 본문을 재전송하지 않는다. AI04 호출은 DB 트랜잭션·세션 잠금 밖에서 한다. 상세는 [백엔드 호출 구현](#백엔드-호출-구현-s15p31e105-421).
3. **러닝 종료 → AI06**: 백엔드가 동의된 support 세션을 모아 개인화 요청을 보낸다. 버전 JSON 저장·재시도·실패 상태는 별도 백엔드 계약으로 결정한다.
4. **시연 전용**: Demo player → AI08, 브라우저 console → AI07. 실제 앱/백엔드 동작과 분리한다.

## 팀 합의 목록과 이 패키지 기본값

| ID | 합의 주제 | 패키지 기본값 | 상태 |
| --- | --- | --- | --- |
| N1 | AI04 요청·응답 계약 | 시연 설계 필드와 policy v0.4.0 학습 심박 기준 반영 | v6_8_2 반영 |
| N2 | batch 저장·후보/context·AI04·DB 저장 순서 | W07 저장 후 백엔드가 AI04 호출, 버전 재검사·DB 저장 | 백엔드 구현 반영(S15P31E105-421), 팀 확인 전 |
| N3 | AI07 SSE·trace·buffer 정책 | 세션 허용목록, 메모리 ring buffer, 만료/재접속은 demo 설정 | 제안 |
| N4 | 컨테이너·콘솔·Nginx 경로 | 기존 infra 내부 `runway_service`, host port 없음, demo 경로 예시만 제공 | 제안 |
| N5 | W07 demo 앱 upload 주소·token 설정 | 시연 입구만 두고 앱 전환은 범위 밖 | 합의 필요 |
| N6 | 재생 데이터 출처·세션 ID·보존 | prototype Val 사본만 로컬 재생, 원본 기록 저장 없음 | 제안 |
| N7-1 | 학습 HR 기준 | 최근 20회 GOOD HR의 P98·P85를 모집단 중앙값과 정책 비중으로 섞는다. 위험 기준 = 섞은 P98 + 3(일반화 178), 지속 기준 = 섞은 P85 | v6_8_2 반영 |
| N7-2 | cueBpm | AI04는 추천 페이스의 정수 BPM(60~220)을 반환한다(S15P31E105-416). BPM 모듈 로드·계산 실패 때만 null + `CUE_BPM_UNAVAILABLE`이며, 이때 COACHING 명령은 현재 BPM을 유지한다(S15P31E105-421). 사용자 기록은 백엔드가 보내지 않고 AI가 DB에서 직접 읽는다(S15P31E105-438, 합의). 백엔드는 코칭 발행(`publishSuggested=true`) 때만 `cueBpm`을 적용하고, 작은 BPM 변화는 따로 거르지 않는다(S15P31E105-462, 합의) | 기록 조회·적용 시점 합의(462). 수동 BPM 유지·`cueBpm=null` 처리는 백엔드 구현(S15P31E105-421, 2026-11-05 사용자 확정), 팀 확인 전 |
| N7-3 | 러닝 mode enum | AI05 `COURSE/FREE_WITH_GOAL/FREE_NO_GOAL`; AI04 입력 문자열 유지 | 잠정 |
| N7-4 / O1 | 자유러닝 경사 null vs 0 | MVP 기본 `FREE_RUN_GRADE_POLICY=flat0`; 경사 정보가 없으면 0% 평지 계산 후 HTTP 200과 경로별 경고 반환. 코스 경사 저장은 S15P31E105-319, unknown 정책·GPS 고도 활용은 MVP 이후 | flat0 MVP 기본값 합의(MR !142 리뷰) |
| N7-5 | AI04 timeout | 3초, timeout 후 재시도 없이 다음 batch. 1 vCPU 실측 p99 ≤ 0.6 s(동시 50명, AI09·AI06 동시 실행 포함, S15P31E105-440). 단 DB 조회 lock 수정 전에는 DB 지연 시 초과 | 백엔드 구현 반영(S15P31E105-421), 실측 확인(S15P31E105-440) |
| N7-6 / O2 | HRmax source | 나이 공식·HRR 경로를 기준 계산에서 제거. 마지막 400m는 안전 한계만 위험 기준 + 5 bpm(허용선은 위험 기준) | v6_8_2 반영 |
| N7-7 | 목표 시간 기준 | MPC policy v0.4.0의 일시정지 제외 activeSec | 제안 |
| N8 | 워치 demo 실시간 전송 | 기본 OFF, 5초 batch, 실기기 테스트는 별도 | 합의 필요 |
| O1 | 자유러닝 경사 의미 | N7-4 처리 | flat0 MVP 기본값 합의(MR !142 리뷰) |
| O2 | HRmax ERD 출처 | N7-6 처리 | 제안 |
| O3 | GOOD 판정·최근 20회 P98/P85 | AI06의 GOOD 표본 품질 필드와 `sessionStartedAt` 순서를 사용 | v6_8_2 반영 |
| O4 | 5초 판단·trace·저장·발행 주기 | 계산과 저장/발행 분리, 발행 판단만 백엔드 저장 | 합의 필요 |
| O5 | decision=null·EASE_OFF 저장 | EASE_OFF pace는 max(안내, min(max(실제 pace, 현재 안내) +30, 11:07/km)) sec/km(S15P31E105-497·504). 어떤 decision을 저장할지는 백엔드 합의 필요 | 백엔드 기준: null·NOT_RUNNING 미저장, 발행하는 GUIDE_PACE·EASE_OFF만 저장(S15P31E105-421), 팀 확인 전 |
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
| O14 | AI04 timeout/500/503 retry와 중복 | 다음 W07 batch의 최신 입력에서 재판단, 같은 입력 자동 retry 없음 | 백엔드 구현 반영(S15P31E105-421), 팀 확인 전 |
| O15 | 인스턴스 자원·동시 처리량 | 단일 worker 예시; memory/CPU/GPU 부하 검증 후 제한 합의 | 합의 필요 |
| AI09 | 개인 페이스 계획 요청·응답 및 신규 사용자 표시 | 건강정보 동의 사용자만 `userId`를 보내며, 생략 시 개인 조회 없이 평균 경로(`AVERAGE_BASED`, `personalized=false`) 사용; AI 서비스는 DB에 저장하지 않음 | userId 선택 입력·동의 규칙 합의(MR !142 리뷰) |

### S15P31E105-442 백엔드 저장 연동 (2026-11-06 사용자 승인)

S01 생성/READY 목표 변경에서 잠금 밖 AI09 전체 호출은 최대 60초, 일시 장애만 1회 재시도한다. 매 시도 X-Request-Deadline을 전달한다. 코스+목표의 비율 대체는 297의 기존 저장 비율을 읽으며 원격 AI05를 다시 호출하지 않는다. 건강정보 미동의자의 정상 AI05 계획 경로는 userId·개인화 입력 없이 기존 프로필의 직접 입력 평균 페이스(존재 시)와 코스 경사를 사용한다. AI05 구간 ratio와 AI09 paceRatio의 정의는 다르므로 AI05 계획은 실제 구간 페이스의 거리 가중 평균에서 비율을 다시 도출한다. 기준 페이스를 얻지 못한 AI 필요 계획은 세션 생성 실패(503)이며 코스를 재생성하지 않는다.

고정 목표 자유러닝은 기존 plan의 평균 페이스만 쓰고 segments는 빈 배열이다. 무목표 자유러닝은 plan=null이다. 저장/공개 응답은 기존 pace_plans/pace_plan_segments와 plan 필드를 유지하며 AI metadata 및 예상시간 원값을 별도 컬럼으로 추가하지 않는다. 동의·상태/버전 재검사와 실패 원자성은 sessions.md를 따른다.
