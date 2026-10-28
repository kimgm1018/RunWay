# API 명세 — 그룹런

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [G01](#g01-그룹런-생성) | 그룹런 생성 | POST | `/group-runs` | 1차 MVP | 회원 |
| [G02](#g02-그룹런-검색) | 그룹런 검색 | GET | `/group-runs` | 1차 MVP | 회원 |
| [G03](#g03-그룹런-상세) | 그룹런 상세 | GET | `/group-runs/{groupRunId}` | 1차 MVP | 회원 |
| [G04](#g04-그룹런-정보-수정) | 그룹런 정보 수정 | PATCH | `/group-runs/{groupRunId}` | 1차 MVP | 회원 |
| [G05](#g05-그룹런-참가) | 그룹런 참가 | POST | `/group-runs/{groupRunId}/join` | 1차 MVP | 회원 |
| [G06](#g06-그룹런-참가-취소) | 그룹런 참가 취소 | DELETE | `/group-runs/{groupRunId}/participants/me` | 1차 MVP | 회원 |
| [G07](#g07-그룹런-참가자-조회) | 그룹런 참가자 조회 | GET | `/group-runs/{groupRunId}/participants` | 1차 MVP | 회원 |
| [G09](#g09-그룹런-시작) | 그룹런 시작 | POST | `/group-runs/{groupRunId}/start` | 1차 MVP | 회원 |
| [G10](#g10-그룹런-실시간-현황순위) | 그룹런 실시간 현황·순위 | GET | `/group-runs/{groupRunId}/live` | 1차 MVP | 회원 |
| [G12](#g12-그룹런-전체-강제-종료) | 그룹런 전체 강제 종료 | POST | `/group-runs/{groupRunId}/force-finish` | 1차 MVP | 회원 |
| [G13](#g13-그룹런-취소) | 그룹런 취소 | POST | `/group-runs/{groupRunId}/cancel` | 1차 MVP | 회원 |
| [G14](#g14-그룹런-결과-조회) | 그룹런 결과 조회 | GET | `/group-runs/{groupRunId}/results` | 1차 MVP | 회원 |
| [G16](#g16-그룹런-대기방-준비-완료) | 그룹런 대기방 준비 완료 | POST | `/group-runs/{groupRunId}/participants/me/ready` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

group_runs → group_run_participants → running_sessions로 참가자의 개인 기록을 연결한다. 참가 관계의 session_id는 NULL 가능하며 참가 자체가 운동 시작을 뜻하지 않는다. 참가자 역할·준비 상태와 그룹 목표 달성 집계는 ERD에 저장된 상태로 간주하지 않는다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## G01 그룹런 생성

`POST` `/api/v1/group-runs`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 화면 | 6.8 그룹런 만들기, 6.9 만남 장소 선택, 6.9b 장소 확정 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

코스 지정 또는 선두를 따르는 자유그룹런, 시간/페이스 상호 환산.

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
| `title` | string / object (확인 필요) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `description` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `crewId` | integer (int64) | O | 그룹런을 여는 크루 ID. 화면 6.8은 크루 안에서만 생성 |
| `courseId` | integer (int64) / null | X | 선택한 코스 식별자. 개인·그룹 자유러닝은 null/생략 가능 |
| `scheduledAt` | string (ISO 8601) | X | 그룹런 예정 시작시각(UTC) |
| `meetingPosition` | GeoJSON | O | 만나는 곳 좌표(6.9 지도 핀) |
| `meetingPlaceName` | string | O | 장소 이름(주소에서 자동 채움, 수정 가능) |
| `meetingAddress` | string | X | 만나는 곳 주소 |
| `meetingDirections` | string | X | 찾아오는 법(선택 입력) |
| `capacity` | number | X | 참가 인원 상한. 화면 6.8에서는 크루 단위로 옮겨 입력하지 않음 |
| `responseDeadlineAt` | string (ISO 8601) | X | 참가 응답 마감 시각 |
| `recurrence` | object | X | 반복 설정(6.8 '+ 반복'). 형식 미정 |
| `targetDistanceM` | number | 조건부 | 목표 거리, 미터, 양수. 코스 러닝은 코스 거리, 자유 러닝은 시간 목표만 둘 수 있음 |
| `goalInputType` | string (제안) | O | TIME/PACE 중 하나 |
| `targetDurationSec` | number | X | 목표 완주 시간, 초, 양수 |
| `targetPaceSecPerKm` | number | X | 목표 페이스, 초/km, 양수 |

```json
{
  "title": "러닝 모임",
  "crewId": 101,
  "meetingPosition": {
    "type": "Point",
    "coordinates": [
      129.118,
      35.153
    ]
  },
  "meetingPlaceName": "집결 장소",
  "targetDistanceM": 5000,
  "goalInputType": "TIME",
  "targetDurationSec": 1800,
  "scheduledAt": "2026-10-25T00:00:00Z"
}
```

### Response

`201 Created (제안)`

```json
{
  "id": 101,
  "hostId": 101,
  "status": "SCHEDULED",
  "courseId": null,
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "scheduledAt": "2026-10-25T00:00:00Z",
  "meetingPlaceName": "집결 장소",
  "meetingAddress": null,
  "goalPaceSecPerKm": 360
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `hostId` | integer (int64) | O | `group_runs.host_id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `courseId` | integer (int64) / null | O | `group_runs.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDistanceM` | integer / null | O | group_runs.goal_distance의 적용값. |
| `targetDurationSec` | integer / null | O | group_runs.goal_duration의 적용값. |
| `capacity` | number | X | group_runs에는 capacity가 없다. crews.capacity는 크루 정원으로 대체할 수 없다. 그룹 정원 응답은 확인 필요. |
| `scheduledAt` | string (ISO 8601 UTC) | O | 실제로 적용된 group_runs.scheduled_at. |
| `meetingPlaceName` | string / null | O | group_runs.meeting_name. 미지정은 null. |
| `meetingAddress` | string / null | O | group_runs.meeting_address. 미지정은 null. |
| `goalPaceSecPerKm` | number / null | O | 공동 목표가 계산 가능한 경우의 목표 페이스. 단독 목표 산출 규칙은 미정. |

**사용 흐름과 응답 판단**

모집·대기방에서 서버에 적용된 일정·장소·코스·목표를 확인한다. 그룹 목표 페이스는 거리·시간에서 파생하며 미설정은 null이다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 COURSE_INACCESSIBLE` | 자원 상태/접근 | 요청 용도에 사용할 수 없는 코스를 참조함. MERGED/BLOCKED의 상세·저장 목록 상태 안내를 무조건 차단하지 않음 |
| `422 INVALID_GOAL` | 목표 값 | 거리·시간·페이스가 양수/입력 조합 조건을 위반함. 무목표 자유러닝 자체는 오류가 아님 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `403 CREW_FORBIDDEN` | 크루 존재·가입/모집 권한 또는 비활성 상태 확인 필요 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 코스 없이 만든 그룹런(자유 러닝)은 '자유 러닝 · 40분'처럼 시간·거리 목표만 보여 준다.
- 생성하면 크루 멤버에게 알림을 보내는 기존 규칙은 알림 종류 검토 대상으로 유지한다. 참가 응답 마감 임박·마감 전날 미응답자 알림은 보내지 않는다(사용자 확정).
- 코스 지정 또는 선두를 따르는 자유그룹런, 시간/페이스 상호 환산.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 반복 그룹런 생성 방식(회차별 개별 그룹런 생성 여부)
- [ ] 크루 없는 공개 그룹런 허용 여부
- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정

## G02 그룹런 검색

`GET` `/api/v1/group-runs`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 화면 | 2.P 그룹 탭, 2.P′ 추천 그룹런, 6.0 내 크루 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

모집 중 그룹런 탐색.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string (제안) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `crewId` | integer (int64) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `scheduledFrom` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `latitude` | number | X | 내 근처 검색 기준 위도 |
| `longitude` | number | X | 내 근처 검색 기준 경도 |
| `radiusM` | number | X | 검색 반경(화면 기본 3km) |
| `participation` | string | X | ME(내가 참가 응답한 그룹런)/NONE |
| `myCrewsOnly` | boolean | X | 가입한 크루의 그룹런만 |
| `level` | string | X | BEGINNER/INTERMEDIATE/ADVANCED. 신규 사용자 추천(2.P′) |
| `cursor` | string / object (확인 필요) | X | 서버 발급 불투명 페이지 커서 |
| `limit` | number | X | 조회 결과 최대 개수(최대값 미정) |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "id": 101,
      "title": "주말 러닝",
      "hostId": 101,
      "courseId": null,
      "scheduledAt": "2026-10-24T09:00:00Z",
      "status": "SCHEDULED",
      "goalDistance": null,
      "goalDuration": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 조회 권한이 있는 그룹런 요약 목록. 세부 객체 계약 미정 |
| `page` | string / object (확인 필요) | X | 페이지 메타데이터는 저장 엔티티가 아니다. cursor/limit 등 공통 페이지 형식 확정 필요. |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].title` | string | O | `group_runs.title` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `items[].hostId` | integer (int64) | O | `group_runs.host_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].courseId` | integer (int64) / null | O | `group_runs.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].scheduledAt` | string (ISO 8601 UTC) | O | `group_runs.scheduled_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `items[].status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `items[].goalDistance` | integer / null | O | `group_runs.goal_distance` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].goalDuration` | integer / null | O | `group_runs.goal_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

모집 카드에는 그룹 ID·이름·일정·장소·현재 참가수·본인 참가 여부가 필요하다. 참가 인원과 실제 시작 인원을 구분한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_FILTER` | 검색 조건 | 정렬·필터·페이지 조건이 명세의 허용값/형식에 맞지 않음 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- 목록 항목에 내 참가 여부와 참가 수, 출발까지 남은 시간을 포함한다(6.0 상단 고정 카드). 불참 응답 상태·인원은 관리하지 않는다.
- 모집 중 그룹런 탐색.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G03 그룹런 상세

`GET` `/api/v1/group-runs/{groupRunId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

코스 없는 그룹런은 선두 추종 자유러닝.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "title": "주말 러닝",
  "description": null,
  "hostId": 101,
  "crewId": 101,
  "courseId": null,
  "scheduledAt": "2026-10-25T00:00:00Z",
  "meetingPosition": null,
  "participantCount": 0,
  "status": "SCHEDULED",
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "meetingPlaceName": null,
  "meetingAddress": null,
  "goalPaceSecPerKm": 360
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | O | `group_runs.title` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `description` | string / null | O | `group_runs.description` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `hostId` | integer (int64) | O | `group_runs.host_id` (BIGINT). 저장 값은 NULL 불가. |
| `crewId` | integer (int64) | O | `group_runs.crew_id` (BIGINT). 저장 값은 NULL 불가. |
| `courseId` | integer (int64) / null | O | `group_runs.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `scheduledAt` | string (ISO 8601 UTC) | O | 실제로 적용된 group_runs.scheduled_at. |
| `meetingPosition` | GeoJSON Point / null | O | `group_runs.meeting_position` (geography(Point,4326)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `capacity` | number | X | group_runs에는 capacity가 없다. crews.capacity는 크루 정원으로 대체할 수 없다. 그룹 정원 응답은 확인 필요. |
| `participantCount` | integer | X | group_run_participants의 해당 그룹 참가 관계 수. 실제 시작 인원과 구분한다. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `targetDistanceM` | integer / null | O | group_runs.goal_distance의 적용값. |
| `targetDurationSec` | integer / null | O | group_runs.goal_duration의 적용값. |
| `goalPaceSecPerKm` | number / null | O | 공동 목표가 계산 가능한 경우의 목표 페이스. 단독 목표 산출 규칙은 미정. |
| `groupGuidePaceSecPerKm` | number / null (제안) | X | 자동 계산한 현재 공동 안내 페이스. 산출 전 표시 규칙 미정 (ERD만으로 응답 형식을 확정하지 않음.) |
| `meetingPlaceName` | string / null | O | group_runs.meeting_name. 미지정은 null. |
| `meetingAddress` | string / null | O | group_runs.meeting_address. 미지정은 null. |

**사용 흐름과 응답 판단**

모집·대기방에서 서버에 적용된 일정·장소·코스·목표를 확인한다. 그룹 목표 페이스는 거리·시간에서 파생하며 미설정은 null이다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 GROUP_NOT_FOUND` | 대상 없음 | 참조한 그룹런이 없음 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 대기방에 표시할 공동 안내 페이스는 참가자·공동 목표·관련 분석 데이터 변경에 따라 자동 계산한다. 이 조회는 계산을 실행하지 않는다.

- 코스 없는 그룹런은 선두 추종 자유러닝.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G04 그룹런 정보 수정

`PATCH` `/api/v1/group-runs/{groupRunId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

그룹장이 출발 전 공동 코스·목표를 수정한다. 변경 후 전략을 갱신하고 출발 후 최초 공동 목표는 변경할 수 없다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `targetDistanceM` | integer / null | X | 수정할 목표 거리(m). 양수. 자유러닝의 목표 해제는 null; 생략은 기존 값 유지. |
| `goalInputType` | string | 조건부 | TIME/PACE. 거리·시간·페이스 환산이 필요한 목표 변경 시 기준을 명시한다. |
| `targetDurationSec` | integer / null | 조건부 | TIME 기준 목표 시간(초). 양수. 자유러닝의 해당 목표 해제는 null. |
| `targetPaceSecPerKm` | number / null | 조건부 | PACE 기준 목표 페이스(초/km). 양수. 자유러닝의 해당 목표 해제는 null. |
| `title` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `description` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `scheduledAt` | string (ISO 8601) | X | 그룹런 예정 시작시각(UTC) |
| `meetingPosition` | GeoJSON | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `capacity` | number | X | 참가 인원 상한(허용 범위 미정) |
| `courseId` | integer (int64) / null | X | 수정할 코스. null은 자유러닝으로 전환, 생략은 기존 코스 유지 |

```json
{
  "targetDistanceM": 5000,
  "goalInputType": "TIME",
  "targetDurationSec": 1800
}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "title": "주말 러닝",
  "status": "SCHEDULED",
  "courseId": null,
  "updatedAt": "2026-10-24T09:00:00Z",
  "scheduledAt": "2026-10-25T00:00:00Z",
  "meetingPlaceName": null,
  "meetingAddress": null,
  "targetDistanceM": 5000,
  "targetDurationSec": 1800,
  "goalPaceSecPerKm": 360
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | O | `group_runs.title` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `courseId` | integer (int64) / null | O | `group_runs.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `updatedAt` | string (ISO 8601 UTC) | O | `group_runs.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `scheduledAt` | string (ISO 8601 UTC) | O | 실제로 적용된 group_runs.scheduled_at. |
| `meetingPlaceName` | string / null | O | group_runs.meeting_name. 미지정은 null. |
| `meetingAddress` | string / null | O | group_runs.meeting_address. 미지정은 null. |
| `targetDistanceM` | integer / null | O | group_runs.goal_distance의 적용값. |
| `targetDurationSec` | integer / null | O | group_runs.goal_duration의 적용값. |
| `goalPaceSecPerKm` | number / null | O | 공동 목표가 계산 가능한 경우의 목표 페이스. 단독 목표 산출 규칙은 미정. |

**사용 흐름과 응답 판단**

모집·대기방에서 서버에 적용된 일정·장소·코스·목표를 확인한다. 그룹 목표 페이스는 거리·시간에서 파생하며 미설정은 null이다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

**확정된 목표 수정:** 기존 G04에서 출발 전 목표를 변경한다. TIME은 거리·시간으로 페이스를, PACE는 거리·페이스로 시간을 재계산해 응답한다. 기존 목표를 AI 안내 페이스 변경으로 대신하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_HOST` | 역할 권한 | 그룹장 전용 작업을 그룹장이 아닌 사용자가 요청함 |
| `409 EDIT_NOT_ALLOWED` | 상태 충돌 | 현재 그룹 상태에서 변경할 수 없는 정보를 수정하려 함. 수정 가능 필드·상태 범위 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `422 INVALID_GOAL` | 수정 목표의 값·조합 검증 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

**응답·복구 행동과의 연결:** 수정한 목표의 누락·0/음수·지원하지 않는 goalInputType·모순된 조합은 INVALID_GOAL로 구분한다. 출발 이후에는 EDIT_NOT_ALLOWED를 반환하고 G03으로 확정 목표를 다시 조회한다.

### 처리 규칙

- 목표 변경도 그룹장만 SCHEDULED(출발 전)에 수행한다. RUNNING/COMPLETED/CANCELLED에서는 수정하지 않으며 일시정지된 개인 세션을 근거로 공동 목표를 변경하지 않는다.
- PATCH에서 생략한 항목은 유지한다. TIME/PACE 기준으로 입력한 목표와 유지되는 거리로 파생값을 다시 계산하고 이전 파생값을 입력값처럼 혼합하지 않는다. 환산 불가능한 자유러닝의 단독 목표는 유지하며 2개 입력을 강제하지 않는다.
- 자유러닝 목표 해제 시 해당 값을 null로 전달한다. 명시적인 null 해제는 필드 누락과 구분하며 기준값 누락 오류를 자동 적용하지 않는다. 목표를 유지·설정하는 요청에서 코스 러닝의 필수 목표 조합과 모순되거나 TIME/PACE 기준 값이 없으면 INVALID_GOAL로 거절한다. 소수 시간 반올림·오차 허용 기준은 별도 확정한다.
- 목표 변경 저장 후 초기 전략·공동 안내를 갱신한다. 갱신이 지연/실패한 경우 저장 성공과 구분하고 후속 작업을 재처리하며 클라이언트가 목표 수정을 반복하지 않게 한다. 구체 준비 상태 스키마는 기존 미정이다.

- 예정 시작 시각을 변경하면 기존 시작 임박 예약을 무효화하고 변경된 시각 기준으로 다시 계산한다. 참가자 대상 중요 변경 소식 알림은 알림 초안의 제안 항목이며 예약 갱신 자체와 구분한다.

- 그룹장이 출발 전 공동 코스·목표를 수정한다. 변경 후 전략을 갱신하고 출발 후 최초 공동 목표는 변경할 수 없다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- SCHEDULED에서 수정 가능. RUNNING/COMPLETED/CANCELLED에서는 목표 변경 불가. DB에 없는 RECRUITING/READY를 그룹 저장 상태로 사용하지 않는다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정



**부분 목표 해제·저장 제약:** 자유러닝의 목표값을 null로 해제하는 의도는 허용한다. 다만 일부 목표 해제 시 기존 파생 시간/페이스를 함께 제거할지, 독립 목표로 유지할지의 세부 규칙은 미정이다. 이전 파생값을 그대로 남긴 성공 응답을 임의 생성하지 않으며 해당 부분 해제 구현은 결정 전 보류한다. group_runs에는 goal_pace 컬럼이 없으므로 거리 없는 PACE 단독 목표의 영속 저장·복원도 별도 데이터 계약이 필요하다. 숫자 목표 수정의 거리+TIME/PACE 환산과 이 미정 사례를 구분하고 임의 컬럼을 추가하지 않는다.
## G05 그룹런 참가

`POST` `/api/v1/group-runs/{groupRunId}/join`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 화면 | 6.0 내 크루, 6.4 그룹런 상세 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

정원 및 참가 여부 검사.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "groupRunId": 101,
  "userId": 101,
  "joinedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_run_participants.group_run_id` (BIGINT). 저장 값은 NULL 불가. |
| `userId` | integer (int64) | O | `group_run_participants.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | 표시 상태 (확인 필요) | 확인 필요 | group_run_participants에 상태 컬럼이 없음. PENDING/APPROVED 등 크루 상태를 재사용하지 않는다. |
| `joinedAt` | string (ISO 8601 UTC) | O | `group_run_participants.joined_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

참가 완료 후 그룹·본인·참가 결과를 식별한다. 그룹 자체 상태와 참가 관계 존재를 구분한다.

위 보완 필드는 호출 목적상 필요한 출력이다. 저장 컬럼 부재는 출력 불필요의 근거가 아니다. 저장·전송 정책 미정 항목은 위 설명의 계약을 확정한 후 구현한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 FULL_OR_ALREADY_JOINED` | 기존 혼합 코드 | 이미 참가한 상태와 정원 초과를 합친 기존 코드. 그룹 정원은 ERD에 없으므로 정원 분기는 확인 필요. 크루 정원을 그룹 정원으로 사용하지 않음 |
| `409 INVALID_GROUP_STATE` | 상태 충돌 | 현재 그룹 상태에서 요청한 참가·시작·종료·취소·준비 처리를 허용하지 않음. 구체 전이·중복 처리 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 참가가 확정되면 예정된 그룹런의 시작 임박 알림 수신 대상으로 반영한다. 참가 자체의 소식 알림은 보내지 않는다. 발송 시각·횟수는 미정이다.

- 화면의 '참가' 행동을 처리한다. 별도 불참 응답은 없다.
- 참가 상태·인원은 갱신하되 그룹런 참가 알림은 보내지 않는다.
- 정원 및 참가 여부 검사.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G06 그룹런 참가 취소

`DELETE` `/api/v1/group-runs/{groupRunId}/participants/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 화면 | 6.4 그룹런 상세 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

시작 전 참가 취소. 러닝 중에는 개인 세션 종료 처리.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string (제안) | X | 이 응답의 상태에 대응하는 저장 컬럼이 없다. 관련 엔티티의 상태를 재사용하지 않고 표현 확인 필요. |
| `cancelledAt` | string (ISO 8601) | X | group_run_participants에 취소 시각 컬럼 없음. 그룹 자체 ended_at과 구분한다. |


**사용 흐름과 응답 판단**

참가 취소 후 관계 제거를 확인한다. 취소시각/상태 저장이 없는 점을 숨기지 말고 재참가 가능 표시와 연결한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 RUN_ALREADY_STARTED` | 상태 충돌 | 러닝이 이미 시작된 뒤 참가 취소를 요청함. 개인 종료와 구분 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 참가를 취소해 미참가 상태로 되돌린다. 불참 응답 상태를 만들지 않는다.
- 참가 취소 알림은 보내지 않는다. 참가 상태·인원을 갱신하고 본인의 시작 임박 예약 알림은 취소한다.
- 시작 전 참가 취소. 러닝 중에는 개인 세션 종료 처리.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G07 그룹런 참가자 조회

`GET` `/api/v1/group-runs/{groupRunId}/participants`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

참가자 역할·상태, 세션 연결. 위치는 별도 실시간 응답.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "userId": 101,
      "sessionId": null,
      "joinedAt": "2026-10-24T09:00:00Z",
      "nickname": "러너",
      "isHost": true,
      "readyStatus": "READY",
      "readinessScore": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 그룹 참가자의 역할·준비·세션 연결 상태 목록. 세부 객체 계약 미정 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].userId` | integer (int64) | O | `group_run_participants.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].sessionId` | integer (int64) / null | O | `group_run_participants.session_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].joinedAt` | string (ISO 8601 UTC) | O | `group_run_participants.joined_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

대기방은 참가자 ID뿐 아니라 닉네임·준비 여부·본인/호스트 구분이 필요하다. 준비 상태의 저장 근거는 아직 미정이다.

기능상 필요한 응답 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].nickname` | string | O | 참가자 회원 표시명. |
| `items[].isHost` | boolean | O | group_runs.host_id 비교 결과. |
| `items[].readyStatus` | string (구조 제안) | O | G16에서 변경하는 준비 상태. 저장·복구 계약 확정 필요. |

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].readinessScore` | number / null | O | 대기방 준비도 점수. 동의·참가자 공개범위 및 최신 날짜 선택 계약 확인 필요. 미측정은 null. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 GROUP_FORBIDDEN` | 접근 권한 | 그룹 참가자 목록의 조회 자격이 없음. 크루 가입/그룹 참가의 정확한 조회 경계 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 참가자 역할·상태, 세션 연결. 위치는 별도 실시간 응답.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G09 그룹런 시작

`POST` `/api/v1/group-runs/{groupRunId}/start`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

그룹장이 그룹런 시작을 요청한다. 서버는 시작 대상 참가자의 개인 세션 준비·시작을 연계하고 앱·워치에 시작 상태를 전달해야 한다. 뛰지 않은 사람은 실제 시작 대상에 포함하지 않는다. 실제 시작 확인·부분 실패의 기술 계약은 미정이다.

### 인증 및 권한

- 해당 그룹런의 그룹장(호스트)만 시작할 수 있다.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

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
  "groupRunId": 101,
  "status": "RUNNING",
  "startedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `startedAt` | string (ISO 8601 UTC) / null | O | `group_runs.started_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

그룹 시작 수락과 각 개인 세션의 실제 시작·부분 실패를 구분할 결과가 필요하다. 그룹 RUNNING만으로 전원 시작을 의미하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_HOST` | 역할 권한 | 그룹장 전용 작업을 그룹장이 아닌 사용자가 요청함 |
| `409 INVALID_GROUP_STATE` | 상태 충돌 | 현재 그룹 상태에서 요청한 참가·시작·종료·취소·준비 처리를 허용하지 않음. 구체 전이·중복 처리 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 실제 시작이 확정되면 남아 있는 시작 임박 예약을 무효화하고 참가자에게 시작 상태를 전달한다. 일반 소식 알림의 채택과 별개로 운동 상태 동기화는 수행한다.

- 각 참가자가 S01·S03을 따로 순서대로 호출해야만 그룹 시작이 완성되는 흐름으로 두지 않는다. 기존 준비 세션은 참가자별로 식별하고 재요청으로 중복 생성·시작하지 않는다.
- 실제로 운동을 시작한 참가자 집합을 관리하고 뛰지 않은 사람은 시작·자동 종료 대상에서 제외한다. 실제 시작 확인 방식·전원 준비 조건·부분 실패 처리의 세부 계약은 별도 확정한다. 시작 전달은 운동 상태 동기화이며 선택 소식 알림 설정에 의존하지 않는다.

- 그룹장이 그룹런 시작을 요청한다. 서버는 시작 대상 참가자의 개인 세션 준비·시작을 연계하고 앱·워치에 시작 상태를 전달해야 한다. 뛰지 않은 사람은 실제 시작 대상에 포함하지 않는다. 실제 시작 확인·부분 실패의 기술 계약은 미정이다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G10 그룹런 실시간 현황·순위

`GET` `/api/v1/group-runs/{groupRunId}/live`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

지정 코스는 코스상 진행률, 자유는 선두 실제 경로 기준으로 순위·앞뒤 거리 비교.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "groupRunId": 101,
  "status": "RUNNING",
  "groupGuidePaceSecPerKm": 360,
  "participants": [
    {
      "userId": 101,
      "rank": 2,
      "aheadCount": 1,
      "behindCount": 2,
      "gapToAheadM": 35,
      "gapToBehindM": 20
    }
  ],
  "courseId": null,
  "updatedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `courseId` | integer (int64) / null | O | `group_runs.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `groupGuidePaceSecPerKm` | number | X | 자동 계산된 현재 공동 안내 페이스 (ERD만으로 응답 형식을 확정하지 않음.) |
| `updatedAt` | string (ISO 8601 UTC) | O | `group_runs.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `participants` | array | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 |


**사용 흐름과 응답 판단**

복구 화면은 참가자별 식별자·순위·앞뒤 인원/거리·현재 페이스와 기준시각이 필요하다. GPS 누락을 순위0/거리0으로 표시하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_PARTICIPANT` | 참가 권한 | 해당 그룹 참가 관계가 없는 사용자가 참가자 전용 요청을 보냄 |
| `404 GROUP_NOT_FOUND` | 대상 없음 | 참조한 그룹런이 없음 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 화면 진입·재연결 시 최신 그룹 상태를 복구하는 조회다. 순위 계산·페이스 조정·알림 생성을 실행시키지 않는다.
- 참가자 측정 데이터 수신에 따라 순위·거리 차이를 자동 계산하고 변경 내용을 실시간 전달한다. 그룹 페이스·격차 알림도 조건 충족 시 자동 전송한다.
- 반복 GET이 운동 진행의 필수 조건이 되어서는 안 된다. 채널·메시지·순서·만료·재연결 계약은 별도 확정한다.

- 지정 코스는 코스상 진행률, 자유는 선두 실제 경로 기준으로 순위·앞뒤 거리 비교.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G12 그룹런 전체 강제 종료

`POST` `/api/v1/group-runs/{groupRunId}/force-finish`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

종료 신호 미수신 등 예외 상황에서 해당 그룹런의 그룹장(호스트)이 그룹 전체를 강제 종료한다. 정상 흐름에서는 실제 시작 참가자 전원 개인 종료 시 자동 종료하므로 별도 호출하지 않는다.

### 인증 및 권한

- 해당 그룹런의 그룹장(호스트)만 실행할 수 있다. 크루장 또는 일반 참가자 권한만으로 실행할 수 없다.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

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
  "groupRunId": 101,
  "status": "COMPLETED",
  "endedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |
| `endedAt` | string (ISO 8601 UTC) / null | O | `group_runs.ended_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `goalAchieved` | boolean / null (집계 확인 필요) | X | 자동 평가 결과. 분석 전 값은 미정이며 강제 종료 성공과 구분 (ERD만으로 응답 형식을 확정하지 않음.) |


`goalAchieved`는 group_runs 컬럼이 아니다. 참가자별 running_sessions.goal_achieved(NULL 가능)를 그룹 결과로 합치는 규칙은 확인 필요이며 강제 종료만으로 true/false를 정하지 않는다.

**사용 흐름과 응답 판단**

강제 종료 시각까지의 기준과 참가자 종료 반영/분석 상태가 필요하다. 목표달성 false를 자동으로 만들지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_HOST` | 역할 권한 | 그룹장 전용 작업을 그룹장이 아닌 사용자가 요청함 |
| `409 INVALID_GROUP_STATE` | 상태 충돌 | 현재 그룹 상태에서 요청한 참가·시작·종료·취소·준비 처리를 허용하지 않음. 구체 전이·중복 처리 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.
- 종료 성공·원본 저장 완료와 분석 준비/실패를 구분한다. 아직 없는 결과나 미측정 값을 0/false로 채우거나 원 요청 전체를 재실행하도록 요구하지 않는다.

### 처리 규칙

- 강제 종료 상태가 확정되면 아직 남은 시작 임박 예약을 무효화한다. 종료 상태 전달·결과 정리 실패는 해당 후속 작업만 재시도한다.

- 진행 중인 그룹런 전체를 종료한다. 진행 중인 참가자 세션도 종료 대상으로 처리하고 이미 종료된 세션 상태는 유지한다.
- 일부 참가자가 아직 종료하지 않았다는 이유로 거부하지 않는다. 요청 중복·정상 자동 종료와의 경합 시 이중 종료·이중 집계를 방지한다.
- 강제 종료 사실을 참가자 앱·워치에 전달하고 그룹 결과 정리를 자동 실행한다. 연결이 끊긴 기기는 재연결 시 종료 상태를 복구한다.
- 강제 종료는 목표 달성이나 전원 완주를 의미하지 않는다. 기록은 강제 종료 기준 시각까지 반영한다. 기준 이전 데이터는 지연 수신해도 복구·재집계하고 이후 데이터는 해당 그룹런 집계에서 제외한다. 종료 시각·사유·시계 보정의 상세 계약은 별도 확정한다.

- 종료 신호 미수신 등 예외 상황에서 해당 그룹런의 그룹장(호스트)이 그룹 전체를 강제 종료한다. 정상 흐름에서는 실제 시작 참가자 전원 개인 종료 시 자동 종료하므로 별도 호출하지 않는다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 강제 종료 확인 화면, 종료 기준 시각·기기 시계 보정·종료 사유 및 상태값 매핑
- [ ] 종료 사실 전달과 재연결 복구 계약


## G13 그룹런 취소

`POST` `/api/v1/group-runs/{groupRunId}/cancel`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 화면 | 6.4c 그룹런 취소, 6.4d 취소 확인, 6.4e 취소 완료 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

그룹런 시작 전 호스트 취소.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commandId` | string (UUID) | X | 네트워크 재전송 중복 제거를 위한 명령 ID(제안) |
| `cancelReason` | string | O | WEATHER/PERSONAL/LACK_OF_PARTICIPANTS/LOCATION_ISSUE/OTHER |
| `cancelMessage` | string | X | 멤버에게 남길 말(최대 100자) |

```json
{
  "cancelReason": "WEATHER"
}
```

### Response

`200 OK (제안)`

```json
{
  "groupRunId": 101,
  "status": "CANCELLED"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `group_runs.status` (ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')). 저장 값은 NULL 불가. 허용값: SCHEDULED, RUNNING, COMPLETED, CANCELLED. |


**사용 흐름과 응답 판단**

취소된 그룹 ID·CANCELLED·저장된 사유를 확인한다. 알림 후속 처리 실패 때문에 그룹 취소 자체를 재요청하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_HOST` | 역할 권한 | 그룹장 전용 작업을 그룹장이 아닌 사용자가 요청함 |
| `409 INVALID_GROUP_STATE` | 상태 충돌 | 현재 그룹 상태에서 요청한 참가·시작·종료·취소·준비 처리를 허용하지 않음. 구체 전이·중복 처리 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 취소 상태 반영 시 예약된 시작 임박 알림을 무효화한다. 발송 직전에도 상태를 검사하여 취소된 그룹런의 시작 알림을 보내지 않는다.

- 취소하면 크루 멤버 전원(참가 여부와 무관)에게 알림을 보낸다. 취소한 그룹런은 되돌릴 수 없다.
- 취소된 그룹런은 내 크루 목록에서 빠지고, 상세 조회(G03)는 취소 사유·남긴 말과 함께 계속 열 수 있다.
- 그룹런 시작 전 호스트 취소.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G14 그룹런 결과 조회

`GET` `/api/v1/group-runs/{groupRunId}/results`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

그룹 종료 후 자동 정리된 참가자 기록과 공동 목표 달성 평가 결과를 조회한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "groupRunId": 101,
  "targetDistanceM": null,
  "targetDurationSec": null,
  "participants": [
    {
      "userId": 101,
      "sessionId": 301,
      "actualDistanceM": 5000,
      "movingDurationSec": 1800,
      "averagePaceSecPerKm": 360,
      "goalAchieved": true
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` (BIGINT). 저장 값은 NULL 불가. |
| `targetDistanceM` | integer / null | O | `group_runs.goal_distance` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDurationSec` | integer / null | O | `group_runs.goal_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `goalAchieved` | boolean / null (집계 확인 필요) | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 (ERD만으로 응답 형식을 확정하지 않음.) |
| `participants` | array | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `participants[].userId` | integer (int64) | O | `group_run_participants.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `participants[].sessionId` | integer (int64) / null | O | `group_run_participants.session_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


`goalAchieved`는 group_runs 컬럼이 아니다. 참가자별 running_sessions.goal_achieved(NULL 가능)를 그룹 결과로 합치는 규칙은 확인 필요이며 강제 종료만으로 true/false를 정하지 않는다.

**사용 흐름과 응답 판단**

결과 화면에서 공동 목표와 각 참가자의 실제 결과를 나란히 보여준다. 세션 ID만으로 완료 결과 화면을 만들 수 없다.

기존 목록/결과의 기능상 필요한 하위 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `participants[].actualDistanceM` | number / null | O | 연결 세션 total_distance. |
| `participants[].movingDurationSec` | integer / null | O | 연결 세션 moving_duration. |
| `participants[].averagePaceSecPerKm` | number / null | O | 연결 세션 average_pace. |
| `participants[].goalAchieved` | boolean / null | O | 개인 목표평가. 그룹 집계 결과와 구분. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 RESULTS_NOT_READY` | 결과 준비 | 종료·동기화·분석 중이라 최종 결과가 준비되지 않음. 기존 RESULTS_NOT_READY 응답 후 G14 재조회. 잠정결과·실패 세부 표현은 확인 필요 |
| `403 NOT_PARTICIPANT` | 참가 권한 | 해당 그룹 참가 관계가 없는 사용자가 참가자 전용 요청을 보냄 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 종료 성공·원본 저장 완료와 분석 준비/실패를 구분한다. 아직 없는 결과나 미측정 값을 0/false로 채우거나 원 요청 전체를 재실행하도록 요구하지 않는다.

**응답·복구 행동과의 연결:** 결과 준비 전에는 기존 RESULTS_NOT_READY를 유지한다. 같은 G14 조회로 복구하며 그룹 종료를 재요청하지 않는다.

### 처리 규칙

- 실제 시작 참가자 전원 개인 종료 또는 G12 강제 종료 시 결과 정리를 자동 수행한다. 조회가 결과 생성이나 그룹 종료를 실행시키지 않는다.
- 운동 종료·목표 완주·분석 완료를 구분한다. 지연 업로드 반영·잠정 결과 표시는 별도 확정하며 준비 전에는 RESULTS_NOT_READY를 반환한다.

- 그룹 종료 후 자동 정리된 참가자 기록과 공동 목표 달성 평가 결과를 조회한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- RECRUITING / READY / RUNNING / COMPLETED / CANCELLED (허용 전이 검토).

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 실시간 전달 채널, 선두 경로 기준 순위·동기화 처리 확정


## G16 그룹런 대기방 준비 완료

`POST` `/api/v1/group-runs/{groupRunId}/participants/me/ready`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-002, GRP-004 |
| 관련 화면 | 6.5 그룹런 대기방 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

당일 대기방에서 '준비 완료'를 누른다. 모두 준비되면 방장이 출발([G09](#g09-그룹런-시작))한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `ready` | boolean | X | 기본 true. false면 준비 완료 취소 |

```json
{
  "ready": true
}
```

### Response

`200 OK (제안)`

```json
{
  "participantCount": 1,
  "readyStatus": "READY",
  "readyCount": 1
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `readyStatus` | string | O | group_run_participants에 준비 상태 컬럼 없음. 기존 READY/WAITING 표시의 저장·산출 근거 확인 필요. |
| `readyCount` | number | O | 준비 상태 저장·산출 근거 미정. 참가 관계 수로 대체하지 않는다. |
| `participantCount` | integer | O | group_run_participants의 해당 그룹 참가 관계 수. 실제 시작 인원과 구분한다. |


**사용 흐름과 응답 판단**

본인 준비상태와 준비/참가 인원이 필요하다. 본인 준비완료와 모든 참가자의 실제 운동 시작은 다르다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_PARTICIPANT` | 참가 권한 | 해당 그룹 참가 관계가 없는 사용자가 참가자 전용 요청을 보냄 |
| `409 INVALID_GROUP_STATE` | 상태 충돌 | 현재 그룹 상태에서 요청한 참가·시작·종료·취소·준비 처리를 허용하지 않음. 구체 전이·중복 처리 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- '참가'로 응답한 사람만 대기방에 들어갈 수 있다.
- 참가자 목록(G07)에는 각자의 준비도 점수와 준비 상태를 함께 내려 준다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] 대기방 상태 실시간 전달 방식(폴링/웹소켓)
- [ ] 준비 완료 전 방장 출발 허용 여부
- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정

## 그룹 자동 처리와 전달

- G08 공동 페이스 계산과 G11 페이스·격차 알림은 내부 자동 처리 및 실시간 전달로 이동했다. G15 불참 응답은 제거했다. 제외한 ID는 재사용하지 않는다.
- 실제 운동을 시작한 참가자 전원의 개인 운동 종료를 감지하면 별도 호스트 요청 없이 그룹을 종료하고 결과를 정리한다. 뛰지 않은 참가자는 시작·자동 종료 판정 대상에 포함하지 않는다. 실제 시작 확인 이벤트·합류·명령 경합의 기술 계약은 별도 확정한다.
- 공동 페이스·순위·격차·운동 부담·강제 종료는 해당 참가자 앱·워치에 전달한다. 대기방 공동 페이스·준비 상태 변경도 전달 대상으로 설계한다.
- 연결 끊김은 즉시 종료 사유가 아니다. 기기는 기본 측정·기록과 마지막 페이스·BPM을 유지한다.
- 정상 종료와 강제 종료의 상태·사유 저장 및 지연 데이터 정합성은 ERD에 맞춰 확정한다. 기존 COMPLETED 값만으로 강제 종료 기록 정책을 확정하지 않는다.
- [자동 처리 요구사항](../requirements.md)를 따른다.
