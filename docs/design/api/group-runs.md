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
| [PLS01](#pls01-만남-장소-검색) | 만남 장소 검색 | GET | `/places/search` | 1차 MVP | 회원 |

## PLS01 만남 장소 검색

`GET /api/v1/places/search` — S15P31E105-471, 2026-11-06 사용자 승인 계약. 회원 인증이 필요하다.

| Query | 규칙 |
| --- | --- |
| `query` | 앞뒤 공백 제거 후 최대 100 Unicode 코드포인트. 생략·공백이면 `200 {"items":[]}`, 외부 호출 없음 |
| `latitude`, `longitude` | 선택. 둘 다 생략하거나 함께 전송. 유한한 WGS84 위도(-90~90)·경도(-180~180). 거리 계산 기준 |

```json
{"items":[{"name":"공원 입구","address":"합성 예시 주소","position":[129.118,35.153],"distanceM":null}]}
```

- `items`는 항상 배열, 최대 10개. 지역 검색 최대 5개를 먼저, Geocoding 주소 최대 5개를 다음에 병합하고 동일 이름·주소·좌표는 중복 제거한다. 주변 검색·거리순·페이지네이션은 보장하지 않는다.
- `name`, `address`는 문자열. 도로명 주소 우선·지번 대체, 이름의 검색 강조 태그는 제거한다. 주소 검색 결과 이름은 주소다.
- `position`은 WGS84 **[경도, 위도]** 배열. 지역 검색 mapx/mapy는 10^7로 나누어 도 단위로 변환한다. 위치를 저장하는 API는 아니다.
- `distanceM`은 기준 좌표가 있으면 구면 직선거리(m), 없으면 null. 도보 이동 거리가 아니다.
- 외부 호출은 서버에서 수행한다. 연결 1초·두 소스 전체 5초·소스별 응답 128 KiB 제한, 자동 재시도·리다이렉트 없음. 한 소스라도 실패하면 부분 결과 대신 503이다.
- 오류: `400 VALIDATION_ERROR`(검색어/좌표), `401 UNAUTHORIZED`(회원 인증), `503 SERVICE_UNAVAILABLE`(비활성·외부 인증/제한/장애·시간/크기 초과·잘못된 응답). 외부 오류 원문·검색어·좌표·Secret은 로그/오류에 포함하지 않는다.
- 프론트는 최신 응답만 표시하고 결과 선택 시 핀을 이동한다. 확정한 이름·주소·좌표는 기존 G01/G04로 저장한다. 지도 터치 좌표의 Reverse Geocoding은 제외한다.
- 설정·주입법은 [백엔드 안내](../../../backend/README.md)의 만남 장소 검색 설정을 따른다. 이 계약은 실제 배포·연결 완료를 뜻하지 않는다.

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
  "goalPaceSecPerKm": 360,
  "groupGuidePaceSecPerKm": 350,
  "comfortRange": { "fastSecPerKm": 330, "slowSecPerKm": 370 },
  "myFit": { "recentPaceSecPerKm": 356, "readinessScore": 82 }
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
| `goalPaceSecPerKm` | number / null | O | **방장 목표**(`targetDistanceM`·`targetDurationSec` 환산) 페이스. 환산 불가면 null. 추천 페이스와 별개이며 `groupGuidePaceSecPerKm`으로 대체하지 않는다. |
| `groupGuidePaceSecPerKm` | number / null | O | **추천 공동 페이스**(참가자 정보 기반 파생값, S15P31E105-419). `SCHEDULED`: 참가자 `user_profiles.average_pace`의 중앙값(유효값 없는 참가자 제외). 유효 참가자 0명이면 null. 방장 목표 환산값을 추천값으로 쓰지 않는다. DB 신규 컬럼 없음. |
| `meetingPlaceName` | string / null | O | group_runs.meeting_name. 미지정은 null. |
| `meetingAddress` | string / null | O | group_runs.meeting_address. 미지정은 null. |
| `cancellation` | object / null | O | **CANCELLED일 때만** 채운다. 그 외 status는 null. S15P31E105-469. |
| `cancellation.reason` | string | 조건부 | `group_runs.cancel_reason`. CANCELLED이면 필수. |
| `cancellation.message` | string / null | 조건부 | **항상 null(조회)**. 요청 `cancelMessage`는 DB에 저장하지 않으며 알림 일회 전송용이다. |
| `cancellation.byNickname` | string | 조건부 | `host_id` 회원의 닉네임. 호스트만 취소 가능. |
| `cancellation.byRole` | string | 조건부 | 항상 `"HOST"`. |
| `comfortRange` | object / null | O | **참가자 편한 페이스 범위**(파생값, 미저장, S15P31E105-470). 대기방 `WaitingRoom.comfortRange`의 출처이며 별도 대기방 API 없이 G03으로 받는다. 계산은 아래 "페이스 적합도·편한 범위 계산" 참고. 근거가 없으면 null. |
| `comfortRange.fastSecPerKm` | integer | 조건부 | 빠른 쪽 경계(sec/km, 더 작은 값). `comfortRange`가 있을 때만 존재. |
| `comfortRange.slowSecPerKm` | integer | 조건부 | 느린 쪽 경계(sec/km, `fastSecPerKm` 이상). |
| `myFit` | object / null | O | **요청자 본인**의 "내 페이스와 잘 맞아요" 근거(파생값, S15P31E105-470). 다른 참가자 값은 담지 않는다. 최근 완료 기록 페이스가 없으면 null. |
| `myFit.recentPaceSecPerKm` | integer | 조건부 | 본인 `COMPLETED` 세션 `average_pace` 최신 최대 5개 산술평균(반올림). 프로필 usualPace 미사용. |
| `myFit.readinessScore` | integer / null | 조건부 | 본인 최신 준비도(R02와 같은 기준, 반올림 정수). 미산출·건강정보 미동의면 null. |

**사용 흐름과 응답 판단**

모집·대기방에서 서버에 적용된 일정·장소·코스·목표를 확인한다. 그룹 목표 페이스는 거리·시간에서 파생하며 미설정은 null이다. 취소된 그룹은 `cancellation`으로 사유·호스트를 보여 주고, 남긴 말 카드는 `message`가 null이면 숨긴다. `myFit`·`comfortRange`는 최근 기록·준비도 파생값이다.

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

- 대기방 `groupGuidePaceSecPerKm`은 조회 시점의 참가자 `user_profiles.average_pace` 중앙값으로 **파생 계산**한다(목표 환산값 아님, 유효 0명이면 null). GET은 쓰기·알림·SSE 등 부수효과를 만들지 않는다.

#### 페이스 적합도·편한 범위 계산 (S15P31E105-470)

`myFit`·`comfortRange`와 G07 `readinessScore`는 DB 신규 컬럼·마이그레이션 없이 기존 `running_sessions`와 `daily_readiness`에서 조회 시점에 **파생 계산**한다. 온보딩 프로필(`user_profiles.average_pace`, 사용자 평소 페이스)은 이 값들의 근거로 쓰지 않는다(`comfortRange`의 폴백이 쓰는 `groupGuidePaceSecPerKm`만 기존 규칙대로 프로필 중앙값이다). GET은 쓰기·알림 같은 부수효과를 만들지 않는다.

- **최근 페이스(사용자별)**: 해당 사용자의 `running_sessions` 중 `status = COMPLETED`, 미삭제(`deleted_at IS NULL`), `average_pace`가 양수인 세션을 `ended_at`(없으면 `started_at`) 최신순으로 최대 5건 가져와 `average_pace`의 산술평균을 정수(sec/km)로 반올림한다(0.5는 올림). 조건에 맞는 세션이 없으면 null. 개인 러닝과 그룹런 세션을 구분하지 않는다.
- **`myFit`**: 요청자의 최근 페이스가 null이면 `myFit`은 null이다. 아니면 `{ recentPaceSecPerKm: 요청자 최근 페이스, readinessScore: 요청자 최신 준비도 또는 null }`. 요청자가 아직 참가하지 않았어도 계산한다.
- **최신 준비도(사용자별)**: R02와 같이 `daily_readiness`에서 `readiness_date`가 가장 늦은 1건(날짜 필터 없음)의 `readiness_score`를 정수로 반올림한다. R02와 같은 조건으로 활성 회원이고 건강정보 동의(`health_data_access = AGREEE`)가 있어야 하며, 결과가 없거나 동의가 없으면 null이다. 조회 시점에 동의를 철회한 회원의 값은 노출하지 않는다.
- **`comfortRange`**: 해당 그룹런 참가자(요청자의 참가 여부와 무관) 각각의 최근 페이스를 구해 null을 제외한다. 값이 2개 이상이면 `[최솟값, 최댓값]`(정수 sec/km, `fastSecPerKm` = 최솟값, `slowSecPerKm` = 최댓값). 2개 미만이면 `groupGuidePaceSecPerKm`이 있을 때 `groupGuidePaceSecPerKm ± 20`초(빠른 쪽은 1 미만으로 내리지 않음)이고, 추천 페이스도 없으면 null이다.
- **FE 대응**: `GroupRunDetail.myFit` ← G03 `myFit`(readinessScore가 null일 수 있어 FE 타입은 `number | null`로 맞춰야 한다), `WaitingRoom.comfortRange` ← G03 `[comfortRange.fastSecPerKm, comfortRange.slowSecPerKm]`, `GroupRunParticipant.readinessScore` ← G07 `items[].readinessScore`.

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
  ],
  "participantCount": 1,
  "readyCount": 1
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 그룹 참가자의 역할·준비·세션 연결 상태 목록. `session_id` null 행도 포함한다(대기방 구성원). |
| `participantCount` | integer | O | `group_run_participants` 해당 그룹 행 수(session null 포함). **대기방 인원**. G16와 동일 의미(S15P31E105-499). |
| `readyCount` | integer | O | 그중 `ready=true` 행 수. G16와 동일 의미(S15P31E105-499). |

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
| `items[].readyStatus` | string | O | `group_run_participants.ready` 기준. true→READY, false→WAITING. G16에서 변경. |

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].readinessScore` | integer / null | O | 해당 참가자의 **최신 준비도**(S15P31E105-470, 반올림 정수). `readyStatus`(대기방 준비 버튼)와 **별개**. 최신 1건 선택·동의 조건은 G03 "페이스 적합도·편한 범위 계산"의 최신 준비도 규칙과 같다. 미산출·건강정보 미동의면 null. |

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
- `participantCount`·`readyCount`는 `items`와 같은 조회 결과에서 집계한다. session null을 제외하지 않는다. 별도 화면 입장(presence) 상태는 두지 않는다.
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
| 미정 사항 | 없음 |
| 비고 | 그룹 시작 승인과 개인 워치의 실제 시작 결과를 구분 |

### 설명

그룹장이 그룹런 시작을 요청한다. 서버는 대상 참가자의 개인 세션을 확인하고 시작 명령을 승인한다. 각 폰은 승인된 명령을 워치에 전달하고 실제 시작 결과를 서버에 보고한다. 서버의 시작 승인과 워치의 실제 측정 시작은 구분하며, 실제로 시작한 참가자만 운동 진행·종료 판정에 포함한다.

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

없음.

### Response

`200 OK`

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `participants` | object[] | O | 서버가 확정한 참가자별 시작 명령과 처리 결과. 재요청도 최초 승인 대상과 같은 세션 목록을 반환 |
| `participants[].sessionId` | integer (int64) | O | 시작 명령이 연결된 개인 세션 ID |
| `participants[].commandId` | integer (int64) | O | 서버가 발급한 START 명령 번호(session_control_events.id). 같은 요청을 다시 보내도 같은 번호 반환 |
| `participants[].result` | string (enum) | O | 최초 승인은 PENDING(워치 실행 결과 대기). 같은 요청의 재응답은 현재 결과인 PENDING / APPLIED(실제 시작 확인) / REJECTED(시작 거절) / UNKNOWN(실행 여부 미확인) 중 하나 |
| `participants[].expectedVersion` | integer (int64) | O | 해당 START 명령을 승인할 때 기준으로 삼은 버전. 승인 뒤 갱신된 최신 stateVersion과 구분 |
| `participants[].startedAt` | string (date-time, UTC) / null | O | 서버에 실제 시작이 확정된 개인 세션의 started_at. 최초 승인 시 null이며 실제 시작 확인 후 시각 반환. 필드 자체는 생략하지 않음 |

최초 승인 응답 예시:

```json
{
  "participants": [
    {
      "sessionId": 5001,
      "commandId": 501,
      "result": "PENDING",
      "expectedVersion": 1,
      "startedAt": null
    }
  ]
}
```

200은 그룹 시작 승인을 뜻하며 워치의 실제 시작 완료를 뜻하지 않는다. 서버는 그룹 행을 먼저, 연결 세션 행을 ID 순서로 잠근 뒤 아래 대상·권한·준비 조건을 확인한다. 최초 승인에서는 그룹을 RUNNING으로 바꾸고 모든 대상의 START를 한 트랜잭션으로 저장한다. 하나라도 불충족이면 그룹 상태와 모든 명령 생성을 함께 롤백한다. 요청 해시·별도 그룹 명령 식별자는 추가하지 않는다. 대기방 `ready`는 G16 표시용이며 S08 워치 준비·G09 START 승인 근거로 쓰지 않는다.

**시작 대상과 준비 확인**

- 현재 참가 관계에 연결된 미삭제 READY 개인 세션 전체를 새 시작 대상으로 삼는다. session_id가 없는 참가자와 CANCELLED/INTERRUPTED/COMPLETED 세션은 시작 대상에서 제외한다. 기존 참가 관계·기록을 삭제하거나 새 개인 세션을 자동 생성하지 않는다. 대상이 없으면 `409 INVALID_GROUP_STATE`다. 연결된 RUNNING/PAUSED 개인 세션이 있으면 `409 INVALID_SESSION_STATE`로 거절한다.
- 각 대상의 소유자가 해당 참가자인지, 등록·연결된 현재 제어기기가 본인 WATCH인지, 필요한 동의·ACTIVE 코스·현재 그룹 목표·신규 프로토콜(stateVersion≥1) 조건을 만족하는지 확인한다. READY 대상 중 조건이 맞지 않는 참가자를 조용히 제외하고 나머지만 승인하지 않는다.
- 서버가 잠금 아래 읽은 현재 stateVersion을 각 START의 expected_version으로 저장한다. 다른 제어가 PENDING/UNKNOWN이면 전체 승인을 보류한다. 그룹 목표·참가/취소·세션 연결 변경도 같은 그룹 잠금, 개인 목표·BPM·제어는 같은 세션 잠금으로 직렬화한다. 승인 전 변경이 먼저 확정되면 그 상태를 검사하고, 승인 후 목표 변경은 미확정 START 때문에 거절한다.
- S08 REPORT_PREPARED는 준비 이력을 저장하지 않는다. G16의 대기방 표시도 특정 세션 버전에 대한 워치 준비 증거를 대신하지 않는다. 각 폰은 현재 목표·버전으로 워치를 준비시키며, 워치는 ready=true로 실제 준비한 버전과 START_AUTHORIZED.expectedVersion이 일치할 때만 실행한다. 준비 실패·버전 불일치는 S03 RESULT/REJECTED로 보고한다. 서버 승인만으로 전원 준비·실제 시작 성공을 보장하지 않는다.

**그룹 세션 연결의 불변조건**

개인 세션을 참가 관계에 연결하는 내부 처리는 해당 그룹→세션 순서로 잠그고, 본인·미삭제 READY·신규 프로토콜과 START 승인 이력이 없음을 확인한다. 한 개인 세션을 둘 이상의 그룹 참가 관계에 연결하지 않는다. 기존 START가 REJECTED여도 개인 운동 이력이 있는 세션을 그룹 준비 세션으로 재사용하지 않는다. 구체 연결 API·호출 시점은 별도 설계하되 이 조건을 우회해서는 안 된다.

개인 S03 REQUEST는 세션 잠금 후 그룹 연결 여부를 다시 검사한다. 개인 START 승인이 먼저면 뒤의 그룹 연결을 거절하고, 그룹 연결이 먼저면 개인 REQUEST를 거절한다. 연결 쓰기는 같은 세션 잠금 아래 다른 그룹 연결도 재검사한다. 이 조건과 승인 후 연결 보존으로 해당 그룹 세션의 유일한 START가 G09에서 생성된 것임을 보장하며, 기존 개인 START를 최초 그룹 승인으로 오인하지 않는다. DB UNIQUE가 아닌 서비스 검사 책임이며 새 컬럼은 추가하지 않는다.

**동일 출발 재요청**

인증·현재 호스트 권한을 확인한 뒤 이미 승인된 그룹 시작이 있으면 최초 START 행·참가 관계에서 같은 명령과 현재 결과를 반환한다. 현재 세션 버전·상태·기기·코스가 달라졌어도 시작 대상을 다시 고르거나 새 명령을 만들지 않는다. 그룹이 이미 종료됐어도 기존 승인 결과 확인은 허용하며 실제 동작을 다시 실행하지 않는다. 승인 뒤 참가 관계·세션 연결은 최초 대상 복원이 가능하도록 유지한다. G09 승인 전에 그룹 연결 세션에 개인 S03 REQUEST로 START를 만드는 우회는 허용하지 않는다.

각 폰은 승인된 START_AUTHORIZED를 전달하고 실제 결과는 개인 S03 RESULT로 보고한다. 이미 승인된 시작을 S03 REQUEST로 새로 만들지 않는다. 실제 started_at이 확정된 참가자만 진행 판정에 포함한다. 미확인·실패를 성공으로 표시하거나 다른 참가자의 실제 운동을 롤백하지 않는다.

### 오류 응답

오류 본문은 `code`, 사용자 안내용 `message`, 추가 설명용 `details` 객체로 반환한다. 다음 표는 G09의 확정 오류 계약이다. 입력 오류의 details에는 필드 이름과 사유만 넣으며 토큰·건강·GPS 값이나 권한 밖의 세션·기기 정보는 넣지 않는다.

| HTTP·코드 | 발생 조건 | 클라이언트 처리 |
| --- | --- | --- |
| `400 VALIDATION_ERROR` | 요청 본문을 보내거나 경로 groupRunId가 양의 int64 범위를 벗어남 | 잘못된 입력 수정, 같은 입력 자동 재시도하지 않음 |
| `401 UNAUTHORIZED` | Access Token 누락·만료·위변조 | 공통 인증 복구 절차 적용, 인증 실패 상태에서 시작 요청 반복하지 않음 |
| `404 GROUP_NOT_FOUND` | 요청한 그룹런이 존재하지 않음 | 그룹런을 찾을 수 없다는 안내 후 목록으로 이동 |
| `403 NOT_HOST` | 그룹런은 존재하지만 요청자가 현재 그룹장이 아님 | 그룹장만 시작할 수 있다는 안내, 시작 요청 중단 |
| `403 SESSION_FORBIDDEN` | 서버가 확인한 연결 세션의 소유자가 해당 참가자와 다름 | 대기방의 세션 연결을 확인하고 정합성 문제 해결 전 시작하지 않음 |
| `404 SESSION_NOT_FOUND` | 참가 관계에 session_id가 있으나 해당 세션이 없거나 삭제됨 | 해당 참가자의 개인 세션 연결·준비를 확인한 뒤 출발 재요청 |
| `403 DEVICE_FORBIDDEN` | 연결 세션의 현재 제어기기가 참가자 소유의 등록·연결된 WATCH가 아님 | 해당 참가자의 워치 등록·연결·제어기기 확인 |
| `403 CONSENT_REQUIRED` | 시작 대상 참가자에게 필요한 건강·위치 수집 동의가 없거나 철회됨 | 해당 참가자에게 동의 확인 안내, 동의 전 시작하지 않음 |
| `403 COURSE_INACCESSIBLE` | 새 시작 승인에 사용할 코스가 MERGED 또는 BLOCKED | 대표 코스 또는 다른 ACTIVE 코스를 선택해 다시 준비 |
| `404 COURSE_NOT_FOUND` | 새 시작 승인에 사용할 코스가 존재하지 않음 | 코스 재조회·재선택 후 다시 준비 |
| `409 INVALID_GROUP_STATE` | 기존 승인 없는 새 요청에서 그룹이 SCHEDULED가 아니거나 시작 대상 READY 세션이 없음 | 현재 그룹 상태 표시, 추가 시작하지 않음 |
| `409 INVALID_SESSION_STATE` | 연결 세션이 이미 RUNNING/PAUSED이거나 READY 대상이 구버전(stateVersion=0) 또는 현재 그룹 목표와 불일치 | 해당 참가자의 현재 세션·목표 재조회 후 준비 상태 확인 |
| `409 COMMAND_PENDING` | 새 시작 대상의 개인 세션에 PENDING 또는 UNKNOWN 명령이 남아 있음 | 기존 명령 결과 확인, 실패로 추측해 새 명령을 만들지 않음 |
| `429 TOO_MANY_REQUESTS` | 서버가 요청 제한을 적용함 | Retry-After가 있으면 해당 시간 이후 재시도, 요청 제한을 우회하지 않음 |
| `503 SERVICE_UNAVAILABLE` | DB 등 필수 의존 서비스의 일시 장애로 시작 승인을 완료·확인할 수 없음 | 상태 확인 후 필요한 경우 같은 본문으로 최초 포함 최대 3회 시도, 결과 불명확 시 시작 확인 중으로 표시 |
| `500 INTERNAL_ERROR` | 예상하지 못한 서버 오류 | 시작 상태 재조회, 실제 시작 여부를 확인하기 전 새 명령 생성·자동 재실행하지 않음 |

예: 현재 그룹장이 아닌 사용자가 시작을 요청한 경우.

```json
{
  "code": "NOT_HOST",
  "message": "그룹장만 그룹런을 시작할 수 있습니다.",
  "details": {}
}
```

**검사 순서와 정보 노출 방지**

1. 인증과 경로·본문 형식을 확인한다. 그룹이 없으면 GROUP_NOT_FOUND, 존재하지만 현재 그룹장이 아니면 NOT_HOST를 반환하고 참가자 세션을 조회하지 않는다.
2. 그룹 행을 먼저 잠그고 현재 호스트를 재확인한다. 이미 승인한 그룹 시작이 있으면 최초 START 결과를 반환한다. 현재 버전으로 재승인하거나 준비·코스 조건을 다시 적용해 기존 결과 확인을 막지 않는다. 권한 확인 없는 결과 반환은 허용하지 않는다.
3. 새 승인만 SCHEDULED를 검사하고 현재 참가 관계에서 연결 세션을 찾는다. 세션 행을 ID 오름차순으로 잠근 뒤 대상·소유자·현재 기기·동의·코스·목표·상태와 미확인 명령을 재검사한다. 연결되지 않은 참가자는 제외하지만 존재해야 할 연결 세션이 없거나 삭제됐으면 SESSION_NOT_FOUND다. 서버가 고른 세션·기기 식별자를 클라이언트 입력처럼 신뢰하지 않는다.
4. 현재 버전을 START의 승인 버전으로 저장하고 그룹 시작 상태와 모든 명령을 함께 확정한다. 하나라도 실패하면 전체 롤백한다. 실패 응답에는 건강·위치 자료·기기 ID·권한 밖 세션 정보를 포함하지 않는다. 새 승인과 재요청 모두 그룹장에게 필요한 위 Response 필드만 반환한다.

**승인 뒤 워치 실행 실패**

G09가 200을 반환한 뒤 워치가 시작을 거절하거나 응답하지 않는 경우는 G09의 전체 실패로 바꾸지 않는다. 실제 결과는 각 개인 S03 RESULT의 REJECTED·UNKNOWN으로 저장하고 S02/S10으로 확인한다. 준비 버전 일치 여부는 워치에서도 검사하며, 서버 승인만으로 실제 시작을 확정하지 않는다. 이미 시작한 다른 참가자의 운동을 되돌리거나 새 그룹 시작 명령을 만들지 않는다.

### 처리 규칙

- 실제 시작이 확정되면 남아 있는 시작 임박 예약을 무효화하고 참가자에게 시작 상태를 전달한다. 일반 소식 알림의 채택과 별개로 운동 상태 동기화는 수행한다.

- 각 참가자가 S01·S03을 따로 순서대로 호출해야만 그룹 시작이 완성되는 흐름으로 두지 않는다. 기존 준비 세션은 참가자별로 식별하고 재요청으로 중복 생성·시작하지 않는다.
- 실제 시작 확인과 부분 실패 처리는 위 Response의 계약을 따른다. 시작 상태 전달은 운동 상태 동기화이므로 선택 소식 알림 설정에 의존하지 않는다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 그룹 상태는 ERD의 SCHEDULED / RUNNING / COMPLETED / CANCELLED를 사용한다.
- 참가자 개인 세션의 시작 상태와 실제 결과는 S03 계약을 따른다.

### 미정 사항

없음.

## G10 그룹런 실시간 현황·순위

`GET` `/api/v1/group-runs/{groupRunId}/live`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | GRP-001~004, GRP-006~008 / MAT-004 |
| 관련 Jira | S15P31E105-424 |
| 미정 사항 | 아래 [확장]만 남김. MVP 순위·격차 정책은 2026-11-05 확정 |
| 비고 | GET은 최신 스냅샷 읽기만 한다. 순위 재계산·알림·푸시를 트리거하지 않는다 |

### 설명

참가자가 그룹런 진행 중 화면·워치 복구에 쓰는 **실시간 순위·앞뒤 격차** 조회다.  
지정 코스는 누적 거리 기반 코스 진행으로 비교한다. 자유 그룹 MVP는 누적 거리로 순위를 매기고, 선두 궤적 투영은 궤적 연동 후 확장한다. GPS는 지도 표시용이며, 순위 키를 GPS 최근접 투영만으로 두지 않는다.

### 인증 및 권한

- 로그인 사용자이며 해당 그룹런 **참가자**만 조회한다.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 건강·위치 **원본**을 이 API 응답에 넣지 않는다. 파생된 순위·격차·측정 시각만 노출한다.
- 그룹 참가는 참가자 간 **파생 거리·순위** 공유를 전제한다. 건강정보 동의를 철회해도 진행 중 세션·기존 표본은 삭제·종료되지 않는다(W04). 철회 이후 새 측정 batch는 W07이 거절하며, 철회 직전 표본의 파생값은 최대 `GPS_TTL`(MVP 60초) 동안 live에 남을 수 있다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | 그룹런 식별자 |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "groupRunId": 101,
  "status": "RUNNING",
  "groupGuidePaceSecPerKm": 360,
  "courseId": null,
  "updatedAt": "2026-11-05T03:00:00Z",
  "loadAlert": { "memberCount": 1, "nextPaceSecPerKm": 375 },
  "participants": [
    {
      "userId": 101,
      "rank": 1,
      "aheadCount": 0,
      "behindCount": 2,
      "gapToAheadM": null,
      "gapToBehindM": 35,
      "progressM": 1200.5,
      "paceSecPerKm": 320,
      "measuredAt": "2026-11-05T02:59:50Z",
      "stale": false
    },
    {
      "userId": 102,
      "rank": null,
      "aheadCount": null,
      "behindCount": null,
      "gapToAheadM": null,
      "gapToBehindM": null,
      "progressM": null,
      "paceSecPerKm": null,
      "measuredAt": "2026-11-05T02:58:50Z",
      "stale": true
    }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `groupRunId` | integer (int64) | O | `group_runs.id` |
| `status` | string | O | `group_runs.status` (`SCHEDULED`\|`RUNNING`\|`COMPLETED`\|`CANCELLED`) |
| `courseId` | integer (int64) / null | O | `group_runs.course_id` |
| `groupGuidePaceSecPerKm` | number / null | O | **추천 공동 페이스**(참가자 정보 기반 파생값, 중앙값 집계). 방장 목표 환산 `goalPaceSecPerKm`과 별개. 산출 규칙은 아래 `groupGuidePaceSecPerKm` 절. 산출 불가면 null |
| `updatedAt` | string (ISO 8601 UTC) | O | `group_runs.updated_at` |
| `loadAlert` | object / null | O | 멤버 부담 알림(파생). 부담 참가자가 없거나 `RUNNING`이 아니거나 `groupGuidePaceSecPerKm`이 null이면 null. 규칙은 아래 `loadAlert` 절 |
| `loadAlert.memberCount` | integer | loadAlert 존재 시 O | 부담 참가자 수(1 이상) |
| `loadAlert.nextPaceSecPerKm` | integer | loadAlert 존재 시 O | 그룹이 늦출 안내 페이스(sec/km). `groupGuidePaceSecPerKm + 15` |
| `participants` | array | O | 참가자별 현황. 저장 컬럼 직접 대응이 아닌 **파생 응답** |
| `participants[].userId` | integer (int64) | O | 참가자 사용자 ID |
| `participants[].rank` | integer / null | O | 1부터. 동률은 같은 값. 순위 집합 밖·그룹 비RUNNING이면 null |
| `participants[].aheadCount` | integer / null | O | 앞선 참가자 수(**동순위 제외**). 비순위면 null |
| `participants[].behindCount` | integer / null | O | 뒤진 참가자 수(동순위 제외). 비순위면 null |
| `participants[].gapToAheadM` | number / null | O | 바로 앞 군집(더 좋은 progress) 최근접과의 진행 거리 차(m). 선두·비순위면 null |
| `participants[].gapToBehindM` | number / null | O | 바로 뒤 군집 최근접과의 차(m). 꼴등·비순위면 null |
| `participants[].progressM` | number / null | O | 순위에 쓴 진행 거리(m). 비순위면 null |
| `participants[].paceSecPerKm` | integer / null | O | 참가자 **실시간 실측 페이스**(sec/km, S15P31E105-598). 순위 표본 `measuredAt` 기준 최근 60초 `running_metric_samples.speed`(>0) 산술평균으로 `round(1000 / meanSpeedMps)`. `stale=true`이거나 산출 불가면 null. 그룹이 비`RUNNING`이면 null. 종료 후 `running_sessions.average_pace`·AI 권장 페이스는 쓰지 않는다. 선두–후미 간격은 `progressM` 차이로 클라이언트가 계산하며 `gapM`/`spreadM`은 두지 않는다 |
| `participants[].measuredAt` | string (ISO 8601 UTC) / null | O | 조회에 반영된 **최신 표본 시각**(순위 제외여도 참고용으로 반환). 표본이 없거나 그룹이 비`RUNNING`이면 null. DB 신규 컬럼 없음 |
| `participants[].stale` | boolean | O | **순위 집합 밖**이면 true(TTL 초과·허용 오차 초과 미래 시각·비RUNNING·표본 없음·그룹 비RUNNING 등). GPS 끊김만 뜻하지 않는다. DB 컬럼 없음 |

**사용 흐름**

- 화면 진입·재연결 시 최신 스냅샷을 읽는다.
- GPS 누락·TTL 초과를 순위 0 / 거리 0으로 채우지 않는다.
- 최종 결과는 G14. G10은 실시간 경주용이다.

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `403 NOT_PARTICIPANT` | 비참가자 |
| `404 GROUP_NOT_FOUND` | 그룹 없음 |
| `401 UNAUTHORIZED` | 미인증 |
| `400 VALIDATION_ERROR` | path 식별자 형식 오류 |

공통 재시도 기준은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준).

### 확정 정책 (MVP) — S15P31E105-424

#### 그룹 상태와 순위 채움

| `group_runs.status` | 순위·격차 필드 |
|---|---|
| `SCHEDULED` | 전원 `rank`/`gap*`/`progressM` = null. 참가자 목록·`groupGuidePaceSecPerKm`만 |
| `RUNNING` | 아래 규칙으로 순위 집합을 채움 |
| `COMPLETED` / `CANCELLED` | 실시간 순위 null(또는 마지막 스냅샷을 유지하지 않음). **확정 순위는 G14** |

#### 순위 집합에 넣는 조건 (`RUNNING`일 때)

다음을 **모두** 만족할 때만 순위에 포함한다.

1. 개인 세션이 실제로 시작됨(`started_at` 있음)이며 세션이 `RUNNING` (일시정지·개인 종료·미시작은 **제외**, rank/gap null)
2. 허용 시각 이하의 거리 표본이 있고 `totalDistanceM`(또는 동등 누적 거리)이 non-null
3. 표본이 **신선**함: `now - measuredAt ≤ GPS_TTL` (MVP 기본 **60초**)
4. 표본 시각이 과도한 미래가 아님: `measuredAt ≤ now + MEASURED_AT_FUTURE_SKEW` (MVP 기본 **5초**). 이를 넘는 표본은 최신 후보에서 제외해 이후 정상 표본이 가려지지 않게 한다

제외 참가자는 `stale=true`, rank/gap/progress null. `measuredAt`은 마지막 반영 표본이 있으면 참고용으로 남긴다. `userId`는 목록에 남긴다.

#### 지정 코스 (`courseId != null`)

- **순위 키:** 워치/폰이 올린 **누적 거리**를 코스 진행으로 쓴다. GPS 좌표는 경로 표시용이다.
- **왕복:** 코스 편도 길이를 `L = courseDistanceM / 2`로 본다(왕편·복편 대칭 전제).  
  - 누적 거리 `d`에 대해 진행 표시값 `progressM = d` (단조 증가; 반환점 이후에도 d는 계속 증가하므로 순위는 `d`로 비교).  
  - UI가 “왕편에서의 위치”가 필요하면 `fold = d <= L ? d : (2L - d)` 같은 **표시용** 접기를 쓸 수 있으나, **등수 비교 키는 누적 `d`** 로 고정한다(돌아오는 중 앞사람을 역전하는 관계를 누적이 보존).
- GPS 최근접 투영만으로 등수를 정하지 않는다(왕복 동일 선 모호성).

#### 자유 그룹 (`courseId == null`)

1. **MVP:** 순위 후보의 누적 거리 `d`만으로 순위를 매긴다(서비스는 궤적을 비워 전달).
2. **확장(비활성):** 선두 bootstrap = 최대 `d`. 선두 궤적≥2점이면 타 참가자를 궤적에 투영. 위치 없으면 `d`로 대체. 속도·헤딩만으로 선두를 정하지 않는다.

#### 동률

- 진행도를 내림차순 정렬한 뒤 **인접** 차이가 허용 오차(MVP: **1m**) 이하면 같은 동률 군집·같은 `rank`(사슬 포함). 경쟁 순위(예: 1,1,3).
- `aheadCount`/`behindCount`는 동률 군집 밖 인원만 센다.
- 바로 앞/뒤 gap은 **인접한 다른 군집**의 최근접 진행도와의 차. 동률 군집만 있으면 해당 gap null.

#### `groupGuidePaceSecPerKm`

- **추천 공동 페이스**이며 방장 목표 환산값(`goalPaceSecPerKm`)이 아니다. 목표 환산값을 추천으로 쓰지 않는다. 집계는 **중앙값(median)**, 그룹 전용 AI API는 없다.
- `SCHEDULED`: 참가자 `user_profiles.average_pace` 중앙값. 유효 0명이면 null.
- `RUNNING`: 참가자별 개인 AI04 `recommendedPace`를 우선하고 없으면 **위와 같은 최근 60초 실측 페이스**를 입력으로 중앙값을 낸다(종료 후 `average_pace` 폴백 아님, S15P31E105-598). 뒤처진 참가자도 포함하며 일시정지·개인 종료 참가자는 제외한다. 유효 입력이 없으면 `SCHEDULED`와 같은 프로필 중앙값으로 폴백(이전 값 저장용 컬럼이 없음)하고, 그것도 없으면 null.
- 개인 SAFETY는 개인 코칭 경로가 우선한다. 중앙값·제외 규칙으로 충분하므로 특정 참가자 때문에 그룹 추천을 따로 낮추지 않는다.
- 파생 계산만 하며 DB 신규 컬럼·마이그레이션, GET 부수효과(쓰기·알림·SSE)는 없다. SSE·변경 이벤트 푸시는 이번 범위 밖(별도 Jira).

#### `participants[].paceSecPerKm`와 `loadAlert` (MVP, S15P31E105-468 · 실측 갱신 S15P31E105-598)

- 개인 페이스(실시간 실측): 순위용 최신 거리 표본의 `measuredAt`을 창 끝으로 두고, 그 시각 포함 이전 **60초** 동안의 `running_metric_samples.speed` 중 양수·유한 값만 산술평균한 뒤 `round(1000 / meanSpeedMps)`(sec/km). AI04 최근 60초 실측 평균과 같은 창·의미다. 순위 집합 밖(`stale=true`), speed 표본 없음, 평균 속도 비양수·비유한 값이면 null. `running_sessions.average_pace`(종료 후 분석값)·AI `recommended_pace`는 개인 페이스에 쓰지 않는다.
- 부담 참가자: 그룹 `RUNNING`이고, `groupGuidePaceSecPerKm`이 있으며, `stale=false`이고 `paceSecPerKm`이 있으며, `paceSecPerKm <= groupGuidePaceSecPerKm - 30`(안내 페이스보다 30초/km 이상 빠름)인 참가자. 경계값 포함.
- `loadAlert`: 부담 참가자가 1명 이상이면 `{ memberCount: 부담 참가자 수, nextPaceSecPerKm: groupGuidePaceSecPerKm + 15 }`, 아니면 null. 그룹이 `RUNNING`이 아니거나 안내 페이스가 null이어도 null. 입력 페이스는 위 실측 `paceSecPerKm`이다.
- 매 GET마다 현재 값으로 파생 계산하며 알림 이력·해제 상태·푸시는 저장하지 않는다(상태·이벤트·알림 부수 효과 없음, DB 변경 없음).

#### 계산 시점·저장

- 측정(W07)이 반영된 뒤 순위 스냅샷을 갱신할 수 있다. **GET `/live`는 재계산·쓰기·알림을 하지 않는다**(읽기 전용).
- MVP 구현이 GET 시점에 파생 계산만 하더라도, 부수 효과(상태 변경·이벤트·알림)는 금지한다.
- 신선도·순위용 **신규 DB 컬럼을 만들지 않는다.** `measuredAt`/`stale`은 기존 `running_metric_samples.measured_at` 등으로 계산한다.

#### 실시간 푸시

- MVP: **없음**. 클라이언트 폴링·재진입 GET.
- 확장 여지는 아래 [확장] 참고.

### 확장 (열려 있음 · MVP 비범위)

| 확장 | 방향 |
|---|---|
| `routeProgressM` 실측 | 워치가 W07 `routeProgressM`을 채우면 지정 코스 순위 키를 누적거리 대신 **코스 방향 진행**으로 교체. 왕복은 폴리라인(왕+복) 누적 길이로 정의하고 `/2` 접기 전제를 폐기 |
| 코스 폴리라인 투영 | 표시·이탈 감지는 GPS→폴리라인 투영. 등수 키와 표시 좌표를 분리한 현재 구조를 유지한 채 투영기만 교체 |
| 자유 그룹 궤적 품질 | 궤적 간소화·노이즈 제거·이탈 참가자 재부착 규칙 강화. bootstrap은 누적거리 유지 가능 |
| 동적 `groupGuidePace` | S15P31E105-419에서 RUNNING 파생(위 `groupGuidePaceSecPerKm` 절)으로 포함됨. 같은 응답 필드로 FE 계약 유지. 변경 푸시(SSE)만 별도 Jira |
| 실시간 채널 | S10 또는 그룹 전용 SSE/WS로 `live` 스냅샷 push. GET 계약은 읽기 복구용으로 유지. 채널이 GET을 대체해 운동 필수 경로가 되지 않게 함 |
| TTL·오차 | `GPS_TTL`, 동률 ε를 설정값화 |
| COMPLETED 스냅샷 | 종료 직후 G10에 마지막 live를 잠시 노출할지 G14만 쓸지 제품 결정 |

### 상태값

저장 상태: `SCHEDULED` / `RUNNING` / `COMPLETED` / `CANCELLED`.  
(문서 일부의 RECRUITING/READY는 참가자 ready 표시용이며 그룹 저장 상태가 아니다.)

### 미정 사항

- [x] MVP 순위·격차·왕복·선두·동률·TTL·guide pace·GET 읽기 전용 (2026-11-05)
- [ ] 실시간 push 채널 메시지 스키마 (확장)
- [ ] `routeProgressM` 전환 일정 (워치 실측 연동 후)


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

종료 신호 미수신 등 예외 상황에서 해당 그룹런의 그룹장(호스트)이 그룹 전체를 강제 종료한다. 정상 흐름에서는 승인된 START가 모두 확정되거나 명시 중단으로 정리되고, 실제 시작 참가자 전원이 종료하면 자동 종료하므로 별도 호출하지 않는다.

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
- 강제 종료는 목표 달성이나 전원 완주를 의미하지 않는다. 기록은 강제 종료 기준 시각까지 반영한다. 개인 END가 확정되기 전까지 도착한 batch 중 기준시각 이전 측정값을 집계하고, 이후 측정값은 그룹 집계에서 제외한다. 개인 END 확정 후 새 batch는 거절하고 저장된 동일 batch에는 기존 ACK를 반환한다. 개인 종료 후 복구·자동 재집계는 하지 않는다. 그룹 기준시각과 개인 실제 종료시각은 아래 그룹 종료·분석 연결 계약을 따른다.

- 종료 신호 미수신 등 예외 상황에서 해당 그룹런의 그룹장(호스트)이 그룹 전체를 강제 종료한다. 정상 흐름에서는 승인된 START가 모두 확정되거나 명시 중단으로 정리되고, 실제 시작 참가자 전원이 종료하면 자동 종료하므로 별도 호출하지 않는다.
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
| `cancelReason` | string | O | WEATHER/PERSONAL/LACK_OF_PARTICIPANTS/LOCATION_ISSUE/OTHER. `group_runs.cancel_reason`에 저장. |
| `cancelMessage` | string | X | 멤버 알림용 남길 말(최대 100자). **길이만 검증·저장하지 않음**. 알림 경로가 연결되면 본문에 일회 전달하고, 없으면 discard. 이후 저장이 필요하면 스키마 추가. |

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

- 취소하면 크루 멤버 전원(참가 여부와 무관, 취소자 본인 제외)에게 앱 내 알림함 행을 만든다(S15P31E105-458, [notifications.md](notifications.md)). 저장 코드는 기존 ERD `GROUP_RUN_PARTICIPATION_CANCELLED`(참가 취소 알림이 아님). `notifications.groupRun`이 false인 수신자는 행을 만들지 않는다. 취소한 그룹런은 되돌릴 수 없다. `cancelMessage`가 있으면 알림 본문에만 실을 수 있고 DB·G03에는 남지 않는다.
- 취소된 그룹런은 내 크루 목록에서 빠지고, 상세 조회(G03)는 `cancellation`(사유·호스트 닉네임·역할 HOST, message는 null)과 함께 계속 열 수 있다.
- 그룹런 시작 전 호스트 취소. 취소자 컬럼은 두지 않고 `host_id`로 파생한다.
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
| 미정 사항 | 그룹 `goalAchieved` 집계만 남음. 함께 거리·평균 페이스·최대 간격은 2026-11-05 확정 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

그룹 종료 후 자동 정리된 참가자 기록과 공동 목표 달성 평가 결과를 조회한다. 그룹 루트의 `distanceM`·`averagePaceSecPerKm`·`maxGapM`은 참가자 세션 수치의 **조회 시점 파생값**이며 DB에 저장하지 않는다(S15P31E105-467).

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
  "analysis": { "status": "READY" },
  "hasUnconfirmedStarts": false,
  "distanceM": 4200.5,
  "averagePaceSecPerKm": 365,
  "maxGapM": 799.5,
  "participants": [
    {
      "userId": 101,
      "sessionId": 301,
      "startResult": "APPLIED",
      "state": "COMPLETED",
      "analysis": { "status": "READY" },
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
| `distanceM` | number / null | O | **함께 달린 거리(m)**. 집계 대상 참가자 `actualDistanceM`의 최솟값. 파생·미저장. 아래 집계 규칙. FE `GroupRunResult.distanceM`. |
| `averagePaceSecPerKm` | integer / null | O | **그룹 평균 페이스(초/km)**. 집계 대상 중 null이 아닌 참가자 `averagePaceSecPerKm`의 산술 평균을 정수로 반올림(`Math.round`). 유효 페이스 0명이면 null. 파생·미저장. FE 동명 필드. |
| `maxGapM` | number / null | O | **최대 간격(m)**. 집계 대상 거리의 max−min. 대상 1명이면 `0`. 파생·미저장. FE `GroupRunResult.maxGapM`. |
| `goalAchieved` | boolean / null (집계 확인 필요) | X | 그룹 단위 목표 달성. **이번 범위 미제공**(참가자별만). ERD 컬럼 없음. |
| `participants` | array | X | 참가자별 결과 목록 |

#### 그룹 집계 규칙 (`distanceM` / `averagePaceSecPerKm` / `maxGapM`)

- **집계 대상:** 실제 시작이 확인되고(`startedAt` 있음 → 응답에서 `actualDistanceM` 후보) `actualDistanceM != null`인 참가자.
- **READY만 채움:** 그룹 `analysis.status`가 `READY`가 아니면 세 필드 모두 null. 잠정 수치를 내려주지 않는다.
- **대상 0명:** 세 필드 모두 null.
- 마이그레이션·신규 컬럼 없음.

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

### 결과 준비 상태 — 온라인 종료·분석 확정 계약

G14는 분석 중·실패를 포함해 `200 OK`로 현재 결과를 반환한다. 다음 필드와 상태 판정이 위 초안의 결과 준비 오류·잠정 결과 설명보다 우선한다. READY 이전의 참가자 수치는 아직 최종 결과가 아닌 값으로 표시한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `analysis` | object | O | 그룹 결과 준비 상태 |
| `analysis.status` | string (enum) | O | PROCESSING(미확인 시작·종료 또는 분석 대기/진행) / READY(최종 결과 준비) / FAILED(집계 대상 분석 실패) |
| `hasUnconfirmedStarts` | boolean | O | 명시 중단하지 않은 미확정 START가 남았는지 여부 |
| `participants[].startResult` | string (enum) / null | O | 해당 세션 START의 PENDING/APPLIED/REJECTED/UNKNOWN. 승인 전이면 null. 세션 상태와 함께 해석 |
| `participants[].state` | string (enum) / null | O | 연결 개인 세션의 S02 state. 세션이 없으면 null. INTERRUPTED와 UNKNOWN 조합은 시작 미확인 중단을 나타낼 수 있음 |
| `participants[].analysis` | object / null | O | 실제 시작한 개인 세션의 분석 상태. 미시작 세션이면 null |
| `participants[].analysis.status` | string (enum) | 조건부 | 개인 분석 객체가 있으면 필수. PENDING/PROCESSING/READY/FAILED/LEGACY |

```json
{
  "groupRunId": 101,
  "targetDistanceM": null,
  "targetDurationSec": null,
  "analysis": { "status": "PROCESSING" },
  "hasUnconfirmedStarts": true,
  "participants": [
    {
      "userId": 101,
      "sessionId": 301,
      "startResult": "UNKNOWN",
      "state": "READY",
      "analysis": null,
      "actualDistanceM": null,
      "movingDurationSec": null,
      "averagePaceSecPerKm": null,
      "goalAchieved": null
    }
  ]
}
```

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_PARTICIPANT` | 참가 권한 | 해당 그룹 참가 관계가 없는 사용자가 참가자 전용 요청을 보냄 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 종료 성공·원본 저장 완료와 분석 준비/실패를 구분한다. 아직 없는 결과나 미측정 값을 0/false로 채우거나 원 요청 전체를 재실행하도록 요구하지 않는다.

**응답·복구 행동:** 결과 준비 중·실패도 `200`과 `analysis.status`로 반환한다. 같은 G14 조회로 현재 결과를 확인하며 그룹 종료나 분석을 재실행하지 않는다.

### 처리 규칙

- 실제 시작 참가자 전원 개인 종료 또는 G12 강제 종료 시 결과 정리를 자동 수행한다. 조회가 결과 생성이나 그룹 종료를 실행시키지 않는다.
- 운동 종료·목표 완주·분석 완료를 구분한다. 개인 END 확정 전후의 지연 batch 경계와 결과 준비 상태는 아래 확정 계약을 따른다.

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
| `readyStatus` | string | O | `group_run_participants.ready` 기준. true→READY, false→WAITING. S08 워치 준비와 별개. |
| `readyCount` | number | O | 해당 그룹에서 `ready=true`인 참가 관계 수. |
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
- 승인된 START가 모두 APPLIED/REJECTED로 확정되거나 S08의 명시 중단으로 정리되고, 실제 시작 참가자 전원이 개인 종료하면 별도 호스트 요청 없이 그룹을 종료한다. START가 PENDING/UNKNOWN인 참가자는 시작 미확인으로 표시하고 자동 종료를 보류한다. 시작이 거절됐거나 명시 중단한 세션은 운동 종료 대기·분석 집계에서 제외한다. 그룹장은 미확인 참가자가 있어도 G12로 강제 종료할 수 있다.
- 공동 페이스·순위·격차·운동 부담·강제 종료는 해당 참가자 앱·워치에 전달한다. 대기방 공동 페이스·준비 상태 변경도 전달 대상으로 설계한다.
- 인터넷 단절 중 그룹 운동 지속·복구는 온라인 MVP 지원 범위 밖이며 연결 오류를 표시한다.
- 정상 종료와 강제 종료의 상태·사유 저장 및 지연 데이터 정합성은 ERD에 맞춰 확정한다. 기존 COMPLETED 값만으로 강제 종료 기록 정책을 확정하지 않는다.
- [자동 처리 요구사항](../requirements.md)를 따른다.

## 173 그룹 종료·분석 연결

G09/G12는 그룹 행과 참가자 세션 행을 ID 순서로 잠근다. 참가자별 명령 ID는 session_control_events.id BIGINT다. 별도 그룹 UUID·요청 해시를 저장하지 않는다. G09는 본문 없는 출발 요청을 받아 현재 참가 관계·연결 세션에서 최초 시작 대상을 결정하고, 현재 그룹 목표·제어 워치·상태 버전을 검사해 각 개인 START를 한 트랜잭션으로 승인한다. 시작 후 참가자 집합을 다른 내용으로 재승인하지 않으며 반복 호출은 기존 START 명령을 반환한다. 그룹은 승인과 개인 실제 시작을 구분하고 실제 시작한 참가자만 운동 진행·분석 집계에 포함한다. 자동 종료 전에는 승인된 START 중 미확정·미중단 세션이 없는지도 확인한다.

G12는 호스트 권한을 검사하고 그룹 종료 상태/기준시각을 한 번 저장한다. 같은 종료 재요청은 기존 시각을 반환한다. 실제 시작이 확인된 참가자에 대해 현재 실행기기(워치 또는 폰)의 END 명령을 생성하고 S02/S10에서 전달하며 현재 실행기기에 이미 승인된 END는 재사용한다. 현재 실행기기의 다른 개인 제어가 미확인이면 그 결과 확인 뒤 END를 생성하며, 조회에 종료 대기를 표시한다. 종료된 그룹에서는 새로운 BPM/재개 명령을 승인하지 않는다. 개인 세션의 서버 상태는 실제 END 결과를 받은 뒤 종료로 확정한다. 그룹 종료 상태가 워치 실제 종료 확인을 뜻하지 않는다.

개인 폰은 현재 실행기기의 종료와 최종 batch ACK를 확인한 뒤 S06 RESULT를 보고한다. 워치 기록은 워치·폰의 보유 batch를, 폰 기록은 전환 때 확보한 워치 batch와 마지막 폰 batch를 확인한다. 연결이 끊긴 워치 안의 미수신 자료는 기다리지 않는다. 실제 appliedAt은 개인 명령 결과에 저장하고 그룹 집계는 그룹 종료 기준시각 이후 샘플을 제외한다. 미응답을 성공으로 간주하거나 실제 종료시각을 만들어 넣지 않는다. 그룹 전체의 장기 복구·강제 재집계는 MVP 범위 밖이다.

개인 기록 삭제(S09)는 그룹 종료 후 G14 분석 상태가 READY/FAILED이고 해당 개인도 삭제 가능 조건을 만족할 때만 허용한다. 삭제 표시된 개인 세션의 참가 관계·집계 원본을 보존해 참가 인원·확정 집계·순위가 바뀌지 않게 한다. 다른 참가자의 결과는 유지하며, 그룹 결과 조회가 삭제된 개인 기록의 상세·경로 조회 권한을 부여하지 않는다. 개인 기록·공유 게시물의 삭제 범위는 [S09](sessions.md#s09-러닝-세션-삭제)를 따른다.

G14의 분석 집계 대상은 실제 시작이 확인된(`started_at`이 있는) 개인 세션이다. START 거절·시작 전 취소·S08 시작 미확인 중단 세션은 분석 완료를 기다리지 않으며 거리·순위·목표 평가에 포함하지 않는다. 참가자 목록에는 해당 상태와 null인 측정값을 표시할 수 있다.

시작이 여전히 PENDING/UNKNOWN이고 명시 중단하지 않은 참가자는 `hasUnconfirmedStarts=true`와 참가자의 `startResult`로 표시한다. 다른 참가자의 조회 가능한 결과를 숨기지는 않되 이 상태를 최종 결과로 확정하지 않는다. G12는 미확정 START 세션을 관리상 중단하므로 종료 후 늦은 START/APPLIED를 집계 대상으로 편입하지 않는다. 그룹을 재개하거나 늦은 기록을 복구하지 않는다.

아래 상태는 그룹이 종료된 뒤 적용한다. 미확인 START 또는 실제 시작했으나 개인 종료가 미확정인 세션이 있으면 PROCESSING이다. 나머지 경우 집계 대상 중 FAILED가 있으면 FAILED, 모두 READY/LEGACY이면 READY, 그 외에는 PROCESSING이다. 대상이 하나도 없고 미확인 START도 없으면 READY와 빈 집계 결과를 반환하고 목표 달성 여부는 null로 둔다. 분석 버전 목록·자동 재계산은 추가하지 않는다. 미완료 결과를 최종 순위로 표시하지 않으며 결측 위치를 가짜 거리로 보완하지 않는다.

PHONE_FALLBACK 참가자도 G12가 현재 폰을 실행기기로 END를 PENDING 승인한다. S02/S10의 SERVER_END는 워치와 같은 숫자 commandId를 전달한다. 폰은 승인된 명령으로 GPS·타이머를 멈추고 마지막 폰 batch의 COMMITTED를 확인해 S06 RESULT를 보고한다. 그룹 종료 뒤 폰으로 인계돼 아직 현재 폰의 END 명령이 없으면 앱이 S06 REQUEST를 자동 호출한다. 기존에 승인된 현재 폰의 END가 있으면 같은 명령을 사용한다. 응답 유실 시 같은 commandId·실제 적용시각으로 결과를 다시 보고한다. 그룹 집계는 그룹 종료 기준시각을 따르며 개인의 실제 종료시각을 바꾸지 않는다.

그룹 강제 종료와 START 결과 저장은 그룹→개인 세션 순서로 잠근다. START/APPLIED가 먼저 확정됐다면 실제 시작한 세션으로 기존 END·저장 절차를 적용한다. G12가 먼저 확정됐다면 미확정 START(PENDING/UNKNOWN)의 세션을 INTERRUPTED·분석 FAILED로 닫고 현재 BPM·pendingCommand는 null, 실제 시작/종료시각은 null로 유지한다. PENDING START는 UNKNOWN(reasonCode=START_UNCONFIRMED_ABORTED)으로 남기고 기존 UNKNOWN은 보존하며 단일 버전을 1 증가시킨다. 재요청에서 다시 증가시키지 않는다. 이는 그룹장의 강제 종료 권한에 따른 관리상 중단이며 S08의 본인 중단과 같은 데이터 보존·늦은 결과 거절 규칙을 적용한다.

중단된 미확인 START의 늦은 결과·새 batch는 409 INVALID_SESSION_STATE로 거절한다. 저장된 동일 batch의 ACK는 재응답한다. 재연결한 워치는 새 동작 전에 최신 그룹 종료/개인 세션 상태를 확인하고 측정·박자를 중지한다. 실제 시작시각·종료 성공을 추정하거나 그룹을 재개하지 않으며, 늦은 시작·미전송 기록 복구는 MVP 범위에서 제외한다.

그룹 종료와 폰 인계는 그룹→개인 세션 순서로 잠그고 최신 모드를 확인한다. 종료된 그룹에서도 이미 시작한 개인 세션의 폰 인계·END는 허용하며 RESUME·BPM은 거절한다. 인계 전 승인된 워치 명령이 미확인이면 UNKNOWN 이력을 남기고 현재 폰의 새 END 승인·결과 보고를 막지 않는다. 워치 재연결로 그룹 운동을 자동 재개하지 않는다.
