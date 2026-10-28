# API 명세 — 러닝 세션

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [S01](#s01-러닝-세션-생성) | 러닝 세션 생성 | POST | `/running-sessions` | 1차 MVP | 회원 |
| [S02](#s02-러닝-세션-조회) | 러닝 세션 조회 | GET | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |
| [S03](#s03-러닝-시작) | 러닝 시작 | POST | `/running-sessions/{sessionId}/start` | 1차 MVP | 회원 |
| [S04](#s04-러닝-일시정지) | 러닝 일시정지 | POST | `/running-sessions/{sessionId}/pause` | 1차 MVP | 회원 |
| [S05](#s05-러닝-재개) | 러닝 재개 | POST | `/running-sessions/{sessionId}/resume` | 1차 MVP | 회원 |
| [S06](#s06-개인-러닝-종료) | 개인 러닝 종료 | POST | `/running-sessions/{sessionId}/finish` | 1차 MVP | 회원 |
| [S07](#s07-러닝-취소) | 러닝 취소 | POST | `/running-sessions/{sessionId}/cancel` | 1차 MVP | 회원 |
| [S08](#s08-출발-전-러닝-설정-수정) | 출발 전 러닝 설정 수정 | PATCH | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |
| [S09](#s09-러닝-세션-삭제) | 러닝 세션 삭제 | DELETE | `/running-sessions/{sessionId}` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

running_sessions와 courses를 참조한다. groupRunId는 running_sessions의 컬럼이 아니라 group_run_participants.session_id로 역조회하는 관계다. 관계의 유일성·중첩 방식은 별도 확인이 필요하다. pace_plans → pace_plan_segments와 coaching_decisions는 안내의 근거이며 버전·준비 상태 스키마는 ERD에 없다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## S01 러닝 세션 생성

`POST` `/api/v1/running-sessions`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 관련 화면 | 2.0 코스 러닝, 2.0F 자유 러닝, 3.2 코스 상세 '경쟁 모드' (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

개인런·그룹런 공통. courseId null이면 자유러닝. groupRunId는 참가자 테이블로 연결.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courseId` | integer (int64) / null | X | 선택한 코스 식별자. 개인·그룹 자유러닝은 null/생략 가능 |
| `groupRunId` | integer (int64) | X | 그룹런 식별자 |
| `targetDistanceM` | number | 조건부 | 목표 거리, 미터, 양수. 목표를 끈 자유 러닝은 생략 |
| `targetDurationSec` | number | 조건부 | 목표 완주 시간, 초, 양수. 자유러닝은 선택 입력·단독 입력 가능 |
| `targetPaceSecPerKm` | number | X | 목표 페이스, 초/km, 양수. 자유러닝은 선택 입력·단독 입력 가능 |
| `comparisonSessionId` | integer (int64) | X | 경쟁 모드에서 겨룰 같은 코스의 내 과거 기록 ID(3.2) |

```json
{
  "targetDistanceM": 5000,
  "targetDurationSec": 1800
}
```

### Response

`201 Created (제안)`

```json
{
  "id": 101,
  "status": "READY",
  "courseId": null,
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "targetPaceSecPerKm": 360,
  "comparisonSessionId": null,
  "groupRunId": null
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `initialGuidance` | object / null (제안) | X | 모드에 따른 초기 안내. 무목표 자유러닝은 사전 Pace Plan 없음. 준비 중인 계획은 후속 전달 (ERD만으로 응답 형식을 확정하지 않음.) |
| `guidanceStatus` | string (제안) | X | 전략 준비 상태. 무목표의 계획 비대상을 준비 중·실패와 구분. 구체 상태값은 미정 (ERD만으로 응답 형식을 확정하지 않음.) |
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `running_sessions.status` (ENUM('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'INTERRUPTED')). 저장 값은 NULL 불가. 허용값: READY, RUNNING, PAUSED, COMPLETED, CANCELLED, INTERRUPTED. |
| `courseId` | integer (int64) / null | O | `running_sessions.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDistanceM` | integer / null | O | `running_sessions.goal_distance` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDurationSec` | integer / null | O | `running_sessions.goal_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `groupRunId` | integer (int64) / null | O | group_run_participants를 통한 연결 그룹. 개인런은 null. 연결 유일성 검증 필요. |
| `targetPaceSecPerKm` | number / null | O | running_sessions.goal_pace. 목표 미설정/계산 불가 시 null. 거리·시간 입력 예시에서는 360초/km. |
| `comparisonSessionId` | integer (int64) / null | O | running_sessions.comparison_session_id. 비교 미선택은 null. |

**사용 흐름과 응답 판단**

서버에 적용된 코스·모든 목표·비교 기록·그룹 연결로 준비/운동 화면을 복원해야 한다. 입력 당시 값이 아니라 저장·계산 결과를 반환한다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 COURSE_INACCESSIBLE` | 자원 상태/접근 | 요청 용도에 사용할 수 없는 코스를 참조함. MERGED/BLOCKED의 상세·저장 목록 상태 안내를 무조건 차단하지 않음 |
| `409 ACTIVE_SESSION_EXISTS` | 상태 충돌 | 기존 활성 세션과 새 세션 생성이 충돌함. 활성 상태 범위·동시 생성 처리 기준 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `422 INVALID_GOAL` | 무목표 허용과 구분하여 음수·0·모순 목표를 거절 |
| `422 INVALID_COMPARISON_SESSION` | 비교 기록이 본인 소유·동일 코스 조건에 맞지 않음 |
| `403 NOT_PARTICIPANT` | 참가하지 않은 groupRunId를 세션에 연결하려 함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

**응답·복구 행동과의 연결:** 코스 지정인데 courseId 없음, 무목표 자유러닝, 목표 조합 오류를 구분한다. 성공 후 S02로 저장된 목표와 안내 준비상태를 복구한다.

### 처리 규칙

- 세션 준비 시점에는 목표가 수정 가능하다. S08로 출발 전 변경을 반영하고 전략을 다시 생성한다. 실제 운동 시작이 확정되면 그때의 목표를 고정한다.
- groupRunId를 받으면 본인이 해당 그룹런 참가자인지와 준비 가능한 그룹 상태인지 검사한다. 개인 세션 생성으로 그룹장 시작 권한을 우회할 수 없다.
- 코스·목표·비교 기록으로 세션을 준비하면 모드에 맞는 초기 안내를 내부에서 자동 생성한다. 무목표 자유러닝에는 사전 Pace Plan을 생성하지 않는다. 클라이언트는 별도 전략 생성 요청을 하지 않는다.
- 준비 결과는 세션 생성 응답과 후속 갱신으로 제공한다. 전략 산출 대기·실패 시 시작 허용 정책은 미정이다.
- 코스 러닝은 목표가 필수다. 자유러닝은 거리·시간·페이스 중 원하는 목표만 입력하거나 모두 생략할 수 있다. 목표가 있으면 Future Grade 0%의 평지 기준 계획을 생성하고, 목표가 없으면 사전 계획 없이 실시간 HR 예측·MPC 코칭을 제공한다.
- 자유러닝은 목표 2개 입력을 강제하지 않는다. [모드별 AI 동작](../requirements.md#러닝-모드별-ai-동작)을 따른다. 일부 목표의 환산·상충 입력 검증과 응답 구조는 세부 계약에서 정의한다.
- 개인런·그룹런 공통. courseId null이면 자유러닝. groupRunId는 참가자 테이블로 연결.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 선택 목표의 환산·상충 입력 검증, 목표별 결과 표시와 무목표 계획 비대상 응답 표현
- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S02 러닝 세션 조회

`GET` `/api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 세션 상태 조회.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "READY",
  "courseId": null,
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "startedAt": null,
  "endedAt": null,
  "movingDurationSec": null,
  "elapsedDurationSec": null,
  "totalDistanceM": null,
  "targetPaceSecPerKm": 360,
  "comparisonSessionId": null,
  "groupRunId": null
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `guidance` | object / null (제안) | X | 최신 전략 버전·구간 페이스·코칭·BPM·기록 비교와 적용 시각. 구조 미정 (ERD만으로 응답 형식을 확정하지 않음.) |
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `running_sessions.status` (ENUM('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'INTERRUPTED')). 저장 값은 NULL 불가. 허용값: READY, RUNNING, PAUSED, COMPLETED, CANCELLED, INTERRUPTED. |
| `courseId` | integer (int64) / null | O | `running_sessions.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDistanceM` | integer / null | O | `running_sessions.goal_distance` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDurationSec` | integer / null | O | `running_sessions.goal_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `startedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.started_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `endedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.ended_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `movingDurationSec` | integer / null | O | `running_sessions.moving_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `elapsedDurationSec` | integer / null | O | `running_sessions.elapsed_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `totalDistanceM` | number / null | O | `running_sessions.total_distance` (NUMERIC(12,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetPaceSecPerKm` | number / null | O | running_sessions.goal_pace. 목표 미설정/계산 불가 시 null. 거리·시간 입력 예시에서는 360초/km. |
| `comparisonSessionId` | integer (int64) / null | O | running_sessions.comparison_session_id. 비교 미선택은 null. |
| `groupRunId` | integer (int64) / null | O | group_run_participants를 통한 연결 그룹. 개인런은 null. 연결 유일성 검증 필요. |

**사용 흐름과 응답 판단**

서버에 적용된 코스·모든 목표·비교 기록·그룹 연결로 준비/운동 화면을 복원해야 한다. 입력 당시 값이 아니라 저장·계산 결과를 반환한다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_OWNER` | 소유권 | 본인 전용 세션·기록이 다른 회원 소유임 |
| `404 SESSION_NOT_FOUND` | 대상 없음 | 요청한 러닝 세션이 존재하지 않거나 삭제됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 세션 재진입·재연결 복구 시 최신 준비 전략·코칭·BPM·과거 기록 비교 상태를 함께 반환한다. 조회로 분석을 실행하지 않는다.
- 정상 운동 중 갱신은 지속 전달한다. 사용자에게 새로고침이나 반복 요청을 요구하지 않는다.
- 본인 세션 상태 조회.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S03 러닝 시작

`POST` `/api/v1/running-sessions/{sessionId}/start`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

READY에서 RUNNING 전이. 초기 페이스 계획은 시작 이전 생성.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |

```json
{}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "RUNNING",
  "startedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 RUNNING. 중복 명령 재응답은 별도 멱등 정책을 따른다. |
| `startedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.started_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

시작 성공 RUNNING과 실제 시작시각으로 화면을 전환한다. 전략 준비 중이라는 사실과 운동 시작 실패를 분리한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `403 CONSENT_REQUIRED` | 동의 | 요청에서 수집·이용하는 건강·위치 정보에 필요한 동의가 없음/철회됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 시작 상태를 반영하는 시점의 목표를 최초 목표로 고정한다. 출발 후에는 일시정지 중이어도 S08로 목표를 바꿀 수 없다. S08 변경과 시작이 경합하면 시작 여부를 일관되게 검사한다.
- 그룹런 참가 세션의 시작은 G09의 그룹장 시작 흐름과 연계한다. 일반 참가자가 S03을 직접 호출해 그룹 시작 전 자기 세션만 임의 시작하지 않도록 그룹 상태·참가 관계를 검사한다.
- 계획 대상 모드의 초기 전략 생성은 내부 준비 과정에서 수행한다. 생성 대기·실패의 구분과 시작 전제 조건은 계약 확정 시 정의한다. 무목표 자유러닝은 사전 계획 생성이 시작 조건이 아니다.
- 휴대폰·워치의 시작 요청은 같은 세션에 반영하고 중복 시작을 방지한다.
- READY에서 RUNNING 전이. 초기 페이스 계획은 시작 이전 생성.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S04 러닝 일시정지

`POST` `/api/v1/running-sessions/{sessionId}/pause`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

RUNNING에서 PAUSED 전이. 정지 기간은 페이스 저하 판단에서 제외.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |

```json
{}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "PAUSED"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 PAUSED. 중복 명령 재응답은 별도 멱등 정책을 따른다. |
| `pausedAt` | string (ISO 8601) | X | running_sessions에 일시정지 발생 시각 컬럼 없음. updated_at을 발생 시각으로 치환하지 않는다. |


**사용 흐름과 응답 판단**

일시정지 성공 PAUSED를 즉시 반영한다. pausedAt의 저장/이벤트 근거는 별도 필요하며 DB updated_at으로 치환하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- RUNNING에서 PAUSED 전이. 정지 기간은 페이스 저하 판단에서 제외.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S05 러닝 재개

`POST` `/api/v1/running-sessions/{sessionId}/resume`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

PAUSED에서 RUNNING 전이.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |

```json
{}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "RUNNING"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 RUNNING. 중복 명령 재응답은 별도 멱등 정책을 따른다. |
| `resumedAt` | string (ISO 8601) | X | running_sessions에 재개 발생 시각 컬럼 없음. updated_at을 발생 시각으로 치환하지 않는다. |


**사용 흐름과 응답 판단**

재개 성공 RUNNING을 반영한다. resumedAt 발생시각은 처리 완료시각과 다를 수 있다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- PAUSED에서 RUNNING 전이.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S06 개인 러닝 종료

`POST` `/api/v1/running-sessions/{sessionId}/finish`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 개인 운동을 종료한다. 그룹런에서도 본인만 종료하며, 실제로 운동을 시작한 참가자 전원의 개인 종료가 확인되면 서버가 그룹을 자동 종료한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |

```json
{}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "COMPLETED",
  "endedAt": "2026-10-24T09:00:00Z",
  "totalDistanceM": null,
  "movingDurationSec": null,
  "elapsedDurationSec": null,
  "goalAchieved": null
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 COMPLETED. 중복 명령 재응답은 별도 멱등 정책을 따른다. |
| `endedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.ended_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `totalDistanceM` | number / null | O | `running_sessions.total_distance` (NUMERIC(12,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `movingDurationSec` | integer / null | O | `running_sessions.moving_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `elapsedDurationSec` | integer / null | O | `running_sessions.elapsed_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `goalAchieved` | boolean / null | O | `running_sessions.goal_achieved` (BOOLEAN). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

개인 종료와 최종 분석 완료를 구분한다. 원본 저장 성공 뒤 분석이 지연되더라도 종료 요청을 다시 시키지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.
- 종료 성공·원본 저장 완료와 분석 준비/실패를 구분한다. 아직 없는 결과나 미측정 값을 0/false로 채우거나 원 요청 전체를 재실행하도록 요구하지 않는다.

### 처리 규칙

- 기록 경로를 반영한 뒤 공용 코스 자동 등록·중복 정리를 연계한다. 별도 사용자 코스 등록 요청은 요구하지 않는다.
- 그룹 강제 종료 시 종료 기준 시각까지의 측정 기록을 반영한다. 기준 시각 이전 데이터는 늦게 도착해도 복구·재집계하고 이후 데이터는 해당 그룹런 기록에 합산하지 않는다.
- 종료 후 기록 요약·구간 분석·목표 달성 평가·통계 갱신을 자동 실행한다. 별도 분석·통계 생성 요청을 요구하지 않는다.
- 운동 종료와 마지막 기록 동기화·분석 완료는 구분한다. 늦게 도착한 측정값 반영 후 결과 갱신과 중복 집계 방지 규칙을 정의한다.
- 종료 응답이 모든 분석의 완료를 보장하지 않는다. 결과 준비 상태·잠정값 표현은 응답 계약과 ERD 확정 시 보완한다.
- 연결 끊김 동안 기기가 저장한 종료 상태·기록은 재연결 시 복구한다.
- 본인 개인 운동을 종료한다. 그룹런에서도 본인만 종료하며, 실제로 운동을 시작한 참가자 전원의 개인 종료가 확인되면 서버가 그룹을 자동 종료한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S07 러닝 취소

`POST` `/api/v1/running-sessions/{sessionId}/cancel`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | STA-001~005 / REC-001 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

READY에서 CANCELLED. 달리기 시작 후 취소와 구분.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |

```json
{}
```

### Response

`200 OK (제안)`

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
| `status` | string | O | 이 작업의 신규 처리 성공 상태는 CANCELLED. 중복 명령 재응답은 별도 멱등 정책을 따른다. |


**사용 흐름과 응답 판단**

준비 취소는 CANCELLED이며 진행 중 운동 종료를 대신하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- READY에서 CANCELLED. 달리기 시작 후 취소와 구분.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- READY → RUNNING ↔ PAUSED → COMPLETED, 시작 전 CANCELLED 가능.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## S08 출발 전 러닝 설정 수정

`PATCH` `/api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 본인 |
| 관련 요구사항 | USR-004 / PAC-001 |
| 비고 | 사용자 결정 반영. 필드·경로·오류 코드는 구현 전 검토할 제안 |

### 설명

러닝 시작 전 준비 중인 세션의 코스·목표·비교 기록을 수정한다. 시작 후에는 최초 목표를 변경할 수 없다.

### 인증 및 권한

- 본인 소유의 아직 출발하지 않은 READY 세션만 수정한다. 그룹 공동 코스·목표는 그룹장 G04로 변경하며 S08로 개인이 덮어쓰지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 준비 중인 본인 세션 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courseId` | integer (int64) / null | X | 코스 변경. null은 자유러닝 선택 |
| `targetDistanceM` | number / null | X | 목표 거리. 자유러닝은 선택 입력. 기존 목표 제거의 null 처리 계약은 별도 확정 |
| `targetDurationSec` | number / null | X | 목표 시간. 입력 조합은 S01과 동일 |
| `targetPaceSecPerKm` | number / null | X | 목표 페이스. 자유러닝은 단독 입력 가능. 환산·상충 검증 계약은 별도 확정 |
| `comparisonSessionId` | integer (int64) / null | X | 비교 기록. null은 비교 해제 |

```json
{"targetDistanceM": 5000, "targetDurationSec": 1800}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "status": "READY",
  "courseId": null,
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "targetPaceSecPerKm": 360,
  "comparisonSessionId": null,
  "groupRunId": null
}
```

- 세션 ID·변경된 설정·모드에 따른 계획 제공 여부와 준비 상태를 제공한다. 계획 대상 모드는 준비 완료 시 전략·BPM을 제공하고 무목표 자유러닝은 사전 계획 비대상으로 표시한다. 상세 구조는 S01/S02 계약 확정 시 통일한다.



| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | 수정한 running_sessions.id. |
| `status` | string | O | 수정 성공 시 READY. |
| `courseId` | integer (int64) / null | O | 실제로 적용한 코스. 자유러닝은 null. |
| `targetDistanceM` | integer / null | O | 실제 적용된 goal_distance. |
| `targetDurationSec` | integer / null | O | 실제 적용된 goal_duration. |
| `targetPaceSecPerKm` | number / null | O | 실제 저장·계산된 goal_pace. |
| `comparisonSessionId` | integer (int64) / null | O | 적용한 비교 기록. 미선택은 null. |
| `groupRunId` | integer (int64) / null | O | 기존 연결 그룹. 개인런은 null. |

**사용 흐름과 응답 판단**

출발 전 수정 후 서버가 적용한 설정으로 화면을 갱신한다. S01/S02와 같은 필드를 사용한다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_OWNER` | 소유권 | 본인 전용 세션·기록이 다른 회원 소유임 |
| `409 SESSION_ALREADY_STARTED` | 상태 충돌 | 운동이 시작되어 고정된 목표를 출발 전 수정 API로 바꾸려 함 |
| `409 INVALID_STATE` | 상태 충돌 | 현재 세션 상태에서 해당 API의 작업(출발 전 설정 수정·시작·정지·재개·종료·취소·BPM 변경 중 해당 작업)을 수행할 수 없음. 같은 명령 재전송은 중복 여부를 먼저 판별 |
| `422 INVALID_GOAL` | 목표 값 | 거리·시간·페이스가 양수/입력 조합 조건을 위반함. 무목표 자유러닝 자체는 오류가 아님 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

**응답·복구 행동과의 연결:** SESSION_ALREADY_STARTED면 S02로 실제 현재 상태를 조회하고 저장된 최초 목표를 사용한다. 시작 이후 목표를 재전송해 강제 변경하지 않는다.

### 처리 규칙

- 생략한 필드는 유지하고 변경 후 전체 설정을 검증한다. 코스·비교 기록 일치와 목표 유효성을 함께 검사한다.
- 저장 후 바뀐 입력과 모드에 따라 초기 안내를 갱신해 앱·워치에 전달한다. 자유러닝의 목표를 모두 제거하면 기존 사전 계획을 해제하고 계획 비대상으로 전환한다. 이전 입력의 늦은 분석 결과는 폐기한다.
- 이미 RUNNING·PAUSED·종료 상태이거나 실제 시작 이력이 있으면 거부한다. 그룹장 G04로도 출발 후 공동 목표를 변경하지 않는다.

### 상태값

READY에서만 허용한다.

### 미정 사항

- [ ] 기존 목표 제거의 null 처리와 선택 목표 환산·상충 검증 계약
- [ ] 변경·시작 경합, 전략 버전·준비 상태·실패 표시 계약

## S09 러닝 세션 삭제

`DELETE` `/api/v1/running-sessions/{sessionId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 본인 |
| 관련 요구사항 | STA-004 / REC-001~002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안. S07 취소와 별도 |

### 설명

본인 러닝 세션을 삭제 표시(기존방식)한다. S07은 세션을 `CANCELLED`로 남기고, 이 API는 이후 조회 대상에서 제거한다.

### 인증 및 권한

- 본인 소유의 세션만 삭제한다.
- 그룹 공동 진행 상태와 다른 참가자 세션은 이 API로 지우지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | string (UUID) | O | 러닝 세션 UUID |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "id": "018f5c2a-7b3d-7c2a-8f1e-6a0b9c8d7e6f",
  "deletedAt": "2026-10-26T10:54:00+09:00"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | string (UUID) | O | 삭제한 세션 ID |
| `deletedAt` | string (ISO 8601) | O | 삭제 표시 시각 |

### 오류 응답

- `403 NOT_OWNER`
- `404 SESSION_NOT_FOUND`
- `409 INVALID_STATE`
- 공통 인증 오류 `401 UNAUTHORIZED`, 권한 오류 `403 FORBIDDEN`, 요청 형식 오류 `400 VALIDATION_ERROR` (해당 시).

### 처리 규칙

- 본인 세션인지 확인한 뒤 삭제 표시(기존방식)한다. 행을 물리 삭제하지 않는다.
- 이미 삭제 표시된 세션의 재요청은 `404 SESSION_NOT_FOUND`로 응답한다.
- `RUNNING`, `PAUSED`는 삭제하지 않고 `409 INVALID_STATE`로 거부한다.
- 그룹런에 연결된 세션은 다른 참가자 진행과 그룹 결과에 영향을 주면 거부한다. 허용 상태는 미정이다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).

### 상태값

- `READY`, `CANCELLED`, `COMPLETED` 삭제 허용은 제안이다. `RUNNING`, `PAUSED`는 거부한다.

### 미정 사항

- [ ] `READY`, `CANCELLED`, `COMPLETED` 중 실제로 지울 수 있는 상태
- [ ] 삭제 시 구간 기록, 비교 대상, 커뮤니티에 공유된 기록의 처리
