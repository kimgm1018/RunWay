# API 명세 — 러닝 코스

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [C01](#c01-코스-추천) | 코스 추천(AI 경로 후보 생성) | POST | `/courses/recommendations` | 1차 MVP | 회원 |
| [C03](#c03-코스-상세-조회) | 코스 상세 조회 | GET | `/courses/{courseId}` | 1차 MVP | 회원 |
| [C07](#c07-코스-저장) | 코스 저장 | PUT | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C08](#c08-코스-저장-해제) | 코스 저장 해제 | DELETE | `/courses/{courseId}/bookmark` | 1차 MVP | 회원 |
| [C09](#c09-저장-코스-목록) | 저장 코스 목록 | GET | `/users/me/bookmarked-courses` | 1차 MVP | 회원 |

## 코스 상태별 사용 범위

C01(AI 경로 후보 생성)은 DB `courses`를 조회하지 않으므로 이 상태 규칙의 대상이 아니다. 아래 `ACTIVE` 규칙은 저장된 코스를 사용하는 [C03](#c03-코스-상세-조회)·세션·저장 코스 흐름에 적용한다. C01 후보를 선택·저장해 `ACTIVE` 코스가 된 뒤부터 이 규칙을 따른다.

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
| 관련 요구사항 | CRS-001, CRS-002, CRS-003, CRS-005, CRS-007~008 / SYS-002 |
| 관련 화면 | 3.1 오늘의 러닝, 3.1b 추천 코스 목록 (화면 설계 v10) |
| 미정 사항 | AI Route 실연동·오류 세분화는 [370 후속 초안](#코스-생성-후속-필요-사항)에서 제안. 선택 코스 저장 API·팀 확인은 후속 |
| 비고 | **기존 "1차 MVP DB `ACTIVE` 필터" 방식은 C01에서 대체(superseded)됨.** 현재 구현은 Route 실연동 전 스텁 경로를 반환한다 |

### 설명

출발 위치·목표 거리·형태·선호 조건을 받아 **새 러닝 경로 후보**(기본 3개)를 생성해 반환한다. 서버는 이 입력을 AI Route 생성기에 전달하는 계약만 가진다(Route 실연동 전에는 스텁이 같은 입력·seed에 대해 동일한 더미 경로를 반환한다). 후보는 이 호출에서 **저장하지 않는다.** 사용자가 후보 중 하나를 고르면 그 경로만 `courses`에 저장하고(후속 저장 API), 저장으로 얻은 `courseId`를 [S01 러닝 세션 생성](sessions.md#s01-러닝-세션-생성)에 사용한다.

> **대체 안내:** 이전 1차 MVP의 `targetDistanceM`·`goalInputType`·`environmentTypes`·`radiusM`·`limit` 기반 DB `ACTIVE` 코스 검색 계약은 C01에서 폐기한다. 저장된 공용 코스의 조회·저장은 [C03](#c03-코스-상세-조회)·[C07](#c07-코스-저장)·[C09](#c09-저장-코스-목록)가 담당한다.

### 인증 및 권한

- 로그인 사용자(JWT Access Token). 기존 코스 API와 동일하다.
- 위치 좌표는 클라이언트가 전달한다. 앱에서 위치 권한을 받으며, 이 API는 서버측 `LOCATION_CONSENT`를 별도 검사하지 않는다.
- 추천 입력에 페이스·목표 시간·심박·계정 개인정보·건강 데이터는 사용하지 않는다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `latitude` | number | O | 출발 위도(WGS84). 서비스 지역(부산) 범위 밖이면 `422 INVALID_SEARCH`(OUT_OF_AREA) |
| `longitude` | number | O | 출발 경도(WGS84). 서비스 지역(부산) 범위 밖이면 `422 INVALID_SEARCH`(OUT_OF_AREA) |
| `distanceKm` | number | O | 목표 거리(km). 1.0 이상 15.0 이하 |
| `shape` | string | X | `loop`(기본) / `out_and_back` / `point_to_point`. 대소문자 무시, 생략·빈 값은 `loop` |
| `endLatitude` | number | 조건부 | `point_to_point`에서 필수인 도착 위도 |
| `endLongitude` | number | 조건부 | `point_to_point`에서 필수인 도착 경도 |
| `filters` | object | X | 선호·회피 조건. 생략하면 모두 `false` |
| `seed` | integer | X | 생성 시드. 기본 1, 1 이상 10,000,000 이하. 같은 입력·같은 seed면 같은 결과 |

**서비스 지역(부산) 판정:** 출발 좌표가 위도 35.02~35.40, 경도 128.75~129.30 사각형 안에 있어야 한다(현재 구현 기준 근사 박스). Route 데이터 범위가 이 사각형보다 넓으므로, Route 실연동 시 백엔드의 사각형 사전 검증을 제거하고 Route의 `OUT_OF_AREA` 판정을 그대로 사용한다(2026-11-05 AI 팀 협의, 구현은 S15P31E105-423). 위경도 형식·범위 검증은 백엔드가 유지한다. MVP 서비스 지역은 부산이며, 전국 확장은 [S15P31E105-433](https://ssafy.atlassian.net/browse/S15P31E105-433)에서 다룬다.

**`point_to_point` 규칙:** 도착 좌표 둘 다 필수. 출발-도착 직선거리가 **17km**를 넘으면 `422 INVALID_SEARCH`(OUT_OF_APP_RANGE). `loop`·`out_and_back`에서 `endLatitude`/`endLongitude` 중 한쪽만 보내면 `422 INVALID_SEARCH`이며, 둘 다 보내면 무시된다. 도착 좌표 자체의 위경도 범위(-90~90, -180~180)는 모든 경우 검증한다.

`filters` 필드(모두 선택, boolean, 기본 `false`. `true`면 해당 조건을 요청):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `filters.river` | boolean | X | 강변 경로 선호 |
| `filters.beach` | boolean | X | 해변 경로 선호 |
| `filters.park` | boolean | X | 공원 경로 선호 |
| `filters.trail` | boolean | X | 트레일(흙길·산책로) 선호 |
| `filters.pedestrian` | boolean | X | 보행자 전용·보행 친화 경로 선호 |
| `filters.avoidMajorRoad` | boolean | X | 큰 도로 회피 |
| `filters.avoidSteps` | boolean | X | 계단 회피 |
| `filters.avoidTunnel` | boolean | X | 터널 회피 |
| `filters.flat` | boolean | X | 평탄한 경로 선호 |

> `null`·생략은 `false`로 취급한다. 선호/회피 조건은 **가중치성 요청**이며 모든 조건을 만족하는 후보가 항상 있다고 보장하지 않는다. 알 수 없는 `filters` 키의 처리(무시 vs 오류)는 미정이다.

요청 예시 — 루프(기본):

```json
{
  "latitude": 35.1796,
  "longitude": 129.0756,
  "distanceKm": 5.0,
  "shape": "loop",
  "filters": {
    "river": true,
    "park": true,
    "avoidMajorRoad": true
  },
  "seed": 1
}
```

요청 예시 — 편도(`point_to_point`):

```json
{
  "latitude": 35.1587,
  "longitude": 129.1604,
  "distanceKm": 8.0,
  "shape": "point_to_point",
  "endLatitude": 35.1532,
  "endLongitude": 129.1186,
  "filters": {
    "beach": true,
    "flat": true
  },
  "seed": 25
}
```

### Response

`200 OK`

```json
{
  "courses": [
    {
      "index": 0,
      "distanceM": 5000.00,
      "route": {
        "type": "LineString",
        "coordinates": [
          [129.0756, 35.1796],
          [129.0786, 35.1803],
          [129.0756, 35.1796]
        ]
      }
    },
    {
      "index": 1,
      "distanceM": 5000.00,
      "route": {
        "type": "LineString",
        "coordinates": [
          [129.0756, 35.1796],
          [129.0771, 35.1821],
          [129.0756, 35.1796]
        ]
      }
    },
    {
      "index": 2,
      "distanceM": 5000.00,
      "route": {
        "type": "LineString",
        "coordinates": [
          [129.0756, 35.1796],
          [129.0741, 35.1771],
          [129.0756, 35.1796]
        ]
      }
    }
  ],
  "nextSeed": 25
}
```

> 위 `coordinates`는 형태 예시를 위해 점 수를 줄인 값이다. 실제 응답은 경로를 따라가는 다수의 점을 포함한다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses` | array | O | 생성된 경로 후보 목록(현재 스텁은 3개). 후보는 저장되지 않는다 |
| `nextSeed` | integer | O | "다른 경로 더 보기"에 쓰는 다음 시드. 요청 `seed + 24` |

`courses[]` 필드:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `courses[].index` | integer | O | 이번 응답 내 후보 순번(0부터). **코스 ID가 아니다** |
| `courses[].distanceM` | number | O | 경로 거리(m). `courses.distance` 저장 시 사용하는 값. 요청 `distanceKm`과 정확히 같다고 보장하지 않는다(Route 실연동 시 실제 길이 기준, 미정) |
| `courses[].route` | object | O | GeoJSON `LineString`. 좌표는 `[경도, 위도]` 순서(GeoJSON·PostGIS 기준) |

**응답에 없는 필드:** `courses[].id`(저장 전이므로 없음), `status`, `regionCode`, `environmentTags`, `estimatedDurationSec`. 예상 시간은 이 API의 책임이 아니며 목표 페이스를 아는 [S01](sessions.md#s01-러닝-세션-생성) 목표 설정·코스 상세([C03](#c03-코스-상세-조회))의 `targetPaceSecPerKm` 계산 쪽에서 다룬다. 좌표 순서 주의: AI 내부 `coords`는 `[lat,lon]`이고 공개 API는 GeoJSON `[lon,lat]`이다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 INVALID_SEARCH` | 검색 조건 | 아래 표의 조건 |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조, 토큰 사용자가 존재하지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·자료형 불일치(예: 숫자 필드에 문자열) |

`422 INVALID_SEARCH`의 세부 조건. 현재 구현은 **응답 `code`를 모두 `INVALID_SEARCH`로 통일**하고 `message`로 구분한다. 괄호의 식별자는 내부 구분용 이름이며 응답 필드로 확정되지 않았다(세분화 코드/`details` 노출 여부는 미정).

| 내부 식별자 | 조건 | 메시지(현재 구현) |
|---|---|---|
| (조건 누락) | 요청 본문이 비어 있음 | 추천 조건이 필요합니다. |
| (형식) | `latitude`/`longitude`/`distanceKm`/`endLatitude`/`endLongitude`가 null·NaN·무한대 | `{필드}이(가) 올바르지 않습니다.` |
| (범위) | `latitude`가 -90~90 밖 | latitude는 -90~90이어야 합니다. |
| (범위) | `longitude`가 -180~180 밖 | longitude는 -180~180이어야 합니다. |
| `OUT_OF_AREA` | 출발 좌표가 서비스 지역(부산) 밖 | 출발 위치가 서비스 지역(부산) 밖입니다. |
| `DISTANCE_RANGE` | `distanceKm`가 1.0 미만 또는 15.0 초과 | distanceKm는 1.0 이상 15.0 이하여야 합니다. |
| (shape) | `shape`가 허용 값이 아님 | shape는 loop, out_and_back, point_to_point 중 하나여야 합니다. |
| `DESTINATION_REQUIRED` | `point_to_point`인데 도착 좌표 누락, 또는 다른 shape에서 도착 좌표를 한쪽만 전달 | point_to_point에는 endLatitude와 endLongitude가 필요합니다. |
| `OUT_OF_APP_RANGE` | `point_to_point` 출발-도착 직선거리 17km 초과 | 출발-도착 직선거리가 서비스 상한을 초과했습니다. |
| (seed) | `seed`가 1 미만 또는 10,000,000 초과 | seed는 1 이상 10000000 이하여야 합니다. |

- Route 실연동 후 추가 후보(문서 미확정, [S15P31E105-370](https://ssafy.atlassian.net/browse/S15P31E105-370)에서 확정): `NO_ROAD_NEARBY`(출발점 주변 도로 없음), `DESTINATION_TOO_FAR`(도착점이 Route 처리 범위 밖), `NOT_READY`(Route 데이터/서비스 준비 중), 외부 호출 타임아웃·장애. 현재 코드에는 구현되어 있지 않다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 조건에 맞는 경로를 만들지 못한 경우의 응답(빈 `courses` vs 오류)은 Route 실연동 시 확정한다. 현재 스텁은 항상 후보를 반환한다.

### 처리 규칙

- **입력 검증 후 생성기 호출:** 서버는 위 입력만 검증·정규화해 경로 생성기(AI Route, 현재는 스텁 어댑터)에 전달한다. 사용자 프로필·페이스·건강·계정 정보를 생성 입력에 추가하지 않는다.
- **shape별 경로:** `loop`는 출발점으로 돌아오는 순환, `out_and_back`은 왕복, `point_to_point`는 출발→도착 편도다.
- **정규화:** `shape` 생략은 `loop`, `filters` 생략·개별 null은 `false`, `seed` 생략은 1.
- **seed 흐름(다른 경로 더 보기):**
  1. 첫 호출은 `seed` 생략(=1) 또는 임의 값으로 요청한다.
  2. 응답의 `nextSeed`(= 요청 seed + 24)를 같은 조건으로 다시 보내면 다른 후보 묶음을 받는다.
  3. 같은 입력·같은 `seed`는 같은 결과를 반환(재현성). 스텁은 `index`·seed로 경로 시작 각도만 바꾼 더미를 낸다.
  4. `nextSeed`가 상한(10,000,000)을 넘으면 다음 요청이 `INVALID_SEARCH`가 되므로 클라이언트는 상한 근처에서 다시 1로 돌리거나 더 보기를 막는다(상한 도달 시 서버 동작은 미정).
- **선택 후 저장(select-then-save):** C01 응답의 후보는 DB에 저장하지 않으며 코스 ID가 없다. 사용자가 후보 하나를 선택하면 **그 경로만** 후속 저장 API로 `courses`에 저장한다([코스 생성 후속](#코스-생성-후속-필요-사항), 후속 Jira: 선택 코스 저장). 선택하지 않은 후보는 공용 코스·추천 대상이 되지 않는다. 저장된 AI 생성 코스는 출발점=경로 첫 좌표, `creator_id`·`source_session_id`·`region_code`·`description`=NULL, 상태 `ACTIVE`이며 경사는 [elevationProfile 구조](#elevationprofile-100m-경사-구조)를 따른다.
- **세션 연결:** 저장으로 얻은 `courseId`를 [S01](sessions.md#s01-러닝-세션-생성)의 `courseId`로 보낸다. S01은 `ACTIVE` 코스만 허용한다. 이 코스의 `source_session_id`는 NULL이다.
- **페이스 없음:** 추천 요청에 목표 페이스·TIME·goal이 없고 응답에 `estimatedDurationSec`도 없다. 목표는 S01(및 S08)에서 정한다.
- **개인정보:** 개인 저장 별명 등 사용자 데이터를 생성 입력·응답에 넣지 않는다.
- **현재 구현 상태:** BE는 계약·검증과 스텁 어댑터까지 구현되어 있다. 실제 Route 호출·DEM 경사 계산·저장은 후속 업무([S15P31E105-370](https://ssafy.atlassian.net/browse/S15P31E105-370), [S15P31E105-369](https://ssafy.atlassian.net/browse/S15P31E105-369), [S15P31E105-371](https://ssafy.atlassian.net/browse/S15P31E105-371))에서 다룬다.

### 상태값

- 후보는 저장 전이므로 코스 상태값이 없다. 저장 후 상태는 `ACTIVE`이며 이후 상태 규칙은 [코스 상태별 사용 범위](#코스-상태별-사용-범위)를 따른다.

### 미정 사항

아래 후보 수·거리·오류·시간 예산·중복 기준의 제안은 [370 후속 초안](#코스-생성-후속-필요-사항)에 정리했다. **팀 확인 및 구현 전**이며 위 현행 C01 계약을 자동 대체하지 않는다.

- [ ] 선택 코스 저장 API 경로·요청/응답·멱등 처리·중복 경로 기준 (후속 Jira)
- [ ] 후보 개수(현재 스텁 3개)와 `courses[].distanceM` 허용 오차(요청 거리 대비)
- [ ] 알 수 없는 `filters` 키 처리, 조건 불충족 시 응답 방식
- [ ] Route 실연동 오류 코드 세분화(`NO_ROAD_NEARBY`, `DESTINATION_TOO_FAR`, `NOT_READY` 등)·동기/비동기·타임아웃
- [x] 서비스 지역 판정: 부산 사각형 사전 검증을 제거하고 Route `OUT_OF_AREA` 기준으로 교체(2026-11-05 AI 팀 협의, 구현 S15P31E105-423)
- [ ] `nextSeed` 상한 초과 시 서버 동작

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

**상태: S15P31E105-370 계약 초안, 2026-11-04.** 아래 추가 필드·오류 매핑·시간 예산·중복 기준은 제안이며 현재 C01 스텁의 구현 완료 계약이 아니다. Route 담당(AI 팀) 확인은 설명·점수 응답 필드만 받았고(2026-11-05 AI 팀 회신), 나머지 항목은 확인 전이다. 공개 API를 새로 만들지 않고 기존 `POST /api/v1/courses/recommendations`(C01)의 실연동 후속 계약으로 제안한다. 요구사항 CRS-003·SYS-002에는 DB `ACTIVE` 코스 추천 설명이 남아 있으나, 현행 C01의 명시적 대체 안내를 따른다. 이 초안으로 요구사항 전체를 변경하지 않는다.

### 생성 흐름과 요청 초안

1. 회원 인증·현행 C01 입력 검증 및 정규화 후 내부 생성기에 요청한다. 목표 페이스·건강정보·사용자 ID·사용자 토큰은 Route에 전달하지 않는다.
2. 생성기는 점수·Gate를 통과한 후보를 순위대로 최대 3개 반환한다. 백엔드는 좌표를 GeoJSON으로 바꾸고 DEM에서 고도를 조회해 100m 경사 목록을 계산한다.
3. Route가 반환한 요약·추천 이유·주의 문구·점수·안내를 공개 필드로 옮겨 후보 응답에 조합한다. 설명 문구의 생성 주체는 Route다(2026-11-05 AI 팀 회신. 2026-11-04의 백엔드 LLM 생성 안은 폐기). 이 호출은 `courses`·북마크·세션에 쓰지 않는다.
4. 사용자가 선택한 경로만 후속 저장 API에서 저장한 뒤, 받은 `courseId`로 S01을 호출한다. C07 북마크는 이미 저장된 코스에 대한 별도 관계다.

| 요청 | 실연동 초안 |
| --- | --- |
| `latitude`, `longitude` | 현행 C01 출발 WGS84 위경도 형식·범위 검증 유지. **부산 사각형 사전 검증은 제거**하고 서비스 지역 판정은 Route `OUT_OF_AREA`를 `422 INVALID_SEARCH`(`OUT_OF_AREA`)로 전달(2026-11-05 AI 팀 협의). Route 데이터 범위가 사각형보다 넓어 정상 위치를 백엔드가 먼저 거절하지 않게 하고, 이후 지역 확장 때 백엔드 변경 없이 Route 기준을 따르기 위함 |
| `distanceKm` | 현행 1.0~15.0km. 목표는 m로 환산해 생성·거리 오차 검증에 사용 |
| `shape` | 현행 `loop` 기본, `out_and_back`, `point_to_point` 유지 |
| `endLatitude`, `endLongitude` | 현행 편도 필수·다른 shape 한쪽만 전달 시 거절·둘 다면 무시 유지. 편도 직선거리 17km 상한 유지 |
| `filters` | 기존 9개 boolean 키 유지. 누락·null은 false. 알 수 없는 키는 `400 VALIDATION_ERROR`로 거절하는 안을 제안(현재 처리의 확정 아님) |
| `seed` | 현행 기본 1, 범위 1~10,000,000 유지. 같은 정규화 입력·동일 생성기/데이터/설정 버전 안에서 재현성 보장 |

출발점·도착점은 도로망에 스냅될 수 있다. 허용 이동은 Route 현행 최대 250m를 제안하며, 경로 첫/끝 좌표가 사용자가 고른 좌표와 정확히 같다고 보장하지 않는다. `loop`·`out_and_back`은 경로 첫/끝 좌표가 같고, 편도는 스냅된 출발→도착 순서를 유지한다.

### 후보 응답 초안

현행 최상위 `courses`, `nextSeed` 및 후보 `index`, `distanceM`, `route`를 유지하고 아래 필드를 추가하는 안이다. 현재 DTO·스텁에는 추가 필드가 없다.

| 필드 | 타입·필수 여부 | 생성 후속 제안 |
| --- | --- | --- |
| `courses` | array, 필수 | 1~3개. 3개 미만이면 찾은 후보만 반환하며 복제해 채우지 않는다. 0개는 아래 `NO_ROUTE` 오류 |
| `courses[].index` | integer, 필수 | 응답 순위대로 0부터 연속 부여. 코스 ID·영속 선택 토큰이 아님 |
| `courses[].distanceM` | number, 필수 | Route가 계산한 실제 경로 길이(m), 소수 둘째 자리 반올림. 목표 거리 대비 ±10% 이내를 제안(Route 현행 유효성 기준). 목표 거리로 덮어쓰지 않음 |
| `courses[].route` | object, 필수 | WGS84 GeoJSON `LineString`, `[경도, 위도]` 2D 좌표 2개 이상. 순서·방향·모든 점을 보존하며 Z 고도는 넣지 않음 |
| `courses[].elevationProfile` | object[], 필수 | **백엔드 계산값**. [100m 경사 구조](#elevationprofile-100m-경사-구조)의 `startDistanceM/endDistanceM/gradePercent`를 사용. 별도 sequence 없이 배열 순서로 구분. 거리·마지막 잔여 구간·null 금지 검증도 동일 |
| `courses[].summary` | string, 필수 | Route가 만든 한 줄 요약(예: "강변을 많이 지나는 코스예요."). 저장할 공용 코스 이름이나 `courses.description`이 아님 |
| `courses[].reasons` | string[], 필수 | Route가 만든 추천 이유 목록(예: "강변 구간이 40%예요"). 없으면 빈 배열. 현행 Route는 최대 4개 |
| `courses[].caveats` | string[], 필수 | Route가 만든 주의 문구(예: "계단이 1곳 있어요"). 없으면 빈 배열 |
| `courses[].score` | number, 필수 | Route 규칙 기반 총점. `scoreTerms[].contribution`의 합. **같은 응답 안 후보 설명용**이며 요청 간 비교·저장·클라이언트 재정렬에 쓰지 않음. 순위는 `index` |
| `courses[].scoreTerms` | object[], 필수 | 항목별 점수. 없으면 빈 배열. 각 항목은 아래 표 |
| `notices` | string[], 필수 | 응답 전체 안내(예: "이 주변은 공원 정보가 일부만 있어요"). 후보 부족·스냅·선호 정보 부족 포함. 없으면 빈 배열 |
| `nextSeed` | integer, 필수 | 현행 `요청 seed + 24` 유지. 10,000,000을 넘으면 클라이언트는 더 보기를 중단. 그 값을 그대로 재요청하면 기존 422, 자동 순환·서버 clamp는 제안하지 않음 |

`courses[].scoreTerms[]` 필드(Route `score_terms`의 snake_case를 camelCase로만 바꾼다):

| 필드 | 타입·필수 여부 | 설명 |
| --- | --- | --- |
| `term` | string, 필수 | 항목 키. 열린 집합이며 현행 예는 `distance_fit`(목표 거리 적합도), `river`·`park` 등 선호, `avoid_major_road` 등 회피, `difficulty_flat`(평지 점수, 평균 경사가 클수록 감점), `repeated_edge_penalty`·`out_and_back_penalty`, `running_suitability`. 클라이언트는 모르는 키도 `label`로 표시 |
| `label` | string, 필수 | 표시용 한국어 이름(예: "목표 거리 적합도") |
| `group` | string, 필수 | `base`/`preference`/`avoid`/`difficulty`/`shape`/`suitability` 등 분류. 열린 집합 |
| `featureValue` | number, 필수 | 항목 계산에 쓴 경로 특성값 |
| `weight` | number, 필수 | 적용 가중치 |
| `contribution` | number, 필수 | 총점 기여도. 감점 항목은 음수 |

`difficulty_flat`은 `filters.flat=true`이고 고도 자료가 있을 때만 포함된다. 선택하지 않은 선호·회피 항목은 포함되지 않는다.

추가 필드를 포함한 **단일 후보 객체의 축약 예시**다. 경로 중간 점과 전체 경사 목록, 일부 점수 항목은 생략했으며 숫자는 형태 예시다. 거리 계산용·저장용 데이터가 아니다.

```json
{
  "index": 0,
  "distanceM": 5020.0,
  "route": {"type": "LineString", "coordinates": [[129.0756, 35.1796], [129.0786, 35.1803], [129.0756, 35.1796]]},
  "elevationProfile": [{"startDistanceM": 0.0, "endDistanceM": 100.0, "gradePercent": 0.8}],
  "summary": "강변을 많이 지나고 평지 위주인 코스예요.",
  "reasons": ["강변을 많이 지나요", "평지 위주예요"],
  "caveats": ["계단이 1곳 있어요"],
  "score": 1.42,
  "scoreTerms": [
    {"term": "distance_fit", "label": "목표 거리 적합도", "group": "base", "featureValue": 0.96, "weight": 1.0, "contribution": 0.96},
    {"term": "difficulty_flat", "label": "평지 선호", "group": "difficulty", "featureValue": 1.2, "weight": 0.15, "contribution": -0.18}
  ]
}
```

응답 최상위에는 `courses`, `notices`(예: `["이 주변은 공원 정보가 일부만 있어요"]`), `nextSeed`가 온다.

설명 문구는 Route 원문을 일반 텍스트로 그대로 표시한다. 백엔드는 번역·재작성·LLM 생성을 하지 않고, 클라이언트는 HTML로 해석하지 않는다. 문구·점수 항목의 길이·개수 상한은 [Route 내부 계약](ai-service.md#route-응답-크기-상한)을 따른다(`summary` 100자, `reasons`·`caveats`·`notices` 각 6개, 좌표 3,000점 등).

경사 계산이 준비되지 않았거나 실패하면 가짜 평지·빈 경사로 성공시키지 않는다. 한 후보라도 잘못된 경로·거리·경사를 반환하면 전체 요청을 실패시키는 안이다. Route가 합법적으로 1~2개만 찾은 경우와 잘못된 후보를 임의 제거하는 경우를 구분한다. 현행 `distanceM`은 도로 edge 길이이고 경사 재표본은 경로 좌표를 사용하므로, 두 길이의 일치 허용 오차와 최종 거리 축 정규화는 369·371과 실연동 구현 전 확정해야 한다. 이 수치가 정해지기 전 경사/저장 연결을 구현 완료로 취급하지 않는다.
### 실패와 시간 예산 초안

공개 오류는 기존 공통 `{code,message,details}`를 사용한다. 아래 `details.reason`은 **추가 제안**이며 현행 C01의 message 구분과 다르다. Route의 원본 message·debug·요청 좌표·traceback은 전달하지 않고 백엔드의 고정 안내와 허용한 reason만 사용한다.

| HTTP·code | `details.reason` 제안 | 처리·클라이언트 행동 |
| --- | --- | --- |
| 400 `VALIDATION_ERROR` | 없음 | JSON·자료형·알 수 없는 필터 키. 필드명/사유만 노출 |
| 401 `UNAUTHORIZED` | 없음 | 현행 회원 인증 규칙 유지 |
| 422 `INVALID_SEARCH` | 현행 범위 사유, `NO_ROAD_NEARBY`, `DESTINATION_TOO_FAR`, `NO_ROUTE` | 조건 수정 필요. Gate 전체 탈락도 `NO_ROUTE`. 같은 조건 자동 재시도 없음 |
| 503 `SERVICE_UNAVAILABLE` | `ROUTE_NOT_READY`, `ROUTE_BUSY`, `ROUTE_TIMEOUT`, `ROUTE_UNAVAILABLE`, `ROUTE_INVALID_RESPONSE`, `GRADE_NOT_READY`, `GRADE_UNAVAILABLE`, `GENERATION_TIMEOUT` | 준비·과부하·연결·시간초과·상류 형식 오류・DEM 의존 장애. 더미 경로 fallback 없이 재시도 안내 |
| 500 `INTERNAL_ERROR` | 없음 | 백엔드의 예상하지 못한 오류·계산 결과 불변식 위반. 내부 정보 노출 없음 |

`DESTINATION_TOO_FAR`는 단순 서비스 영역 밖이 아니라 **목표 거리로 해당 도착점까지 갈 수 없음**이다. 내부 오류 세부 매핑은 [Route 내부 계약](ai-service.md#route-코스-생성-내부-http-계약-초안)을 따른다. 새로운 502/504 공개 코드를 공통 규약에 추가하지 않는다.

백엔드 조합 단계도 아래처럼 구분한다. Route가 성공했어도 DEM 미준비는 `GRADE_NOT_READY`, 처리 중 확인된 DEM I/O·의존 데이터 접근 실패는 `GRADE_UNAVAILABLE`이다. **C01 전체 20초 예산이 어느 단계에서든 먼저 만료되면 `503 SERVICE_UNAVAILABLE`, `details.reason=GENERATION_TIMEOUT`**, 고정 message `코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.`를 제안한다. Route 호출의 15초 상한이 먼저 만료될 때만 `ROUTE_TIMEOUT`이다. 예를 들어 Route가 11.9초에 성공하고 DEM이 8.2초 걸리면 전체 20초 시점에 `GENERATION_TIMEOUT`으로 실패한다. DEM 실패나 전체 시간초과는 준비된 Route의 장애로 기록하지 않으며, 예상하지 못한 계산 불변식 위반은 위 500으로 구분한다.

**동기 방식 제안:** 단일 요청에서 후보·경사를 반환한다. 비동기 작업 생성/조회 API는 도입하지 않는다. 다음은 부하·DEM·모바일 검증 전 **시간 예산 제안**이며 성능 SLA나 배포 설정 변경이 아니다.

| 구간 | 제안 상한 | 포함 범위 |
| --- | --- | --- |
| Route admission·생성 | 12초 | 대기를 포함한 전체 처리. 실행 1건·대기 1건까지만 받고 나머지는 `BUSY`. 남은 예산이 6초 미만이면 계산을 시작하지 않고 `TIMEOUT`. 리눅스 실측 최악 처리 4.5초(2026-11-05 AI 팀) |
| BE→Route HTTP | 15초 | 연결 최대 1초를 포함한 전체 호출 wall-clock. 읽기 대기 1회마다 15초가 아님 |
| C01 백엔드 | 20초 | Route 호출·변환·최대 3개 DEM 계산·응답 직렬화 전체. 남은 예산 없으면 실패 |
| 공개 proxy / 모바일 | 25초 / 30초 | proxy 전체 요청 한도 / 클라이언트 전체 대기 한도. 운영·FE 확인 필요 |

12 < 15 < 20 < 25 < 30초로 하위 실패를 상위가 응답할 여유를 둔다. Route 처리는 리눅스 실측 최악 4.5초로 12초 안에 여유가 있다(AI 팀 측정). DEM 계산·cold 기동·동시 요청 실측은 남아 있다. Route 계산은 중간 취소가 어려우므로 [Route 대기·시작 조건](ai-service.md#route-시간-예산동시성과-재시도)으로 늦게 끝날 계산을 시작하지 않는 방식을 쓴다. 긴 대기열로 지연을 숨기지 않는다. 만족하지 못하면 ADR-0019 판정 절차로 돌아가며 런타임에서 임의로 Java/스텁을 재호출하지 않는다.

백엔드 전체 예산이 끝나면 부분 후보를 성공 응답하지 않고, 남은 Route/DEM 작업의 취소를 시도하며 늦게 온 결과를 버린다. 응답 직렬화 전에도 남은 예산을 확인하고 deadline 이후 정상 응답을 시작하지 않는다. DEM/직렬화 작업의 시간 제한·취소와 점유 자원 회수도 후속 구현의 검증 조건이며, HTTP 연결 종료만으로 회수가 끝났다고 보지 않는다. 실패 뒤 자동 재시도·저장·백그라운드 저장은 하지 않는다.

BE는 같은 요청에서 자동 재시도하지 않는다. 사용자가 명시적으로 다시 시도하면 입력·seed를 유지해 새 호출을 시작하고 중복 탭은 막는다. C01은 DB 쓰기가 없어 재호출이 코스 저장을 중복시키지 않지만, 이전 계산이 남아 있을 수 있으므로 요청 빈도·동시 실행 상한은 Route가 제한해야 한다. 모바일 취소/연결 끊김 뒤 결과는 버리며 자동 저장하지 않는다. 선택 저장 재시도는 아래 별도 멱등 정책 대상이다.

### 선택 저장·중복과 태그 경계

**확정된 저장 시점:** 후보 전부를 저장하지 않고 사용자가 선택한 경로만 `courses`에 저장한다. 서버 내부 저장 로직(319)의 출발점=경로 첫 좌표, `creator_id/source_session_id/region_code/description`=NULL, 상태 `ACTIVE`, 100m 경사 형식을 유지한다. 공개 선택 저장 API 경로·요청·응답은 이번에 추가하지 않는다. 기존 내부 저장 메서드는 매번 INSERT하며 아래 중복 방지·멱등 처리를 아직 보장하지 않는다.

| 구분 | 370 제안·후속 구현 조건 |
| --- | --- |
| 재생성 | C01의 같은 seed나 응답 `index`를 영속 식별자로 쓰지 않는다. 생성기·데이터 갱신으로 같은 입력의 결과가 달라질 수 있음 |
| 정확히 동일한 경로 | WGS84 2D 좌표의 숫자값·순서·방향·출발점이 모두 같은 경로만 중복 후보로 본다. JSON 공백·숫자 표기 차이는 무시하되 좌표를 추가 반올림·단순화하지 않음 |
| 유사·역방향 경로 | 겹침률이 높아도 자동 병합하지 않는다. 순환 출발점 이동·역방향·다른 좌표 표본화는 별개다. Route의 **한 응답 안 후보 dedupe**와 DB 공용 코스 병합은 다른 정책 |
| 재시도·동시 선택 | 후속 선택 저장 API는 사용자 범위 멱등키와 서버 검증한 선택 내용의 일치를 검사하고 같은 결과 `courseId`를 반환하도록 설계해야 함. 다른 내용의 키 재사용은 충돌로 처리하는 안. 원자적 중복 방지는 후속 저장 설계에서 확정 |
| 상태·검증 | 재사용 대상이 `ACTIVE`인지 확인하고 `MERGED/BLOCKED`를 우회해 새 활성 복제본을 만들지 않음. 정확 경로 중복과 기존 상태 정책의 원자적 적용이 필요 |
| 신뢰 경계 | 클라이언트가 제출한 경로·거리·경사를 그대로 INSERT하지 않음. 선택 결과를 서버가 검증하는 방법(서명 후보 또는 만료되는 서버 후보 참조)·보존 기간·길이 허용 오차는 저장 API 설계에서 확정 |

**선호와 태그:** 요청 boolean은 가중치이며 실제 환경의 증거가 아니다. `river→RIVERSIDE`, `beach→BEACH`, `park→PARK`는 이름상의 대응 후보일 뿐 true라고 저장하지 않는다. `trail`, `pedestrian`, 회피 3종·`flat`에 대응하는 저장 enum은 없으며 `URBAN/TRACK`을 추론하지 않는다. [내부 매핑 표](ai-service.md#route-선호와-저장-태그-매핑)에 9개 키를 정리한다. 실제 경로 기반 태깅 근거·임계값은 후속이며 스키마 enum을 늘리지 않는다.

### 생성기 교체와 남은 확인

기존 `CourseRecommendPort.recommend(CourseRecommendCommand)`를 백엔드 내부 생성 경계로 재사용한다. HTTP 어댑터가 Route의 순위·좌표·오류를 공개 형식에 맞추고, 경사 계산·선택 저장은 생성기 밖의 백엔드 공통 처리에 둔다. 설명 문구·점수는 생성기 출력이며, 생성 주체가 백엔드 Java로 바뀌면 같은 필드를 Java 생성기가 채운다. 기존 포트는 공개 Response를 반환하므로 추가 경사·설명·점수 DTO 조합 위치는 실연동 구현 때 정하되, Java 이식 때문에 Controller·C01 URL/요청/응답·단위·오류·저장 시점을 바꾸지 않는다. 바뀌는 범위는 내부 생성기 구현과 그 연결뿐이며 Java 알고리즘·배포 설계는 별도 업무다.

- AI 확인 대기: [운영용 Route 내부 계약](ai-service.md#route-코스-생성-내부-http-계약-초안)의 URL·본문·오류·메타데이터·큐/시간 상한. 담당 확인 없이 확정으로 바꾸지 않는다.
- AI 팀 확인 완료(2026-11-05 회신): 후보별 `summary`·`reasons`·`caveats`·`score`/`scoreTerms`와 응답 전체 `notices`를 Route가 제공한다. 추천 이유는 Route에서 이미 생성하며 백엔드 LLM 생성은 하지 않는다.
- FE/BE 확인 대기: 경사·설명·점수·notices 추가, 점수 표시 여부, 부족 후보 안내, 동기 대기·취소·더 보기 상한 UI.
- 369·371 및 저장 API 후속: 거리 축 일치 허용 오차, 후보 진위 검증·멱등키·동시 중복 방지, AI 계획 전달. `StoredCourseGradeSource` 연결·FE 고도 그래프의 경사 누적 변환도 후속이다.
- 출발점의 지역 역지오코딩·태깅은 미정. `region_code` NULL 원칙을 유지한다.
- Route는 HR 추론 `ai/service`와 별도 컨테이너이며, DEM/OSM/env 데이터 배포·최적화·성능 판정은 [ADR-0019](../../adr/0019-course-generation-backend.md)와 담당 업무를 따른다.

러닝 종료 후 경로 **자동 반영**(COM-002)은 아래 절·별도 구현 업무이며 C01과 구분한다.

## 러닝 경로 자동 코스 반영

- 사용자가 달린 경로는 러닝 종료 후 기록에 반영되는 과정에서 공용 코스로 자동 등록한다. 별도 등록 버튼이나 C04 요청을 요구하지 않는다.
- 지연 동기화로 경로가 완성되면 해당 기록 기준으로 자동 반영한다. 재전송·재처리·동일 경로로 공용 코스가 무분별하게 중복 생성되지 않도록 한다.
- 경로 없는 기록·유효하지 않은 GPS·유사 코스 판정·환경 태그 부여·상태 승계 등 구체 계약은 미정이다. 사용자에게 등록 이름·태그를 입력받는 흐름을 전제하지 않는다.
- 자동 코스 등록과 개인 저장은 별개다. C07 저장·별명 설정, C08 저장 해제, C09 저장 목록은 유지한다. 자동 북마크 여부는 이 결정으로 확정하지 않는다.
- 계정의 프로필·게시물 공개 여부와 공용 코스 반영을 구분한다. 공용 경로에 사용자 식별정보를 연결해 노출할지와 경로 처리의 세부 정책은 별도 검토하며 자동 등록 여부 자체는 사용자 결정이다.
- C04 ID는 공개 API에서 제외하며 재사용하지 않는다.
