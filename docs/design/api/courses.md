# API 명세 — 러닝 코스

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [C01](#c01-코스-추천) | 코스 추천 | POST | `/courses/recommendations` | 1차 MVP | 회원 |
| [C03](#c03-코스-상세-조회) | 코스 상세 조회 | GET | `/courses/{courseId}` | 1차 MVP | 회원 |
| [C07](#c07-코스-저장) | 코스 저장 | PUT | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C08](#c08-코스-저장-해제) | 코스 저장 해제 | DELETE | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C09](#c09-저장-코스-목록) | 저장 코스 목록 | GET | `/users/me/bookmarked-courses` | 1차 MVP | 회원 |

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
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

1차 MVP는 `ACTIVE` 상태의 기존 서비스 공용 코스만 추천하며 새 코스를 생성하지 않는다. 결과가 없으면 빈 배열을 반환한다.

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
| `latitude` | number | O | 시작 위도(WGS84, -90~90) |
| `longitude` | number | O | 시작 경도(WGS84, -180~180) |
| `targetDistanceM` | number | O | 목표 거리, 미터, 양수 |
| `goalInputType` | string (제안) | O | TIME/PACE 중 하나 |
| `targetDurationSec` | number | 조건부 | TIME 선택 시 필수인 목표 완주 시간, 초, 양수 |
| `targetPaceSecPerKm` | number | 조건부 | PACE 선택 시 필수인 목표 페이스, 초/km, 양수 |
| `environmentTypes` | string[] | X | PARK/RIVERSIDE/URBAN/BEACH/TRACK 코드 배열. 미지정/빈 배열은 환경 필터 없음 |
| `limit` | number | X | 조회 결과 최대 개수(최대값 미정) |

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
| `courses` | array | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 |
| `emptyReason` | string / object (확인 필요) | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 (ERD만으로 응답 형식을 확정하지 않음.) |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses[].id` | integer (int64) | O | `courses.id` (BIGINT). 저장 값은 NULL 불가. |
| `courses[].regionCode` | string / null | O | `courses.region_code` (VARCHAR(40)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `courses[].status` | string | O | `courses.status` (ENUM('ACTIVE', 'MERGED', 'BLOCKED')). 저장 값은 NULL 불가. 허용값: ACTIVE, MERGED, BLOCKED. |


**사용 흐름과 응답 판단**

추천 카드 선택에 코스 ID·거리·지역·환경·예상시간·경로 표시 참조가 필요하다. 공용 코스 이름 필수화를 뜻하지 않는다. 지역 조합 표시와 미판정 대체 표현을 구분한다. 예상시간은 파생값의 산식·준비 여부를 확인한다.

**환경 전달 기준:** U10에서 받은 환경 코드를 environmentTypes로 전달하여 course_environment_tags.environment_type과 비교한다. 코드 배열은 필터 조건이며 태그 행 PK가 아니다. 복수 환경 결합 방식(AND/OR)은 별도 정책이다.

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses[].distanceM` | number | O | courses.distance(m). 이 응답의 distance 기존 표기는 단위 명시 필드로 통일. |
| `courses[].environmentTags` | string[] | O | 환경 코드 목록. |
| `courses[].estimatedDurationSec` | number / null | O | 요청 목표/사용자 기준으로 산출한 예상시간. 산식 확인 필요. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 LOCATION_CONSENT_REQUIRED` | 동의 | 위치를 사용하는 요청에 필요한 위치 수집·이용 동의가 없음/철회됨 |
| `422 INVALID_SEARCH` | 검색 조건 | 좌표 범위·목표 거리/시간/페이스 또는 추천 조건 조합이 유효하지 않음. environmentTypes에 허용되지 않은 환경 코드가 포함된 경우도 해당 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- 화면 3.1의 추천 조건 필터로 코스를 찾는다. 공용 코스에는 이름을 두지 않으며 이름·키워드 검색은 제공하지 않는다. C02 별도 검색은 이 흐름에 통합한다.
- 기준 위치·목표 거리·시간 또는 페이스·환경 필터를 사용한다. 추가 필터 값과 거리 오차 허용 범위는 별도 확정한다.
- 결과는 코스 ID·거리·환경·경로 표시 등으로 구분한다. 개인 저장 별명을 공용 이름이나 타인의 검색 결과에 노출하지 않는다.

- 러닝 수준·평소 정보·사용 가능한 최신 준비도는 서버가 본인 데이터에서 참조한다. 클라이언트가 준비도 평가를 실행하거나 평가 ID를 찾아 전달할 필요는 없다.

- 1차 MVP는 `ACTIVE` 상태의 기존 서비스 공용 코스만 추천하며 새 코스를 생성하지 않는다. `MERGED`, `BLOCKED` 코스는 추천에서 제외하고 결과가 없으면 빈 배열을 반환한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- `ACTIVE` 코스만 추천 대상이다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정

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
| `elevationProfile` | JSON (구조 확인 필요) / null | O | `courses.elevation_profile` (JSONB). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `environmentTags` | string[] | X | course_environment_tags.environment_type 코드 배열: PARK/RIVERSIDE/URBAN/BEACH/TRACK. PK 배열과 구분. |
| `estimatedDurationSec` | number | X | 코스와 페이스로 계산한 표시 값. courses 저장 컬럼이 아니며 계산·반올림 규칙 확인 필요. |
| `status` | string | O | `courses.status` (ENUM('ACTIVE', 'MERGED', 'BLOCKED')). 저장 값은 NULL 불가. 허용값: ACTIVE, MERGED, BLOCKED. |
| `mergedIntoCourseId` | integer (int64) / null | O | `courses.merged_into_course_id` (BIGINT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

상세 지도와 출발 버튼에 경로·거리·상태가 필요하다. MERGED는 대표 코스로 이동할 수 있는 ID를 제공하고 BLOCKED를 추천 가능으로 표현하지 않는다.

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

저장한 코스의 현재 상태를 구분한다. `MERGED` 코스는 대표 코스를 함께 안내하고 `BLOCKED` 코스는 추천 대상이 아님을 안내한다.

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

## 러닝 경로 자동 코스 반영

- 사용자가 달린 경로는 러닝 종료 후 기록에 반영되는 과정에서 공용 코스로 자동 등록한다. 별도 등록 버튼이나 C04 요청을 요구하지 않는다.
- 지연 동기화로 경로가 완성되면 해당 기록 기준으로 자동 반영한다. 재전송·재처리·동일 경로로 공용 코스가 무분별하게 중복 생성되지 않도록 한다.
- 경로 없는 기록·유효하지 않은 GPS·유사 코스 판정·환경 태그 부여·상태 승계 등 구체 계약은 미정이다. 사용자에게 등록 이름·태그를 입력받는 흐름을 전제하지 않는다.
- 자동 코스 등록과 개인 저장은 별개다. C07 저장·별명 설정, C08 저장 해제, C09 저장 목록은 유지한다. 자동 북마크 여부는 이 결정으로 확정하지 않는다.
- 계정의 프로필·게시물 공개 여부와 공용 코스 반영을 구분한다. 공용 경로에 사용자 식별정보를 연결해 노출할지와 경로 처리의 세부 정책은 별도 검토하며 자동 등록 여부 자체는 사용자 결정이다.
- C04 ID는 공개 API에서 제외하며 재사용하지 않는다.
