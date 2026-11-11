# API 명세 — 러닝 기록·분석

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [H01](#h01-러닝-기록-목록) | 러닝 기록 목록 | GET | `/running-records` | 1차 MVP | 회원 |
| [H02](#h02-러닝-기록-상세) | 러닝 기록 상세 | GET | `/running-records/{sessionId}` | 1차 MVP | 회원 |
| [H03](#h03-구간별-러닝-분석-결과-조회) | 구간별 러닝 분석 결과 조회 | GET | `/running-records/{sessionId}/splits` | 1차 MVP | 회원 |
| [H06](#h06-러닝-통계-요약) | 러닝 통계 요약 | GET | `/running-records/statistics` | 1차 MVP | 회원 |
| [H07](#h07-평균-페이스-추이) | 평균 페이스 추이 | GET | `/running-records/statistics/pace-trend` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

기록의 저장 근거는 running_sessions다. running_metric_samples·running_route_points는 측정/경로 근거이며 원본 GPS 응답을 추가하지 않는다. 구간 분석·기간 통계는 파생 결과다. NULL 결과를 0으로 채우지 않고 개인 원본 기록의 본인 조회 정책을 유지한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 삭제된 운동 기록

[S09](sessions.md#s09-러닝-세션-삭제)로 삭제 표시한 세션은 H01 목록·H06 통계·H07 추이에서 제외한다. H02/H03에서 직접 조회하면 기존 `404 RECORD_NOT_FOUND`를 반환하며 경로·구간·분석 원본을 우회 제공하지 않는다. 새 비교 대상·추천 입력에서도 제외한다.

다른 운동의 기존 비교 참조와 이미 확정된 결과는 소급 변경하지 않는다. 삭제 대상의 상세는 접근 불가로 표시하고 진행 중 비교의 새 안내는 중단하되 현재 운동의 목표·본인 기록은 유지한다. 그룹의 확정 집계와 공용 코스 원본은 S09의 보존 규칙을 따르며 개인 기록 조회 제외와 구분한다.

## H01 러닝 기록 목록

`GET` `/api/v1/running-records`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | REC-001~005 / SYS-002 |
| 관련 화면 | 2.1 홈 과거 러닝 기록, 5.1 전체 기록, 3.2 경쟁 모드 기록 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

완료된 본인 러닝 기록 목록만 조회.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string / object (확인 필요) | X | 서버 발급 불투명 페이지 커서 |
| `limit` | number | X | 조회 결과 최대 개수(최대값 미정) |
| `from` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `to` | string / object (확인 필요) | X | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `courseId` | integer (int64) | X | 선택한 코스 식별자. 개인·그룹 자유러닝은 null/생략 가능 |
| `runType` | string | X | ALL/SOLO/GROUP(5.1 전체·개인·그룹런 탭) |
| `sort` | string | X | LATEST/DISTANCE/PACE(2.1 최신순·거리순·페이스순) |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "id": 101,
      "courseId": null,
      "startedAt": null,
      "totalDistance": null,
      "movingDuration": null,
      "averagePace": null,
      "goalAchieved": null,
      "runType": "GROUP",
      "group": {
        "groupRunId": 55,
        "crewName": "아침크루",
        "finisherCount": 3
      }
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 본인 러닝 기록 요약 목록. |
| `page` | string / object (확인 필요) | X | 페이지 메타데이터는 저장 엔티티가 아니다. cursor/limit 등 공통 페이지 형식 확정 필요. |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].courseId` | integer (int64) / null | O | `running_sessions.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].startedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.started_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].totalDistance` | number / null | O | `running_sessions.total_distance` (NUMERIC(12,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].movingDuration` | integer / null | O | `running_sessions.moving_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].averagePace` | number / null | O | `running_sessions.average_pace` (NUMERIC(10,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].goalAchieved` | boolean / null | O | `running_sessions.goal_achieved` (BOOLEAN). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].runType` | string | O | `SOLO` 또는 `GROUP`. 세션이 `group_run_participants`에 연결되면 GROUP. 파생·미저장(S15P31E105-472). |
| `items[].group` | object / null | O | SOLO이거나 그룹 연결이 없으면 null. |
| `items[].group.groupRunId` | integer (int64) | 조건부 | 연결 `group_runs.id`. FE 6.7 결과 진입용. |
| `items[].group.crewName` | string | 조건부 | 그룹런 소속 크루 이름. |
| `items[].group.finisherCount` | integer | 조건부 | 해당 그룹런에서 `goal_achieved = true`인 참가자 수. |


**사용 흐름과 응답 판단**

기록 목록은 기록 ID·운동시각·거리·이동시간·평균페이스로 상세 진입을 지원한다. 개인/그룹 구분과 정렬 기준의 표시값도 확인한다.

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

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다.

- 3.2 경쟁 모드의 '이 코스의 내 기록'은 `courseId`로 조회한다.
- 그룹런 기록은 `runType=GROUP`과 `group`(crewName·finisherCount·groupRunId)를 함께 내려 6.7 결과로 이동할 수 있게 한다(S15P31E105-472). `finisherCount`는 목표 달성(`goal_achieved=true`) 인원이다.
- 완료된 본인 러닝 기록 목록만 조회.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 기록별 공개 상태 없음. 본인 소유권을 검사한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## H02 러닝 기록 상세

`GET` `/api/v1/running-records/{sessionId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | REC-001~005 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인의 초기 목표와 실제 결과, 화면에 표시할 경로 그림을 함께 제공한다.

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
  "sessionId": 101,
  "targetDistanceM": null,
  "targetDurationSec": null,
  "actualDistanceM": null,
  "movingDurationSec": null,
  "elapsedDurationSec": null,
  "averagePaceSecPerKm": null,
  "averageHeartRate": null,
  "averageCadence": null,
  "goalAchieved": null,
  "courseId": null,
  "courseFromFreeRun": false,
  "targetPaceSecPerKm": null,
  "comparisonSessionId": null
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | `running_sessions.id` (BIGINT). 저장 값은 NULL 불가. |
| `targetDistanceM` | integer / null | O | `running_sessions.goal_distance` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `targetDurationSec` | integer / null | O | `running_sessions.goal_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `actualDistanceM` | number / null | O | `running_sessions.total_distance` (NUMERIC(12,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `movingDurationSec` | integer / null | O | `running_sessions.moving_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `elapsedDurationSec` | integer / null | O | `running_sessions.elapsed_duration` (INTEGER). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `averagePaceSecPerKm` | number / null | O | `running_sessions.average_pace` (NUMERIC(10,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `averageHeartRate` | number / null | O | `running_sessions.average_heart_rate` (NUMERIC(7,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `averageCadence` | number / null | O | `running_sessions.average_cadence` (NUMERIC(8,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `goalAchieved` | boolean / null | O | `running_sessions.goal_achieved` (BOOLEAN). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `routePreviewImageUrl` | string / null (제안) | X | 원본 경로에서 생성한 표시용 이미지 참조. 해당 저장 컬럼·준비 상태는 미정. 원본 GPS 응답으로 대체하지 않는다. |
| `courseId` | integer (int64) / null | O | `running_sessions.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `courseFromFreeRun` | boolean | O | 연결 세션의 코스가 이 자유 러닝 기록으로 만든 개인 코스이면 true(`courses.source_session_id`=세션 ID). 코스가 없거나 일반 코스를 쓴 기록이면 false. `courseId`가 숨겨지는 조회자에게는 false. 항상 포함 |


**사용 흐름과 응답 판단**

초기 거리/시간뿐 아니라 목표 페이스·비교기록과 실제 결과를 보여야 목표달성을 해석할 수 있다. 개인 경로 그림의 준비 여부는 원본 GPS와 분리한다.

기능상 필요한 응답 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `targetPaceSecPerKm` | number / null | O | 최초 goal_pace. 미설정은null. |
| `comparisonSessionId` | integer (int64) / null | O | 비교를 선택한 과거 세션. 미선택은 null. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_OWNER` | 소유권 | 본인 전용 세션·기록이 다른 회원 소유임 |
| `404 RECORD_NOT_FOUND` | 대상 없음 | 요청한 러닝 기록이 없거나 삭제됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 종료 성공·원본 저장 완료와 분석 준비/실패를 구분한다. 아직 없는 결과나 미측정 값을 0/false로 채우거나 원 요청 전체를 재실행하도록 요구하지 않는다.

### 처리 규칙

- H04 원본 GPS 조회는 제공하지 않는다. 경로 그림은 `routePreviewImageUrl` 등 표시용 이미지 참조로 제공하는 계약을 제안한다. 생성 위치·형식·캐시·미생성 상태 표현은 미정이다.
- 본인 기록의 지도 표시용 경로 좌표는 [S11 러닝 경로 조회](sessions.md#s11-러닝-경로-조회)가 제공한다(S15P31E105-549). 기록 ID는 세션 ID와 같다. S11은 출처 선택·정확도·구간 분리를 적용한 표시용 좌표이며 원본 GPS 다운로드가 아니다.
- 이미지도 기록 접근 권한을 적용한다. 공유 게시물에는 게시물 권한에 맞는 표시용 결과만 제공하며 원본 GPS 다운로드 기능을 추가하지 않는다.

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다.

- 운동 종료·기록 반영에 따른 분석·통계 갱신은 내부에서 자동 수행한다. 이 API는 결과를 읽으며 생성·재분석 요청을 요구하지 않는다.
- 종료 직후 데이터 동기화·분석이 진행 중일 수 있다. 잠정 결과·처리 상태·지연 업로드 재집계의 응답 표현은 계약 확정 시 정의한다.

- 본인의 초기 목표와 실제 결과, 화면에 표시할 경로 그림을 함께 제공한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 기록별 공개 상태 없음. 본인 소유권을 검사한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## H03 구간별 러닝 분석 결과 조회

`GET` `/api/v1/running-records/{sessionId}/splits`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | REC-001~005 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

자동 분석한 구간별 페이스·심박·케이던스 결과 조회.

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
  "splits": [
    {
      "startDistanceM": 0,
      "endDistanceM": 1000,
      "paceSecPerKm": 360,
      "averageHeartRate": null,
      "averageCadence": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `splits` | array | O | `running_session_splits` 행 목록. `start_distance` 오름차순. 분석 미완료면 빈 배열 또는 분석 객체 null(173절) |


**사용 흐름과 응답 판단**

각 구간의 범위와 페이스·심박·케이던스로 차트를 그린다. 빈 구간과 분석 준비 중/실패는 구분한다.

기존 목록/결과의 기능상 필요한 하위 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `splits[].startDistanceM` | number | O | `running_session_splits.start_distance` (m). 1km 단위 구간의 시작. |
| `splits[].endDistanceM` | number | O | `running_session_splits.end_distance` (m). 마지막 구간은 1km 미만일 수 있음. |
| `splits[].paceSecPerKm` | number / null | O | `running_session_splits.pace`. 구간 페이스(초/km). 불가 시 null. |
| `splits[].averageHeartRate` | number / null | O | `running_session_splits.average_heart_rate`. 미측정은 null. |
| `splits[].averageCadence` | number / null | O | `running_session_splits.average_cadence`. 미측정은 null. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 RECORD_NOT_FOUND` | 대상 없음 | 요청한 러닝 기록이 없거나 삭제됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `403 NOT_OWNER` | 타인 원본 기록의 구간 분석 조회 |
| `409 ANALYSIS_NOT_READY` | 분석이 아직 준비되지 않음. 정상 준비 상태/오류 구분 미정 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

**응답·복구 행동과의 연결:** 분석 준비 중/실패 계약은 미정이다. 원본 세션 존재와 본인 소유권을 먼저 확인하고 H03 조회를 재시도하며 종료를 다시 요청하지 않는다.

### 처리 규칙

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다.

- 운동 종료·기록 반영에 따른 분석·통계 갱신은 내부에서 자동 수행한다. 이 API는 결과를 읽으며 생성·재분석 요청을 요구하지 않는다.
- 종료 직후 데이터 동기화·분석이 진행 중일 수 있다. 잠정 결과·처리 상태·지연 업로드 재집계의 응답 표현은 계약 확정 시 정의한다.

- 자동 분석한 구간별 페이스·심박·케이던스 결과 조회.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 기록별 공개 상태 없음. 본인 소유권을 검사한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## H06 러닝 통계 요약

`GET` `/api/v1/running-records/statistics`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | REC-002, REC-004 |
| 관련 화면 | 2.1 홈 러닝 분석, 5.1 월 요약, 5.3 러닝 분석 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

기간(주·월·년)별 러닝 횟수·거리·시간·평균 페이스와 세부 분포, 직전 기간 비교를 조회한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `period` | string | O | WEEK/MONTH/YEAR |
| `baseDate` | string (YYYY-MM-DD) | X | 기간 기준일. 기본값 오늘(사용자 시간대) |
| `runType` | string | X | ALL/SOLO/GROUP |

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "runCount": 0,
  "totalDistanceM": 0,
  "totalDurationSec": 0,
  "averagePaceSecPerKm": null,
  "breakdown": [],
  "heartRateZones": [],
  "previousPeriod": null
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `runCount` | number | O | 러닝 횟수 (ERD만으로 응답 형식을 확정하지 않음.) |
| `totalDistanceM` | number | O | 누적 거리 (ERD만으로 응답 형식을 확정하지 않음.) |
| `totalDurationSec` | number | O | 총 시간 (ERD만으로 응답 형식을 확정하지 않음.) |
| `averagePaceSecPerKm` | number / null | O | 평균 페이스 (ERD만으로 응답 형식을 확정하지 않음.) |
| `breakdown` | array | O | 기간(`period`)별 거리 분포. WEEK=요일, MONTH=주, YEAR=월. |
| `heartRateZones` | array | O | 심박 구간 1~5 비율(아래 카르보넨 산식). 산정 불가 시 빈 배열. |
| `previousPeriod` | object / null | O | 직전 동일 길이 기간의 횟수·거리·평균 페이스와 차이. 비교 불가 시 null. |

`breakdown` 항목(확정):

| period | 항목 필드 | 설명 |
|---|---|---|
| WEEK | `day` (MON..SUN), `distanceM` | 해당 주의 요일별 누적 거리 |
| MONTH | `week` (1..), `distanceM` | 해당 월의 주 순서별 누적 거리 |
| YEAR | `month` (YYYY-MM), `distanceM` | 해당 연의 월별 누적 거리 |

`heartRateZones` 항목: `zone` (1..5), `ratio` (0~1, 해당 기간 심박 샘플 비율).

**심박 Zone 산식 (카르보넨, 확정)**

1. `HRmax`: 조회 기준일에 가장 가까운 `daily_health_metrics.max_heart_rate`. 없으면 `220 - 만 나이`(`users.birth_date`).
2. `RHR`: 동일 기준으로 `daily_health_metrics.rhr_bpm`.
3. `HRR = HRmax - RHR`.
4. 목표 심박 = `(HRR × 운동 강도 %) + RHR`.
5. Zone 강도: 1=50–60%, 2=60–70%, 3=70–80%, 4=80–90%, 5=90–100%. 경계 bpm은 상위 Zone에 포함한다(예: 60% 경계는 Zone2).
6. RHR/`HRmax` 산정 불가 또는 기간 내 심박 샘플이 없으면 `heartRateZones`는 `[]`.

**평균 페이스 집계 (확정)**

기간 내 세션의 `running_sessions.average_pace` 중 null이 아닌 값의 산술 평균. 거리·시간은 각각 `total_distance`·`moving_duration` 합산. 페이스 계산 불가면 `averagePaceSecPerKm=null`(횟수 0과 구분).

**기간·시간대 (확정)**

- `period`+`baseDate`로 달력 주/월/년 경계를 잡는다. 주 시작은 월요일.
- 사용자 timezone 컬럼이 없으므로 MVP 기본 시간대는 `Asia/Seoul`이다.

**사용 흐름과 응답 판단**

통계에는 요청기간·실제 집계기간·측정수 또는 결측 표시가 필요하다. 운동 없음의 횟수0과 계산 불가 평균페이스 null을 구분한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_PERIOD` | 조회 기간 | 실제 요청 period의 허용값·baseDate 날짜 형식이 잘못됨. runType은 INVALID_FILTER/VALIDATION_ERROR와 매핑 확인. 최대 기간은 별도 확정 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다.

- 운동 종료·기록 반영에 따른 분석·통계 갱신은 내부에서 자동 수행한다. 이 API는 결과를 읽으며 생성·재분석 요청을 요구하지 않는다.
- 종료 직후 데이터 동기화·분석이 진행 중일 수 있다. 잠정 결과·처리 상태·지연 업로드 재집계의 응답 표현은 계약 확정 시 정의한다.

- 기간 경계는 사용자 시간대 기준으로 계산한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [x] 심박 구간 경계(카르보넨 + `daily_health_metrics` / `birth_date`) — 위 산식 확정
- [x] 요일별/주별/월별 breakdown 단위를 period별로 고정 — WEEK/MONTH/YEAR 매핑 확정
- [ ] `previousPeriod` 세부 필드명 최종 표기
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정


## H07 평균 페이스 추이

`GET` `/api/v1/running-records/statistics/pace-trend`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | REC-002 |
| 관련 화면 | 5.3 러닝 분석 '평균 페이스 추이 최근 6개월' (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

최근 N개월 월별 평균 페이스를 조회한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `months` | number | X | 조회 개월 수. 기본 6(최대값 미정) |

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "month": "2026-10",
      "averagePaceSecPerKm": 360,
      "runCount": 3
    }
  ],
  "changeSecPerKm": null
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 월(YYYY-MM)별 평균 페이스·러닝 횟수 |
| `changeSecPerKm` | number / null | O | 첫 달 대비 마지막 달 페이스 변화 (ERD만으로 응답 형식을 확정하지 않음.) |


**사용 흐름과 응답 판단**

기간별 추이를 그릴 때 누락 월·기록 없는 월과 실제 페이스를 구분한다.

기존 목록/결과의 기능상 필요한 하위 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].month` | string (YYYY-MM) | O | 차트의 기준 월. |
| `items[].averagePaceSecPerKm` | number / null | O | 해당 월 세션 `average_pace`의 산술 평균. 계산 불가면 null. |
| `items[].runCount` | integer | O | 해당 월 집계 러닝 수. |

월 경계는 H06과 동일하게 MVP 기본 시간대 `Asia/Seoul`. 기록 없는 월도 `runCount=0`, `averagePaceSecPerKm=null`로 포함한다. `changeSecPerKm`은 첫 달·마지막 달 모두 페이스가 있을 때만 마지막−첫 달 차이, 아니면 null.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다.

- 운동 종료·기록 반영에 따른 분석·통계 갱신은 내부에서 자동 수행한다. 이 API는 결과를 읽으며 생성·재분석 요청을 요구하지 않는다.
- 종료 직후 데이터 동기화·분석이 진행 중일 수 있다. 잠정 결과·처리 상태·지연 업로드 재집계의 응답 표현은 계약 확정 시 정의한다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] H06에 포함할지 별도 API로 둘지
- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정

## 173 종료 후 분석 상태

H02/H03은 analysis={status}만 포함한다. PENDING/PROCESSING/FAILED이면200과 함께 미완료 상태를 표시하고 아직 없는 분석 객체는null이다. READY에서만 최종 분석으로 표시한다. 결과 화면은 분석 상태가 READY로 바뀌면 H02/H03을 다시 조회해 바로 표시한다. 화면 재진입 시에도 현재 상태와 저장된 결과를 조회하며 별도 완료 알림은 보내지 않는다. 조회 자체가 계산·재시도·알림을 실행하지 않는다. 결과는 원본에서 한 번 계산해 덮어써 저장하며 가산하지 않는다. 자동 재시도·분석 버전·실행권·마감 해시를 추가하지 않는다. LEGACY는 과거 저장 통계를 그대로 보여주며 새 종료 확인을 요구하지 않는다. 상세는 [세션 상태](sessions.md#준비코칭종료-후-분석-상태)를 따른다.

PHONE_FALLBACK으로 끝난 운동도 폰 GPS의 경로·거리·경과시간을 저장해 조회한다. recordingMode는 세션의 제어기기/중계기기 관계로 계산한다. analysisStatus=READY는 가능한 결과의 계산 완료이며 워치 자료 전체 수신을 뜻하지 않는다. 심박은 실제 수신 구간만 제공하고 누락·미확정 값은 null/미확인으로 표시한다.
