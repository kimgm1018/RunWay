# API 명세 — 러닝 기록·분석

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [H01](#h01-러닝-기록-목록) | 러닝 기록 목록 | GET | `/running-records` | 1차 MVP | 회원 |
| [H02](#h02-러닝-기록-상세) | 러닝 기록 상세 | GET | `/running-records/{sessionId}` | 1차 MVP | 회원 |
| [H03](#h03-구간별-러닝-분석-결과-조회) | 구간별 러닝 분석 결과 조회 | GET | `/running-records/{sessionId}/splits` | 1차 MVP | 회원 |
| [H06](#h06-러닝-통계-요약) | 러닝 통계 요약 | GET | `/running-records/statistics` | 1차 MVP | 회원 |
| [H07](#h07-평균-페이스-추이) | 평균 페이스 추이 | GET | `/running-records/statistics/pace-trend` | 1차 MVP | 회원 |
| [H08](#h08-기록-공유-링크-발급) | 기록 공유 링크 발급 | POST | `/running-records/{sessionId}/share-link` | 1차 MVP | 회원 |
| [H09](#h09-공유-기록-조회) | 공유 기록 조회 | GET | `/shared-runs/{token}` | 1차 MVP | 공개 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

기록의 저장 근거는 running_sessions다. running_metric_samples·running_route_points는 측정/경로 근거이며 원본 GPS 응답을 추가하지 않는다. 구간 분석·기간 통계는 파생 결과다. NULL 결과를 0으로 채우지 않고 개인 원본 기록의 본인 조회 정책을 유지한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 삭제된 운동 기록

[S09](sessions.md#s09-러닝-세션-삭제)로 삭제 표시한 세션은 H01 목록·H06 통계·H07 추이에서 제외한다. H02/H03에서 직접 조회하면 기존 `404 RECORD_NOT_FOUND`를 반환하며 경로·구간·분석 원본을 우회 제공하지 않는다. 이미 발급한 공유 링크도 [H09](#h09-공유-기록-조회)에서 `404 SHARED_RUN_NOT_FOUND`가 된다. 새 비교 대상·추천 입력에서도 제외한다.

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
| `items[].routePreviewImageUrl` | string | X | 이 기록의 경로 썸네일 PNG 주소 `/api/v1/images/{id}`(같은 서버 기준 상대 경로, S15P31E105-756, [ADR-0024](../../adr/0024-own-run-route-thumbnail.md)). 그림이 아직 없거나(생성 전·실패) 그릴 경로가 없으면 필드를 생략한다. 기록 주인만 Bearer 토큰으로 F02 조회할 수 있다. 그림 구조·배치는 [C03 basemap](courses.md#basemap-썸네일-지도-바탕-구조)과 같다. |


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

- 기록별 공개 상태 없음. 본인 소유권을 검사한다. 공유 링크(`run_share_links`)는 공개 상태가 아니며 H02 권한을 바꾸지 않는다(H08·H09 참고).

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
| `routePreviewImageUrl` | string / null | O | 이 기록의 경로 썸네일 PNG 주소 `/api/v1/images/{id}`([running_session_basemaps](../db/erd.md)). 그림이 아직 없거나(종료 직후 생성 전·실패) 그릴 경로가 없으면 null. H01 항목과 같은 값이며 기록 주인만 Bearer 토큰으로 F02 조회한다(S15P31E105-756, [ADR-0024](../../adr/0024-own-run-route-thumbnail.md)). 원본 GPS 응답으로 대체하지 않는다. |
| `courseId` | integer (int64) / null | O | `running_sessions.course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `courseFromFreeRun` | boolean | O | 연결 세션의 코스가 이 자유 러닝 또는 자유 그룹런(코스 미지정 그룹런) 기록으로 만든 개인 코스이면 true(`courses.source_session_id`=세션 ID, [S15P31E105-762](https://ssafy.atlassian.net/browse/S15P31E105-762)). 코스가 없거나 일반 코스(지정 코스 그룹런 포함)를 쓴 기록이면 false. `courseId`가 숨겨지는 조회자에게는 false. 항상 포함 |


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

- H04 원본 GPS 조회는 제공하지 않는다. 경로 그림은 표시용 이미지 `routePreviewImageUrl`로 제공한다(S15P31E105-756, [ADR-0024](../../adr/0024-own-run-route-thumbnail.md)).
  - 생성: 개인 세션이 처음 완료되면 커밋 뒤 서버가 비동기로 S11과 같은 표시용 경로 조각(조각 사이를 잇지 않음)과 Route 바탕 지도(`POST /internal/v1/basemaps`, bbox만 전송)로 600×900 PNG를 그린다. 선 스타일·배치는 [C03 basemap](courses.md#basemap-썸네일-지도-바탕-구조)과 같다. 서버 기동 시 그림이 없거나 그리기 버전이 다른 완료 기록을 최신순으로 설정 건수만큼 채운다. 종료 응답에는 영향이 없다.
  - 미생성 표현: 생성 전·Route 일시 실패는 필드 없음(H01)·null(H02). 표시용 경로가 50 m 미만이거나 없거나 전국 자료 범위 밖이면 그림 없이 끝나며 다시 시도하지 않는다.
  - 형식·캐시·권한: [F02](files.md#f02-이미지-조회)의 기록 경로 썸네일 규칙을 따른다(본인만, 그 외 404, `private` 캐시).
- 본인 기록의 지도 표시용 경로 좌표는 [S11 러닝 경로 조회](sessions.md#s11-러닝-경로-조회)가 제공한다(S15P31E105-549). 기록 ID는 세션 ID와 같다. S11은 출처 선택·정확도·구간 분리를 적용한 표시용 좌표이며 원본 GPS 다운로드가 아니다.
- 이미지도 기록 접근 권한을 적용한다. 공유 게시물에는 게시물 권한에 맞는 표시용 결과만 제공하며 원본 GPS 다운로드 기능을 추가하지 않는다.

- 본인의 원본 기록 조회다. 다른 사용자 기록은 이 API로 열지 않고 접근 가능한 공유 게시물의 표시용 요약으로 제공한다.
- 예외(S15P31E105-704): 소유자가 [H08](#h08-기록-공유-링크-발급)로 링크를 발급한 기록 하나는 링크를 받은 사람이 로그인 없이 [H09](#h09-공유-기록-조회)로 표시용 요약·경로를 본다. H09는 H02 응답이 아니며 심박·목표·기기·세션 ID를 주지 않는다. H02 자체는 계속 본인만 조회한다.
- 기록별 공개 설정은 없다. 게시물의 노출은 작성자의 계정 공개 여부·승인된 팔로워 관계로 결정한다. 공유 링크는 공개 설정이 아니라 링크를 아는 사람에게만 여는 별도 경로다.

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

## H08 기록 공유 링크 발급

`POST` `/api/v1/running-records/{sessionId}/share-link`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 (본인 기록) |
| 관련 업무 | S15P31E105-704 경로 재생 공유 |
| 미정 사항 | 없음. 링크 취소는 후속 업무 |

### 설명

본인의 완료된 러닝 기록의 공유 링크를 만든다. 링크를 받은 사람은 로그인 없이 [H09](#h09-공유-기록-조회)로 그 기록 하나의 표시용 요약과 경로를 본다. 기록 하나에 링크는 하나이며, 다시 요청하면 같은 링크를 돌려준다.

### 인증 및 권한

- JWT 회원. 기록(세션) 소유자만 발급한다. 다른 회원의 기록이면 `403 NOT_OWNER`다(H02와 같은 검사).
- 완료 기록만 발급한다. H01 목록과 같은 기준(`running_sessions.status = COMPLETED`, 미삭제)이며, 진행 중·준비·취소·중단 세션은 기록이 아니므로 `404 RECORD_NOT_FOUND`이고 링크를 만들지 않는다.
- 요청마다 계정 상태를 조회하지 않는다([공통 인증 규약](README.md#인증-요청과-복구): 탈퇴 뒤 기존 JWT는 만료까지 유효하고 자원 권한 검사로 막는다). 탈퇴 처리(U18)가 기록을 삭제 표시하므로 탈퇴 뒤 남은 JWT로 호출하면 H02와 같이 `404 RECORD_NOT_FOUND`다. 탈퇴와 겹쳐 기록이 아직 남아 있으면 DB 쓰기 차단(`rw_active_owner`)이 거절한다. 탈퇴가 커밋된 뒤면 `401 UNAUTHORIZED`, 탈퇴 트랜잭션이 아직 진행 중이면 회원 행 잠금 대기를 하지 않고 `503 SERVICE_UNAVAILABLE`이다. 어느 쪽도 링크를 만들지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `sessionId` | integer (int64) | O | 러닝 세션 BIGINT 식별자 |

### Query Parameters

없음

### Request Body

```json
{ "title": "자유 러닝" }
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `title` | string | O | 앱이 보여 주던 기록 제목. 앞뒤 공백을 제거한 뒤 1~40자(유니코드 코드 포인트, 닉네임과 같은 계산)이며 제거한 값을 저장한다. 제어 문자(NUL 포함, `Cc`)·보이지 않는 서식 문자(폭 없는 공백·양방향 재정렬 등, `Cf`)·짝 없는 서로게이트는 허용하지 않는다. 그 밖의 제목 규칙은 없어 앱이 보낸 값을 쓴다 |

### Response

`200 OK`

```json
{
  "token": "Q2hhbmdlTWVJc05vdEFSZWFsVG9rZW5KdXN0QVNhbXA",
  "url": "https://k15e105.p.ssafy.io/r/Q2hhbmdlTWVJc05vdEFSZWFsVG9rZW5KdXN0QVNhbXA"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `token` | string | O | `run_share_links.token`. 서버가 만든 32바이트 난수의 base64url(패딩 없음) 43자 |
| `url` | string | O | 공개 주소 + `/r/{token}`. 공개 주소는 서버 설정 `runway.share.base-url`(`BACKEND_SHARE_BASE_URL`, 기본 `https://k15e105.p.ssafy.io`) |

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | 본문이 JSON이 아니거나 `title`이 없음·공백뿐·앞뒤 공백 제거 후 40자 초과·허용하지 않는 문자(제어·서식 문자, 짝 없는 서로게이트) 포함. `sessionId`가 정수가 아님 |
| `401 UNAUTHORIZED` | 토큰이 없거나 만료·위변조. 탈퇴와 겹쳐 DB 쓰기 차단(`rw_active_owner`)에 걸림 |
| `403 NOT_OWNER` | 다른 회원의 기록 |
| `404 RECORD_NOT_FOUND` | 기록이 없거나 삭제됨(탈퇴 뒤 남은 JWT 포함), 또는 완료(COMPLETED)되지 않은 세션. 링크를 만들지 않는다 |
| `503 SERVICE_UNAVAILABLE` | 저장소 일시 장애, 또는 진행 중인 탈퇴와 겹쳐 회원 행이 잠김. 같은 요청으로 다시 시도해도 같은 링크를 받는다(탈퇴가 끝났으면 401·404) |

### 처리 규칙

- 한 쓰기 트랜잭션에서 소유권을 확인하고 `run_share_links`에 저장한다.
- 같은 기록에 이미 링크가 있으면 새로 만들지 않고 기존 token을 돌려준다(멱등). `title`이 다르면 제목만 바꾼다.
- 같은 기록의 첫 발급이 동시에 겹치면 `session_id` UNIQUE 충돌을 `INSERT … ON CONFLICT`로 받아 먼저 저장된 행을 쓴다. 두 요청 모두 같은 token을 받는다.
- 같은 링크를 다시 돌려줘야 하므로 token은 평문으로 저장한다.
- 링크를 끄는 수단은 없다. 기록을 삭제(S09)하면 H09가 404가 된다. 회원이 탈퇴하면 [U18](users.md#u18-회원탈퇴)이 그 회원의 링크 행을 삭제해 H09가 404가 된다. 취소 API·화면은 후속 업무다.
- 완료 여부는 소유권 확인 뒤 `status = COMPLETED`로 검사한다(H01과 같은 기록 기준). 진행 중 위치가 링크로 열리지 않게 한다.
- token은 로그에 남기지 않는다.

## H09 공유 기록 조회

`GET` `/api/v1/shared-runs/{token}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 공개 (로그인 불필요) |
| 관련 업무 | S15P31E105-704 경로 재생 공유 |
| 미정 사항 | 없음 |

### 설명

[H08](#h08-기록-공유-링크-발급)로 발급한 링크의 기록을 로그인 없이 보여 준다. 앱의 공유 재생 화면과 웹 안내 페이지(`/r/{token}`)가 같은 응답으로 경로를 재생한다.

### 인증 및 권한

- 인증하지 않는다. 공개 경로는 `GET`/`HEAD` `/api/v1/shared-runs/{token}`뿐이다. Authorization 헤더가 있어도 결과는 같다.
- token을 아는 사람만 연다. token은 추측할 수 없는 난수이며 다른 기록 목록·ID를 노출하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `token` | string | O | H08이 준 token. `[A-Za-z0-9_-]{43}` 형식이 아니면 조회하지 않고 404 |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "title": "자유 러닝",
  "startedAt": "2026-11-11T22:01:02Z",
  "distanceM": 5021.40,
  "durationSec": 1712,
  "averagePaceSecPerKm": 341.00,
  "cadence": 172.00,
  "runner": { "nickname": "러너", "profileImageUrl": "/api/v1/images/550e8400-e29b-41d4-a716-446655440000" },
  "segments": [
    { "coordinates": [[127.027612, 37.497912], [127.027901, 37.498105]] }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `title` | string | O | 발급 때 받은 제목(`run_share_links.title`) |
| `startedAt` | string (ISO 8601 UTC) / null | O | `running_sessions.started_at` |
| `distanceM` | number / null | O | `running_sessions.total_distance`. H02 `actualDistanceM`과 같은 값 |
| `durationSec` | integer / null | O | `running_sessions.moving_duration`. H02 `movingDurationSec`과 같은 값(앱 5.1 기록 카드의 시간) |
| `averagePaceSecPerKm` | number / null | O | `running_sessions.average_pace` |
| `cadence` | number / null | O | `running_sessions.average_cadence`(spm). H02 `averageCadence`와 같은 값 |
| `runner.nickname` | string | O | 발급자 닉네임 |
| `runner.profileImageUrl` | string / null | O | 발급자 프로필 사진 주소. U21과 같은 방식(`users.profile_image_key` → [F02](files.md#f02-이미지-조회) 공개 주소). 없으면 null |
| `segments` | object[] | O | 지도 표시용 경로 조각. 위치가 없거나 시작 전 기록이면 빈 배열 |
| `segments[].coordinates` | number[][] | O | WGS84 `[경도, 위도]`. 한 조각 안에서만 선으로 잇는다 |

`segments`는 [S11 경로 선택 규칙](sessions.md#경로-선택-규칙)과 같은 규칙(시작~종료 시각, 정확도 30m, 워치 우선, 60초 공백 분리, 최대 2,000개 축약)으로 고른 결과이며, 같은 기록의 S11 `segments[].coordinates`와 같다. 기기 출처(`source`)는 주지 않는다. 심박·목표·기기·세션 ID·측정 시각·정확도는 응답하지 않는다.

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `404 SHARED_RUN_NOT_FOUND` | token 형식 오류, 없는 token, 연결된 세션이 완료(COMPLETED)가 아님, 기록 삭제(S09), 발급자가 탈퇴했거나 ACTIVE가 아님. 어떤 이유인지 구분하지 않는다 |
| `503 SERVICE_UNAVAILABLE` | 저장소 일시 장애 |

### 처리 규칙

- 읽기 전용 단일 트랜잭션에서 링크·기록·발급자와 경로를 조회한다. 아무것도 잠그거나 바꾸지 않는다.
- 연결된 세션이 `status = COMPLETED`이고 삭제되지 않았으며 발급자가 ACTIVE일 때만 응답한다.
- 응답 필드는 위 표의 것만 준다. 기록 원본(H02·H03)·다른 기록으로 이어지는 식별자를 주지 않는다.
- token과 좌표는 로그에 남기지 않는다.

## 173 종료 후 분석 상태

H02/H03은 analysis={status}만 포함한다. PENDING/PROCESSING/FAILED이면200과 함께 미완료 상태를 표시하고 아직 없는 분석 객체는null이다. READY에서만 최종 분석으로 표시한다. 결과 화면은 분석 상태가 READY로 바뀌면 H02/H03을 다시 조회해 바로 표시한다. 화면 재진입 시에도 현재 상태와 저장된 결과를 조회하며 별도 완료 알림은 보내지 않는다. 조회 자체가 계산·재시도·알림을 실행하지 않는다. 결과는 원본에서 한 번 계산해 덮어써 저장하며 가산하지 않는다. 자동 재시도·분석 버전·실행권·마감 해시를 추가하지 않는다. LEGACY는 과거 저장 통계를 그대로 보여주며 새 종료 확인을 요구하지 않는다. 상세는 [세션 상태](sessions.md#준비코칭종료-후-분석-상태)를 따른다.

PHONE_FALLBACK으로 끝난 운동도 폰 GPS의 경로·거리·경과시간을 저장해 조회한다. recordingMode는 세션의 제어기기/중계기기 관계로 계산한다. analysisStatus=READY는 가능한 결과의 계산 완료이며 워치 자료 전체 수신을 뜻하지 않는다. 심박은 실제 수신 구간만 제공하고 누락·미확정 값은 null/미확인으로 표시한다.
