# API 명세 — 러닝 코스

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [C01](#c01-코스-추천) | 코스 추천 | POST | `/courses/recommendations` | 1차 MVP | 회원 |
| [C03](#c03-코스-상세-조회) | 코스 상세 조회 | GET | `/courses/{courseId}` | 1차 MVP | 회원 |
| [C07](#c07-코스-저장) | 코스 저장 | PUT | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C08](#c08-코스-저장-해제) | 코스 저장 해제 | DELETE | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C09](#c09-저장-코스-목록) | 저장 코스 목록 | GET | `/users/me/bookmarked-courses` | 1차 MVP | 회원 |

## 코스 상태별 사용 범위

| 상태 | 새 운동에 사용 | 저장한 코스에서의 안내 |
| --- | --- | --- |
| ACTIVE | 생성·코스 변경·새 시작 승인에 사용 가능 | 기존 정보 표시 |
| MERGED | 기존 코스 ID로 사용 불가. 대표 코스를 다시 선택하고 ACTIVE인지 확인 | mergedIntoCourseId로 대표 코스 안내 |
| BLOCKED | 사용 불가. 다른 ACTIVE 코스 선택 | 사용 제한 상태 안내 |

세션 API는 MERGED·BLOCKED에 `403 COURSE_INACCESSIBLE`, 없는 코스에 `404 COURSE_NOT_FOUND`를 반환한다. 과거 기록·저장 목록 조회는 새 운동 사용과 구분한다. 이미 반영된 동일 목표 변경의 결과 확인, 승인한 명령의 결과 보고나 진행 중인 운동의 기록 저장·종료를 코스 상태 변경만으로 막지 않는다. 상세는 [세션의 코스 상태 규칙](sessions.md#코스-상태와-새-운동)을 따른다.

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

courses → course_environment_tags는 복수 태그, course_bookmarks는 본인 저장 관계다. myAlias/alias는 course_bookmarks.custom_name이며 공용 이름 컬럼이 아니다. 지역 표시명은 courses.region_code → regions의 sido_name + sigungu_name + 코스로 구성한다. 지역 NULL의 대체 표시명은 미정이다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## C01 코스 추천

`POST` `/api/v1/courses/recommendations`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | CRS-001, CRS-003, CRS-005, CRS-007~008 / COM-002 / SYS-002 |
| 관련 화면 | 3.1 오늘의 러닝, 3.1p 페이스 입력, 3.1b 추천 코스 목록 (화면 설계 v10) |
| 미정 사항 | 후속 생성 연동만 남음 |
| 비고 | 1차 MVP는 기존 ACTIVE 코스 필터. AI 경로 생성은 범위 밖([코스 생성 후속](#코스-생성-후속-필요-사항)) |

### 설명

1차 MVP는 `ACTIVE` 상태의 기존 서비스 공용 코스만 추천하며 새 코스를 생성하지 않는다. 결과가 없으면 빈 배열을 반환한다.

### 인증 및 권한

- 로그인 사용자(JWT Access Token). 기존 코스 API와 동일하다.
- 위치 좌표는 클라이언트가 전달한다. 앱에서 위치 권한을 받으며, 이 API는 서버측 `LOCATION_CONSENT`를 별도 검사하지 않는다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `latitude` | number | O | 시작 위도(WGS84, -90~90) |
| `longitude` | number | O | 시작 경도(WGS84, -180~180) |
| `targetDistanceM` | number | O | 목표 거리, 미터, 양수 |
| `goalInputType` | string | O | TIME/PACE 중 하나 |
| `targetDurationSec` | number | 조건부 | TIME 선택 시 필수인 목표 완주 시간, 초, 양수. PACE와 동시 지정 불가 |
| `targetPaceSecPerKm` | number | 조건부 | PACE 선택 시 필수인 목표 페이스, 초/km, 양수. TIME과 동시 지정 불가 |
| `environmentTypes` | string[] / null | X | PARK/RIVERSIDE/URBAN/BEACH/TRACK. null·생략·빈 배열은 환경 필터 없음. 2개 이상이면 **AND**(요청한 태그를 모두 가진 코스만) |
| `radiusM` | number | X | 출발점 검색 반경(m). 기본 3000(3km). 양수. 1~3km를 권장하나 상한은 열어 둔다 |
| `limit` | number | X | 결과 최대 개수. 기본 20, 최대 50 |

```json
{
  "latitude": 35.1796,
  "longitude": 129.0756,
  "targetDistanceM": 5000,
  "goalInputType": "TIME",
  "targetDurationSec": 1800,
  "environmentTypes": [
    "PARK"
  ]
}
```

### Response

`200 OK (제안)`

```json
{
  "courses": [
    {
      "id": 101,
      "regionCode": null,
      "status": "ACTIVE",
      "distanceM": 5000,
      "environmentTags": [
        "PARK"
      ],
      "estimatedDurationSec": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses` | array | O | 추천 결과 목록. 없으면 빈 배열 |

중첩 객체의 저장 필드 대응:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses[].id` | integer (int64) | O | `courses.id` (BIGINT). 저장 값은 NULL 불가. |
| `courses[].regionCode` | string / null | O | `courses.region_code` (VARCHAR(40)). NULL 허용 |
| `courses[].status` | string | O | 항상 `ACTIVE`(추천 대상만 반환) |
| `courses[].distanceM` | number | O | `courses.distance`(m) |
| `courses[].environmentTags` | string[] | O | 환경 코드 목록(없으면 빈 배열) |
| `courses[].estimatedDurationSec` | number | O | 요청 목표 페이스(또는 TIME→페이스 환산) × 코스 거리로 산출한 예상 시간(초). `round(distanceM/1000 × paceSecPerKm)` |

**환경 전달 기준:** environmentTypes를 `course_environment_tags.environment_type`과 비교한다. 코드 배열은 필터 조건이며 태그 행 PK가 아니다. **복수 값은 AND**다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 INVALID_SEARCH` | 검색 조건 | 좌표 범위·목표 거리/시간/페이스·goal 조합·radiusM·limit 또는 environmentTypes에 허용되지 않은 코드 |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형 불일치 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색 결과 0건은 오류가 아니다.

### 처리 규칙

- 화면 3.1의 추천 조건 필터로 **기존** 코스를 찾는다. 공용 코스에는 이름을 두지 않으며 이름·키워드 검색은 제공하지 않는다.
- **거리 허용 오차:** 코스 `distance`가 `targetDistanceM`의 **±10%** 구간 안에 있어야 한다.
- **출발점 반경:** `start_position`이 요청 좌표로부터 `radiusM`(기본 3km) 이내. `ST_DWithin` 사용.
- **정렬:** 출발점까지 거리 오름차순, 같으면 `id` 오름차순.
- `MERGED`·`BLOCKED`는 제외. 결과 없으면 빈 배열.
- 1차 MVP는 새 코스를 생성하지 않는다. 개인 저장 별명을 추천 응답에 넣지 않는다.

### 상태값

- `ACTIVE` 코스만 추천 대상이다.

### 미정 사항

- [ ] 준비도·러닝 수준을 추천 순위에 반영할지(현재는 거리순만)
- [ ] AI 경로 생성 연동([코스 생성 후속](#코스-생성-후속-필요-사항))

## C03 코스 상세 조회

`GET` `/api/v1/courses/{courseId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | CRS-001, CRS-003, CRS-005, CRS-007~008 / COM-002 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

요청 사용자 페이스 기준 예상 소요 시간, 경로는 GeoJSON.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courseId` | integer (int64) | O | 조회·저장·해제할 공용 코스 식별자. 경로 인자는 null/생략 불가 |

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `targetPaceSecPerKm` | number | X | 목표 페이스, 초/km, 양수 |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "description": null,
  "route": {
    "type": "LineString",
    "coordinates": [
      [
        129.0,
        35.0
      ],
      [
        129.001,
        35.001
      ]
    ]
  },
  "startPosition": {
    "type": "Point",
    "coordinates": [
      129.0,
      35.0
    ]
  },
  "distanceM": 75,
  "elevationGainM": null,
  "elevationProfile": null,
  "environmentTags": [
    "PARK"
  ],
  "status": "ACTIVE",
  "mergedIntoCourseId": null
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `courses.id` (BIGINT). 저장 값은 NULL 불가. |
| `myAlias` | string / null (제안) | X | 요청 사용자 본인 북마크의 별명 (ERD만으로 응답 형식을 확정하지 않음.) |
| `description` | string / null | O | `courses.description` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `route` | GeoJSON LineString | O | `courses.route` (geography(LineString,4326)). 저장 값은 NULL 불가. |
| `startPosition` | GeoJSON Point | O | `courses.start_position` (geography(Point,4326)). 저장 값은 NULL 불가. |
| `distanceM` | number | O | `courses.distance` (NUMERIC(12,2)). 저장 값은 NULL 불가. |
| `elevationGainM` | number / null | O | `courses.elevation_gain` (NUMERIC(10,2)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `elevationProfile` | array / null | O | `courses.elevation_profile` (JSONB). 구조는 [100m 경사 구조](#elevationprofile-100m-경사-구조). 저장 값을 그대로 반환한다. NULL 허용(경사가 없는 기존 코스); 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `environmentTags` | string[] | X | course_environment_tags.environment_type 코드 배열: PARK/RIVERSIDE/URBAN/BEACH/TRACK. PK 배열과 구분. |
| `estimatedDurationSec` | number | X | 코스와 페이스로 계산한 표시 값. courses 저장 컬럼이 아니며 계산·반올림 규칙 확인 필요. |
| `status` | string | O | `courses.status` (ENUM('ACTIVE', 'MERGED', 'BLOCKED')). 저장 값은 NULL 불가. 허용값: ACTIVE, MERGED, BLOCKED. |
| `mergedIntoCourseId` | integer (int64) / null | O | `courses.merged_into_course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

상세 지도와 출발 버튼에 경로·거리·상태가 필요하다. MERGED는 대표 코스로 이동할 수 있는 ID를 제공하고 BLOCKED를 추천 가능으로 표현하지 않는다.

#### elevationProfile 100m 경사 구조

**상태: 확정([S15P31E105-319](https://ssafy.atlassian.net/browse/S15P31E105-319)).** 코스 경사를 100m 조각 목록으로 저장한다. 형식은 AI 개인 페이스 계획의 경사 구간(`PlanGradeSegment`: `startDistanceM`·`endDistanceM`·`gradePercent`)과 같아 AI가 변환 없이 사용한다. AI 생성 코스 저장 시 서버가 아래 규칙으로 검증·정규화한 뒤 `courses.elevation_profile`에 저장하고, C03은 저장 값을 그대로 반환한다.

```json
[
  {"startDistanceM": 0,    "endDistanceM": 100,    "gradePercent": -0.75},
  {"startDistanceM": 100,  "endDistanceM": 200,    "gradePercent": -0.5},
  …
  {"startDistanceM": 2400, "endDistanceM": 2450.5, "gradePercent": 0}
]
```

예시는 2450.5m 코스(25조각, 마지막 50.5m)다. 1km 단위 값이 필요하면 조각 10개(1km)씩 묶어 계산한다. 저장하지 않는다.

| 필드 | 타입 | 필수 | 규칙 |
|---|---|:---:|---|
| (최상위) | array | O | 1 ~ 450개. 출발점부터 순서대로 |
| `[].startDistanceM` | number | O | 출발점부터의 거리(m). i번째 = i × 조각 폭(정확히 일치). 첫 조각은 0 |
| `[].endDistanceM` | number | O | 다음 조각의 `startDistanceM`과 정확히 같다. 마지막이 아닌 조각 폭은 조각 폭과 정확히 같고, 마지막 조각은 0 초과 조각 폭 이하이며 끝이 저장되는 `courses.distance`(소수 2자리 반올림 후)와 ±0.99m 이내 |
| `[].gradePercent` | number | O | 조각 경사(%) = (조각 끝 고도 − 시작 고도) / 조각 길이 × 100. 산출 측 스무딩 고도 기준, 오르막 양수. -100 ~ 100 |

- **조각 폭**은 100m다. 100m로 나눈 개수 ceil(`courses.distance` / 100)이 450을 넘으면(45km 초과) 100 × ceil(`courses.distance` / 45000)m로 넓힌다(예: 50km → 200m). AI 고도→경사 변환(`ai/service/app/course_grade.py`)과 같은 규칙이다. 여기서 거리는 **저장될 소수 2자리 반올림 값**이다(예: 45000.004m는 45000.00m로 보고 100m 폭).
- 최대 450개는 AI 저장 경사 검사(`ai/service/app/db_lookup.py` `_stored_grade`)와 같다. 허용 오차는 AI(float로 연속 1e-6m, 총거리 1m)보다 엄격하게 둔다(시작·연속·폭 정확히 일치, 총거리 0.99m). 경계값이 float 오차로 AI에서 거절되지 않도록 하기 위해서이며, 서버를 통과한 값은 AI 검사도 통과한다. AI 변환 결과는 정확한 격자이고 끝이 코스 거리와 같아 그대로 통과한다.
- `null`은 허용하지 않는다. DEM 범위 밖·다리·터널 등 경사를 알 수 없거나, 계산 값이 -100 ~ 100%를 벗어나는 조각(예: 수 m 이하의 짧은 마지막 조각)은 산출 측이 앞뒤 고도로 보간한 값을 넣는다. 현재 AI 고도→경사 변환을 그대로 쓰면 짧은 꼬리 조각에서 스무딩으로 ±100%를 넘을 수 있어(예: 0.01m 조각) 산출 측 보정이 필요하다.
- 숫자는 유한값이며 소수 6자리까지 허용한다(초과 시 거절, 끝자리 0은 자릿수에 넣지 않음). 산출 측은 소수 6자리 이하로 반올림해 보낸다(예: Python float `1e-07`, `2450.123456789`는 거절).
- 서버는 숫자를 정규화해 저장한다: 0은 `0`, 지수 표기 정수는 일반 정수(`1E+3` → `1000`), 끝자리 0 제거(`1.10` → `1.1`). C03 응답의 숫자 표기는 보낸 값과 다를 수 있으나 값은 같다.
- 위 표에 없는 키는 저장하지 않는다(AI의 선택 필드 `basePaceRatio` 포함).
- 코스 거리(`courses.distance`)와 누적 상승(`courses.elevation_gain`)은 컬럼과 같은 소수 2자리(반올림)로 맞춘 값으로 검증·저장한다. 코스 거리는 0 초과 9999999999.99 이하, 누적 상승은 null 또는 0 ~ 99999999.99(컬럼 범위)이다. 경사와 누적 상승의 일치는 검증하지 않는다.
- 위 규칙을 어긴 입력(순서·격자 불일치, 조각 사이 틈·겹침, 총거리 불일치, 개수 초과, 범위 밖 값, 필수 누락·null)은 저장하지 않고 거절한다. 서버 내부 저장 로직은 공통 `400 VALIDATION_ERROR`를 사용하고 `details.fields`에 위반 필드 이름(예: `elevationProfile[3].gradePercent`)과 사유만 담는다. 외부 생성 API를 공개할 때의 오류 계약은 해당 엔드포인트 업무에서 확정한다.
- 경사가 없는 기존 코스는 `elevationProfile: null`이다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 COURSE_NOT_FOUND` | 대상 없음 | 참조 코스가 존재하지 않음. 저장 관계 부재와 공용 코스 부재를 구분 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 공용 코스에 이름은 없다. 본인이 저장한 코스라면 본인 북마크의 별명을 `myAlias`로 제공할 수 있다.

- 요청 사용자 페이스 기준 예상 소요 시간, 경로는 GeoJSON.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- `ACTIVE` / `MERGED` / `BLOCKED`. 저장한 코스가 `MERGED` 또는 `BLOCKED`이면 상태를 안내하고, `MERGED`이면 대표 코스를 함께 안내한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## C07 코스 저장

`PUT` `/api/v1/courses/{courseId}/bookmark`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | CRS-001, CRS-003, CRS-005, CRS-007~008 / COM-002 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

반복 저장은 멱등.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courseId` | integer (int64) | O | 조회·저장·해제할 공용 코스 식별자. 경로 인자는 null/생략 불가 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `alias` | string / null (제안) | X | 본인 저장 목록의 별명. 생략하면 기존 값 유지, null이면 별명 제거 |

```json
{"alias": "내 아침 코스"}
```


### Response

`200 OK (제안)`

```json
{
  "alias": "내 아침 코스",
  "createdAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `alias` | string / null | O | `course_bookmarks.custom_name` (VARCHAR(50)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `bookmarked` | boolean | X | 본인 course_bookmarks 관계 존재 여부. courses.status와 별개. |
| `createdAt` | string (ISO 8601 UTC) | O | `course_bookmarks.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

저장 후 적용된 본인 별명과 저장 여부가 필요하다. 반복 저장이 별명 변경까지 포함하는지는 확인하고 본인 별명을 타인에게 노출하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 COURSE_INACCESSIBLE` | 자원 상태/접근 | 요청 용도에 사용할 수 없는 코스를 참조함. MERGED/BLOCKED의 상세·저장 목록 상태 안내를 무조건 차단하지 않음 |
| `404 COURSE_NOT_FOUND` | 대상 없음 | 참조 코스가 존재하지 않음. 저장 관계 부재와 공용 코스 부재를 구분 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 코스 저장과 본인 별명 설정·변경을 처리한다. 같은 별명으로 반복 호출해도 멱등이다.
- 별명은 사용자와 코스의 북마크 관계에만 저장한다. 공용 코스나 다른 사용자의 별명을 수정하지 않는다.
- 별명 길이·공백 검증과 병합 코스의 별명 승계 규칙은 별도 확정한다.

- 반복 저장은 멱등.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- `ACTIVE`, `MERGED`, `BLOCKED` 코스를 저장할 수 있으나 추천에는 `ACTIVE`만 사용한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## C08 코스 저장 해제

`DELETE` `/api/v1/courses/{courseId}/bookmark`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | CRS-001, CRS-003, CRS-005, CRS-007~008 / COM-002 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

사용자의 저장 코스 목록에서만 코스를 제거한다. 서비스 공용 코스 원본은 변경하거나 삭제하지 않으며, 이미 저장 해제된 경우에도 성공 가능한 멱등 규칙을 적용한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courseId` | integer (int64) | O | 조회·저장·해제할 공용 코스 식별자. 경로 인자는 null/생략 불가 |

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
| `bookmarked` | boolean | X | 본인 course_bookmarks 관계 존재 여부. courses.status와 별개. |


**사용 흐름과 응답 판단**

저장 관계가 없어도 bookmarked=false 성공이 가능하다. 북마크 부재를 404로 처리하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 COURSE_NOT_FOUND` | 대상 없음 | 참조 코스가 존재하지 않음. 저장 관계 부재와 공용 코스 부재를 구분 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 사용자의 북마크 관계만 삭제한다. 코스 등록자 여부와 관계없이 서비스 공용 코스 원본은 변경하거나 삭제하지 않는다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 코스 상태는 변경하지 않는다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## C09 저장 코스 목록

`GET` `/api/v1/users/me/bookmarked-courses`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | CRS-001, CRS-003, CRS-005, CRS-007~008 / COM-002 / SYS-002 |
| 관련 화면 | 3.1c 저장한 코스, 2.1 홈 '저장한 코스' (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

저장한 코스의 현재 상태를 구분한다. `MERGED` 코스는 대표 코스를 함께 안내하고 `BLOCKED` 코스는 추천·새 운동 사용이 불가함을 안내한다.

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
| `difficulty` | string | X | EASY/MODERATE/HARD(화면 하·중·상 필터) |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "id": 101,
      "regionCode": null,
      "status": "ACTIVE",
      "mergedIntoCourseId": null,
      "myAlias": "내 아침 코스",
      "distanceM": 5000
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 사용자가 저장한 코스와 각 코스의 현재 상태 목록 |
| `page` | string / object (확인 필요) | X | 페이지 메타데이터는 저장 엔티티가 아니다. cursor/limit 등 공통 페이지 형식 확정 필요. |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `courses.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].regionCode` | string / null | O | `courses.region_code` (VARCHAR(40)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].status` | string | O | `courses.status` (ENUM('ACTIVE', 'MERGED', 'BLOCKED')). 저장 값은 NULL 불가. 허용값: ACTIVE, MERGED, BLOCKED. |
| `items[].mergedIntoCourseId` | integer (int64) / null | O | `courses.merged_into_course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

저장 카드에는 본인 별명·지역 표시명과 현재 코스 상태·대표 ID가 필요하다. PK 나열만으로 저장 목록을 복원하지 않는다.

기능상 필요한 응답 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].myAlias` | string / null | O | 본인 course_bookmarks.custom_name. 미지정은 null. 공용 이름과 구분. |

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].distanceM` | number | O | courses.distance(m). distance 대신 단위 명시. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 각 항목에 본인 북마크의 `alias`를 포함한다. 별명이 없으면 거리·환경 등으로 표시하며 공용 이름을 생성하지 않는다.

- `ACTIVE`, `MERGED`, `BLOCKED` 상태를 구분하고, `MERGED`이면 `mergedIntoCourseId`를 함께 반환한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- `ACTIVE` / `MERGED` / `BLOCKED`.

### 미정 사항

- [ ] 코스 난이도 산정 기준(거리·고도) 확정
- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

## 코스 생성 후속 필요 사항

C01 1차 MVP는 기존 ACTIVE 코스 **필터만** 한다. CRS-002 동적 경로 **생성**을 C01(또는 별도 업무)에 붙이려면 아래가 선행이다. (상세 계약은 확정 전.)

- BE↔Route AI HTTP 계약(URL·요청/응답·오류·타임아웃). 현재 Route는 워크스페이스 데모(`ai/workspace/seongyun/route`)이며 배포용 `ai/service`는 HR만 제공
- Route 서비스 배포와 OSM/env/DEM 데이터(현재 커버리지는 부산 extract 기준)
- 생성 경로는 `courses`에 저장한다(서버 내부 저장 로직 구현, [S15P31E105-319](https://ssafy.atlassian.net/browse/S15P31E105-319)). 출발점은 경로 첫 좌표, `creator_id`·`source_session_id`·`region_code`·`description`은 NULL, 상태는 ACTIVE, 경사는 [elevationProfile 구조](#elevationprofile-100m-경사-구조)를 따른다. 미정: 저장 호출 시점(후보 경로 생성 시 전부 저장 vs 사용자가 고른 경로만 저장 — 전부 저장하면 고르지 않은 후보도 ACTIVE 공용 코스로 C01 추천 대상이 됨), 유사 경로 중복 기준, 재시도·동시 호출 시 멱등 처리, 경로 실제 길이와 `distanceM`의 일치 검증, 외부 API 오류 코드. 후속 연결: AI가 `elevation_profile`을 경사 구간 목록으로 읽는 구현(`StoredCourseGradeSource`, 현재 꺼짐)과 범위 밖 경사 보정, FE 고도 그래프의 경사 누적 변환
- AI 선호 키(`river`/`park`/…) ↔ `PARK`/`RIVERSIDE`/`URBAN`/`BEACH`/`TRACK` 태그 매핑
- 좌표 순서: AI `coords`는 `[lat,lon]`, GeoJSON·PostGIS는 `[lon,lat]`
- 생성 지연(수 초)에 대한 동기/비동기·클라이언트 타임아웃
- (선택) `shape`·도착점, 출발점→`region_code` 역지오코딩

러닝 종료 후 경로 **자동 반영**(COM-002)은 아래 절·별도 구현 업무이며 C01과 구분한다.

## 러닝 경로 자동 코스 반영

- 사용자가 달린 경로는 러닝 종료 후 기록에 반영되는 과정에서 공용 코스로 자동 등록한다. 별도 등록 버튼이나 C04 요청을 요구하지 않는다.
- 지연 동기화로 경로가 완성되면 해당 기록 기준으로 자동 반영한다. 재전송·재처리·동일 경로로 공용 코스가 무분별하게 중복 생성되지 않도록 한다.
- 경로 없는 기록·유효하지 않은 GPS·유사 코스 판정·환경 태그 부여·상태 승계 등 구체 계약은 미정이다. 사용자에게 등록 이름·태그를 입력받는 흐름을 전제하지 않는다.
- 자동 코스 등록과 개인 저장은 별개다. C07 저장·별명 설정, C08 저장 해제, C09 저장 목록은 유지한다. 자동 북마크 여부는 이 결정으로 확정하지 않는다.
- 계정의 프로필·게시물 공개 여부와 공용 코스 반영을 구분한다. 공용 경로에 사용자 식별정보를 연결해 노출할지와 경로 처리의 세부 정책은 별도 검토하며 자동 등록 여부 자체는 사용자 결정이다.
- C04 ID는 공개 API에서 제외하며 재사용하지 않는다.
