# API 명세 — 크루

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [M01](#m01-크루-검색) | 크루 검색 | GET | `/crews` | 1차 MVP | 회원 |
| [M02](#m02-크루-상세) | 크루 상세 | GET | `/crews/{crewId}` | 1차 MVP | 회원 |
| [M03](#m03-크루-생성) | 크루 생성 | POST | `/crews` | 1차 MVP | 회원 |
| [M04](#m04-크루-가입-신청) | 크루 가입 신청 | POST | `/crews/{crewId}/join-requests` | 1차 MVP | 회원 |
| [M05](#m05-크루-가입-신청-목록) | 크루 가입 신청 목록 | GET | `/crews/{crewId}/join-requests` | 1차 MVP | 회원 |
| [M06](#m06-크루-가입-승인거절) | 크루 가입 승인·거절 | PATCH | `/crews/{crewId}/join-requests/{userId}` | 1차 MVP | 회원 |
| [M07](#m07-크루-멤버-목록) | 크루 멤버 목록 | GET | `/crews/{crewId}/members` | 1차 MVP | 회원 |
| [M08](#m08-크루-탈퇴) | 크루 탈퇴 | DELETE | `/crews/{crewId}/members/me` | 1차 MVP | 회원 |
| [M09](#m09-크루-멤버-내보내기) | 크루 멤버 내보내기 | DELETE | `/crews/{crewId}/members/{userId}` | 선택 기능 | 회원 |
| [M10](#m10-내-크루-목록) | 내 크루 목록 | GET | `/users/me/crews` | 1차 MVP | 회원 |
| [M11](#m11-크루-해산) | 크루 해산 | DELETE | `/crews/{crewId}` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

crews와 crew_memberships를 구분한다. 크루 상태는 ACTIVE/INACTIVE, 가입 상태는 PENDING/APPROVED/REJECTED/LEFT다. myMembershipStatus는 본인의 가입 관계가 없으면 null이며 가입 상태와 크루 상태를 혼용하지 않는다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## M01 크루 검색

`GET` `/api/v1/crews`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 관련 화면 | 6.0b 가입한 크루 없음, 6.1 크루 모집 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

크루 공개 검색 범위 정책 미정. 이번 구현 범위는 `q`·`regionCode`다. 근처(좌표) 검색 파라미터는 명세에 유지하되 **미구현**이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `q` | string | X | 크루 이름 부분 일치 검색어 |
| `regionCode` | string | X | `crews.region_code` 정확 일치 필터. NULL인 크루는 이 필터에 포함되지 않음 |
| `latitude` | number | X | '내 근처' 기준 위도. **미구현** — 스키마에 크루 좌표가 없어 현재 무시하거나 거부 정책은 후속 확정 |
| `longitude` | number | X | '내 근처' 기준 경도. **미구현** |
| `radiusM` | number | X | 검색 반경(화면 기본 3km). **미구현** |
| `level` | string | X | BEGINNER/INTERMEDIATE/ADVANCED. **미구현** — `crews`에 level 컬럼 없음 |
| `cursor` | string / object (확인 필요) | X | 서버 발급 불투명 페이지 커서. **미구현** |
| `limit` | number | X | 조회 결과 최대 개수. **미구현**(최대값 미정) |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "id": 101,
      "name": "러닝 크루",
      "description": null,
      "ownerId": 101,
      "capacity": 20,
      "status": "ACTIVE",
      "regionCode": null,
      "memberCount": 10,
      "myMembershipStatus": "PENDING"
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 검색 조건에 맞는 크루 목록 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `crews.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].name` | string | O | `crews.name` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `items[].description` | string / null | O | `crews.description` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].ownerId` | integer (int64) | O | `crews.owner_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].capacity` | integer | O | `crews.capacity` (INTEGER). 저장 값은 NULL 불가. |
| `items[].status` | string | O | `crews.status` (ENUM('ACTIVE', 'INACTIVE')). 저장 값은 NULL 불가. 허용값: ACTIVE, INACTIVE. |
| `items[].regionCode` | string / null | O | `crews.region_code` (VARCHAR(40)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

목록 카드에는 이름·정원·현재 승인 인원·지역·본인 가입 상태가 필요하다. 타인 신청 내역을 공개하지 않는다.

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].memberCount` | integer | O | APPROVED 관계 수. |
| `items[].myMembershipStatus` | string / null | O | 본인 가입관계. 미가입 null, PENDING/APPROVED 등 ERD 상태. |

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

- ACTIVE 크루를 대상으로 한다. 이번 구현은 `q`(이름 부분 일치)·`regionCode`(정확 일치)만 적용한다.
- `latitude`·`longitude`·`radiusM`·`level`·`cursor`·`limit`는 명세에 두되 미구현이다. 좌표·level 저장 방식과 페이지 형식이 정해지기 전까지 서버는 이 파라미터로 필터·페이징하지 않는다.
- 정원이 찬 크루는 목록에 포함하되, 모집 중(여유 정원) 크루를 먼저 정렬한다.
- 크루 공개 검색 범위 정책 미정.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT (`myMembershipStatus`).

### 미정 사항

- [ ] 근처 검색(latitude/longitude/radiusM) 구현 — 크루·지역 좌표 저장 방식 확정 후
- [ ] level 필터 — 스키마 반영 여부 확정 후
- [ ] 공개 검색 범위(INACTIVE 포함 여부 등) 최종 확정
- [ ] cursor/limit 등 공통 페이지 형식
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거

## M02 크루 상세

`GET` `/api/v1/crews/{crewId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 관련 화면 | 6.2 크루 상세, 6.2b 가입 신청 완료 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

가입 상태는 본인에게만 노출.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "name": "러닝 크루",
  "description": null,
  "ownerId": 101,
  "memberCount": 10,
  "capacity": 20,
  "regionCode": null,
  "myMembershipStatus": "PENDING"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `crews.id` (BIGINT). 저장 값은 NULL 불가. |
| `name` | string | O | `crews.name` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `description` | string / null | O | crews.description. |
| `ownerId` | integer (int64) | O | `crews.owner_id` (BIGINT). 저장 값은 NULL 불가. |
| `memberCount` | integer | O | crew_memberships의 APPROVED 관계 수. 대기·거절·탈퇴 제외. |
| `myMembershipStatus` | string / null | O | 본인 crew_memberships.status. 관계 없으면 null. PENDING/APPROVED/REJECTED/LEFT. |


**사용 흐름과 응답 판단**

가입 버튼 판단에 myMembershipStatus와 정원·현재 인원이 필요하다. 관계 없음 null과 PENDING·APPROVED를 구분한다.

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `capacity` | integer | O | crews.capacity. 크루 정원. |
| `regionCode` | string / null | O | crews.region_code. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 CREW_NOT_FOUND` | 대상 없음 | 대상 크루가 없음. INACTIVE 상태의 조회/조작 허용 범위는 별도 확인 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 응답에 지역·레벨·정원·대표 사진과 모집 상태를 포함한다. 구성원 미리보기(크루장 표시, 평균 페이스)는 M07로 조회한다.
- 가입 상태는 본인에게만 노출.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## M03 크루 생성

`POST` `/api/v1/crews`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 관련 화면 | 6.3 크루 만들기 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

생성자는 OWNER 구성원으로 등록한다(`crews.owner_id` + `crew_memberships` APPROVED). 가입 방식은 크루장 승인으로 고정이므로 `joinPolicy`를 받지 않는다. 실제 저장은 [schema.sql](../db/schema.sql) `crews` 컬럼(`name`, `description`, `image_key`, `capacity`, `region_code`)에 대응한다. 스키마에 없는 요청 필드(`level`, `regionName`, `regionPosition`, `imageId`)는 **요청에서 받을 수 있으나(nullable) 현재는 저장하지 않는다(미구현)**.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `name` | string | O | `crews.name` (VARCHAR(100)). 비어 있지 않은 문자열 |
| `description` | string | X | `crews.description` (TEXT). 생략 또는 null 허용 |
| `imageKey` | string | X | `crews.image_key` (VARCHAR(1024)). 생략 또는 null 허용. 본인이 CREW 용도로 올린 실제 정규 원본 경로만 연결(246번 후속 확정) |
| `regionCode` | string | X | `crews.region_code` (VARCHAR(40)). `regions.region_code` 참조. 생략 또는 null 허용. 저장됨 |
| `capacity` | integer | O | `crews.capacity`. 1~200의 정수. 자동 기본값은 두지 않는다 |
| `imageId` | string (UUID) | X | 대표 사진([F01](files.md#f01-이미지-업로드)). **미구현** — 받아도 `crews`에 저장하지 않음. `imageKey`와 병행 시 저장은 `imageKey`만 |
| `regionName` | string | X | 활동 지역 이름. **미구현** — 받아도 저장하지 않음. 저장용은 `regionCode` |
| `regionPosition` | GeoJSON / object | X | 활동 지역 좌표. **미구현** — 받아도 저장하지 않음 |
| `level` | string | X | BEGINNER/INTERMEDIATE/ADVANCED. **미구현** — `crews`에 컬럼 없음, 받아도 저장하지 않음 |

```json
{
  "name": "하천 러닝 코스",
  "description": "주말 아침 러닝",
  "regionCode": null,
  "imageKey": null,
  "regionName": null,
  "regionPosition": null,
  "level": null,
  "imageId": null,
  "capacity": 10
}
```

### Response

`201 Created (제안)`

```json
{
  "id": 101,
  "ownerId": 101,
  "name": "러닝 크루",
  "createdAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `crews.id` (BIGINT). 저장 값은 NULL 불가. |
| `ownerId` | integer (int64) | O | `crews.owner_id` (BIGINT). 저장 값은 NULL 불가. |
| `name` | string | O | `crews.name` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `createdAt` | string (ISO 8601 UTC) | O | `crews.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

생성한 크루 ID로 상세 이동하고 본인이 크루장임을 확인한다. OWNER는 crews.owner_id에서 파생하며 membership enum이 아니다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 INVALID_CREW` | 입력 값 | 크루 이름·지역·정원 등 생성 값이 확정 규칙/ERD 형식과 맞지 않음. 크루 정원은 1~200명으로 확정 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 생성자는 `crews.owner_id`에 기록되고 `crew_memberships`에 APPROVED로 등록된다. 가입 방식은 크루장 승인으로 고정이므로 `joinPolicy`를 받지 않는다.
- 저장하는 필드: `name`, `description`, `imageKey`→`image_key`, `regionCode`→`region_code`, `capacity`. `status`는 ACTIVE.
- 2026-11-05 사용자 추가 승인(S15P31E105-246): imageKey가 있으면 인증된 생성자가 업로드한 CREW 용도 정규 경로와 실제 파일 존재를 확인한다. 타인 이미지·다른 용도·없는 파일·비정규 경로는 `403 RESOURCE_NOT_OWNED`로 거절하며 크루·구성원을 저장하지 않는다. imageKey 생략/null은 허용한다. imageId 수신만 하는 기존 범위는 유지한다. 이 검사는 타인의 미연결 CREW 이미지를 자신의 크루에 붙여 공개하는 우회를 방지한다. 정상 크루장 이양은 이미 검증해 연결한 image_key를 유지한다.
- `regionCode`를 보낸 경우 `regions.region_code`에 존재해야 한다. 없으면 422 INVALID_CREW.
- `imageId`, `regionName`, `regionPosition`, `level`은 요청에 포함해도 되며 null/생략 가능하나 **현재 저장·검증하지 않는다**(스키마 반영·매핑 후속).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 생성 직후 생성자의 `crew_memberships.status`는 APPROVED.

### 미정 사항

- [ ] `imageId`(F01) ↔ `image_key` 매핑
- [ ] `regionName`/`regionPosition` 저장 방식(또는 `regionCode`만 유지)
- [ ] `level` 스키마 반영 여부
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거



## M04 크루 가입 신청

`POST` `/api/v1/crews/{crewId}/join-requests`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

ACTIVE 크루에 대해 본인 가입 신청을 PENDING으로 생성·반환한다. 승인 전에는 내 크루에 '승인 대기'로 보인다(6.0, 6.2b). 요청 body는 없다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "crewId": 101,
  "userId": 101,
  "status": "PENDING",
  "requestedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | `crew_memberships.crew_id` (BIGINT). 저장 값은 NULL 불가. |
| `userId` | integer (int64) | O | `crew_memberships.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `crew_memberships.status` (ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT')). 저장 값은 NULL 불가. 허용값: PENDING, APPROVED, REJECTED, LEFT. |
| `requestedAt` | string (ISO 8601 UTC) | O | `crew_memberships.requested_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

신청 성공은 PENDING이며 가입 완료가 아니다. 이미 PENDING 또는 APPROVED면 409다. REJECTED/LEFT는 동일 행을 PENDING으로 갱신해 재신청한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 ALREADY_MEMBER_OR_PENDING` | 중복 관계 | 이미 PENDING 또는 APPROVED 관계가 있는데 가입 신청을 다시 보냄 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- ACTIVE 크루에만 신청 가능. 요청 body 없음. 성공 시 PENDING 행을 생성하거나 반환한다.
- 이미 PENDING 또는 APPROVED → `409 ALREADY_MEMBER_OR_PENDING`.
- REJECTED 또는 LEFT → 동일 `crew_memberships` 행을 PENDING으로 갱신해 재신청한다(`requested_at` 갱신, `joined_at` null).
- 승인 전에는 내 크루에 '승인 대기'로 보인다(6.0, 6.2b). 크루장 승인(M06) 후 멤버가 된다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## M05 크루 가입 신청 목록

`GET` `/api/v1/crews/{crewId}/join-requests`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

OWNER(`crews.owner_id`)만 조회. 스키마에 ADMIN 역할이 없어 ADMIN은 미구현이며 OWNER만 허용한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.
- OWNER는 `crews.owner_id`와 호출자 일치로만 판정한다. 비소유자는 `403 NOT_ADMIN`(코드명 유지, ADMIN 역할은 미구현).

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string | X | 가입 상태 필터. 생략 시 기본값 `PENDING` |
| `cursor` | string / object (확인 필요) | X | 서버 발급 불투명 페이지 커서. **미구현** |
| `limit` | number | X | 조회 결과 최대 개수(최대값 미정). **미구현** |

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "userId": 101,
      "status": "PENDING",
      "requestedAt": "2026-10-24T09:00:00Z",
      "joinedAt": null,
      "nickname": "러너"
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 해당 크루 가입 신청 목록. 세부 객체 계약 미정 |
| `page` | string / object (확인 필요) | X | 페이지 메타데이터는 저장 엔티티가 아니다. cursor/limit은 **미구현**. |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].userId` | integer (int64) | O | `crew_memberships.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].status` | string | O | `crew_memberships.status` (ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT')). 저장 값은 NULL 불가. 허용값: PENDING, APPROVED, REJECTED, LEFT. |
| `items[].requestedAt` | string (ISO 8601 UTC) | O | `crew_memberships.requested_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `items[].joinedAt` | string (ISO 8601 UTC) / null | O | `crew_memberships.joined_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].nickname` | string | O | `users`의 표시명(닉네임). |


**사용 흐름과 응답 판단**

승인 대기자 목록은 PENDING 대상과 회원 식별·닉네임이 필요하다. 승인 버튼을 행의 userId에 연결한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_ADMIN` | 역할 권한 | 호출자가 `crews.owner_id`가 아님. ADMIN 역할은 스키마에 없어 미구현; OWNER만 허용 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- OWNER(`crews.owner_id`)만 조회. 비소유자 → `403 NOT_ADMIN`. ADMIN은 미구현.
- `status` 쿼리는 선택이며 생략 시 기본값 `PENDING`. `nickname`은 `users`에서 조회한다.
- `cursor`/`limit`은 쿼리 표에 유지하되 **미구현**.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] `cursor`/`limit` 페이지네이션 구현
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## M06 크루 가입 승인·거절

`PATCH` `/api/v1/crews/{crewId}/join-requests/{userId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

PENDING 신청에 대해 APPROVED 또는 REJECTED만 처리. OWNER(`crews.owner_id`)만 가능하며 ADMIN은 미구현이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.
- OWNER는 `crews.owner_id`와 호출자 일치로만 판정한다. 비소유자는 `403 NOT_ADMIN`(코드명 유지, ADMIN 역할은 미구현).

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `userId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string | O | `APPROVED` 또는 `REJECTED`만 허용. |

```json
{
  "status": "APPROVED"
}
```

### Response

`200 OK (제안)`

```json
{
  "crewId": 101,
  "userId": 101,
  "status": "APPROVED"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | `crew_memberships.crew_id` (BIGINT). 저장 값은 NULL 불가. |
| `userId` | integer (int64) | O | `crew_memberships.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `status` | string | O | `crew_memberships.status` (ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT')). 승인 성공은 APPROVED, 거절 성공은 REJECTED. PENDING/LEFT는 이 작업의 성공 결과가 아니다. |
| `resolvedAt` | string (ISO 8601) | X | crew_memberships에 처리 완료 시각 컬럼 없음. joined_at은 가입 시각이며 거절 시각과 구분한다. |


**사용 흐름과 응답 판단**

요청 결정은 APPROVED/REJECTED만 허용하고 응답은 처리된 상태를 반환한다. 정원 검증은 승인에만 해당한다. APPROVED 시 `joined_at`을 설정한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_ADMIN` | 역할 권한 | 호출자가 `crews.owner_id`가 아님. ADMIN 역할은 스키마에 없어 미구현; OWNER만 허용 |
| `409 NOT_PENDING` | 상태 충돌 | 대상 신청이 PENDING이 아님(또는 신청 관계 없음). 동시 승인·거절 포함 |
| `409 CREW_CAPACITY_EXCEEDED` | 정원 초과 | APPROVED 처리 시 현재 APPROVED 인원이 `crews.capacity` 이상이면 거부 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- body `status`는 `APPROVED`|`REJECTED`만 허용. OWNER만 처리; 비소유자 → `403 NOT_ADMIN`.
- 대상이 PENDING이 아니면 → `409 NOT_PENDING`.
- APPROVED 시 현재 APPROVED 인원이 `capacity` 이상이면 → `409 CREW_CAPACITY_EXCEEDED`. 승인 성공 시 `joined_at` 설정.
- 알림 자동 발송은 **후속**. 이번 스프린트는 상태 저장만 한다(상세 정책은 [알림 정책](../requirements.md#알림-정책) 참고).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 승인·거절 알림 자동 발송(이번 스프린트는 상태 저장만)
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## M07 크루 멤버 목록

`GET` `/api/v1/crews/{crewId}/members`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 관련 화면 | 6.2 크루 상세 구성원 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

승인된 현재 구성원 목록.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
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
      "userId": 101,
      "status": "APPROVED",
      "joinedAt": "2026-10-24T09:00:00Z",
      "nickname": "러너",
      "isOwner": false
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 해당 크루 멤버 목록. 세부 객체 계약 미정 |
| `page` | string / object (확인 필요) | X | 페이지 메타데이터는 저장 엔티티가 아니다. cursor/limit 등 공통 페이지 형식 확정 필요. |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].userId` | integer (int64) | O | `crew_memberships.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].status` | string | O | `crew_memberships.status` (ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT')). 현재 승인된 멤버만 조회하므로 APPROVED. |
| `items[].joinedAt` | string (ISO 8601 UTC) / null | O | `crew_memberships.joined_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

현재 멤버 목록은 APPROVED만 반환한다. 크루장 역할은 `crews.owner_id` 비교로 `isOwner`를 파생하고 가입 요청(PENDING)은 포함하지 않는다. `cursor`/`limit`·평균 페이스는 미구현이다.

표시·선택·후속 이동에 필요한 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].nickname` | string | O | 멤버의 표시명. |
| `items[].isOwner` | boolean | O | crews.owner_id와 해당 userId의 비교. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 CREW_NOT_FOUND` | 대상 없음 | 대상 크루가 없음. INACTIVE 상태의 조회/조작 허용 범위는 별도 확인 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 구성원 항목에 역할(크루장)과 최근 평균 페이스를 포함한다(6.2).
- 승인된 현재 구성원 목록.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## M08 크루 탈퇴

`DELETE` `/api/v1/crews/{crewId}/members/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음(그룹런 등 해산 연쇄는 M11) |
| 비고 | 탈퇴와 해산은 분리. 해산은 [M11](#m11-크루-해산) |

### 설명

본인 멤버십을 `LEFT`로 바꾼다. 크루장은 다른 APPROVED 멤버에게 권한을 이양한 뒤에만 탈퇴할 수 있다. 크루 종료는 M11 해산을 쓴다.

### FE 분기 (확정)

| 상황 | FE 행동 | API |
|---|---|---|
| 일반 APPROVED 멤버 | 탈퇴 확인 후 호출 | M08, body 없음 |
| OWNER + APPROVED 2명 이상 | 후임 선택 후 탈퇴 | M08 + `{"successorUserId": <후임>}` |
| OWNER + APPROVED 1명(본인만) | 해산 안내·확인 | **M11** (M08 호출 시 `409 OWNER_CANNOT_LEAVE`) |
| OWNER가 크루 전체 종료(인원 무관) | 해산 확인 | **M11** |

서버가 APPROVED 인원·OWNER 여부를 판정한다. FE가 인원만 보고 leave/delete를 고르지 않아도 되며, 레이스 시 서버 오류 코드를 따른다.

### 인증 및 권한

- 로그인 사용자. ACTIVE 크루의 APPROVED 멤버만 탈퇴 가능.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | 대상 크루 |

### Query Parameters

없음

### Request Body

선택. OWNER 이양 탈퇴 시에만 필요.

```json
{
  "successorUserId": 102
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `successorUserId` | integer (int64) | X | OWNER 탈퇴 시 필수. 같은 크루 APPROVED 멤버(본인 제외). 일반 멤버가 보내면 `400 VALIDATION_ERROR` |

### Response

`200 OK`

```json
{
  "status": "LEFT",
  "leftAt": "2026-10-24T09:00:00Z"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string | O | 탈퇴 후 `LEFT` |
| `leftAt` | string (ISO 8601 UTC) / null | O | `crew_memberships.left_at` |

**사용 흐름과 응답 판단**

성공 시 본인은 더 이상 APPROVED가 아니다. OWNER 이양 성공 시 `crews.owner_id`는 후임으로 바뀌고 응답은 탈퇴한 본인의 LEFT만 담는다. 새 크루장은 멤버 목록의 `isOwner`로 확인한다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `409 OWNER_CANNOT_LEAVE` | 역할 제약 | OWNER가 후임 없이 탈퇴하거나, APPROVED가 본인뿐인데 M08을 호출함(해산은 M11) |
| `422 INVALID_SUCCESSOR` | 후임 부적합 | 후임이 본인이거나, 해당 크루 APPROVED가 아님 |
| `404 CREW_NOT_FOUND` | 대상 없음 | 크루 없음 또는 ACTIVE가 아님 |
| `404 MEMBER_NOT_FOUND` | 대상 없음 | 호출자가 APPROVED 멤버가 아님 |
| `400 VALIDATION_ERROR` | 입력 형식 | 일반 멤버가 `successorUserId`를 보냄 등 |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |
| `403 FORBIDDEN` | 권한 | 권한 없음 |

### 처리 규칙

- 일반 APPROVED: `LEFT` + `left_at`.
- OWNER + APPROVED ≥ 2: `successorUserId` 필수 → `owner_id` 이양 후 OWNER `LEFT` (한 트랜잭션).
- OWNER + APPROVED = 1: M08 거부(`OWNER_CANNOT_LEAVE`). 자동 해산하지 않음.
- 비ACTIVE 크루 탈퇴는 `404 CREW_NOT_FOUND`.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 이양·탈퇴와 동시 내보내기/승인 경합 시 재시도 UX 문구
- [ ] 그룹런 등 연결 데이터의 해산 연쇄는 M11 미정 항목


## M11 크루 해산

`DELETE` `/api/v1/crews/{crewId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음(그룹런·알림) |
| 비고 | hard delete 아님. `crews.status=INACTIVE` |

### 설명

OWNER가 크루를 종료한다. **APPROVED 인원과 무관**하다. 100명 크루도 멤버가 모두 나갈 필요 없이 해산할 수 있다.

### FE 안내

- 설정/관리의 **해산** 및, OWNER 혼자일 때 탈퇴 확인 후 호출하는 API가 M11이다.
- 확인 UI는 FE 책임. 서버는 확인 플래그를 요구하지 않는다.

### 인증 및 권한

- OWNER(`crews.owner_id`)만. 비소유자 → `403 NOT_ADMIN`.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | 대상 크루 |

### Request Body

없음

### Response

`200 OK`

```json
{
  "id": 101,
  "status": "INACTIVE"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `crews.id` |
| `status` | string | O | `INACTIVE` |

이미 `INACTIVE`면 동일 본문으로 성공(멱등).

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_ADMIN` | 역할 권한 | 호출자가 OWNER가 아님 |
| `404 CREW_NOT_FOUND` | 대상 없음 | 크루 없음 |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |

### 처리 규칙

- `crews.status` → `INACTIVE`.
- 해당 크루 `APPROVED` 멤버십 → `LEFT` + `left_at`.
- 해당 크루 `PENDING` → `REJECTED`.
- `owner_id`는 이력으로 유지(변경하지 않음).
- 검색(M01) 등 ACTIVE만 노출하는 API에서는 더 이상 나오지 않음.

### 미정 사항

- [ ] 해산 시 진행·예정 그룹런 취소·보존 정책
- [ ] 해산 알림


## M09 크루 멤버 내보내기

`DELETE` `/api/v1/crews/{crewId}/members/{userId}`

| 항목 | 값 |
|---|---|
| 단계 | 선택 기능 |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

선택 기능. OWNER/ADMIN만 가능하고 OWNER는 내보낼 수 없음.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `crewId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |
| `userId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "status": "LEFT",
  "leftAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `status` | string | O | `crew_memberships.status` (ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT')). 저장 값은 NULL 불가. 허용값: PENDING, APPROVED, REJECTED, LEFT. |
| `leftAt` | string (ISO 8601 UTC) / null | O | `crew_memberships.left_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

내보내기 대상의 LEFT와 leftAt을 반환한다. 요청자·대상·크루장 역할을 각각 검사한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_ADMIN` | 역할 권한 | 내보내기에 필요한 크루 관리 권한이 없음. 현재는 `crews.owner_id`만 OWNER로 본다(ADMIN 역할 없음) |
| `409 CANNOT_REMOVE_OWNER` | 역할 제약 | 크루장을 일반 멤버 내보내기로 제거하려 함 |
| `404 CREW_NOT_FOUND` | 대상 없음 | 대상 크루가 없음 |
| `404 MEMBER_NOT_FOUND` | 대상 없음 | 대상 사용자가 해당 크루의 APPROVED 멤버가 아님 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- OWNER만 가능하고 OWNER 본인은 내보낼 수 없다. 대상 APPROVED 멤버를 `LEFT`로 전이하고 `left_at`을 기록한다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- PENDING / APPROVED / REJECTED / LEFT.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## M10 내 크루 목록

`GET` `/api/v1/users/me/crews`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | MAT-003 |
| 관련 화면 | 6.0 그룹 — 내 크루, 6.0b 가입한 크루 없음, 2.P 그룹 탭 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

가입한 크루와 승인 대기 중인 크루를 조회한다. 크루별 그룹런은 G02(`crewId`)로 조회한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `membershipStatus` | string | X | APPROVED/PENDING. 생략 시 둘 다 |

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "id": 101,
      "name": "러닝 크루",
      "regionCode": null,
      "myMembershipStatus": "PENDING",
      "memberCount": 10,
      "isOwner": false
    }
  ]
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 크루 id·이름·레벨·지역·멤버 수·내 역할·가입 상태(승인 대기 표시) |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `crews.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].name` | string | O | `crews.name` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `items[].regionCode` | string / null | O | `crews.region_code` (VARCHAR(40)). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

승인 대기 표시와 크루 진입 가능 여부를 구분한다. 크루 상태와 본인 가입 상태는 다른 값이다.

기존 목록/결과의 기능상 필요한 하위 필드 보완안:

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].myMembershipStatus` | string | O | PENDING/APPROVED 중 본인 목록 포함 조건에 맞는 가입상태. 크루장 포함 규칙 확인 필요. |
| `items[].memberCount` | integer | O | APPROVED 관계 수. |
| `items[].isOwner` | boolean | O | crews.owner_id=본인 비교 결과. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 가입한 크루가 없으면 빈 배열을 반환하고 화면은 6.0b 안내를 보여 준다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
