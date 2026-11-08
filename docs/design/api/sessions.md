# API 명세 — 러닝 세션

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다. 이 문서의 API는 Query Parameter를 사용하지 않는다.

주요 사용 흐름은 **S01 세션 생성 → S08 워치 준비 결과 확인 → S03 시작 → S04/S05 일시정지·재개 → S06 종료 → 결과 표시** 순서다. S02는 현재 상태 조회, S10은 상태 변경 구독이다. S03~S06의 공통 처리 순서와 재시도 규칙은 [세션 제어 공통 계약](#세션-제어-공통-계약)에 모았다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [S01](#s01-러닝-세션-생성) | 러닝 세션 생성 | POST | `/running-sessions` | 1차 MVP | 회원 |
| [S02](#s02-러닝-세션-조회) | 러닝 세션 조회 | GET | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |
| [S03](#s03-러닝-시작) | 러닝 시작 | POST | `/running-sessions/{sessionId}/start` | 1차 MVP | 회원 |
| [S04](#s04-러닝-일시정지) | 러닝 일시정지 | POST | `/running-sessions/{sessionId}/pause` | 1차 MVP | 회원 |
| [S05](#s05-러닝-재개) | 러닝 재개 | POST | `/running-sessions/{sessionId}/resume` | 1차 MVP | 회원 |
| [S06](#s06-개인-러닝-종료) | 개인 러닝 종료 | POST | `/running-sessions/{sessionId}/finish` | 1차 MVP | 회원 |
| [S07](#s07-러닝-취소) | 러닝 취소 | POST | `/running-sessions/{sessionId}/cancel` | 1차 MVP | 회원 |
| [S08](#s08-러닝-설정제어-기기-변경) | 러닝 설정·제어 기기 변경 | PATCH | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |
| [S09](#s09-러닝-세션-삭제) | 러닝 세션 삭제 | DELETE | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |
| [S10](#s10-활성-러닝-이벤트-구독) | 활성 러닝 이벤트 구독 | GET | `/running-sessions/{sessionId}/events` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

running_sessions와 courses를 참조한다. groupRunId는 running_sessions의 컬럼이 아니라 group_run_participants.session_id로 역조회하는 관계다. 연결 API·시점의 상세는 별도 확인이 필요하다. 한 개인 세션은 하나의 그룹 참가 관계에만 연결하며, 기존 START 이력 없는 본인 READY 세션만 연결한다. 연결과 개인 START의 경합·재요청 복원 조건은 [G09](group-runs.md#g09-그룹런-시작)를 따른다. pace_plans → pace_plan_segments와 coaching_decisions는 추천의 근거다. 현재 상태와 결과 준비 상태는 running_sessions, 실제 제어 결과는 session_control_events에 저장한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. 오류 조건은 각 API의 오류 응답 절을 따른다.

## 코스 상태와 새 운동

- 코스를 지정한 새 운동 생성·출발 전 목표 변경·새 시작 승인에는 **ACTIVE 코스만 사용**한다. 자유러닝의 courseId=null에는 이 검사를 적용하지 않는다.
- MERGED(병합)·BLOCKED(사용 제한)는 `403 COURSE_INACCESSIBLE`, 존재하지 않는 코스는 `404 COURSE_NOT_FOUND`다. MERGED는 코스 조회·저장 목록의 mergedIntoCourseId로 대표 코스를 확인해 다시 선택한다. 서버가 요청의 코스 ID를 자동으로 바꾸지 않으며 대표 코스도 ACTIVE여야 한다.
- 검사는 S01, S08 UPDATE_GOAL의 변경 후 코스, S03 REQUEST·G09의 새 시작 승인에 적용한다. 이미 반영된 동일 목표 변경의 결과 확인, 승인한 명령의 재응답·실행 결과 보고, 폰 인계·기록 저장·종료는 이후 코스 상태가 바뀌었다는 이유로 막지 않는다. 기존 기록과 저장한 코스의 상태 조회도 유지한다.

## 목표 검증·초기 계획·동의 (S15P31E105-255 확정, 2026-10-29)

S01과 S08 UPDATE_GOAL에 공통으로 적용한다.

- **목표 조합:** 거리·시간·페이스는 각각 양수이며 **최대 2개**까지 지정한다. 목표 거리는 **45km(45000m) 이하**이며 넘으면 `422 INVALID_GOAL`이다(2026-10-30 확정). 세 값을 모두 지정하면 `422 INVALID_GOAL`이다. 모두 생략한 무목표 자유러닝은 허용한다. 페이스는 소수 둘째 자리까지 허용하며 그 이상의 정밀도는 `400 VALIDATION_ERROR`다.
- **비교 기록:** 자유러닝(courseId=null)에는 비교 모드가 없다. 비교 기록은 코스가 있을 때만 지정할 수 있고, 본인·미삭제·COMPLETED이며 `course_id`가 선택 코스와 같아야 한다. 아니면 `422 INVALID_COMPARISON_SESSION`이다. 검증과 참조 저장은 대상 세션 행을 잠근 상태에서 한다.
- **초기 계획(S15P31E105-442, 2026-11-06 사용자 승인):** 세션 생성(S01)과 READY 목표 변경(S08) 시 원격 계산은 DB 트랜잭션·회원/세션/그룹 잠금 밖에서 수행한다. 저장 단계에서 권한·동의·코스·목표·상태/버전을 재검사하고 세션/목표와 계획·구간을 함께 저장한다. START에서는 저장한 계획만 쓴다.
  - 자유러닝의 거리+페이스, 거리+시간, 페이스만은 AI09를 호출하지 않고 고정 목표 페이스를 쓴다(시간÷거리 km). 기존 `plan` 객체에 추천 페이스를 저장하되 `segments=[]`이며 AI 구간 추천은 없다. 무목표 자유러닝은 `plan=null`이고 AI04 런타임 판단을 이 사유로 차단하지 않는다.
  - 거리만 있는 자유러닝은 AI09에 courseId·경사 없이 selectedGoal.targetDistanceM을 보내 평지 구간 계획을 받아 저장한다. 코스 러닝은 목표가 있으면 사용자 평균 목표를 유지하며 AI09 paceRatio → 미리 저장된 AI05 코스 비율(297) → 균등 순서로 적용하고, 속도/시간 목표가 없으면 AI09 계획을 그대로 저장한다.
  - 1회 AI 전체 호출 상한은 60초이며 일시 장애만 1회 재시도한다. 기준 페이스가 필요한 경로에서 계획을 얻지 못하면 `503 SERVICE_UNAVAILABLE`, 부분 세션·계획 없이 실패한다. 기존 선택 코스는 지우지 않으며 클라이언트는 코스·목표를 유지해 세션 생성만 재요청한다. 고정 목표가 있는 코스는 위 비율 대체로 계획을 만들 수 있다. 이미 활성 세션이 있는 재요청은 기존 `409 ACTIVE_SESSION_EXISTS`와 sessionId로 복구한다.
  - READY 목표 변경은 계산·저장 성공 시에만 목표와 계획을 교체하고, 실패 시 기존 목표·계획·버전을 유지한다. 최종 페이스는 소수 둘째 자리 HALF_UP으로 저장하며 중간 계산은 정밀도를 유지한다. 구간 최종 반올림에 따른 시간 오차는 0.005×거리(km)초 이내다.
  - 응답 plan 구조와 DB 컬럼은 유지한다. 새 출처·modelVersion·예상시간 필드는 추가하지 않으며 예상시간은 저장 구간에서 계산 가능하다. 건강정보 미동의는 userId/개인화 없이 AI05 경로를 사용한다. 목표 평균을 얻을 수 없는 AI05 요청은 실제 계획 실패로 처리하며 임의 기본 페이스를 넣지 않는다.

- **동의:** 위치정보 동의는 가입(U15) 필수이므로 세션 API에서 다시 검사하지 않는다. 건강정보 동의(`users.health_data_access`)를 거부해도 세션 생성·변경·인계·중단·삭제는 허용한다(GPS 기록 가능). 건강정보가 필요한 AI 코칭만 P07에서 막는다. 따라서 S01~S09에서 `403 CONSENT_REQUIRED`는 발생하지 않는다(S03~S07은 2026-11-02 S15P31E105-256에서 확정). S10도 건강정보 동의로 구독을 거절하지 않으며, 미동의 세션에는 서버가 자동 코칭을 발행하지 않는다(2026-11-05 S15P31E105-257 확정).

`plan` 객체 필드(객체가 null이면 내부 필드를 보내지 않음):

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `planId` | integer (int64) | O | pace_plans.id |
| `recommendedPaceSecPerKm` | number | O | 추천 페이스(초/km), 소수 둘째 자리 |
| `segments` | array | O | 구간 계획. 없으면 빈 배열 |
| `segments[].sequence` | integer | O | 구간 순서, 1부터 |
| `segments[].startDistanceM` | number | O | 구간 시작거리(m) |
| `segments[].endDistanceM` | number | O | 구간 종료거리(m) |
| `segments[].recommendedPaceSecPerKm` | number | O | 구간 추천 페이스(초/km) |

`coaching` 객체 필드(2026-11-05 S15P31E105-257 확정). [COACHING_GUIDE payload](../watch-mobile-server-integration.md#93-타입별-필수-payload)와 같은 필드를 사용한다. 현재 제어기기의 미확정 COACHING 명령이 있고, 그 추천의 기준 버전이 현재 `stateVersion`과 같으며 `expiresAt`이 지나지 않았을 때만 채운다. 그 외에는 `null`이다. 만료된 미확인 코칭 명령은 `pendingCommand.coachingGuide`로 확인한다. 세션 생성 직후(S01)와 목표 변경(S08) 응답은 미확정 COACHING 명령이 없으므로 항상 `null`이다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 코칭 적용 명령 번호(session_control_events.id) |
| `coachingId` | integer (int64) | O | 코칭 추천 ID(coaching_decisions.id) |
| `expectedVersion` | integer (int64) | O | 명령 승인 기준 stateVersion(= based_on_state_version) |
| `targetBpm` | integer | O | 적용할 박자(60~220, = cue_bpm) |
| `recommendedPaceSecPerKm` | number | O | 권장 페이스(초/km) |
| `expiresAt` | string (date-time, UTC) | O | 새로 적용할 수 있는 만료시각 |
| `coachingLevel` | string (enum) / null | O | AI04 코칭 단계 `OK`/`CAUTION`/`DANGER`. 저장된 값이 없으면 null(S15P31E105-503) |

## 기록 비교 (S15P31E105-422 확정, 2026-11-05)

REC-005·WAT-007의 같은 코스 과거 기록 비교는 서버가 자동 계산해 S02·S10의 `comparison`으로 전달한다(P05는 공개 API가 아니다). 클라이언트 조회가 계산 조건이 아니며 결과를 저장하지 않는다. 비교 대상 선택·검증은 S01/S08 `comparisonSessionId` 규칙을 따른다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `status` | string (enum) | O | WAITING(아직 비교할 현재 거리 없음) / AVAILABLE(결과 있음) / NO_RECORD(비교 기록에 거리 측정값이 없어 비교 불가) / UNAVAILABLE(비교 기록이 삭제됐거나 본인 완료 기록이 아님) |
| `targetStartedAt` | string (date-time, UTC) / null | O | 비교 기록의 실제 시작시각(화면 라벨용). UNAVAILABLE이면 null |
| `distanceM` | integer / null | O | 비교 지점 거리(m, 소수점 버림). 두 운동시간은 버리기 전 거리로 계산한다. AVAILABLE에만 값 |
| `currentElapsedSec` | integer / null | O | 이번 러닝이 비교 지점에 도달한 운동시간(초, 반올림). AVAILABLE에만 값 |
| `pastElapsedSec` | integer / null | O | 비교 기록이 비교 지점에 처음 도달한 운동시간(초, 반올림). AVAILABLE에만 값 |

`pastElapsedSec - currentElapsedSec`가 양수면 이번 러닝이 앞서고 음수면 뒤처진다.

계산 규칙:

- 운동시간은 [종료 후 분석](#준비코칭종료-후-분석-상태)과 같이 실제 시작부터의 경과시간에서 APPLIED PAUSE~RESUME 구간을 뺀다. RESUME 없는 PAUSE는 계산 시점(종료 세션은 종료시각)까지 일시정지로 본다.
- 이번 러닝의 비교 지점은 누적거리(`total_distance`)가 있는 마지막 샘플의 거리이고, 그 샘플 측정시각까지의 운동시간을 쓴다.
- 비교 기록은 누적거리가 있는 샘플을 측정시각 순으로 이어 (누적거리, 운동시간) 곡선을 만들고, 거리는 감소하지 않게 하며 총거리를 넘지 않게 자른다. 비교 지점에 처음 도달한 운동시간을 앞뒤 샘플 사이 선형 보간으로 구한다.
- 이번 러닝 거리가 비교 기록 총거리를 넘으면 비교 지점을 비교 기록 총거리로 고정하고 이번 러닝이 그 거리에 도달한 운동시간을 같은 방식으로 보간한다.
- 시작 전이거나 이번 러닝에 누적거리 샘플이 없거나 0이면 WAITING이다. 비교 기록이 S09로 삭제되면 진행 중 비교는 UNAVAILABLE로 바뀌고 러닝·목표는 그대로 유지한다.
- 측정 원본 값은 로그에 남기지 않는다.

## S01 러닝 세션 생성

`POST /api/v1/running-sessions`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

기기와 목표를 등록해 운동을 준비한다. 무목표 자유러닝은 목표 필드를 모두 생략할 수 있다.

### 인증 및 권한

본인 회원·등록된 워치와 폰의 소유권을 확인한다(동의는 [목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29) 기준). 코스 사용 권한과 본인 비교 기록 조건을 검사한다.

### Path Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `controlDeviceId` | integer (int64) | O | 본인 등록 워치 ID. 양의 정수 |
| `relayDeviceId` | integer (int64) | O | 본인 등록 폰 ID. 양의 정수 |
| `courseId` | integer (int64) / null | X | ACTIVE 상태의 선택 코스 ID. 자유러닝은 null 또는 생략. [C01](courses.md#c01-코스-추천)의 AI 생성 후보는 선택 후 저장해야 `courseId`가 생기며, 저장으로 얻은 `courseId`를 여기에 전달한다 |
| `comparisonSessionId` | integer (int64) / null | X | 비교할 본인 과거 운동 ID. 미선택은 null 또는 생략 |
| `targetDistanceM` | integer / null | X | 목표 거리(m), 양수. 미설정은 null 또는 생략 |
| `targetDurationSec` | integer / null | X | 목표 시간(초), 양수. 미설정은 null 또는 생략 |
| `targetPaceSecPerKm` | number / null | X | 목표 페이스(초/km), 양수. 미설정은 null 또는 생략 |

```json
{
  "controlDeviceId": 101,
  "relayDeviceId": 102
}
```

### Response

`201 Created` — S02와 같은 전체 세션 상태를 반환한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 세션 ID |
| `controlDeviceId` | integer (int64) / null | O | 현재 제어기기 ID. 기존 기록에 기기 정보가 없으면 null |
| `relayDeviceId` | integer (int64) / null | O | 서버 통신을 중계하는 폰 ID. 기존 기록에 정보가 없으면 null |
| `state` | string (enum) | O | READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `stateVersion` | integer (int64) | O | 서버 상태 버전. 신규 세션은 1부터, 기존 기록은 0 |
| `currentBpm` | integer / null | O | 확정된 현재 박자(60~220). 값이 없거나 폰 기록으로 전환하면 null |
| `startedAt` | string (date-time, UTC) / null | O | 실제 시작시각. 시작 전 null |
| `endedAt` | string (date-time, UTC) / null | O | 실제 종료시각. 종료 전 null |
| `goal` | object | O | 현재 목표. courseId / comparisonSessionId / targetDistanceM / targetDurationSec / targetPaceSecPerKm는 S01과 같은 타입이며 미설정 값은 null |
| `plan` | object / null | O | 초기 페이스 계획과 구간 계획(pace_plans / pace_plan_segments). 무목표 자유러닝은 null |
| `analysis` | object | O | 분석 준비 상태 객체 |
| `analysis.status` | string (enum) | O | PENDING(대기) / PROCESSING(분석 중) / READY(준비 완료) / FAILED(실패) / LEGACY(기존 기록) |
| `coaching` | object / null | O | 현재 유효한 최신 코칭. 없으면 null. 코칭·만료 규칙은 [P07](pace-coaching.md) 참조 |
| `comparison` | object / null | O | 과거 기록 대비 동일 거리 도달 시간 비교(REC-005). `goal.comparisonSessionId`가 null이면 null. 필드·계산 규칙은 [기록 비교](#기록-비교-s15p31e105-422-확정-2026-11-05) 참조 |
| `pendingCommand` | object / null | O | 현재 제어기기의 PENDING 또는 UNKNOWN 명령. 만료된 미확인 코칭도 결과 확인 전까지 포함. 없으면 null |
| `lastCommand` | object / null | O | 마지막 명령. 없으면 null. 명령 객체 필드는 아래 표 참조 |
| `serverReceiveAt` | string (date-time, UTC) | O | 서버가 상태 조회 요청을 받은 시각. 서버와 기기의 시각 차이 추정에 사용 |
| `serverSendAt` | string (date-time, UTC) | O | 서버가 응답을 보내는 시각 |
| `recordingMode` | string (enum) / null | O | WATCH(워치 기록) / PHONE_FALLBACK(폰으로 기록 전환). 기기 정보가 없는 기존 기록은 null |
| `groupEndedAt` | string (date-time, UTC) / null | O | 개인런·아직 종료되지 않은 그룹런은 null, 종료된 그룹런은 그룹 종료 기준시각. 키는 항상 포함 |

```json
{
  "sessionId": 201,
  "controlDeviceId": 101,
  "relayDeviceId": 102,
  "state": "READY",
  "stateVersion": 1,
  "currentBpm": null,
  "startedAt": null,
  "endedAt": null,
  "goal": {
    "courseId": null,
    "comparisonSessionId": null,
    "targetDistanceM": null,
    "targetDurationSec": null,
    "targetPaceSecPerKm": null
  },
  "plan": null,
  "analysis": {
    "status": "PENDING"
  },
  "coaching": null,
  "comparison": null,
  "pendingCommand": null,
  "lastCommand": null,
  "serverReceiveAt": "2026-10-28T01:00:00Z",
  "serverSendAt": "2026-10-28T01:00:00.010Z",
  "recordingMode": "WATCH",
  "groupEndedAt": null
}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `403 COURSE_INACCESSIBLE` | 새 운동에 사용할 코스가 MERGED(대표 코스로 병합) 또는 BLOCKED(사용 제한) 상태. MERGED는 대표 코스를 다시 선택하고 BLOCKED는 다른 코스 선택 |
| `404 COURSE_NOT_FOUND` | 선택한 코스가 존재하지 않음 |
| `422 INVALID_GOAL` | 목표 값이 0·음수이거나 목표 거리가 45km를 넘거나 목표 조합이 서로 모순됨(계산한 추천 페이스가 0 이하이거나 저장 범위를 넘는 경우 포함). 무목표 자유러닝의 전체 생략은 허용 |
| `422 INVALID_COMPARISON_SESSION` | 비교 기록이 본인 소유·동일 코스 조건에 맞지 않음 |
| `409 ACTIVE_SESSION_EXISTS` | 본인의 활성 세션이 있어 새로 생성할 수 없음. `details.sessionId`로 기존 세션을 조회해 복구 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

1. 본인 회원·등록된 워치와 폰을 확인한다. 코스·비교 기록의 권한, 목표 조합과 SQL 정밀도를 검사한다. 기기·코스 행은 확인할 때 잠가(FOR SHARE) W03 연결 해제나 코스 상태 변경과 겹쳐도 해제된 기기·ACTIVE가 아닌 코스로 저장하지 않는다.
2. 본인에게 `stateVersion≥1`인 READY/RUNNING/PAUSED 세션이 있으면 `409 ACTIVE_SESSION_EXISTS`로 거절한다. 기존 기록인 `stateVersion=0` 세션은 이 검사에서 제외한다.
3. 코스·목표가 있으면 `pace_plans`에 초기 계획을 저장한다. 코스 없는 무목표 자유러닝은 사전 계획 없이 생성한다. 거리만 있는 자유러닝과 무목표 코스는 위 AI09 규칙으로 계획을 준비한다. 계획 저장 등 준비 처리가 실패하면 `503`을 반환하고 성공한 계획처럼 표시하지 않는다. 목표 조합으로 계산한 추천 페이스가 범위를 벗어나는 경우는 장애가 아닌 입력 문제이므로 [목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29) 절의 `422 INVALID_GOAL`이다.
4. 위 Response의 초기 상태로 세션을 생성하고 S02 형식으로 반환한다.

### 생성 응답 유실 복구

생성 후 응답만 유실되어 S01을 다시 호출해도 새 세션을 만들지 않는다. `409 ACTIVE_SESSION_EXISTS`의 `details.sessionId`에 요청자 본인의 활성 세션 ID를 반환한다. 기존 세션의 목표를 새 요청 값으로 덮어쓰지 않는다.

```json
{
  "code": "ACTIVE_SESSION_EXISTS",
  "message": "진행 중인 러닝 세션이 있습니다.",
  "details": { "sessionId": 201 }
}
```

앱은 해당 ID로 S02를 조회해 현재 준비·운동 화면을 복원한다. 목표 수정은 조회 후 S08 UPDATE_GOAL로 별도 요청한다. 인증·본인 소유를 확인한 뒤에만 ID를 반환하며, 다른 회원의 활성 세션을 노출하지 않는다. 세션 생성의 활성 여부 검사와 저장은 동일 회원 기준으로 직렬화해 동시 생성도 하나만 성공시킨다. 그룹 시작 등 세션을 만들거나 다시 활성으로 바꾸는 다른 경로도 같은 회원 잠금을 쓴다. 회원별 활성 세션 1개는 DB 부분 UNIQUE(`uq_running_sessions_active`)로도 보장하며, 잠금을 거치지 않은 경로가 이를 어기면 저장이 거절된다(`500 INTERNAL_ERROR`).

### 상태값

| 필드 | 전체 허용값·의미 | 생성 시 초기값 |
| --- | --- | --- |
| `state` | READY(운동 준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(시작 전 취소) / INTERRUPTED(중단) | READY |
| `analysis.status` | PENDING(분석 대기) / PROCESSING(분석 중) / READY(분석 완료) / FAILED(분석 실패) / LEGACY(기존 기록 보존) | PENDING |

`stateVersion`은 **0 이상의 정수 버전**이다. 새 세션은 1부터 시작하고, 상태·목표·BPM 등의 확정 변경 시 증가한다. 0은 기존 기록에만 사용한다. 생성 API는 READY로 반환하며, 다른 상태는 이후 세션의 진행 과정에서 사용한다.

## S02 러닝 세션 조회

`GET /api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

현재 운동 상태·목표·명령 결과·분석 상태를 한 번에 조회한다.

### 인증 및 권한

본인 소유 세션의 상태만 조회한다. 다른 사용자의 세션·명령 결과를 반환하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

없음.

### Response

`200 OK`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 세션 ID |
| `controlDeviceId` | integer (int64) / null | O | 현재 제어기기 ID. 기존 기록에 기기 정보가 없으면 null |
| `relayDeviceId` | integer (int64) / null | O | 서버 통신을 중계하는 폰 ID. 기존 기록에 정보가 없으면 null |
| `state` | string (enum) | O | READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `stateVersion` | integer (int64) | O | 서버 상태 버전. 신규 세션은 1부터, 기존 기록은 0 |
| `currentBpm` | integer / null | O | 확정된 현재 박자(60~220). 값이 없거나 폰 기록으로 전환하면 null |
| `startedAt` | string (date-time, UTC) / null | O | 실제 시작시각. 시작 전 null |
| `endedAt` | string (date-time, UTC) / null | O | 실제 종료시각. 종료 전 null |
| `goal` | object | O | 현재 목표. courseId / comparisonSessionId / targetDistanceM / targetDurationSec / targetPaceSecPerKm는 S01과 같은 타입이며 미설정 값은 null |
| `plan` | object / null | O | 초기 페이스 계획과 구간 계획(pace_plans / pace_plan_segments). 무목표 자유러닝은 null |
| `analysis` | object | O | 분석 준비 상태 객체 |
| `analysis.status` | string (enum) | O | PENDING(대기) / PROCESSING(분석 중) / READY(준비 완료) / FAILED(실패) / LEGACY(기존 기록) |
| `coaching` | object / null | O | 현재 유효한 최신 코칭. 없으면 null. 코칭·만료 규칙은 [P07](pace-coaching.md) 참조 |
| `comparison` | object / null | O | 과거 기록 대비 동일 거리 도달 시간 비교(REC-005). `goal.comparisonSessionId`가 null이면 null. 필드·계산 규칙은 [기록 비교](#기록-비교-s15p31e105-422-확정-2026-11-05) 참조 |
| `pendingCommand` | object / null | O | 현재 제어기기의 PENDING 또는 UNKNOWN 명령. 만료된 미확인 코칭도 결과 확인 전까지 포함. 없으면 null |
| `lastCommand` | object / null | O | 마지막 명령. 없으면 null. 명령 객체 필드는 아래 표 참조 |
| `serverReceiveAt` | string (date-time, UTC) | O | 서버가 상태 조회 요청을 받은 시각. 서버와 기기의 시각 차이 추정에 사용 |
| `serverSendAt` | string (date-time, UTC) | O | 서버가 응답을 보내는 시각 |
| `recordingMode` | string (enum) / null | O | WATCH(워치 기록) / PHONE_FALLBACK(폰으로 기록 전환). 기기 정보가 없는 기존 기록은 null |
| `groupEndedAt` | string (date-time, UTC) / null | O | 개인런·아직 종료되지 않은 그룹런은 null, 종료된 그룹런은 그룹 종료 기준시각. 키는 항상 포함 |

pendingCommand / lastCommand의 필드(객체가 null이면 내부 필드를 보내지 않음):

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버가 발급한 명령 번호 |
| `action` | string (enum) | O | START(시작) / PAUSE(일시정지) / RESUME(재개) / END(종료) / SET_BPM(BPM 변경) / COACHING(자동 코칭) |
| `targetBpm` | integer / null | O | BPM 변경·코칭의 적용값(60~220). 나머지 명령은 null |
| `expectedVersion` | integer (int64) | O | 명령 승인 기준 버전, 1 이상 |
| `coachingId` | integer (int64) / null | O | 연결된 AI 코칭 ID. 없으면 null |
| `result` | string (enum) | O | PENDING(대기) / APPLIED(적용 완료) / REJECTED(거절) / IGNORED(코칭 미적용) / UNKNOWN(실행 여부 미확인) |
| `appliedAt` | string (date-time, UTC) / null | O | APPLIED일 때 실제 적용시각, 그 외 null |
| `reasonCode` | string / null | O | 거절·미적용·미확인 등의 사유 코드. 없으면 null |
| `coachingGuide` | object / null | O | 현재 제어기기의 미확정 COACHING 명령이면 원래 승인된 COACHING_GUIDE payload. 만료 후에도 결과 확인용으로 포함한다. 다른 명령·확정 결과는 null. 필드는 [MessageClient 명세](../watch-mobile-server-integration.md#93-타입별-필수-payload)를 따름 |

```json
{
  "sessionId": 201,
  "controlDeviceId": 101,
  "relayDeviceId": 102,
  "state": "READY",
  "stateVersion": 1,
  "currentBpm": null,
  "startedAt": null,
  "endedAt": null,
  "goal": {
    "courseId": null,
    "comparisonSessionId": null,
    "targetDistanceM": null,
    "targetDurationSec": null,
    "targetPaceSecPerKm": null
  },
  "plan": null,
  "analysis": {
    "status": "PENDING"
  },
  "coaching": null,
  "comparison": null,
  "pendingCommand": null,
  "lastCommand": null,
  "serverReceiveAt": "2026-10-28T01:00:00Z",
  "serverSendAt": "2026-10-28T01:00:00.010Z",
  "recordingMode": "WATCH",
  "groupEndedAt": null
}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN` | 본인 소유가 아닌 세션에 접근 |
| `404 SESSION_NOT_FOUND` | 조회할 본인 세션이 없음 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

상태와 명령은 한 읽기 트랜잭션에서 일관되게 조회한다. 관리상 중단한 INTERRUPTED 세션은 `pendingCommand=null`이며, 보존한 미확인 START는 `lastCommand`에서 확인한다. PHONE_FALLBACK의 pendingCommand는 현재 폰 명령만 가리키며 이전 워치 UNKNOWN은 미확인 이력으로 남긴다. 두 기기 ID가 모두 null인 기존 기록을 폰 전환 상태로 판단하지 않는다.

### 상태값

READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단)

## S03 러닝 시작

`POST /api/v1/running-sessions/{sessionId}/start`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

서버가 승인한 시작 명령을 워치에 적용하고 실제 시작 결과를 저장한다.

### 인증 및 권한

본인 세션·요청 기기 소유권을 확인한다. 건강정보 동의 거부는 세션 제어를 막지 않는다([목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29)). 그룹 시작 승인은 G09를 사용하고 개인 실행 결과는 해당 참가자의 폰이 보고한다. 세션 잠금 후 그룹 연결 여부를 재검사하며, 그룹에 연결된 세션의 새 START는 S03 REQUEST로 승인하지 않고 `409 INVALID_SESSION_STATE`로 거절한다. 그룹장은 본문 없는 G09로 출발을 요청하며 서버가 현재 참가 관계·제어 워치·버전을 결정한다. 이미 승인된 그룹 START의 RESULT는 기존대로 허용한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

단계에 해당하는 필드만 보낸다. 모든 ID는 양의 int64 정수다. REQUEST에서는 서버 승인 뒤에 실행하며, RESULT는 실제 실행기기의 결과를 보고한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | REQUEST(승인 요청) / RESULT(워치 실행 결과 보고) |
| `deviceId` | integer (int64) | O | 명령을 실행할 등록 워치 ID |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST에 필수. 기준 상태 버전, 1 이상 |
| `commandId` | integer (int64) | 조건부 | RESULT에 필수. 서버가 승인한 명령 번호 |
| `result` | string (enum) | 조건부 | RESULT에 필수: APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). PENDING·IGNORED는 보고하지 않음 |
| `appliedAt` | string (date-time, UTC) / null | 조건부 | RESULT에 키 포함: APPLIED이면 실제 적용시각, 그 외 null |
| `reasonCode` | string / null | 조건부 | RESULT에 키 포함, 사유 없으면 null |

승인 요청 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 101,
  "expectedVersion": 1
}
```

워치 결과 보고 예시:

```json
{
  "phase": "RESULT",
  "commandId": 501,
  "deviceId": 101,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null
}
```

### Response

`200 OK` — REQUEST는 명령 승인 정보, RESULT는 결과 저장 확인과 [S02의 전체 세션 상태](#s02-러닝-세션-조회)를 함께 반환한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버 명령 번호. 같은 요청은 같은 번호 반환 |
| `result` | string (enum) | O | PENDING(대기) / APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). 새 REQUEST 승인은 PENDING |
| `action` | string (enum) | 조건부 | REQUEST 응답에 START 고정값 |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST 응답의 승인 기준 버전 |
| `targetBpm` | integer / null | 조건부 | REQUEST 응답에는 null. BPM 변경은 P07 사용 |
| `coachingId` | integer (int64) / null | 조건부 | REQUEST 응답에는 null. 자동 코칭 명령과 구분 |
| `persisted` | boolean | 조건부 | RESULT 응답은 true. 실행 결과의 서버 저장 확인 |
| `stateVersion` | integer (int64) | 조건부 | RESULT 응답의 최신 상태 버전 |
| `state` | string (enum) | 조건부 | RESULT 응답의 현재 상태: READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `currentBpm` | integer / null | 조건부 | RESULT 응답의 확정 BPM. 60~220 또는 null |

최초 승인 응답 예시:

```json
{
  "commandId": 501,
  "action": "START",
  "expectedVersion": 1,
  "targetBpm": null,
  "coachingId": null,
  "result": "PENDING"
}
```

위 워치 결과 보고에 대한 응답 예시(공통 상태는 주요 필드만 발췌하며 실제 응답은 S02 전체 포함):

```json
{
  "commandId": 501,
  "result": "APPLIED",
  "persisted": true,
  "stateVersion": 2,
  "state": "RUNNING",
  "currentBpm": null
}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `404 SESSION_NOT_FOUND / COMMAND_NOT_FOUND` | 대상 세션 또는 해당 API가 사용하는 명령이 없음 |
| `403 COURSE_INACCESSIBLE` | 새 REQUEST의 코스가 MERGED 또는 BLOCKED. 대표 코스 또는 다른 ACTIVE 코스로 다시 준비 |
| `404 COURSE_NOT_FOUND` | 새 REQUEST에서 사용하는 코스가 없음 |
| `409 STALE_STATE / COMMAND_PENDING / COMMAND_CONFLICT` | 기준 버전 불일치·미확인 명령·같은 요청 슬롯의 다른 내용 |
| `409 INVALID_SESSION_STATE / CONTROL_DEVICE_CHANGED` | 새 요청의 허용 상태 불일치·그룹 연결 세션의 REQUEST 또는 폰 인계 후 이전 워치의 결과 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

READY·현재 목표 버전·워치 준비 완료가 필요하다. 코스가 있으면 새 승인 전에 [코스 상태 규칙](#코스-상태와-새-운동)을 확인한다. 실제 측정 시작은 RESULT의 APPLIED로 확정한다. 승인만으로 타이머를 시작하거나 별도 시작 완료 팝업을 띄우지 않는다.

### 상태값

READY → RUNNING (실제 적용 성공 기준). 거절·미확인은 운동 상태를 바꾸지 않는다.

### 시작 결과 미확인·그룹 종료 경계

워치가 시작을 실행했지만 결과가 폰에 오기 전에 연결이 끊기면 서버는 READY와 START의 PENDING/UNKNOWN을 유지한다. 앱은 “시작 여부를 확인할 수 없습니다”를 표시하고 같은 `commandId`의 워치 저장 결과를 재연결 후 다시 확인한다. 새 START를 만들거나 실제 시작시각을 추정하지 않는다. 실제 시작이 확인되기 전에는 폰 인계·일반 종료를 허용하지 않는다.

사용자가 복구를 기다리지 않고 이번 운동을 중단하려면 [S08 시작 미확인 중단](#시작-미확인-운동-중단)을 사용한다. 실제 시작이 확인되면 일반 RUNNING 세션으로 이어가며 폰 인계·종료도 가능하다.

그룹 강제 종료 시 아직 START가 미확정인 세션은 G12가 그룹→세션 순서로 잠그고 관리상 INTERRUPTED로 닫는다. 늦은 START 결과·새 batch는 `409 INVALID_SESSION_STATE`로 거절하고, 그룹을 재개하거나 늦은 시작·미전송 기록을 복구하지 않는다. 재연결한 워치는 새 동작·결과 재보고 전에 최신 S02 상태를 확인하고 `groupEndedAt` 또는 INTERRUPTED를 확인하면 측정·박자를 멈춘다. 이미 실제 시작이 서버에 확인된 세션의 종료·마지막 batch 저장은 기존 G12/S06 절차를 따른다.

## S04 러닝 일시정지

`POST /api/v1/running-sessions/{sessionId}/pause`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

진행 중인 운동을 일시정지하고 실제 적용 결과를 저장한다.

### 인증 및 권한

본인 세션·요청 기기 소유권을 확인한다. 건강정보 동의 거부는 세션 제어를 막지 않는다([목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29)). 실행 결과는 폰이 서버에 보고한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

단계에 해당하는 필드만 보낸다. 모든 ID는 양의 int64 정수다. REQUEST에서는 서버 승인 뒤에 실행하며, RESULT는 실제 실행기기의 결과를 보고한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | REQUEST(승인 요청) / RESULT(현재 실행기기의 결과 보고) |
| `deviceId` | integer (int64) | O | 현재 제어기기 ID. 워치 기록은 WATCH, 폰 인계 후에는 PHONE |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST에 필수. 기준 상태 버전, 1 이상 |
| `commandId` | integer (int64) | 조건부 | RESULT에 필수. 서버가 승인한 명령 번호 |
| `result` | string (enum) | 조건부 | RESULT에 필수: APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). PENDING·IGNORED는 보고하지 않음 |
| `appliedAt` | string (date-time, UTC) / null | 조건부 | RESULT에 키 포함: APPLIED이면 실제 적용시각, 그 외 null |
| `reasonCode` | string / null | 조건부 | RESULT에 키 포함, 사유 없으면 null |

승인 요청 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 101,
  "expectedVersion": 2
}
```

워치 결과 보고 예시:

```json
{
  "phase": "RESULT",
  "commandId": 501,
  "deviceId": 101,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null
}
```

폰 전환 후 승인 요청·결과 보고 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 102,
  "expectedVersion": 3
}
```

서버가 commandId=601을 승인한 뒤 실행 결과 보고:

```json
{
  "phase": "RESULT",
  "commandId": 601,
  "deviceId": 102,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null
}
```

### Response

`200 OK` — REQUEST는 명령 승인 정보, RESULT는 결과 저장 확인과 [S02의 전체 세션 상태](#s02-러닝-세션-조회)를 함께 반환한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버 명령 번호. 같은 요청은 같은 번호 반환 |
| `result` | string (enum) | O | PENDING(대기) / APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). 새 REQUEST 승인은 PENDING |
| `action` | string (enum) | 조건부 | REQUEST 응답에 PAUSE 고정값 |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST 응답의 승인 기준 버전 |
| `targetBpm` | integer / null | 조건부 | REQUEST 응답에는 null. BPM 변경은 P07 사용 |
| `coachingId` | integer (int64) / null | 조건부 | REQUEST 응답에는 null. 자동 코칭 명령과 구분 |
| `persisted` | boolean | 조건부 | RESULT 응답은 true. 실행 결과의 서버 저장 확인 |
| `stateVersion` | integer (int64) | 조건부 | RESULT 응답의 최신 상태 버전 |
| `state` | string (enum) | 조건부 | RESULT 응답의 현재 상태: READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `currentBpm` | integer / null | 조건부 | RESULT 응답의 확정 BPM. 60~220 또는 null |

최초 승인 응답 예시:

```json
{
  "commandId": 501,
  "action": "PAUSE",
  "expectedVersion": 2,
  "targetBpm": null,
  "coachingId": null,
  "result": "PENDING"
}
```

위 워치 결과 보고에 대한 응답 예시(공통 상태는 주요 필드만 발췌하며 실제 응답은 S02 전체 포함):

```json
{
  "commandId": 501,
  "result": "APPLIED",
  "persisted": true,
  "stateVersion": 3,
  "state": "PAUSED",
  "currentBpm": null
}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `404 SESSION_NOT_FOUND / COMMAND_NOT_FOUND` | 대상 세션 또는 해당 API가 사용하는 명령이 없음 |
| `409 STALE_STATE / COMMAND_PENDING / COMMAND_CONFLICT` | 기준 버전 불일치·미확인 명령·같은 요청 슬롯의 다른 내용 |
| `409 INVALID_SESSION_STATE / CONTROL_DEVICE_CHANGED` | 새 요청의 허용 상태 불일치 또는 폰 인계 후 이전 워치의 결과 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

RUNNING에서 PAUSED로 바꾸고 워치 박자를 멈춘다. 폰 전환 후에도 먼저 REQUEST 승인을 받고 폰 GPS 기록을 일시정지한 뒤 RESULT를 보고한다. 실제 적용 결과가 저장되기 전 다음 명령을 겹쳐 실행하지 않는다.

### 상태값

RUNNING → PAUSED (실제 적용 성공 기준). 거절·미확인은 운동 상태를 바꾸지 않는다.

## S05 러닝 재개

`POST /api/v1/running-sessions/{sessionId}/resume`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

일시정지한 운동을 다시 시작하고 실제 적용 결과를 저장한다.

### 인증 및 권한

본인 세션·요청 기기 소유권을 확인한다. 건강정보 동의 거부는 세션 제어를 막지 않는다([목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29)). 실행 결과는 폰이 서버에 보고한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

단계에 해당하는 필드만 보낸다. 모든 ID는 양의 int64 정수다. REQUEST에서는 서버 승인 뒤에 실행하며, RESULT는 실제 실행기기의 결과를 보고한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | REQUEST(승인 요청) / RESULT(현재 실행기기의 결과 보고) |
| `deviceId` | integer (int64) | O | 현재 제어기기 ID. 워치 기록은 WATCH, 폰 인계 후에는 PHONE |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST에 필수. 기준 상태 버전, 1 이상 |
| `commandId` | integer (int64) | 조건부 | RESULT에 필수. 서버가 승인한 명령 번호 |
| `result` | string (enum) | 조건부 | RESULT에 필수: APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). PENDING·IGNORED는 보고하지 않음 |
| `appliedAt` | string (date-time, UTC) / null | 조건부 | RESULT에 키 포함: APPLIED이면 실제 적용시각, 그 외 null |
| `reasonCode` | string / null | 조건부 | RESULT에 키 포함, 사유 없으면 null |

승인 요청 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 101,
  "expectedVersion": 3
}
```

워치 결과 보고 예시:

```json
{
  "phase": "RESULT",
  "commandId": 501,
  "deviceId": 101,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null
}
```

폰 전환 후 승인 요청·결과 보고 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 102,
  "expectedVersion": 4
}
```

서버가 commandId=601을 승인한 뒤 실행 결과 보고:

```json
{
  "phase": "RESULT",
  "commandId": 601,
  "deviceId": 102,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null
}
```

### Response

`200 OK` — REQUEST는 명령 승인 정보, RESULT는 결과 저장 확인과 [S02의 전체 세션 상태](#s02-러닝-세션-조회)를 함께 반환한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버 명령 번호. 같은 요청은 같은 번호 반환 |
| `result` | string (enum) | O | PENDING(대기) / APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). 새 REQUEST 승인은 PENDING |
| `action` | string (enum) | 조건부 | REQUEST 응답에 RESUME 고정값 |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST 응답의 승인 기준 버전 |
| `targetBpm` | integer / null | 조건부 | REQUEST 응답에는 null. BPM 변경은 P07 사용 |
| `coachingId` | integer (int64) / null | 조건부 | REQUEST 응답에는 null. 자동 코칭 명령과 구분 |
| `persisted` | boolean | 조건부 | RESULT 응답은 true. 실행 결과의 서버 저장 확인 |
| `stateVersion` | integer (int64) | 조건부 | RESULT 응답의 최신 상태 버전 |
| `state` | string (enum) | 조건부 | RESULT 응답의 현재 상태: READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `currentBpm` | integer / null | 조건부 | RESULT 응답의 확정 BPM. 60~220 또는 null |

최초 승인 응답 예시:

```json
{
  "commandId": 501,
  "action": "RESUME",
  "expectedVersion": 3,
  "targetBpm": null,
  "coachingId": null,
  "result": "PENDING"
}
```

위 워치 결과 보고에 대한 응답 예시(공통 상태는 주요 필드만 발췌하며 실제 응답은 S02 전체 포함):

```json
{
  "commandId": 501,
  "result": "APPLIED",
  "persisted": true,
  "stateVersion": 4,
  "state": "RUNNING",
  "currentBpm": null
}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `404 SESSION_NOT_FOUND / COMMAND_NOT_FOUND` | 대상 세션 또는 해당 API가 사용하는 명령이 없음 |
| `409 STALE_STATE / COMMAND_PENDING / COMMAND_CONFLICT` | 기준 버전 불일치·미확인 명령·같은 요청 슬롯의 다른 내용 |
| `409 INVALID_SESSION_STATE / CONTROL_DEVICE_CHANGED` | 새 요청의 허용 상태 불일치 또는 폰 인계 후 이전 워치의 결과 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

PAUSED에서 RUNNING으로 바꾸고 최신 저장 BPM으로 재생한다. 폰 전환 후에도 먼저 REQUEST 승인을 받고 폰 GPS 기록만 재개한 뒤 RESULT를 보고한다. 그룹이 종료됐으면 재개하지 않는다. 코칭의 2분 기준은 실제 재개시각부터 다시 계산한다.

### 상태값

PAUSED → RUNNING (실제 적용 성공 기준). 거절·미확인은 운동 상태를 바꾸지 않는다.

## S06 개인 러닝 종료

`POST /api/v1/running-sessions/{sessionId}/finish`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

측정을 멈추고 마지막 기록의 서버 저장을 확인한 뒤 운동을 종료한다.

### 인증 및 권한

본인 세션·요청 기기 소유권을 확인한다. 건강정보 동의 거부는 세션 제어를 막지 않는다([목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29)). 실행 결과는 폰이 서버에 보고한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

단계에 해당하는 필드만 보낸다. 모든 ID는 양의 int64 정수다. REQUEST에서는 서버 승인 뒤에 실행하며, RESULT는 실제 실행기기의 결과를 보고한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | REQUEST(승인 요청) / RESULT(현재 실행기기의 결과 보고) |
| `deviceId` | integer (int64) | O | 현재 제어기기 ID. 워치 기록은 WATCH, 폰 인계 후에는 PHONE |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST에 필수. 기준 상태 버전, 1 이상 |
| `commandId` | integer (int64) | 조건부 | RESULT에 필수. 서버가 승인한 명령 번호 |
| `result` | string (enum) | 조건부 | RESULT에 필수: APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). PENDING·IGNORED는 보고하지 않음 |
| `appliedAt` | string (date-time, UTC) / null | 조건부 | RESULT에 키 포함: APPLIED이면 실제 적용시각, 그 외 null |
| `reasonCode` | string / null | 조건부 | RESULT에 키 포함, 사유 없으면 null |
| `uploadComplete` | boolean | 조건부 | END의 RESULT/APPLIED에 true 필수. END/REJECTED·UNKNOWN은 false 또는 생략 가능 |

승인 요청 예시:

```json
{
  "phase": "REQUEST",
  "deviceId": 101,
  "expectedVersion": 4
}
```

워치 결과 보고 예시:

```json
{
  "phase": "RESULT",
  "commandId": 501,
  "deviceId": 101,
  "result": "APPLIED",
  "appliedAt": "2026-10-28T01:00:01Z",
  "reasonCode": null,
  "uploadComplete": true
}
```

### Response

`200 OK` — REQUEST는 명령 승인 정보, RESULT는 결과 저장 확인과 [S02의 전체 세션 상태](#s02-러닝-세션-조회)를 함께 반환한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버 명령 번호. 같은 요청은 같은 번호 반환 |
| `result` | string (enum) | O | PENDING(대기) / APPLIED(실행 완료) / REJECTED(거절) / UNKNOWN(실행 여부 미확인). 새 REQUEST 승인은 PENDING |
| `action` | string (enum) | 조건부 | REQUEST 응답에 END 고정값 |
| `expectedVersion` | integer (int64) | 조건부 | REQUEST 응답의 승인 기준 버전 |
| `targetBpm` | integer / null | 조건부 | REQUEST 응답에는 null. BPM 변경은 P07 사용 |
| `coachingId` | integer (int64) / null | 조건부 | REQUEST 응답에는 null. 자동 코칭 명령과 구분 |
| `persisted` | boolean | 조건부 | RESULT 응답은 true. 실행 결과의 서버 저장 확인 |
| `stateVersion` | integer (int64) | 조건부 | RESULT 응답의 최신 상태 버전 |
| `state` | string (enum) | 조건부 | RESULT 응답의 현재 상태: READY(준비) / RUNNING(운동 중) / PAUSED(일시정지) / COMPLETED(종료) / CANCELLED(취소) / INTERRUPTED(중단) |
| `currentBpm` | integer / null | 조건부 | RESULT 응답의 확정 BPM. 60~220 또는 null |

최초 승인 응답 예시:

```json
{
  "commandId": 501,
  "action": "END",
  "expectedVersion": 4,
  "targetBpm": null,
  "coachingId": null,
  "result": "PENDING"
}
```

위 워치 결과 보고에 대한 응답 예시(공통 상태는 주요 필드만 발췌하며 실제 응답은 S02 전체 포함):

```json
{
  "commandId": 501,
  "result": "APPLIED",
  "persisted": true,
  "stateVersion": 5,
  "state": "COMPLETED",
  "currentBpm": null
}
```

**워치로 기록 중인 운동은 다음 순서로 종료한다.**

1. **종료 승인:** 폰이 S06에 REQUEST를 보내 END 명령의 commandId를 받는다.
2. **측정 중지:** 워치가 센서 측정·박자를 멈추고 마지막 batch를 폰으로 보낸다.
3. **기록 저장 확인:** 워치·폰이 만든 모든 batch의 W07 COMMITTED(서버 저장 완료)를 확인한다. 폰은 자기 저장 대기 목록과 워치의 pendingBatchCount=0(워치에도 저장 확인 대기 없음)을 함께 확인한다.
4. **종료 결과 보고:** 폰이 같은 commandId로 RESULT를 보내며 result=APPLIED, uploadComplete=true와 실제 종료시각을 보고한다.
5. **종료 확정·분석:** 서버가 결과 저장과 함께 세션을 COMPLETED로 바꾸고 통계 분석을 한 번만 요청한다. 그전까지 화면은 ‘종료 처리 중’으로 표시한다.

예외 상황은 다음과 같이 처리한다.

- **멈췄지만 저장 확인이 안 된 경우:** APPLIED에 uploadComplete=false 또는 생략으로 보고하면 409 UPLOAD_PENDING을 반환하고 종료 확정·분석을 보류한다.
- **종료 거절·실행 여부 미확인:** REJECTED·UNKNOWN은 uploadComplete=false 또는 생략을 허용한다. 실제 결과만 저장하고 종료·분석을 시작하지 않는다.
- **마무리 전송 실패:** 종료 후 최대 2분 동안 정해진 횟수 안에서 시도한다. 끝내 확인하지 못하면 ‘저장 미확인’으로 표시하고 분석을 시작하지 않는다. 시간초과만으로 저장 성공이나 기록 유실을 단정하지 않는다.
- **같은 요청 재전송:** 기존 결과를 반환하며 종료·분석을 중복 실행하지 않는다.
- **종료 확정 뒤 batch 도착:** 처음 보는 batch는 거절한다. 이미 COMMITTED인 동일 batch는 기존 저장 확인(ACK)을 다시 반환한다.

저장 확인에는 기존 batch별 ACK를 사용한다. 종료용 누락 batch 목록·개수 해시·별도 마감 장부는 만들지 않는다. 인터넷 단절 후 장기 복구·임의 재분석·늦은 기록 병합은 이번 MVP에 포함하지 않는다.

### 워치 단절 후 폰에서 종료·저장

폰 인터넷이 연결돼 있으면 [폰 인계](#폰으로-기록-제어-인계)를 완료한 뒤 **워치와 같은 REQUEST → 실행 → RESULT 순서**로 종료한다.

1. S06 REQUEST에 현재 폰 deviceId와 최신 expectedVersion을 보낸다. 서버는 END 명령을 PENDING으로 저장하고 commandId를 반환한다.
2. 폰은 승인된 commandId를 확인하고 GPS·타이머를 멈춘다. 마지막 폰 batch까지 W07 COMMITTED를 확인한다. 워치 내부에만 남은 자료나 워치의 pendingBatchCount=0 응답은 기다리지 않는다.
3. 같은 S06에 RESULT로 commandId·실제 적용시각·uploadComplete=true를 보고한다. 서버 저장 확인 전에는 종료 처리 중으로 표시하며 같은 명령은 다시 실행하지 않는다.

```json
{"phase":"REQUEST","deviceId":102,"expectedVersion":7}
```

서버가 commandId=601을 승인한 경우의 결과 보고:

```json
{"phase":"RESULT","commandId":601,"deviceId":102,"result":"APPLIED","appliedAt":"2026-10-28T01:10:00Z","reasonCode":null,"uploadComplete":true}
```

서버는 현재 제어기기와 명령의 실행기기를 확인해 실제 END 결과·COMPLETED·ended_at·버전 증가를 함께 저장한다. 이전 워치 UNKNOWN은 보존하지만 현재 폰의 명령 승인을 막지 않는다. 종료 성공의 uploadComplete가 false·생략이면 UPLOAD_PENDING으로 확정을 보류한다. 응답이 없으면 동일 commandId·본문으로 결과를 재보고하고 실제 종료시각을 새로 만들지 않는다.

폰이 확보한 기록의 저장과 워치 전체 원본 수신은 구분한다. 계산 가능한 거리·경로·경과시간을 제공하고, 미수신 심박·케이던스나 확정할 수 없는 구간 분석을 가짜 값으로 채우지 않는다. 온라인 마무리 최대 2분과 저장 미확인 표시 규칙은 유지한다.

### END 결과 경계 사례

| 실제 결과 | uploadComplete | 저장·현재 상태 |
| --- | --- | --- |
| APPLIED | false/생략 | 409 UPLOAD_PENDING, PENDING 유지·분석 미시작 |
| APPLIED | true | 실제 종료·버전1회 증가·분석 요청 |
| APPLIED(appliedAt ≤ 실제 시작시각) | 무관 | 400 VALIDATION_ERROR, PENDING 유지·분석 미시작 |
| REJECTED | false/생략 | 거절 결과 저장·운동 상태 유지·버전1회 증가 |
| UNKNOWN | false/생략 | 미확인 결과 저장·상태/버전 유지, 같은 명령 확인 |

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류. END/APPLIED의 `appliedAt`(실제 종료시각)이 실제 시작시각(`startedAt`)보다 늦지 않음(같은 시각 포함, 2026-11-02 확정) |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `404 SESSION_NOT_FOUND / COMMAND_NOT_FOUND` | 대상 세션 또는 해당 API가 사용하는 명령이 없음 |
| `409 STALE_STATE / COMMAND_PENDING / COMMAND_CONFLICT` | 기준 버전 불일치·미확인 명령·같은 요청 슬롯의 다른 내용 |
| `409 INVALID_SESSION_STATE / CONTROL_DEVICE_CHANGED` | 새 요청의 허용 상태 불일치 또는 폰 인계 후 이전 워치의 결과 |
| `409 UPLOAD_PENDING` | 종료 성공 보고에 마지막 batch 저장 확인이 없음 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

종료·서버 저장·분석 완료를 구분한다. 승인만으로 종료 성공이나 분석 완료를 표시하지 않으며, 폰 전환 후의 종료와 END 경계 조건은 위 절을 따른다.

### 상태값

RUNNING / PAUSED → COMPLETED (실제 적용 성공 기준). 거절·미확인은 운동 상태를 바꾸지 않는다.

## S07 러닝 취소

`POST` `/api/v1/running-sessions/{sessionId}/cancel`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 없음. |
| 비고 | 아래 취소 계약 기준. 실제 운동 종료는 S06 사용 |

### 설명

READY에서 CANCELLED. 달리기 시작 후 취소와 구분.

### 인증 및 권한

- 인증된 본인 세션만 취소한다. 다른 회원의 세션은 취소하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음.

### Request Body

없음.

### Response

`200 OK`

```json
{
  "id": 101,
  "status": "CANCELLED"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 CANCELLED. 동일 취소 재요청은 기존 CANCELLED 결과를 반환한다. |


**사용 흐름과 응답 판단**

준비 취소는 CANCELLED이며 진행 중 운동 종료를 대신하지 않는다. 미확정 START 차단·잠금·재요청과 아래 요청·응답·오류 형식은 확정 계약이다.

### 오류 응답

| HTTP·코드 | 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | sessionId가 양의 BIGINT 정수 형식이 아님 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 FORBIDDEN` | 존재하고 삭제되지 않은 세션이 본인 소유가 아님 |
| `404 SESSION_NOT_FOUND` | 세션이 없거나 삭제 표시됨 |
| `409 COMMAND_PENDING` | READY에서 START가 PENDING/UNKNOWN. 결과 재확인 또는 S08 시작 미확인 중단 사용 |
| `409 INVALID_STATE` | CANCELLED 재요청을 제외하고 현재 상태가 READY가 아님 |
| `503 SERVICE_UNAVAILABLE` | 취소 저장 불가. 성공으로 표시하지 않음 |

인증 → sessionId 형식 → 대상 존재·삭제 여부 → 소유권 순서로 확인한다. 그 뒤 필요한 잠금을 잡고 대상과 상태를 재검사한다. 없는/삭제된 대상은 404, 존재하는 타인 세션은 403이며 타인에게 상태·명령 상세를 반환하지 않는다.

### 처리 규칙

- 본인 세션을 확인하고 그룹 소속이면 그룹→세션 순서로 잠근다. START 승인·결과 저장과 같은 세션 잠금 아래 READY와 명령 상태를 재검사한다.
- START가 PENDING/UNKNOWN이면 `409 COMMAND_PENDING`으로 거절한다. 세션을 CANCELLED로 바꾸거나 START를 거절·완료로 추정하지 않는다. 앱은 결과 재확인 또는 S08 ABORT_UNCONFIRMED_START를 사용한다.
- 취소가 먼저 확정됐다면 CANCELLED로 바꾸고 `stateVersion`을 1 증가시키며, 뒤의 새 START는 상태 검사로 거절한다. START가 먼저 승인됐다면 취소는 COMMAND_PENDING이다. START/APPLIED가 먼저 확정됐다면 `409 INVALID_STATE`로 취소를 거절하고 일반 종료를 사용한다.
- 같은 취소 재요청은 본인·권한 확인 후 이미 CANCELLED인 세션의 현재 결과를 반환하고 버전을 다시 증가시키지 않는다. 준비 취소가 실제 운동 종료를 뜻하지는 않는다.
- 취소 성공 후 최신 stateVersion이 필요한 앱은 S02로 현재 상태를 조회한다. S07 성공 응답은 id/status 형식을 유지한다.
- 예시는 합성 데이터이며 설계 확정이 실제 구현 완료를 뜻하지 않는다.

### 상태값

READY → CANCELLED. 이미 CANCELLED인 본인 세션의 같은 취소 재요청은 기존 결과를 반환한다.

### 미정 사항

없음.

## S08 러닝 설정·제어 기기 변경

`PATCH /api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 관련 요구사항 | USR-004 / PAC-001 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

출발 전 목표 변경, 워치 준비 결과 확인, 워치에서 폰으로 기록 전환, 시작 여부 미확인 운동의 관리상 중단을 처리한다.

### 인증 및 권한

본인 세션·작업별 기기 소유권을 확인한다. 잠금 전 확인과 세션 잠금 후 다시 읽은 그룹 연결이 다르면(그 사이 그룹에 연결·해제됨) 같은 값의 재요청이어도 `409 STALE_STATE`로 거절하며 앱은 S02로 재조회한다(동의는 [목표 검증·초기 계획·동의](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29) 기준). 그룹 목표 변경은 G04를 사용한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

`operation`으로 요청할 작업을 선택하고, 해당 작업에 필요한 필드만 보낸다. `expectedVersion`은 모든 작업에 필수다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `operation` | string (enum) | O | 수행할 작업. `UPDATE_GOAL`: 출발 전 러닝 목표·코스 수정. `REPORT_PREPARED`: 워치가 목표를 보관하고 러닝 기록을 시작할 준비에 성공했는지 서버에 전달하여 해당 버전의 준비 응답 확인. `TAKE_OVER_PHONE`: 워치로 시작한 러닝의 기록·제어를 해당 세션의 중계 폰으로 전환. `ABORT_UNCONFIRMED_START`: 시작 결과를 확인하지 못한 운동을 사용자 선택으로 중단 |
| `expectedVersion` | integer (int64) | O | 이번 요청의 기준이 되는 목표·상태 버전. 1 이상. 목표 수정·폰 전환·시작 미확인 중단은 확인한 현재 `stateVersion`, 워치 준비 결과 전달은 워치가 준비한 목표의 버전을 보낸다. 서버가 현재 버전과 비교하는 값이며 클라이언트가 임의로 증가시키지 않는다 |
| `deviceId` | integer (int64) | 조건부 | `REPORT_PREPARED`에서는 준비 결과를 응답한 등록 워치의 ID가 필수. `TAKE_OVER_PHONE`에서는 기록·제어를 이어받을 해당 세션의 중계 폰 ID(`relayDeviceId`, PHONE)가 필수. `ABORT_UNCONFIRMED_START`에서는 해당 세션의 중계 폰 ID가 필수이며, 그 폰이 연결 해제된 경우에만 본인의 현재 연결된 다른 PHONE ID를 허용한다. `UPDATE_GOAL`에서는 보내지 않는다 |
| `ready` | boolean | 조건부 | `REPORT_PREPARED`에 필수. 워치가 러닝 기록을 시작할 준비에 성공했는지 여부 (true 성공, false 실패). 러닝 세션 전체의 준비 여부나 실제 기록 시작 여부를 뜻하지 않는다 |
| `reasonCode` | string / null | 조건부 | `REPORT_PREPARED`에 키를 반드시 포함한다. 워치 준비 결과에 대한 사유 코드이며, 전달할 사유가 없으면 키를 생략하지 않고 `null`로 보낸다 |
| `receivedWatchBatchesUploaded` | boolean | 조건부 | `TAKE_OVER_PHONE`에 `true` 필수. 인계 전 폰이 이미 수신·영속 저장한 워치 데이터 묶음(batch) 전체가 서버에 저장 완료(`COMMITTED`)되었음을 확인한 값. 워치에만 남아 있는 데이터까지 업로드되었다는 뜻은 아니며, 저장 완료를 확인하지 못하면 전환 요청을 보류한다 |
| `courseId` | integer (int64) / null | 조건부 | `UPDATE_GOAL`에서 수정할 코스 ID. 생략하면 기존 코스를 유지하고, `null`이면 코스 설정을 해제한다 |
| `comparisonSessionId` | integer (int64) / null | 조건부 | `UPDATE_GOAL`에서 비교 대상으로 설정할 본인의 과거 러닝 세션 ID. 생략하면 기존 비교 대상을 유지하고, `null`이면 비교 설정을 해제한다 |
| `targetDistanceM` | integer / null | 조건부 | `UPDATE_GOAL`에서 수정할 목표 거리(m). 값은 양수. 생략하면 기존 목표를 유지하고, `null`이면 거리 목표를 해제한다 |
| `targetDurationSec` | integer / null | 조건부 | `UPDATE_GOAL`에서 수정할 목표 시간(초). 값은 양수. 생략하면 기존 목표를 유지하고, `null`이면 시간 목표를 해제한다 |
| `targetPaceSecPerKm` | number / null | 조건부 | `UPDATE_GOAL`에서 수정할 목표 페이스(1km당 소요 시간, 초/km). 값은 양수. 생략하면 기존 목표를 유지하고, `null`이면 페이스 목표를 해제한다 |

```json
{
  "operation": "UPDATE_GOAL",
  "expectedVersion": 1,
  "targetDistanceM": 5000
}
```

```json
{
  "operation": "REPORT_PREPARED",
  "deviceId": 101,
  "expectedVersion": 2,
  "ready": true,
  "reasonCode": null
}
```

```json
{
  "operation": "TAKE_OVER_PHONE",
  "deviceId": 102,
  "expectedVersion": 6,
  "receivedWatchBatchesUploaded": true
}
```

### Response

`200 OK`. 응답 형태는 `operation`에 따라 다르다.

#### REPORT_PREPARED 응답

워치 준비 결과를 확인한 버전만 반환한다. 이 응답 자체가 러닝 시작을 의미하지는 않는다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `expectedVersion` | integer (int64) | O | 서버가 확인한 준비 결과의 버전. 요청의 `expectedVersion`과 같은 값 |

```json
{
  "expectedVersion": 2
}
```

#### UPDATE_GOAL / TAKE_OVER_PHONE / ABORT_UNCONFIRMED_START 응답

변경 후 **러닝 세션 전체 상태**를 반환한다. 필드·타입·필수 여부·명령 객체·JSON 예시는 [S02 러닝 세션 조회](#s02-러닝-세션-조회)의 응답 명세를 따른다.

| 작업 | 실제 변경이 발생했을 때의 주요 결과 |
| --- | --- |
| `UPDATE_GOAL` | `goal`과 `plan`을 갱신하고 `stateVersion`을 1 증가시킨다 |
| `TAKE_OVER_PHONE` | `controlDeviceId`를 중계 폰으로 바꾸고, `recordingMode=PHONE_FALLBACK`, `currentBpm=null`, `stateVersion+1`을 반영한다. 운동 상태·시작시각·목표는 유지한다 |
| `ABORT_UNCONFIRMED_START` | `state=INTERRUPTED`, `analysis.status=FAILED`, `currentBpm=null`, `pendingCommand=null`로 바꾸고 `stateVersion`을 1 증가시킨다. 실제 시작·종료시각을 추정하지 않는다 |

이미 반영된 동일 요청은 현재 상태를 반환하며 버전을 다시 증가시키지 않는다. 판정 조건은 아래 작업별 처리 규칙을 따른다.

### 시작 미확인 운동 중단

사용자가 “이번 운동 중단”을 선택하면 S08에 다음 요청을 보낸다. 실제 운동 종료 성공이나 업로드 완료를 뜻하는 작업이 아니다.

```json
{
  "operation": "ABORT_UNCONFIRMED_START",
  "deviceId": 102,
  "expectedVersion": 1
}
```

- 본인 세션·등록된 중계 폰을 확인한다(중계 폰이 해제된 경우는 아래 참고). READY, `startedAt=null`, 미확정 START(PENDING/UNKNOWN), 현재 버전 일치일 때만 허용한다. 이미 START/APPLIED가 확정됐다면 이 경로로 중단하지 않고 현재 상태를 재조회해 S06 또는 폰 인계로 종료한다.
- **중계 폰이 해제된 경우(S15P31E105-255 확정, 2026-10-30):** 앱 재설치 등으로 세션의 중계 폰이 W03 해제되고 W01로 새 ID가 등록되면, 원래 폰으로는 중단할 수 없고 S07 취소는 미확정 START 때문에 `409 COMMAND_PENDING`, S01은 활성 세션 때문에 `409`가 되어 세션을 정리할 수 없다. 이를 막기 위해 세션의 `relayDeviceId` 기기가 더 이상 연결 중이 아닐 때에 한해 같은 회원의 현재 연결된 PHONE으로 요청해도 허용한다. 중계 폰이 연결 중이면 그 폰만 허용한다. 세션의 `relayDeviceId`는 바꾸지 않으며 재요청 판정도 같은 기준을 따른다. 그 밖의 경우는 `403 DEVICE_FORBIDDEN`이다. 이 예외는 시작 미확인 중단에만 적용하며 `TAKE_OVER_PHONE`에는 적용하지 않는다.
- 그룹 소속이면 그룹→세션 순서로 잠그고 조건을 재검사한다. START/APPLIED 저장이 먼저 완료됐다면 중단을 `409 INVALID_SESSION_STATE`로 거절한다. 중단이 먼저 완료됐다면 세션을 INTERRUPTED로 닫고 늦은 START 결과를 `409 INVALID_SESSION_STATE`로 거절한다.
- PENDING START는 `UNKNOWN(reasonCode=START_UNCONFIRMED_ABORTED)`으로 남기고 기존 UNKNOWN은 그대로 보존한다. 같은 트랜잭션에서 분석은 FAILED, 현재 BPM은 null로 바꾸며 상태 버전을 1 증가시킨다. `startedAt`과 `endedAt`은 null을 유지한다. 관리상 중단을 실제 기기 종료시각으로 기록하지 않는다.
- 같은 등록 폰이 같은 중단을 재요청하면 버전 검사보다 이미 중단된 동일 세션인지 먼저 확인하고 현재 상태를 `200`으로 반환한다. 버전을 다시 증가시키지 않는다. 이 판정은 INTERRUPTED·시작/종료시각 null·보존된 미확정 START로 구분하며 별도 중단 장부를 추가하지 않는다.
- 이후 이 세션의 새 제어 명령·새 batch는 `409 INVALID_SESSION_STATE`로 거절한다. 이미 COMMITTED인 동일 batch는 권한·내용 확인 후 기존 ACK를 반환한다. 기존 저장 원본과 UNKNOWN 이력은 보존하되 완료 운동의 통계·분석 결과를 만들지 않는다. 이 세션은 활성 세션 검사에서 제외해 새 운동 준비를 허용한다.
- 앱은 즉시 해당 세션의 수집·박자·자동 코칭을 중단한다. 재연결한 워치는 새 동작 전에 S02로 최신 상태를 확인하고 INTERRUPTED이면 측정·박자를 중단한다. 미전송 원본을 다른 세션으로 옮기거나 서버 저장 완료로 표시하지 않는다.

### 폰으로 기록 제어 인계

#### 호출 조건

워치 단절 안내에서 사용자가 “폰으로 기록 계속”을 선택하면 `TAKE_OVER_PHONE`을 호출한다.

- 워치로 실제 시작한 `RUNNING` / `PAUSED` 세션에만 허용한다. `READY`, `stateVersion=0`, 처음부터 폰 단독으로 시작한 세션에는 사용할 수 없다.
- 본인 회원·해당 세션의 등록된 중계 폰(`relayDeviceId`, PHONE)을 확인한다. 폰과 서버가 연결되어 있어야 한다.
- 폰이 이미 받은 워치 데이터 전체의 서버 저장 완료(`COMMITTED`)를 확인한 뒤 `receivedWatchBatchesUploaded=true`로 요청한다. 워치에만 남아 있는 데이터까지 모두 저장됐다는 뜻은 아니다.

#### 폰의 데이터 저장·요청 순서

1. 워치 데이터 묶음(batch)의 신규 수신과 수신 확인(`BATCH_RECEIVED`) 발급을 멈춘다. 수신 큐를 잠그고 이미 영속 저장한 모든 batch를 전송 대상으로 고정한다. 수신 ACK 전달 여부와 무관하게 포함하며, 이 경계 이후 도착분에는 수신 ACK나 저장 완료 표시를 하지 않는다.
2. 고정된 대상 전체를 서버에 전송하고 `COMMITTED`를 확인한다. 미확인 데이터가 있으면 인계를 보류한다.
3. 인계를 요청한다. 응답이 유실되면 [S02](#s02-러닝-세션-조회)로 기록 모드를 확인할 때까지 수신 차단을 유지한다. 인계가 실제 거절되고 `WATCH` 유지가 확인된 경우에만 수신을 다시 연다.

#### 서버의 전환·재요청 처리

- 그룹 소속이면 그룹→세션 순서로 잠근다. 권한·기기를 검사한 뒤 이미 같은 폰으로 인계된 요청은 종료 여부와 무관하게 현재 상태를 반환한다. 버전은 다시 증가시키지 않는다.
- 새 인계는 현재 버전과 실제 시작 사실을 재검사하고, 위 응답 표의 폰 전환 결과를 함께 저장한다. 다른 요청과 경합해 버전이 달라졌으면 `STALE_STATE`를 반환하므로 재조회한다.
- 그룹이 이미 종료됐다면 인계 후 종료·저장만 허용하고 기록 재개는 거절한다.

#### 전환 후 워치 처리

- 이전 워치의 `PENDING` 명령은 실제 적용 여부를 추측하지 않고 `UNKNOWN(reasonCode=WATCH_DISCONNECTED)`으로 남긴다. 기존 `UNKNOWN`도 유지한다.
- 늦은 워치 `RESULT`나 새 워치 batch는 `CONTROL_DEVICE_CHANGED`로 거절하고 현재 상태를 되돌리지 않는다.
- 워치가 재연결되어도 해당 운동은 폰 제어를 유지한다. 워치는 최신 `recordingMode`를 확인하고 기존 측정·박자를 중단하며 새 명령을 자동 재실행하지 않는다.

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN / DEVICE_FORBIDDEN` | 본인 세션·등록 기기 조건 위반 |
| `404 SESSION_NOT_FOUND` | 수정·준비 확인·폰 인계 대상 세션이 없음 |
| `403 COURSE_INACCESSIBLE` | UPDATE_GOAL의 변경 후 코스가 MERGED(대표 코스로 병합) 또는 BLOCKED(사용 제한) 상태. MERGED는 대표 코스를 다시 선택하고 BLOCKED는 다른 코스 선택 |
| `404 COURSE_NOT_FOUND` | UPDATE_GOAL의 변경 후 코스가 존재하지 않음 |
| `422 INVALID_GOAL` | 목표 값이 0·음수이거나 목표 거리가 45km를 넘거나 목표 조합이 서로 모순됨(계산한 추천 페이스가 0 이하이거나 저장 범위를 넘는 경우 포함). 무목표 자유러닝의 전체 생략은 허용 |
| `422 INVALID_COMPARISON_SESSION` | 비교 기록이 본인 소유·동일 코스 조건에 맞지 않음 |
| `409 STALE_STATE / COMMAND_PENDING / INVALID_SESSION_STATE` | 작업별 기준 버전·미완료 명령·허용 상태 불일치 |
| `409 UPLOAD_PENDING` | 폰 전환 전 수신한 워치 batch의 저장을 확인하지 못함 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

### 처리 규칙

#### UPDATE_GOAL — 출발 전 목표 수정

1. 본인·권한을 확인하고, 요청을 반영한 최종 목표 전체를 현재 저장값과 비교한다. 같으면 현재 상태를 `200`으로 반환한다. 이후 코스가 `MERGED`·`BLOCKED`로 바뀌었어도 버전 증가·계획 재계산·코스 `ACTIVE` 검사를 다시 하지 않는다.
2. 목표가 실제로 달라질 때만 `READY`, 미완료 명령 없음, `expectedVersion`과 현재 `stateVersion` 일치를 검사한다. 다른 값으로 변경하려는 오래된 버전의 요청은 `409 STALE_STATE`다. 변경 후 코스는 `ACTIVE`여야 한다.
3. [S01](#s01-러닝-세션-생성)의 목표 필드·조합·권한·범위를 적용한다. 생략한 값은 유지하고 `null`은 해제한다. 그룹 목표는 G04로 수정하며 개인 API로 덮어쓰지 않는다. 그룹에 연결된 세션의 목표 변경 요청은 `409 INVALID_SESSION_STATE`다. 비교 기록 조건은 `comparisonSessionId`나 `courseId`가 바뀔 때만 다시 검사한다. 둘 다 그대로면 기존 비교 참조를 보존하므로([S09 삭제 후 조회·참조](#s09-러닝-세션-삭제)) 그 사이 비교 대상이 삭제됐어도 거리·시간·페이스만 바꾸는 요청을 `422`로 거절하지 않는다.
4. 초기 계획을 계산한 뒤 세션 행을 잠그고 버전을 재검사한다. 목표·계획을 함께 저장하고 `stateVersion`을 1 증가시킨다. 무목표 자유러닝은 사전 계획 없이 실시간 코칭한다.

새 코스 선택 검사는 `REPORT_PREPARED`와 `TAKE_OVER_PHONE`에는 적용하지 않는다.

#### REPORT_PREPARED — 워치 준비 결과 확인

- 목표를 보관한 워치의 준비 응답을 확인한다. 필수 요청값은 위 Request Body를 따르며, 별도 준비 장부·버전은 저장하지 않는다.
- 준비 응답의 버전이 현재 버전과 일치할 때만 `200`으로 확인하고 같은 `expectedVersion`을 반환한다.
- 워치는 `ready=true`로 확인한 버전과 `START_AUTHORIZED.expectedVersion`이 일치할 때만 시작한다.
- 최초 준비 이외에는 현재 BPM을 초기 추천으로 덮어쓰지 않는다.

`TAKE_OVER_PHONE`의 허용 상태·처리 순서는 위 **폰으로 기록 제어 인계**를 따른다.

## S09 러닝 세션 삭제

`DELETE` `/api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 |
| 관련 요구사항 | STA-004 / REC-001~002 / COM-001 |
| 미정 사항 | 없음. |
| 비고 | 운동 기록과 연결된 본인 공유 게시물을 함께 삭제 표시. S07 준비 취소·S06 실제 종료와 구분 |

### 설명

본인 운동 기록과 그 기록을 공유한 본인 게시물을 함께 삭제 표시한다. 기존 `running_sessions.deleted_at`과 `posts.deleted_at`을 사용하며 행을 물리 삭제하지 않는다.

앱은 실행 전에 **“이 운동 기록을 삭제할까요? 이 기록을 공유한 게시물도 함께 삭제됩니다.”**라고 안내하고 사용자 확인 후 S09를 호출한다. 서버는 S09 한 번으로 함께 처리하며, 앱이 게시물별 삭제 API를 먼저 호출하지 않는다.

### 인증 및 권한

- 인증된 본인 세션만 삭제한다. 연결 게시물도 해당 세션과 작성자 본인 조건을 모두 확인한다.
- 다른 참가자의 기록·게시물과 공용 코스는 삭제하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 삭제할 본인 러닝 세션 ID |

### Query Parameters

없음.

### Request Body

없음.

### Response

`200 OK`

```json
{
  "id": 201,
  "deletedAt": "2026-10-29T09:00:00Z"
}
```

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `id` | integer (int64) | O | 삭제 표시한 세션 ID |
| `deletedAt` | string (ISO 8601 UTC) | O | 서버가 정한 삭제 시각. 이번에 함께 삭제하는 게시물에도 같은 시각 사용 |

### 오류 응답

| HTTP·코드 | 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | sessionId가 양의 BIGINT 정수 형식이 아님 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 NOT_OWNER` | 존재하고 삭제되지 않은 세션이 본인 소유가 아님 |
| `404 SESSION_NOT_FOUND` | 세션이 없거나 이미 삭제 표시됨. 같은 삭제 재요청도 포함 |
| `409 INVALID_STATE` | 아래 삭제 가능 조건을 만족하지 않음 |
| `500 INTERNAL_ERROR` | 타인 게시물이 같은 세션을 참조하는 정합성 오류. 전체 롤백하며 재시도해도 결과가 같으므로 자동 재시도하지 않음 |
| `503 SERVICE_UNAVAILABLE` | 기록 또는 연결 게시물 삭제 저장 실패. 전체 롤백하며 성공으로 표시하지 않음 |

인증 → sessionId 형식 → 대상 존재·삭제 여부 → 소유권 순서로 확인한다. 잠금 후에도 삭제 여부·소유권·상태를 재검사한다. 타인에게 세션·게시물 상세를 반환하지 않는다.

### 처리 규칙

**삭제 가능 조건**

| 상태·조건 | 처리 |
| --- | --- |
| CANCELLED | 삭제 허용. 실제 분석 작업이 없는 초기 PENDING을 분석 대기로 간주하지 않음 |
| COMPLETED | 분석이 READY/FAILED/LEGACY일 때 허용. PENDING/PROCESSING이면 완료 또는 실패 확정 후 다시 요청 |
| INTERRUPTED | pendingCommand가 없으면 허용. INTERRUPTED는 시작 미확인 관리상 중단(S08 `ABORT_UNCONFIRMED_START`, G12 강제 종료)이 확정될 때만 생기므로 별도 원인 검사는 하지 않는다. 보존된 UNKNOWN 이력은 유지 |
| READY | 삭제 거절. 먼저 S07로 취소하며, 시작 미확인이면 S08 명시 중단 사용 |
| RUNNING / PAUSED | 삭제 거절. 실제 종료 절차를 먼저 완료 |
| 그룹 연결 세션 | 위 개인 조건과 함께 그룹 종료 및 G14 분석 상태 READY/FAILED 필요. 진행·종료 처리·분석 중에는 거절. 그룹 분석 상태는 별도 저장하지 않으므로 그룹이 COMPLETED이고 실제 시작한 모든 참가자 세션의 분석이 READY/FAILED/LEGACY이면 READY/FAILED로 판단한다 |

현재 제어기기에 미확정 명령이 남아 있으면 삭제하지 않는다. 관리상 중단 후 이력으로 남긴 이전 UNKNOWN을 현재 pendingCommand로 취급하지 않는다.

**기록·게시물 일괄 삭제**

1. 그룹 연결이면 그룹→세션 순서로 잠근다. 개인 세션이면 세션을 잠근다. 잠금 전 확인과 세션 잠금 후 다시 읽은 그룹 연결이 다르면(그 사이 그룹에 연결·해제됨) 같은 값의 재요청이어도 `409 INVALID_STATE`로 거절한다. 삭제와 시작·종료·분석 상태 확정은 같은 세션 잠금으로 순서를 정한다.
2. 삭제 조건을 확인한 뒤 `session_id=대상 세션`이고 `author_id=본인`인 연결 게시물을 ID 순서로 잠근다. 같은 세션을 참조하는 타인 게시물이 있다면 자동 삭제하지 않고 정합성 오류(`500 INTERNAL_ERROR`)로 전체 롤백한다.
3. 세션과 아직 삭제되지 않은 본인 연결 게시물에 같은 삭제 시각을 저장하고 한 트랜잭션으로 확정한다. 이미 삭제된 게시물의 삭제 시각은 바꾸지 않는다. 연결 게시물이 없어도 세션은 삭제할 수 있다.
4. 하나라도 실패하면 세션·게시물 변경을 모두 롤백한다. 별도 HTTP 요청을 이어 호출해 부분 삭제하지 않는다. 응답이 유실된 후 재삭제가 404라면, 본인 기록 조회에서도 삭제 여부를 확인한다.

공유 게시물 생성(CMT01)은 같은 세션 잠금 아래 소유권·COMPLETED·미삭제 여부를 검사하고 게시물을 저장한다. 생성이 먼저 확정되면 S09가 그 게시물도 함께 삭제하고, S09가 먼저 확정되면 이후 생성은 INVALID_POST로 거절한다. 두 경로 모두 세션→게시물 순서를 유지한다.

**삭제 후 조회·참조**

| 대상 | 처리 |
| --- | --- |
| 개인 기록·경로·구간·분석 | 목록에서 제외하고 직접 조회는 기존 SESSION_NOT_FOUND/RECORD_NOT_FOUND로 응답 |
| 개인 통계·추이·새 추천 입력 | 삭제된 세션 제외. 이미 확정된 다른 운동의 결과·코칭을 소급 재계산하지 않음 |
| 비교 대상 | 새 선택 불가. 기존 comparison_session_id는 보존하되 대상 상세는 조회 불가로 표시. 진행 중 비교는 해당 대상의 새 조회·안내를 중단하고 원래 목표·본인 측정은 유지 |
| 공유 게시물 | 피드·검색·프로필 목록에서 제외, 상세·댓글·좋아요 접근은 POST_NOT_FOUND |
| 댓글·좋아요 | 행을 연쇄 삭제하지 않음. 삭제된 부모 게시물을 통한 조회·추가·변경 차단 |
| 그룹 결과 | 참가 관계·참가 인원·확정 집계·순위 유지. 내부 집계에는 보존 원본을 사용하지만 삭제된 개인 기록의 상세 열람 권한을 부여하지 않음 |
| 공용 코스 | 기존 source_session_id·경로·상태 유지. 개인 기록 삭제로 코스 원본 삭제·차단하지 않음 |

새 비교 대상 검증·참조 저장은 대상 세션 잠금 아래 미삭제를 확인한다. 여러 세션을 잠글 때는 ID 순서를 사용한다. 삭제가 먼저면 새 선택을 거절하고, 참조가 먼저면 위 기존 참조 규칙을 따른다.

삭제는 제어 상태·실제 시작/종료시각·분석 결과·stateVersion을 바꾸지 않는다. 기존 상태와 내부 원본·제어 결과는 보존한다. 삭제된 세션의 새 제어·SSE 접근은 기존 대상 없음 규칙으로 거절한다. 기존 SSE 연결도 다음 전송 전에 삭제 여부를 확인해 닫으며 삭제된 기록의 스냅샷을 계속 보내지 않는다.

### 상태값

운동 상태는 유지하고 deleted_at으로 삭제 여부를 구분한다.

### 미정 사항

없음.

## S10 활성 러닝 이벤트 구독

`GET /api/v1/running-sessions/{sessionId}/events`

| 항목 | 값 |
| --- | --- |
| 단계 | 1차 MVP |
| 인증 | 본인 회원 |
| 미정 사항 | 없음 — 아래 상태·제어 계약 기준 |

### 설명

세션 상태·코칭·종료·분석 상태를 SSE로 계속 전달한다.

### 인증 및 권한

JWT·본인 세션을 확인한다. 건강정보 동의로 구독을 거절하지 않으며, 미동의 세션에는 자동 코칭만 발행하지 않는다(2026-11-05 S15P31E105-257 확정). 인증정보는 URL·로그에 넣지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 러닝 세션 ID. 양의 정수 |

### Request Body

없음. 인증은 Authorization 헤더를 사용하며 토큰을 URL에 넣지 않는다.

### Response

`200 OK`, `Content-Type: text/event-stream`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `event` | string (enum) | O | SSE 이벤트 이름: SESSION_STATE(현재 상태) / COACHING_GUIDE(새 코칭) / SERVER_END(그룹 종료 안내) / ANALYSIS_STATUS(분석 상태) |
| `data` | object | O | JSON 형식의 S02 전체 세션 상태. 아래 필드는 이벤트별 추가 정보 |
| `data.commandId` | integer (int64) | 조건부 | SERVER_END의 현재 실행기기 END 명령 번호. 워치·폰 모두 서버가 발급한 양의 정수 |
| `data.groupEndedAt` | string (date-time, UTC) / null | O | 개인런·아직 종료되지 않은 그룹런은 null, 종료된 그룹런은 그룹 종료 기준시각. 폰은 SERVER_END를 받으면 종료·저장 |
| `data.coaching` | object / null | O | 코칭이 있으면 현재 유효 추천. 필드는 [S02 `coaching` 객체](#목표-검증초기-계획동의-s15p31e105-255-확정-2026-10-29)이며 [COACHING_GUIDE payload](../watch-mobile-server-integration.md#93-타입별-필수-payload)와 같다 |

SSE 형식 예시(상태 필드는 일부 발췌):

```text
event: SESSION_STATE
data: {"sessionId":201,"state":"RUNNING","stateVersion":2,"currentBpm":165}
```

### 오류 응답

| HTTP·코드 | 발생 조건 |
| --- | --- |
| `400 VALIDATION_ERROR` | 필수값·타입·ID 범위·단계별 필드 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |
| `403 SESSION_FORBIDDEN` | 본인 세션이 아님 |
| `404 SESSION_NOT_FOUND` | 구독할 본인 세션이 없음 |
| `503 SERVICE_UNAVAILABLE` | 저장·필수 처리 장애. 결과를 확인하고 같은 요청으로 제한 재시도 |

중복·충돌 판정과 재시도는 [세션 제어 공통 계약](#세션-제어-공통-계약)을 따른다.

연결 전 오류는 HTTP로 반환하며, 연결 후 토큰 만료·권한 철회·연결 실패는 스트림을 닫고 최신 상태부터 다시 확인한다.

### 처리 규칙

**상태 전달**

- JWT·본인 세션을 확인한 뒤 세션별 SSE 연결을 연다. 각 전송 전에 세션 삭제·회원 탈퇴를 다시 확인하고, 연결 시 토큰의 만료시각에 스트림을 닫는다.
- 연결 직후 S02 전체 상태를 보내며, 이후 상태·BPM·코칭·분석 상태가 바뀔 때도 전체 상태를 보낸다. 이 시점의 전체 상태를 **스냅샷**이라고 한다.
- 비교 기록이 설정된 세션은 W07 batch 저장이 커밋될 때마다 SESSION_STATE 스냅샷을 보내 [기록 비교](#기록-비교-s15p31e105-422-확정-2026-11-05) 결과를 갱신한다. 이 전송은 `stateVersion`을 바꾸지 않는다.
- 클라이언트는 오래된 `stateVersion`을 버린다. 같은 버전의 코칭은 더 큰 `coachingId`만 처리한다. 새 코칭 생성 자체는 세션 버전을 바꾸지 않는다.

**연결 유지와 재접속**

| 상황 | 처리 |
| --- | --- |
| 정상 연결 | 15초마다 heartbeat와 최신 스냅샷 전달 |
| 45초 동안 서버 메시지 없음 | 연결 오류 표시. 연결 오류 중 자동 코칭 중단 |
| 재접속 | 최신 스냅샷부터 다시 확인. 끊긴 동안의 이벤트를 Last-Event-ID로 재생하지 않으며 영속 이벤트 장부도 두지 않음 |
| 토큰 만료·권한 철회 | 연결 종료. 인증 토큰과 원본 데이터를 URL·로그에 기록하지 않음 |

**그룹 종료 안내**

`SERVER_END`는 현재 실행기기의 END 명령 번호(`commandId`, BIGINT)를 전달한다. 워치 기록 중이면 폰이 워치에 전달하고, 폰 기록 중이면 폰이 직접 실행한 뒤 S06 RESULT를 보고한다. 폰 인계 후 `groupEndedAt`이 있지만 현재 폰의 END 명령이 아직 없으면 폰이 S06 REQUEST를 자동 호출한다.

폰은 새 적용을 위해 서버가 승인한 명령과 유효한 가이드만 전달한다. 단, 미확정 COACHING 명령은 만료 뒤에도 아래 [만료된 코칭의 결과 확인](#만료된-코칭의-결과-확인)에 따라 같은 명령을 결과 확인용으로 재전달한다. 만료된 추천을 새 명령으로 승인하거나 실행하지 않는다.

### 상태값

세션·분석 상태 enum은 S02, 이벤트 이름은 위 Response 표를 따른다. 새 코칭 생성 자체는 stateVersion을 바꾸지 않는다.

## 세션 제어 공통 계약

워치·폰 제어는 REQUEST → 현재 실행기기 적용 → RESULT로 통일한다. 명령 ID는 session_control_events.id의 서버 발급 BIGINT다. 워치의 버튼 요청·실행 결과는 항상 폰을 통해 서버로 전달하며, 서버 승인 명령도 폰을 통해 워치에 전달한다. 폰 인계 후에는 폰이 같은 단계로 직접 실행·보고한다.

### 요청과 실제 적용의 구분

S03~S06은 같은 요청·응답 구조를 사용한다. 각 API의 경로로 작업을 정하고, `phase`로 승인 요청과 실행 결과 보고를 구분한다. P07도 같은 처리 순서를 사용하며 BPM·코칭 전용 필드는 [P07](pace-coaching.md)에서 정의한다.

1. 폰이 `REQUEST`를 보내 서버의 승인과 `commandId`를 받는다.
2. 현재 제어기기가 승인된 명령을 실제로 실행한다.
3. 폰이 같은 `commandId`로 `RESULT`를 보고한다. 폰으로 기록 중이면 폰이 직접 실행·보고한다.

승인 응답만으로 운동이 시작·정지·종료됐다고 표시하지 않는다. 실행 결과와 서버 저장 확인을 구분한다. 폰의 데이터 수신 확인도 서버 저장 확인을 대신하지 않는다.

필드별 타입·필수 여부와 요청·응답 JSON은 각 API의 Request Body / Response에서 정의한다. S03~S06의 공통 필드는 `phase`, `deviceId`, `expectedVersion`, `commandId`, `result`, `appliedAt`, `reasonCode`다. S06의 종료 성공 보고에는 `uploadComplete=true`가 추가로 필요하다.

S03~S06의 RESULT는 `APPLIED` / `REJECTED` / `UNKNOWN`을 보고한다. P07의 자동 코칭은 `IGNORED`도 보고할 수 있다. `APPLIED`일 때만 `appliedAt`에 실제 적용시각을 넣고, 나머지는 `null`로 보낸다. 사유가 없더라도 `reasonCode` 키는 `null`로 포함한다.

REQUEST 응답은 승인된 명령 정보이며, RESULT 응답은 `commandId`·`result`·`persisted=true`와 최신 S02 전체 세션 상태를 포함한다. API별 명령 종류·허용 상태는 다음 표를 따른다.

#### 작업별 승인 조건

| API·명령 | 승인 가능한 상태 | 실제 적용 성공 후 상태 |
| --- | --- | --- |
| S03 START | READY | RUNNING |
| S04 PAUSE | RUNNING | PAUSED |
| S05 RESUME | PAUSED | RUNNING |
| S06 END | RUNNING / PAUSED | COMPLETED |
| P07 SET_BPM | READY / RUNNING / PAUSED | 운동 상태 유지 |
| P07 COACHING | RUNNING | 운동 상태 유지 |

REQUEST의 `action`은 엔드포인트로 정한다. P07만 `operation=SET_BPM` 또는 `COACHING`으로 구분한다. `IGNORED`는 COACHING 결과에만 사용한다. 서버는 기기가 보낸 상태·BPM을 그대로 채택하지 않고, 승인된 명령과 결과로 최신 상태를 계산한다.

### 인계 후 폰 제어

- REQUEST의 deviceId는 control_device_id=relay_device_id인 현재 폰이어야 한다. 폰은 PAUSE / RESUME / END만 승인받을 수 있고 START·BPM·코칭은 허용하지 않는다.
- 서버는 현재 폰의 PENDING/UNKNOWN 명령을 검사한 뒤 새 명령을 PENDING으로 저장한다. 폰은 승인 후 실제 동작을 실행하고 commandId별 실제 결과를 기기에 보관해 RESULT로 보고한다. 같은 commandId를 다시 받아도 동작을 재실행하지 않는다.
- 결과의 서버 저장을 확인하기 전 다음 실제 조작을 보류한다. 응답이 없으면 같은 요청·명령·실제 적용시각으로 재확인한다. 기존 워치 UNKNOWN을 폰의 실행 결과로 바꾸지 않으며, 이전 워치의 늦은 결과는 CONTROL_DEVICE_CHANGED로 거절한다.
- 그룹이 종료됐다면 END만 허용한다. 인계 직후 groupEndedAt이 있고 현재 폰의 END 명령이 아직 없으면 폰이 S06 REQUEST를 자동 호출해 승인받고 종료·저장한다. 참가자가 종료 버튼을 다시 누를 필요는 없다.

### 만료된 코칭의 결과 확인

서버가 COACHING 명령을 승인해 PENDING으로 저장한 뒤 워치 전달 전에 만료될 수 있다. 만료 여부와 실제 실행 여부는 다르므로 서버가 시간만 보고 명령을 완료·미적용으로 추정하지 않는다. 대신 다음 절차로 대기 명령을 정리한다.

1. **승인된 명령을 계속 조회 가능하게 한다.** S02/S10의 `coaching`은 만료되면 null이지만 `pendingCommand`는 유지한다. 그 안의 `coachingGuide`에 원래 `commandId`, `coachingId`, `expectedVersion`, `targetBpm`, `recommendedPaceSecPerKm`, `expiresAt`을 포함한다. 명령 행과 연결 코칭 행에서 구성하며 새 장부나 컬럼은 추가하지 않는다.
2. **폰은 같은 명령을 결과 확인용으로 보낸다.** 가이드 만료를 이유로 미확정 명령을 조용히 버리지 않는다. 폰의 보관본 또는 S02/S10의 `pendingCommand.coachingGuide`를 기존 COACHING_GUIDE 경로로 전달한다. 원래 명령 번호·버전·만료시각을 바꾸거나 새 명령을 만들지 않는다.
3. **워치는 기존 결과를 먼저 확인한다.** 같은 commandId의 로컬 결과가 있으면 APPLIED를 포함해 그대로 COACHING_RESULT로 재응답한다. 이미 실행한 코칭을 만료됐다는 이유로 IGNORED로 바꾸지 않는다. 기존 결과가 없고 만료됐거나 버전·상태가 맞지 않으면 적용하지 않고 `IGNORED / GUIDE_STALE`, `appliedAt=null`을 영속 저장한 뒤 응답한다. 같은 명령의 최초 처리·중복 수신·만료 판단·결과 저장은 원자적으로 처리해 APPLIED와 IGNORED가 서로 경합하지 않게 한다.
4. **실제 결과 저장 후 다음 조작을 승인한다.** 폰이 P07 RESULT로 결과를 보고한다. 서버는 명령·기기·소유권과 결과를 확인해 만료된 명령의 실제 결과도 저장하며, 새 REQUEST의 만료 검사를 RESULT에 적용해 결과 보고를 막지 않는다. IGNORED 최초 확정은 현재 BPM·운동 상태를 유지하고 stateVersion을 1 증가시켜 대기 슬롯을 해제한다. 중복 보고는 추가 증가시키지 않는다. 폰·워치는 서버 저장 ACK를 확인한 뒤 최신 버전으로 일시정지·종료·수동 BPM 요청을 다시 보낸다.

만료되어 최신 `coaching`은 없지만 결과 확인할 명령은 남아 있는 S02/S10 예시(일부 필드 발췌):

```json
{
  "coaching": null,
  "pendingCommand": {
    "commandId": 501,
    "action": "COACHING",
    "targetBpm": 165,
    "expectedVersion": 3,
    "coachingId": 701,
    "result": "PENDING",
    "appliedAt": null,
    "reasonCode": null,
    "coachingGuide": {
      "commandId": 501,
      "coachingId": 701,
      "expectedVersion": 3,
      "targetBpm": 165,
      "recommendedPaceSecPerKm": 360,
      "expiresAt": "2026-10-29T01:00:20Z",
      "coachingLevel": "CAUTION"
    }
  }
}
```

워치 결과는 COACHING_RESULT로, 서버 저장 확인은 COMMAND_RECEIVED(persisted=true)로 전달한다. 재접속 때는 새 코칭보다 기존 pendingCommand의 결과 확인을 먼저 수행한다. 자동 코칭이 입력 부족·연결 오류로 중단됐더라도 이 결과 확인·저장 경로는 차단하지 않는다. 제한 재시도 후에도 워치 결과를 확인할 수 없으면 미확인 상태를 표시하고, 실제 시작이 확인된 세션은 기존 S08 폰 인계·종료 경로를 사용한다. 시간초과만으로 UNKNOWN을 IGNORED로 바꾸지는 않는다.

### 멱등·순서·원자 저장

- 서버는 본인·동의·현재 제어기기 일치를 확인하고 세션 행을 잠근 뒤 기기를 다시 검사한다. 미확인 명령의 UNIQUE는 (session_id,device_id) 기준이며, 조회·승인 차단도 현재 제어기기에만 적용한다. 인덱스가 기기 소유권·현재 제어기기 검사를 대신하지 않는다.
- 서버는 세션 행을 잠그고 먼저 (session_id,expected_version) 행을 찾는다. 같은 device/action/targetBpm/coachingId이면 PENDING 또는 저장된 결과를 반환한다. 값이 다르면 409 COMMAND_CONFLICT다. 그 다음 현재 버전·허용 상태를 검사한다. 따라서 적용 뒤 재전송도 새 행·새 동작을 만들지 않는다.
- 새 REQUEST는 현재 제어기기와 stateVersion을 확인한 뒤 하나만 승인한다. 해당 실행기기의 PENDING/UNKNOWN이 있으면 409 COMMAND_PENDING이며 폰은 다음 조작을 대기시킨다. AI와 수동 조작도 한 줄로 직렬화하며 오래 대기한 코칭은 취소된 것으로 추측하지 않고 위 만료 명령 재전달·결과 확인 절차로 정리한다.
- 현재 실행기기(워치 또는 폰)는 commandId별 결과를 로컬에 보관한다. 같은 명령 재수신에는 동작을 재실행하지 않고 그 결과를 반환한다. 다른 명령은 결과의 서버 저장 확인 뒤 처리한다. 기기는 버전을 독립 발급하지 않는다.
- RESULT 저장·실제 상태/BPM·started_at/ended_at 갱신은 한 트랜잭션이다. 확정 결과(APPLIED/REJECTED/IGNORED)를 처음 저장하면 단일 stateVersion을 1 증가시킨다. 같은 확정 결과는 증가시키지 않는다. 거절도 요청 슬롯을 마감하므로 증가시킨다. UNKNOWN은 현재 상태·버전을 변경하지 않고 명령을 미확인으로 남긴다.
- 같은 commandId의 result/appliedAt/reasonCode가 같으면 기존 응답, 다른 최종 결과는 409 COMMAND_CONFLICT다. 이미 저장된 같은 결과의 재전송은 응답 유실 복구이므로 폰 인계·기기 연결 해제 뒤에도 현재 제어기기·기기 연결 검사보다 먼저 기존 응답을 돌려준다(2026-11-02 확정). 아래 CONTROL_DEVICE_CHANGED는 저장되지 않은 이전 워치 결과에 적용한다. UNKNOWN→확정은 가능하지만 확정→UNKNOWN 회귀는 기존 결과를 반환한다. S08로 관리상 중단한 세션의 늦은 START 결과는 예외로 거절하며 상태를 되돌리지 않는다. 서버는 적용 시각을 추정하지 않는다.
- UNKNOWN은 같은 명령의 실행기기 저장 결과를 조회해 확인한다. 확인되지 않으면 WATCH 모드에서는 실패를 표시하고 새 제어를 자동 실행하지 않는다. 이미 실제 시작이 확인된 RUNNING/PAUSED 세션은 사용자가 폰으로 인계하면 이전 워치 UNKNOWN을 유지한 채 현재 폰의 REQUEST/RESULT로 기록·종료할 수 있다. 시작 자체가 미확인인 READY 세션은 S08의 결과 재확인·관리상 중단 규칙을 따른다. 장기 복구와 구간별 누락 탐색은 지원하지 않는다.
- 초기 목표·수동 BPM·운동 상태 변경은 모두 stateVersion 하나로 보호한다. 별도 BPM·준비·전달·명령 순번 컬럼은 없다. 센서 batch 중복 방지는 기존 W07을 유지한다.

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 필수값·타입·양수 ID·BPM·phase 오류 |
| 401 | UNAUTHORIZED | 인증 실패 |
| 403 | SESSION_FORBIDDEN / DEVICE_FORBIDDEN / CONSENT_REQUIRED | 본인·기기 위반. CONSENT_REQUIRED는 건강정보가 필요한 P07 코칭에만 사용 |
| 404 | SESSION_NOT_FOUND / COMMAND_NOT_FOUND | 존재하지 않는 본인 세션·명령 |
| 409 | STALE_STATE / COMMAND_PENDING / COMMAND_CONFLICT / INVALID_SESSION_STATE / UPLOAD_PENDING / CONTROL_DEVICE_CHANGED | 버전·미확인 제어·내용·상태·저장 확인 불일치 |
| 503 | SERVICE_UNAVAILABLE | 저장 불가. 같은 요청을 최초 포함 최대3회만 시도 |

### 준비·코칭·종료 후 분석 상태

초기 페이스 계획은 `pace_plans`, 최신 운동·분석 상태는 `running_sessions`, 제어 명령과 실제 결과는 `session_control_events`에 저장한다.

**분석 처리 순서**

1. 최종 END 결과 저장 후, 하나의 처리 경로가 `PENDING → PROCESSING`으로 바꾸고 분석을 시작한다. 같은 분석을 여러 경로에서 중복 시작하지 않는다.
2. 계산 결과를 덮어써 저장하고 `READY`로 바꾼다. 결과 저장과 READY 변경은 한 트랜잭션으로 처리한다.
3. 분석 상태가 바뀌면 `stateVersion`을 증가시키고 최신 스냅샷을 전달한다.

실패하면 `FAILED`로 표시한다. 서버 재기동 시 남아 있는 `PROCESSING`도 FAILED로 바꾸며 자동으로 다시 분석하지 않는다. 별도의 분석 버전·실행권·임대, 병렬 작업자·다중 서버의 분석 인수·자동 재분석은 MVP 범위에 포함하지 않는다.

**결과 화면 표시**

| `analysis.status` | 화면·응답 처리 |
| --- | --- |
| PENDING / PROCESSING | 분석 중 표시. 아직 계산되지 않은 분석 값은 `null` |
| READY | 최종 결과 표시 |
| FAILED | 분석 실패 표시 |
| LEGACY | 과거 저장 통계 표시. 아래 기존 세션 보존 규칙 적용 |

결과 화면은 `ANALYSIS_STATUS` 이벤트에서 READY를 확인하면 H02/H03으로 최종 결과를 조회해 바로 표시한다. 화면 재진입·재접속 시에도 현재 분석 상태와 저장된 결과를 조회한다. 별도 분석 완료 알림이나 푸시는 보내지 않는다.

### V1 기존 세션 보존

기존 세션은 `stateVersion=0`, `analysis.status=LEGACY`로 구분하고 통계·추천값을 그대로 표시한다. 새 종료 확인을 요구하지 않으며 이 세션을 다시 운동 중으로 바꿀 수 없다. 신규 세션은 `stateVersion=1`부터 시작한다.

과거 코칭의 기준 버전(`based_on_state_version`)과 만료 시각(`expires_at`)은 모두 `null`이며 자동 적용하지 않는다. DB 버전 적용·롤백·기존 데이터 변환 절차는 [백엔드 실행 안내](../../../backend/README.md#세션-제어-스키마-v3)를 따른다.
