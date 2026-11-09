# API 명세 — 워치·건강 데이터

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [W01](#w01-기기-등록) | 기기 등록 | POST | `/devices` | 1차 MVP | 회원 |
| [W02](#w02-등록-기기-조회) | 등록 기기 조회 | GET | `/devices` | 1차 MVP | 회원 |
| [W03](#w03-기기-연결-해제) | 기기 연결 해제 | DELETE | `/devices/{deviceId}` | 1차 MVP | 회원 |
| [W04](#w04-수집-동의철회) | 수집 동의·철회 | POST | `/consents` | 1차 MVP | 회원 |
| [W05](#w05-동의-상태-조회) | 동의 상태 조회 | GET | `/consents` | 1차 MVP | 회원 |
| [W06](#w06-samsung-health-데이터-동기화) | Samsung Health 데이터 동기화 | POST | `/health-records/sync` | 1차 MVP | 회원 |
| [W07](#w07-워치-운동-배치-동기화) | 워치 운동 배치 동기화 | POST | `/sync/batches` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

user_devices는 기기 연결, daily_health_metrics는 날짜별 건강 요약, sync_batches는 수신 배치다. 서버 BIGINT ID와 설치·클라이언트 배치·원본 측정 식별자는 서로 다르다. daily_health_metrics의 수면(분)·안정시 심박·운동부하·최대 심박은 모두 NULL 가능하다. 원본 워치 업로드 계약은 이 문서의 DB 식별자로 치환하지 않는다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 계약 적용 범위

- W07과 아래 173번 온라인 계약의 전송 방식·저장 확인·재시도·폰 인계 규칙은 사용자 승인 기준이다.
- W01~W03 기기 등록·조회·해제는 S15P31E105-251에서 확정한 아래 계약을 따른다. W04~W05 동의 변경·조회와 철회 순서 보장은 S15P31E105-250에서 확정한 아래 계약을 따른다. W06은 S15P31E105-252에서 확정한 일상 심박 추정값 계약을 따르며 다른 건강 레코드는 후속 확정이다. 통신 방식이 확정됐다고 해당 API의 저장 모델까지 확정된 것은 아니다.
- user_devices에는 기기 ID·회원·유형·연결/해제시각만 있다. 설치 식별자·기기 메타데이터·푸시 토큰·마지막 통신시각은 저장하지 않는다. 회원별·유형별 연결 중 기기는 하나다(`uq_user_devices_active`). users.health_data_access는 현재 건강정보 동의 값이다. 가입 시 동의는 U15, 가입 후 변경·조회와 철회 시 동시 처리는 W04·W05를 따른다.

## W01 기기 등록

`POST` `/api/v1/devices`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 관련 화면 | 1.7 워치 연결 안내, 8.3 워치 다시 연결 (화면 설계 v10) |
| 미정 사항 | 없음 (S15P31E105-251 확정) |
| 비고 | 설치 식별자 저장·다른 계정과의 충돌 판정은 후속 업무 |

### 설명

로그인 회원의 PHONE 또는 WATCH를 서버에 등록한다. 실제 블루투스 연결은 기기 앱에서 제어하며, 서버 등록은 현재 연결 성공을 뜻하지 않는다. 회원별·유형별로 연결 중 기기는 하나다.

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
| `deviceType` | string | O | `PHONE` 또는 `WATCH`(대문자). 숫자·소문자·그 밖의 값은 400 |

설치 식별자(`installationId`)·manufacturer·model·osVersion·appVersion·capabilities·pushToken은 저장하지 않으므로 계약에서 제외했다. 이전 클라이언트가 보내도 무시한다. 푸시 토큰 등록 경로는 알림 업무에서 별도로 정한다.

```json
{
  "deviceType": "WATCH"
}
```

### Response

새로 등록하면 `201 Created`, 같은 유형의 연결 중 기기가 이미 있으면 그 기기를 `200 OK`로 반환한다. 본문 형식은 같다.

```json
{
  "id": 101,
  "deviceType": "WATCH"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `user_devices.id` (BIGINT). 저장 값은 NULL 불가. |
| `deviceType` | string | O | `user_devices.device_type` (ENUM('PHONE', 'WATCH')). 저장 값은 NULL 불가. 허용값: PHONE, WATCH. |


**사용 흐름과 응답 판단**

반환한 서버 기기 ID를 이후 업로드/해제에 사용한다. 응답 시간초과 후 같은 요청을 다시 보내면 같은 ID를 200으로 받는다. 해제 후 다시 등록하면 새 ID를 받으며 이전 연결·해제 이력은 보존된다.

서버는 설치 식별자를 저장하지 않아 같은 기기의 재전송과 같은 유형의 다른 실물 기기를 구분하지 못한다. 다른 워치·폰으로 바꾸려면 앱이 "기존 기기를 해제하고 새로 등록합니다"라고 안내한 뒤 W03으로 기존 기기를 해제하고 W01을 호출한다. 서버는 기존 기기를 자동으로 교체하지 않는다.

### 오류 응답

**상태: 확정 (S15P31E105-251, 2026-10-29).**

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조되었거나 토큰의 회원이 존재하지 않거나 탈퇴(WITHDRAWN)함. 탈퇴 후 남은 Access Token으로 기기를 등록·조회·해제할 수 없다 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문 오류, `deviceType` 누락·null·허용값 외 |

- 다른 계정과의 설치 충돌(이전 초안의 `409 DEVICE_CONFLICT`)은 설치 식별자를 저장하지 않아 판정할 수 없으므로 사용하지 않는다. 설치 식별자를 도입하는 후속 업무에서 다시 검토한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 같은 요청을 다시 보내면 기존 기기를 200으로 받는다. 동시에 여러 요청이 와도 DB 부분 유니크 인덱스로 연결 중 기기는 하나만 생기며, 늦은 요청은 먼저 저장된 기기를 200으로 받는다.

### 처리 규칙

- 회원별·유형별 연결 중(`unlinked_at` NULL) 기기는 하나다. 있으면 200으로 기존 기기, 없으면 새 행을 만들고 `linked_at`을 서버 시각으로 기록해 201.
- 해제 후 재등록은 새 행·새 ID다. 기존 행을 다시 활성화하지 않는다.

### 상태값

- 연결 중: `unlinked_at` NULL. 해제됨: `unlinked_at` 값 있음. 별도 상태 컬럼은 없다.

### 확정 사항 (S15P31E105-251, 2026-10-29)

- [x] 설치 식별자는 저장하지 않고, 회원별·유형별 연결 중 기기 1대로 중복 등록을 막는다. 계정 변경·다른 실물 기기 교체는 W03 해제 후 W01
- [x] manufacturer/model/osVersion/appVersion/capabilities는 이번 범위에서 받지 않고 저장하지 않는다
- [x] pushToken은 이 API에서 받지 않는다. 등록·갱신·폐기 경로는 알림 업무에서 정한다
- [x] 신규 201, 같은 유형 재요청 200(같은 본문). 409는 사용하지 않는다

## W02 등록 기기 조회

`GET` `/api/v1/devices`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 미정 사항 | 없음 (S15P31E105-251 확정) |
| 비고 | 기기 표시 정보·마지막 통신시각은 제공하지 않음 |

### 설명

본인 기기의 linkedAt/unlinkedAt 등록·해제 이력을 조회한다. 현재 블루투스 연결 상태를 보장하지 않는다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `deviceType` | string | X | `PHONE` 또는 `WATCH`로 필터. 생략하면 전체. 빈 값·허용값 외는 400 |
| `includeUnlinked` | boolean | X | 기본 `false`(연결 중 기기만). `true`면 해제된 이력 포함. boolean이 아니면 400 |

### Request Body

없음


### Response

`200 OK`

```json
{
  "items": [
    {
      "id": 101,
      "deviceType": "PHONE",
      "linkedAt": "2026-10-24T09:00:00Z",
      "unlinkedAt": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 본인 기기 목록. `linkedAt` 내림차순, 같으면 `id` 내림차순. 없으면 빈 배열 `[]` |

`items[]` 필드(저장 컬럼과 1:1 대응, 추가 표시·집계 값 없음):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `user_devices.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].deviceType` | string | O | `user_devices.device_type` (ENUM('PHONE', 'WATCH')). 저장 값은 NULL 불가. 허용값: PHONE, WATCH. |
| `items[].linkedAt` | string (ISO 8601 UTC) | O | `user_devices.linked_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `items[].unlinkedAt` | string (ISO 8601 UTC) / null | O | `user_devices.unlinked_at` (TIMESTAMPTZ). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |


**사용 흐름과 응답 판단**

연결 기기 관리 화면은 기기 ID·유형·해제 여부를 사용한다. 표시 이름·제조사·마지막 통신시각은 저장하지 않으므로 제공하지 않으며, `linkedAt`을 마지막 통신시각으로 쓰지 않는다.

### 오류 응답

**상태: 확정 (S15P31E105-251, 2026-10-29).**

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조되었거나 토큰의 회원이 존재하지 않거나 탈퇴(WITHDRAWN)함. 탈퇴 후 남은 Access Token으로 기기를 등록·조회·해제할 수 없다 |
| `400 VALIDATION_ERROR` | 입력 형식 | `deviceType`·`includeUnlinked` 값이 허용 범위·자료형과 맞지 않음 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 토큰의 회원 기기만 조회한다. 다른 회원 기기는 결과에 나타나지 않는다.
- linkedAt/unlinkedAt으로 등록·해제 이력을 조회한다. 현재 블루투스 연결 상태를 보장하지 않는다.

### 상태값

- 연결 중: `unlinkedAt` null. 해제됨: `unlinkedAt` 값 있음.

### 확정 사항 (S15P31E105-251, 2026-10-29)

- [x] deviceType 선택 필터, includeUnlinked 기본 false, 잘못된 값은 400
- [x] 빈 목록은 `{"items": []}`, linkedAt·id 내림차순, 표시 필드는 id·deviceType·linkedAt·unlinkedAt
- [x] lastSeenAt은 저장 근거가 없어 제공하지 않는다. linkedAt을 마지막 통신시각으로 사용하지 않음

## W03 기기 연결 해제

`DELETE` `/api/v1/devices/{deviceId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 미정 사항 | 없음 (S15P31E105-251 확정) |
| 비고 | 해제된 기기의 업로드·세션 제어 거부는 W07·세션 제어 업무 |

### 설명

본인 소유 기기의 서버 등록을 해제한다. 기기 행은 삭제하지 않고 `unlinked_at`을 기록해 이력을 남긴다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `deviceId` | integer (int64) | O | `user_devices.id`. 1 이상. 숫자로 해석할 수 없거나 소수·0 이하·범위 초과면 400. `0x1`·`+2`·`002` 같은 표기는 공통 경로 변수 숫자 변환에 따라 해당 값으로 해석된다(다른 API와 같음) |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK`

```json
{}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| (없음) | — | — | 빈 객체. 이전 초안의 `success` 필드는 사용하지 않는다 |


**사용 흐름과 응답 판단**

성공하면 본인 기기 연결이 해제되었음을 화면에 반영한다. 이미 해제된 본인 기기를 다시 요청해도 200이며 처음 기록한 해제 시각은 바뀌지 않는다. 다른 실물 기기로 바꿀 때는 이 API로 기존 기기를 해제한 뒤 W01을 호출한다.

### 오류 응답

**상태: 확정 (S15P31E105-251, 2026-10-29).**

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 DEVICE_NOT_FOUND` | 대상 없음 | 기기가 없거나 다른 회원의 기기. 존재 여부를 드러내지 않도록 두 경우를 구분하지 않는다 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조되었거나 토큰의 회원이 존재하지 않거나 탈퇴(WITHDRAWN)함. 탈퇴 후 남은 Access Token으로 기기를 등록·조회·해제할 수 없다 |
| `400 VALIDATION_ERROR` | 입력 형식 | `deviceId`를 숫자로 해석할 수 없거나 소수·0 이하·int64 범위 초과 |

- 이전 후보 `403 DEVICE_FORBIDDEN`은 사용하지 않는다. 타인 기기는 404로 응답한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합:** 통신 시간초과 후 재요청은 200이다. 동시 해제 요청도 모두 200이며 해제 시각은 한 번만 기록한다.

### 처리 규칙

- 본인 소유의 연결 중 기기면 `unlinked_at`을 서버 시각으로 기록한다. 이미 해제된 본인 기기는 변경 없이 200.
- 진행 중 세션·미확인 명령·기록 업로드는 막지 않고 변경하지도 않는다. 해제를 실제 운동 종료로 간주하지 않는다. 해제된 기기의 업로드·제어 거부는 W07·세션 제어 업무에서 정한다.

### 상태값

- 연결 중 → 해제됨 한 방향이다. 해제된 행을 다시 연결 중으로 바꾸지 않는다.

### 확정 사항 (S15P31E105-251, 2026-10-29)

- [x] 이미 해제된 본인 기기 재요청은 200(해제 시각 유지), 타인·없는 기기는 404 DEVICE_NOT_FOUND
- [x] 진행 중 세션·미확인 명령·업로드는 이 API가 막거나 변경하지 않는다. 해제를 운동 종료로 간주하지 않음
- [x] 해제 후 재등록은 새 ID. 기존 ID를 재사용하지 않는다

## W04 수집 동의·철회

`POST` `/api/v1/consents`

> **S15P31E105-250 확정 계약 · 2026-11-02.** 가입 후 건강정보 동의를 켜거나 끈다. 동의 값의 단일 원천은 `users.health_data_access`(AGREE/DISAGREE)이며 동의 이력·약관 버전·동의 시각은 저장하지 않는다(U15 2026-10-29 확정과 같다).

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 관련 화면 | 1.4 개인정보·데이터 이용 동의, 앱 설정의 건강정보 동의 (화면 설계 v10) |
| 미정 사항 | 약관 본문 제공 방식 |
| 비고 | 필수 3종(약관·개인정보·위치) 변경·철회는 이 API 범위가 아니다 |

### 설명

로그인 회원 본인의 건강정보 수집 동의(HEALTH_DATA)를 동의 또는 철회로 바꾼다. 앱·OS 권한과 서버 동의 값은 다른 값이다. 철회는 기존 건강·운동 기록 삭제나 진행 중 운동 종료가 아니며, 철회 확정 뒤의 새 건강 데이터 저장·준비도 산출만 막는다.

### 인증 및 권한

- 로그인 회원 본인의 동의만 바꾼다. 다른 회원을 지정하는 입력은 없다.
- 유효한 토큰이어도 회원이 ACTIVE가 아니면(탈퇴) `401 UNAUTHORIZED`다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

U15 동의 항목과 같은 형식이다. 문자열·숫자를 boolean으로 바꾸지 않는다. 같은 키가 두 번 오면 적용 값이 모호하므로 거절하고(W06·W07과 같은 기준), 정의하지 않은 추가 필드는 무시한다. `Content-Type: application/json`이 필요하다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `consentType` | string | O | `HEALTH_DATA`만 허용. 필수 3종·알 수 없는 값은 422 |
| `granted` | boolean | O | JSON boolean. true=동의, false=철회 |

```json
{
  "consentType": "HEALTH_DATA",
  "granted": false
}
```

### Response

`200 OK`. 같은 값 재요청도 200이다(멱등). 응답의 `granted`는 이 요청이 적용된 시점의 값이며, 직후 다른 W04 요청이 반대 값으로 바꿀 수 있다. 최신 값은 W05로 확인한다.

```json
{
  "consentType": "HEALTH_DATA",
  "granted": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `consentType` | string | O | `HEALTH_DATA` |
| `granted` | boolean | O | 적용 후 현재 동의 여부 |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 VALIDATION_ERROR` | 입력 형식 | 본문 없음·JSON 구문 오류·객체가 아님·중복 키, `consentType`이 문자열이 아니거나 누락, `granted`가 JSON boolean이 아니거나 누락·null |
| `415 UNSUPPORTED_MEDIA_TYPE` | 입력 형식 | `Content-Type`이 `application/json`이 아님(공통 처리) |
| `422 INVALID_CONSENT` | 동의 입력 | `consentType`이 `HEALTH_DATA`가 아님(TERMS_OF_SERVICE·PERSONAL_INFO·LOCATION_DATA 포함). 값은 바뀌지 않음 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조, 또는 회원이 ACTIVE가 아님 |
| `503 SERVICE_UNAVAILABLE` | 일시 장애 | 회원 행·세션 잠금 대기가 2초를 넘음 등 재시도 가능한 DB 장애. 변경되지 않았을 수 있으므로 W05로 확인 후 재시도 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 통신 시간초과 뒤 같은 요청을 다시 보내도 같은 결과(200)다.

### 처리 규칙

- 한 트랜잭션(READ COMMITTED)에서 처리하고 잠금 대기 상한은 대기 1회당 2초다(로그인·프로필 저장과 같다). 철회는 최대 세 번(세션 생성 잠금·회원 행·세션 행) 기다릴 수 있어 전체 처리 시간은 2초를 넘을 수 있다.
- 값이 실제로 바뀔 때만 `users.health_data_access`와 `updated_at`을 갱신한다. 같은 값이면 쓰지 않는다.
- **철회 순서 보장.** 철회는 ① 회원 세션 생성 잠금(S01과 같은 회원별 advisory lock) → ② `users.health_data_access` 갱신(트랜잭션의 첫 쓰기) → ③ 본인의 삭제되지 않은 진행 가능 세션(READY·RUNNING·PAUSED) 행 `FOR SHARE` 순으로 잠근다. W07은 이 세 상태에만 새 batch를 받고 종료 상태(COMPLETED·CANCELLED·INTERRUPTED)는 되돌아가지 않으므로 종료된 세션은 잠그지 않는다.
  - W06과 준비도 자동 평가(W06 커밋 후 비동기 실행)는 회원 행 `FOR SHARE`로 동의를 읽으므로 ②와 서로 기다린다. R02 조회는 잠그지 않고 읽는다. 먼저 잡은 쪽이 커밋된 뒤 다른 쪽이 진행된다.
  - W07은 회원 행을 잠그지 않고 세션 행을 잡은 뒤 동의를 읽는다. 진행 중인 W07이 있으면 철회는 ③에서 그 커밋을 기다린다. 철회가 ③을 잡은 뒤의 W07은 철회 커밋을 기다렸다가 철회 값을 읽어 측정 샘플 batch를 `403 CONSENT_REQUIRED`로 거절한다(GPS만 있는 batch는 W07 D-2대로 받는다).
  - ①은 철회 도중 새로 만들어진 세션이 ③에서 빠지지 않게 한다. 세션 생성은 회원 행을 잠그지 않고, 세션 행만 잡는 경로(W07·종료·인계)는 ①·②를 기다리지 않으므로 순환 대기가 없다.
  - 따라서 철회 응답(200)을 받은 뒤에는 새 건강 데이터 저장·준비도 산출이 일어나지 않는다. 철회 전에 시작해 먼저 잠금을 얻은 저장은 철회 전에 확정된 것이다.
- 동의(true)는 순서 보장이 필요 없어 ①·③을 잡지 않는다.
- **교착 방지 규칙.** 세션 행이나 회원 세션 생성 잠금을 잡은 트랜잭션은 그 뒤에 회원 행을 잠그지 않는다(`FOR SHARE` 포함). 철회가 회원 행을 쥔 채 세션을 기다리므로 교착(40P01)이 된다. 이후 코칭 발행(P07) 등 건강 데이터를 쓰는 새 경로는 세션을 잠그지 않는 경로면 W06처럼 회원 행 `FOR SHARE`로, 세션을 잠그는 경로면 W07처럼 세션 잠금 뒤 잠그지 않는 읽기로 동의를 확인한다.
- 철회는 회원 행을 쥔 채 진행 중 W07의 커밋을 기다릴 수 있다. 그동안 같은 회원의 로그인·프로필 저장(회원 행 잠금 대기 상한 2초)이 기다리다 503이 될 수 있다. 철회가 드물고 W07 트랜잭션이 짧아 수용한다(2026-11-02 사용자 결정).
- 예시는 합성 값이다.

### 상태값

- HEALTH_DATA: 동의(AGREE) ↔ 철회(DISAGREE) 양방향. 가입 시 값은 U15에서 정한다.
- 저장값 표기(S15P31E105-314 사용자 확정 · 2026-11-09): V1의 오타 `AGREEE`를 V24에서 `AGREE`로 바꿨다. W04와 U15는 동의 여부를 `granted` boolean으로만 받으므로 요청에 `AGREEE`/`AGREE` 문자열이 오는 경로가 없고 서버 호환 처리는 두지 않는다. 폰↔워치 동의 DataItem도 `AGREE`/`DISAGREE`만 인정하며 이전 값 `AGREEE`는 수용하지 않는다(완전 전환). 기기에 이미 저장된 `AGREEE`는 워치 로컬 DB 업그레이드와 폰의 W05 재반영으로 `AGREE`가 된다. 상세는 [워치·모바일·서버 연동](../watch-mobile-server-integration.md)을 따른다.

### 미정 사항

- [x] 가입 U15에서 네 동의를 배열로 일괄 제출한다. W04는 한 번에 한 유형(HEALTH_DATA)만 바꾼다(S15P31E105-250)
- [ ] 약관 본문 제공 방식(정적 페이지/API)
- [x] 요청·응답 필드와 JSON 구조 확정(S15P31E105-250, 2026-11-02)
- [x] HTTP 성공 코드와 오류 코드 확정(S15P31E105-250, 2026-11-02)
- [x] 철회 시 `users.health_data_access` 갱신을 트랜잭션의 첫 쓰기로 둔다(세션 생성 잠금 다음). 기존 건강 데이터는 삭제하지 않는다(S15P31E105-250)


## W05 동의 상태 조회

`GET` `/api/v1/consents`

> **S15P31E105-250 확정 계약 · 2026-11-02.**

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 미정 사항 | 없음 |
| 비고 | 약관 버전·동의 시각은 저장하지 않으므로 응답하지 않는다 |

### 설명

로그인 회원 본인의 네 동의 유형의 현재 상태를 조회해 권한·설정 화면을 복원한다. OS 권한과 서버 동의 상태는 다른 값이다.

### 인증 및 권한

- 로그인 회원 본인의 상태만 조회한다.
- 유효한 토큰이어도 회원이 ACTIVE가 아니면(탈퇴) `401 UNAUTHORIZED`다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK`

```json
{
  "items": [
    {"consentType": "TERMS_OF_SERVICE", "granted": true},
    {"consentType": "PERSONAL_INFO", "granted": true},
    {"consentType": "LOCATION_DATA", "granted": true},
    {"consentType": "HEALTH_DATA", "granted": false}
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 항상 4개, 위 고정 순서 |
| `items[].consentType` | string | O | TERMS_OF_SERVICE / PERSONAL_INFO / LOCATION_DATA / HEALTH_DATA |
| `items[].granted` | boolean | O | 현재 유효 동의 여부. 필수 3종은 U15에서 true가 강제되고 저장하지 않으므로 활성 회원이면 항상 true(파생 값). HEALTH_DATA는 `users.health_data_access` |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조, 또는 회원이 ACTIVE가 아님 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 잠그지 않는 읽기 전용 조회다. 진행 중인 W04 철회는 커밋된 뒤에 보인다.

### 상태값

- W04 상태값과 같다.

### 미정 사항

- [x] 응답 필드·JSON 구조 확정(S15P31E105-250, 2026-11-02)
- [x] HTTP 성공 코드와 오류 코드 확정(S15P31E105-250, 2026-11-02)


## W06 Samsung Health 데이터 동기화

`POST` `/api/v1/health-records/sync`

> **S15P31E105-252 확정 계약 · 2026-11-02, S15P31E105-572 수면 추가 · 2026-11-09.** 지원 레코드는 RunWay 워치 일상 심박 하루 추정값(`provider: RUNWAY_WATCH`)과 삼성 헬스 기상일별 수면 합계(`provider: SAMSUNG_HEALTH`) 두 가지다. 활동량·삼성 헬스 과거 운동 등 다른 레코드는 실제 SDK 지표를 확인한 뒤 별도 업무에서 `type`을 추가한다. 이름의 "Samsung Health"는 기존 API 이름을 유지한 것이며 심박 레코드의 출처는 삼성 헬스가 아니다.

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | WAT-001~008 / SYS-001 / RDY-001 |
| 관련 업무 | 서버 S15P31E105-252, 워치 계산 S15P31E105-63, 폰 업로드 S15P31E105-281, 준비도 S15P31E105-254, 삼성 헬스 수면 S15P31E105-572 |
| 미정 사항 | 다른 레코드 종류(아래 "후속 확정 사항") |

### 설명

휴대폰 앱의 서비스가 워치에서 받은 날짜별 일상 심박 추정값을 서버에 올린다. 서버는 회원·건강정보 동의를 확인하고 `daily_health_metrics.rhr_bpm`에 날짜별 1개 값으로 저장한다. 같은 날짜는 더 큰 revision만 갱신한다.

휴대폰 앱은 삼성 헬스에서 직접 읽은 수면을 폰 시간대 기상일별로 합산해 같은 API로 올린다(`provider: SAMSUNG_HEALTH`). 서버는 `daily_health_metrics.sleep_duration_min`에 날짜별 1개 값으로 저장하며 마지막 값이 우선한다.

**값의 의미와 출처:** `estimatedRestingHrBpm`은 삼성 헬스 공식 안정 시 심박이 아니다. **RunWay 워치 일상 측정 최근 24시간 추정치(`ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2`)** 로, 워치가 최근 24시간 1분 평균 HR 중 운동 구간을 뺀 하위 10%의 평균을 매시간 다시 계산한 값이다. 계산·보관 규칙은 [63번 구현 설계](../watch-passive-health-validation.md#63번-구현-설계-2026-10-30)와 [워치→폰 메시지 9.9](../watch-mobile-server-integration.md#99-일상-심박-하루-추정값과-건강-동의-공유-s15p31e105-63)를 따른다.

### 인증 및 권한

- 로그인 회원 본인의 행에만 저장한다. 요청에 회원·기기 식별자를 받지 않는다.
- 탈퇴 등 활성 회원이 아니면 401 `UNAUTHORIZED`.
- `users.health_data_access`가 동의(`AGREE`)가 아니면 403 `CONSENT_REQUIRED`로 요청 전체를 거절하고 아무것도 저장하지 않는다.
- 기기(`deviceId`)는 받지 않는다. `daily_health_metrics`에 기기가 저장되지 않으며, 워치를 해제·교체한 뒤 폰에 남은 값도 올릴 수 있어야 하기 때문이다.

### Request Body

| 필드 | 타입 | 필수 | 의미·제약 |
|---|---|:---:|---|
| `provider` | string | O | 레코드 출처. `RUNWAY_WATCH`(type `DAILY_HR_ESTIMATE`만) 또는 `SAMSUNG_HEALTH`(type `DAILY_SLEEP_SUMMARY`만). 한 요청은 한 provider의 레코드만 담는다 |
| `records` | object[] | O | 길이 1~31. 각 원소는 객체 |

최상위에는 위 두 필드만 둔다. 심박 레코드 필드 이름은 워치→폰 `DAILY_HR_SUMMARY`와 같아 폰이 변환 없이 중계한다.

레코드 검증은 provider가 정한 레코드 형식으로 정의되지 않은 키 → 필수 키 누락 → 아래 표의 필드 순서로 진행하고 첫 위반 하나만 `errors`에 담는다. 따라서 다른 provider의 레코드는 키 차이로 `UNKNOWN_FIELD`가 되거나, 키가 맞아도 type이 provider와 맞지 않으면 `UNSUPPORTED_RECORD_TYPE`(field `type`)이다. 자료형이 틀리거나 null이면 `type`·`method`는 `UNSUPPORTED`, `metricDate`·`computedAt`은 `INVALID_FORMAT`, 숫자 필드는 `INVALID_TYPE`이다.

**`type: DAILY_HR_ESTIMATE` 레코드** — 모든 키 필수, 정의되지 않은 키 금지, null 불가.

| 필드 | 타입 | 의미·제약 | 저장 |
|---|---|---|---|
| `type` | string | `DAILY_HR_ESTIMATE` | — |
| `metricDate` | string(`YYYY-MM-DD`) | 워치 시간대 기준 계산 날짜. 실제 날짜이며 서버 UTC 오늘 −8일 ~ +1일(폰 미업로드 보관 7일과 시간대 차이를 감안) | `metric_date` |
| `revision` | integer | 1~2147483647. 같은 날짜의 값·유효 분 수가 바뀔 때마다 워치가 1씩 올림 | `rhr_revision` |
| `estimatedRestingHrBpm` | number | 30~220bpm, 소수 둘째 자리까지(끝자리 0은 허용, 예: `58.400`). 반올림하지 않고 넘으면 거절 | `rhr_bpm` |
| `method` | string | `ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2`만 지원 | 저장 안 함(지원 값 하나) |
| `validSampleCount` | integer | 계산에 쓴 유효 분 수. 1~1440 | 저장 안 함 |
| `computedAt` | string | 계산 시각. `Z`로 끝나는 ISO 8601 UTC | 저장 안 함 |

```json
{
  "provider": "RUNWAY_WATCH",
  "records": [
    {
      "type": "DAILY_HR_ESTIMATE",
      "metricDate": "2026-10-30",
      "revision": 3,
      "estimatedRestingHrBpm": 58.4,
      "method": "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2",
      "validSampleCount": 812,
      "computedAt": "2026-10-30T09:00:00Z"
    }
  ]
}
```

**`type: DAILY_SLEEP_SUMMARY` 레코드** (`provider: SAMSUNG_HEALTH`, S15P31E105-572) — 모든 키 필수, 정의되지 않은 키 금지, null 불가.

| 필드 | 타입 | 의미·제약 | 저장 |
|---|---|---|---|
| `type` | string | `DAILY_SLEEP_SUMMARY` | — |
| `metricDate` | string(`YYYY-MM-DD`) | 폰 시간대 기상일(수면 세션 종료 시각의 로컬 날짜). 범위는 심박과 같은 서버 UTC 오늘 −8일 ~ +1일 | `metric_date` |
| `sleepDurationMin` | number | 그 기상일에 끝난 수면의 실제 수면 시간 합(분). 0 초과 1440 이하, 소수 둘째 자리까지. 반올림하지 않고 넘으면 거절. 0은 미측정과 구분되지 않으므로 받지 않는다 | `sleep_duration_min` |
| `computedAt` | string | 폰 집계 시각. `Z`로 끝나는 ISO 8601 UTC | 저장 안 함 |

폰 집계 규칙(S15P31E105-572): 삼성 헬스 직접 읽기 결과만 쓴다(Health Connect 대체 경로 제외). 종료된 세션만 기상일에 넣고, 같은 원본의 중복과 겹친 세션은 합쳐 한 번만 센다. 삼성 헬스가 수면 시간을 주지 않고 단계도 세션 전체를 덮지 않아 시간을 확정할 수 없는 날은 보내지 않는다(0으로 채우지 않음). 출처 기기·앱은 저장하지 않는다.

```json
{
  "provider": "SAMSUNG_HEALTH",
  "records": [
    {
      "type": "DAILY_SLEEP_SUMMARY",
      "metricDate": "2026-11-08",
      "sleepDurationMin": 412.5,
      "computedAt": "2026-11-08T00:30:00Z"
    }
  ]
}
```

예시는 합성 값이다.

### Response

`200 OK` — 유효 레코드의 저장이 커밋된 뒤 응답한다. 모든 레코드가 거절돼도 200이다.

```json
{
  "acceptedCount": 1,
  "duplicateCount": 0,
  "rejectedCount": 1,
  "errors": [
    { "index": 1, "code": "INVALID_RECORD", "field": "estimatedRestingHrBpm", "reason": "OUT_OF_RANGE" }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `acceptedCount` | integer | O | 새로 저장했거나 갱신한 레코드 수. 심박은 저장된 revision보다 큰 revision, 수면은 저장값과 다른 값 |
| `duplicateCount` | integer | O | 바꾸지 않은 레코드 수. 심박은 저장된 revision이 같거나 더 큼, 수면은 저장값과 같음 |
| `rejectedCount` | integer | O | 검증에서 거절한 레코드 수. `errors` 길이와 같음 |
| `errors` | object[] | O | 거절 레코드마다 첫 위반 하나. 없으면 빈 배열 |
| `errors[].index` | integer | O | 요청 `records` 배열 위치(0부터) |
| `errors[].code` | string | O | `INVALID_RECORD`(형식·값 위반) 또는 `UNSUPPORTED_RECORD_TYPE`(지원하지 않는 `type`·`method`) |
| `errors[].field` | string / null | O | 위반 필드 이름. 정의되지 않은 키가 있으면 null(보낸 키 이름을 되돌려 보내지 않음) |
| `errors[].reason` | string | O | `REQUIRED`, `UNKNOWN_FIELD`, `INVALID_TYPE`, `INVALID_FORMAT`, `OUT_OF_RANGE`, `TOO_MANY_DECIMALS`, `UNSUPPORTED` |

`acceptedCount + duplicateCount + rejectedCount = records 길이`다. 오류에는 건강 값 원문을 넣지 않는다.

**폰 처리:** accepted·duplicate 레코드는 업로드 완료로 표시해도 된다. rejected 레코드와 400·413·422는 같은 내용으로 다시 보내도 성공하지 않으므로 재시도하지 않는다. 응답을 받지 못했거나 503이면 같은 요청을 그대로 다시 보내도 된다(조건부 upsert라 중복 저장 없음). 500은 공통 기준대로 즉시 자동 재실행하지 않는다. 다만 W06 저장은 조건부 upsert라 같은 요청을 다시 보내도 저장 결과가 달라지지 않으므로, 다음 업로드 주기에 다시 보내는 것은 허용한다. 재시도 간격·상한은 폰 업로드 업무(281)가 정하며 무한 재시도하지 않는다. 폰은 W06 요청을 한 번에 하나씩 보낸다(같은 회원의 동시 요청 금지). 동시 요청은 저장 결과를 바꾸지 않지만 서로 잠금을 기다리는 동안 같은 회원의 로그인·프로필 저장이 503이 될 수 있다(처리 규칙 2).

### 오류 응답

요청 전체 오류는 공통 `{code, message, details}` 형식이며 아무것도 저장하지 않는다.

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | JSON 구문·중복 키·NaN·표현 한계를 넘는 숫자(예: 지수 초과), 본문이 객체가 아님, `provider`·`records` 누락·자료형, 최상위 추가 필드, `records`가 비었거나 31개 초과, 원소가 객체가 아님 |
| `401 UNAUTHORIZED` | 토큰 없음·만료·위변조, 활성 회원이 아님 |
| `403 CONSENT_REQUIRED` | 건강정보 동의가 없거나 철회됨 |
| `413 FILE_TOO_LARGE` | 본문 32 KiB(32768바이트) 초과. 실제로 읽은 바이트로 판정 |
| `422 UNSUPPORTED_RECORD_TYPE` | `provider`가 `RUNWAY_WATCH`·`SAMSUNG_HEALTH`가 아님(details.fields[0].name=`provider`) |
| `500`/`503` | DB 처리 실패. 공통 오류 처리 기준을 따르며 유효 레코드도 모두 롤백된다 |

레코드 하나의 위반은 위 표의 전체 오류가 아니라 200 응답의 `errors`로 돌려준다.

### 처리 규칙

1. 본문 크기 → 구문·최상위 형태 → provider 순으로 검사한다. 레코드 검증은 저장 전에 끝내며 위반 레코드는 저장하지 않는다.
2. 한 트랜잭션에서 회원 행을 `FOR SHARE`로 읽어 활성 회원·동의를 확인한다. 동의 철회가 `users.health_data_access`를 바꾸는 회원 행 UPDATE라는 전제에서, 철회가 먼저 커밋됐으면 철회 값을 읽어 403이고, W06이 먼저 읽었으면 철회는 W06 커밋 뒤에 진행된다. 그 사이에 커밋된 W06 값은 철회 전에 확정된 것으로 본다. W04 철회는 기존 값을 삭제하지 않으며 회원 행 갱신을 첫 쓰기로 두어 이 순서를 유지한다(S15P31E105-250). W06이 같은 회원의 다른 W06을 기다리는 동안에도 회원 행 공유 잠금을 유지하므로, 같은 회원의 로그인·프로필 저장(회원 행 잠금 대기 상한 2초)이 그동안 503이 될 수 있다.
3. 유효 레코드를 날짜 오름차순(같은 날짜는 요청 순서 유지)으로 `(user_id, metric_date)` 조건부 upsert로 저장한다. 같은 회원의 동시 요청이 날짜 행 잠금을 같은 순서로 잡아 교착이 생기지 않게 하기 위해서다. 응답 `errors[].index`는 요청 위치 그대로다. 행이 없으면 넣고, 있으면 `rhr_revision`이 NULL이거나 새 revision보다 작을 때만 `rhr_bpm`·`rhr_revision`을 바꾼다. 다른 건강 컬럼은 바꾸지 않는다. 비교는 저장 문장 안에서 하므로 같은 날짜 요청이 동시에 와도 최종값은 가장 큰 revision이다.
   - 수면은 행이 없으면 넣고, 있으면 `sleep_duration_min`이 새 값과 다를 때(NULL 포함)만 그 컬럼을 바꾼다(마지막 값 우선, revision 없음). 다른 건강 컬럼은 바꾸지 않는다. 같은 값이면 쓰지 않아 duplicate이고 `updated_at`도 그대로다.
4. 어느 저장이든 실패하면 모두 롤백한다. 같은 요청을 다시 보내면 조건부 upsert라 같은 최종 상태가 되고 이미 반영된 레코드는 duplicate로 응답한다.
5. 한 요청에 같은 날짜가 여러 번 있으면 요청 순서대로 처리하고, 각 레코드는 그 시점의 저장값과 비교해 accepted·duplicate로 센다. 최종값은 가장 큰 revision이다. 예: `[rev1, rev2]`는 둘 다 accepted, `[rev2, rev1]`은 accepted 1·duplicate 1. 따라서 `acceptedCount`는 바뀐 날짜 수와 다를 수 있다. 수면은 revision 없이 요청 순서상 마지막 값이 남으며, 같은 날짜의 같은 값은 duplicate로 센다.
6. 값이 저장·갱신된 날짜가 있으면 같은 트랜잭션에서 내부 이벤트 `DailyHealthMetricsChangedEvent(userId, 날짜 목록)`을 발행한다. 준비도 자동 평가([R02 자동 평가](readiness.md#자동-평가--내부-필수-처리), S15P31E105-254)는 커밋 후 리스너(`@TransactionalEventListener`)로 구독한다. 전부 duplicate·거절·롤백이면 전달되지 않는다. 조회나 별도 평가 요청을 요구하지 않는다. 같은 트랜잭션의 동기 리스너(`@EventListener`)가 예외를 던지면 W06 저장이 롤백되므로 구독자는 커밋 후 리스너를 쓴다. 커밋 후 리스너가 실패하거나 서버가 중단되면 이벤트는 다시 전달되지 않으며, 같은 요청 재전송도 duplicate라 재발행되지 않는다. 254는 평가 실패를 W06 응답에 전파하지 않으며, 누락 복구(정기 재평가 등)는 후속 업무로 남겼다([자동 평가](readiness.md#자동-평가--내부-필수-처리)).
7. 건강 값은 로그·오류 본문에 남기지 않는다. DB 오류는 SQLState만 기록한다.
8. 호출 시점은 폰 업로드 업무(281)가 정한다. W07의 5초 전송 규칙을 적용하지 않는다. 폰은 날짜별 최신 revision을 업로드하고 성공 응답 뒤에만 완료로 표시한다.

### 알려진 한계

- 수면은 revision이 없어 마지막으로 커밋된 요청의 값이 남는다. 폰은 요청을 하나씩 보내므로 한 기기에서는 순서가 바뀌지 않는다. 같은 회원이 여러 폰을 쓰면 동시가 아니어도 마지막으로 올린 폰의 값이 남고, 다른 폰은 자기 값이 바뀌지 않는 한 다시 보내지 않는다. 2026-11-09 사용자 결정으로 수용한다(S15P31E105-572).
- 수면 값은 지우거나 비우는 레코드가 없다. 삼성 헬스에서 기록을 삭제하거나, 시간을 확정할 수 없는 날로 바뀌거나, 시간대가 바뀌어 기상일이 달라져도 서버에 이미 저장된 그 날짜 값은 그대로 남는다. 0분 이하로 집계된 날은 보내지 않는다(S15P31E105-572).
- 같은 revision에 다른 값이 오면 duplicate로 저장값을 유지한다. 워치 앱 재설치 등으로 revision이 1부터 다시 시작하면, 그 날짜는 새 revision이 저장된 revision을 넘을 때까지 갱신되지 않는다. 다음 날짜부터는 영향이 없다.
- 레코드에 운동이 없으므로 W07 운동과의 중복 집계 문제는 현재 해당하지 않는다. 운동 레코드를 추가할 때 출처·원본 ID·시각 기반 식별 규칙을 함께 정한다.

### 후속 확정 사항

- [x] 삼성 헬스 수면의 `type`·단위·기상일·출처와 저장 매핑 (2026-11-09, 572)
- [ ] 활동량·삼성 헬스 과거 운동 등 다른 SDK 지원 지표의 `type`·단위·측정 시각·출처와 저장 매핑
- [ ] 위 레코드의 외부 원본 ID·수정 기록·W07 운동과의 중복 집계 방지
- [x] 부분 저장과 항목별 오류·건수 산정·재요청 규칙 (2026-11-02, 252)
- [x] 일상 심박 추정값의 저장 매핑·순서 역전 처리 (2026-11-02, 252)

## W07 워치 운동 배치 동기화

`POST /api/v1/sync/batches`

> **173번 온라인 MVP 계약안 · 2026-10-27.** 사용자가 승인한 온라인·불변 batch·기존 ERD 유지·batch 단위 멱등성·전체 저장/거절·단계별 ACK를 반영했다. 아래 상세 JSON·타입·오류는 구현 기준으로 검토하는 명세이며 실제 API 구현 완료를 뜻하지 않는다. 순번별 누락 탐색과 실험 파일 수입은 포함하지 않는다.

### 호출 주체와 책임

- 워치가 측정 데이터의 생산 기기다. 워치→폰은 [MessageClient 계약](../watch-mobile-server-integration.md#9-워치폰-messageclient-메시지-명세), 폰→서버는 이 API를 사용한다. 폰 GPS는 폰 자신의 deviceId로 별도 batch를 만든다. 한 batch에 생산 기기·세션을 섞지 않는다.
- 폰은 본인 로그인 인증으로 호출하며 워치의 deviceId·batch ID·본문을 그대로 중계한다. 계정·기기 등록/연결·세션 소유권·현재 건강/위치 동의를 검사한다. batch ID나 해시는 인증 수단이 아니다.
- 각 생산 기기는 앱에 도착한 새 원본을 최대 5초 동안 모아 batch를 생성·전송한다. 전체 MessageClient envelope를 포함해 32 KiB 이하이며, 크기 상한에 도달하면 먼저 나누어 전송한다. 빈 batch는 만들지 않고 종료 시 남은 원본은 즉시 마지막 batch로 전송한다. 폰은 워치 batch를 영속 저장한 뒤 추가로 5초를 기다리지 않고 서버로 중계한다. 센서 전달 지연·통신·서버 저장·AI 계산까지 5초 내에 완료됨을 보장하는 것은 아니다.

### Request Body

| 필드 | 타입 | 필수 | 의미·제약 |
| --- | --- | :---: | --- |
| `id` | string(UUID v4) | O | 생산 기기가 최초 생성한 batch ID. DB의 sync_batches.client_batch_id(UUID)에 저장. JSON에서는 UUID 문자열로 전송하며 재전송·중계 시 대소문자를 포함한 원래 표기 유지 |
| `deviceId` | integer(int64) | O | 원본 생산 기기의 user_devices.id. 중계 폰 ID로 치환 금지 |
| `sessionId` | integer(int64) | O | 본인 running_sessions.id. 한 batch는 한 운동. 실험 UUID와 구분 |
| `schemaVersion` | string | O | 이 명세 예시는 `1`. payload_version에 대응. 실제 배포 전 이 타입 목록·해시 규칙의 지원 버전을 등록해야 함 |
| `payloadHash` | string | O | 아래 정규화 입력의 SHA-256, 소문자 hex 64자리. 서버도 재계산 |
| `items` | object[] | O | 길이 1 이상. 배열 순서·각 값은 batch 완성 후 불변. 아래 허용 타입만 포함 |

### items 공통과 타입별 본문

`type`, `measuredAt`는 공통 필수다. measuredAt는 원래 측정 기준 ISO 8601 UTC 시각이며 수신 시각으로 치환하지 않는다. 한 항목의 원래 시각이 다른 지표들을 억지로 같은 시각으로 합치지 않는다. 아래 이름은 현재 DB에 표현 가능한 측정 샘플/위치를 위한 계약안이다. SDK 원본 객체 전체를 그대로 저장하는 계약이 아니다.

| 타입 | 필수·nullable 필드 | 검증과 실제 SQL 대응 |
| --- | --- | --- |
| `METRIC_SAMPLE` | `elapsedDurationSec` integer≥0, `heartRateBpm` number/null, `cadenceSpm` number/null, `speedMps` number/null, `gradePercent` number/null, `totalDistanceM` number/null, `routeProgressM` number/null, `isHrMeasured` boolean. 모든 키 포함 | running_metric_samples의 elapsed_duration/heart_rate/cadence/speed/grade/total_distance/route_progress/is_hr_measured. 각 값의 단위는 sec/bpm/spm/m·s⁻¹/%/m/m. 측정값은 유한수. 거리·속도·케이던스는 0 이상, 심박은 입력 시 양수. 미측정은 null. isHrMeasured=true이면 심박 필수, false이면 심박 null. 적어도 하나의 측정값이 있어야 함 |
| `GPS_POINT` | `coordinates` [longitude,latitude], `accuracyM` number/null, `altitudeM` number/null. 모든 키 포함 | running_route_points.position/accuracy/altitude. 경도 -180..180, 위도 -90..90, 정확도 입력 시 0 이상. 좌표계 WGS84. 경도·위도 순서 준수 |

두 타입의 device_id와 running_session_id는 batch의 deviceId·sessionId, measured_at는 항목의 measuredAt다. 서버 생성 id·created_at를 클라이언트 원본 ID·측정 시각으로 사용하지 않는다. 서로 다른 측정 시각은 별도 항목으로 보내고, 없는 HR·GPS를 0이나 과거 값으로 채우지 않는다.

`elapsedDurationSec`는 운동 시작을 기준으로 계산한 경과시간(초)이다. 기기 시각 차이·일시정지 구간·누적 측정값은 세션·분석 규칙에 따라 처리하며, 구간 값을 임의로 나누거나 같은 값을 중복 합산하지 않는다. 숫자는 DB가 허용하는 자릿수인지 확인하고 임의로 반올림하거나 소수점을 버리지 않는다.

**업로드 범위:** W07은 명세에 정의한 측정값·GPS만 받는다. 데이터 출처(source)·품질(quality)·측정 구간 시작/끝·심장 박동 간격(IBI)·SDK 원본 ID 등 미지원 필드나 타입을 보내면 422 오류로 batch 전체를 거절한다. 운동 제어·BPM 변경 결과는 W07에 넣지 않고 S03~S06/P07로 `session_control_events`에 저장한다. 전송 데이터와 수신·저장 확인(ACK)의 기기 내 보관은 통합 설계 9.7절을 따른다.

### 합성 요청 예시

아래 해시는 표시된 본문의 해시 투영(deviceId·sessionId를 문자열화, payloadHash 제외)에 대해 계산한 값이다. 실데이터가 아니다.

```json
{
  "id": "00000000-0000-4000-8000-000000000101",
  "deviceId": 101,
  "sessionId": 5001,
  "schemaVersion": "1",
  "items": [
    {
      "type": "METRIC_SAMPLE",
      "measuredAt": "2026-10-27T01:00:01Z",
      "elapsedDurationSec": 1,
      "heartRateBpm": 142,
      "cadenceSpm": null,
      "speedMps": null,
      "gradePercent": null,
      "totalDistanceM": null,
      "routeProgressM": null,
      "isHrMeasured": true
    }
  ],
  "payloadHash": "ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c"
}
```

### 해시·불변성·중복 처리

1. 해시 입력은 payloadHash를 제외한 W07 본문 전체다. batch id의 UUID 문자열은 대소문자 등 원래 표기를 유지하며 해시 계산 전에 다시 쓰지 않는다. 해시 입력 객체의 deviceId·sessionId를 손실 없이 파싱한 정수의 정규 십진 문자열로 바꾼다. 나머지는 RFC 8785 JCS로 정규화한 UTF-8 바이트에 SHA-256을 적용한다. wire의 정수 타입을 일괄 변경하는 것은 아니다. 큰 ID는 RN Number로 반올림하지 않는다. 중복 JSON 키·NaN/Infinity를 거절하고 null/생략·배열 순서를 구분한다.
2. 생산 기기는 로컬 원본의 batch 배정 표시·ID·완성 본문을 같은 로컬 트랜잭션으로 확정한다. 실패하면 함께 롤백한다. 재시도와 폰 중계에서 항목을 재배정·추가·삭제하거나 새로운 ID를 발급하지 않는다.
3. 서버는 권한·동의를 먼저 검사하고 `(device_id,client_batch_id)` UNIQUE로 신규 여부를 판정한다. 세션 행을 먼저 잠근 뒤 새 batch의 대상 데이터 insert와 sync_batches COMMITTED·committed_at를 한 트랜잭션으로 확정한다. END 확정 전 원본을 받고, END/APPLIED 확정 후 새 batch는 거절한다. 이미 COMMITTED인 동일 batch는 기존 ACK를 반환한다. END 결과 처리도 같은 세션 행을 잠그므로 저장 확인과 신규 원본 반영이 뒤섞이지 않는다. 중간 실패 시 대상 데이터와 COMMITTED 모두 롤백한다.
4. 기존 COMMITTED의 session_id·payload_version·payload_hash가 같고 수신 본문 해시도 유효하면 이미 저장한 요청으로 성공 응답한다. 대상 데이터·제어·분석을 재실행하지 않는다. 다르면 409로 거절한다. 다른 요청이 같은 ID를 동시에 쓰면 선행 commit 이후 다시 검사하며 단순 DO NOTHING을 내용 일치로 취급하지 않는다.
5. 전체 batch 성공만 지원한다. acceptedCount는 실제 신규 저장 수가 아니라 이 batch의 저장 확인 항목 수다. 동일 batch 재응답도 items 길이와 같다. 부분 성공·원본별 누락 목록을 반환하지 않는다.

### Response · 서버 저장 ACK

`200 OK`

```json
{
  "status": "COMMITTED",
  "batchId": "00000000-0000-4000-8000-000000000101",
  "acceptedCount": 1
}
```

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `status` | string | 성공은 COMMITTED. 단순 RECEIVED·202·메시지 발신 성공은 저장 ACK가 아님 |
| `batchId` | string(UUID) | 요청 id와 같은 UUID 문자열. DB의 client_batch_id에 대응하며 서버 행 번호 sync_batches.id와 구분 |
| `acceptedCount` | integer | 최초·재요청 모두 저장 확인한 해당 batch 항목 수. items 길이와 일치해야 함 |

폰은 batchId·status·개수를 검증하고 ACK를 영속 기록한 뒤 워치에 전달한다. ACK 대상은 원래 계정·기기·세션·batch이며 늦은 응답을 다른 운동의 저장 확인으로 적용하지 않는다. 워치는 폰 수신 ACK만으로 전송 대기를 해제하지 않는다. 분석 완료·목표 달성 여부는 이 응답에 포함하지 않는다.

### 오류와 재시도

공통 오류 형식은 [API 공통 규약](README.md#성공오류-응답)을 따른다. 실제 건강/GPS 값·인증정보를 오류 details나 로그에 넣지 않는다.

| HTTP·code | 조건 | 클라이언트 처리 |
| --- | --- | --- |
| 400 VALIDATION_ERROR | JSON 구문·필수 필드·자료형·ID 범위 오류 | 동일 입력 자동 재시도 없음 |
| 401 UNAUTHORIZED | 로그인 토큰 누락·만료·위변조 | 인증 원인 해결 전 중단 |
| 403 DEVICE_FORBIDDEN | 본인 등록/연결 기기가 아님 | 발신 중단, 큐 격리/기기 확인 |
| 403 SESSION_FORBIDDEN | 본인 세션과 생산 기기 소유 관계 불일치 | 발신 중단, 세션 확인 |
| 403 CONSENT_REQUIRED | 필요한 건강/위치 동의 없음·철회 | 해당 수집·전송 중단 |
| 409 BATCH_HASH_CONFLICT | 같은 batch ID의 세션·버전·내용이 다름 | 새 ID로 우회하지 않고 충돌로 보관 |
| 422 INVALID_BATCH | 지원하지 않는 버전·타입·추가 필드·단위/범위/해시 위반·빈 items | 전체 거절. 자동 재시도 없음 |
| 413 FILE_TOO_LARGE | W07 본문 크기 상한 초과 | 발신 중단. 이미 완성한 batch를 자동 재구성하지 않음 |
| 429 | 서버 요청 제한 | Retry-After를 우회하지 않음 |
| 500 INTERNAL_ERROR / 503 SERVICE_UNAVAILABLE | 서버 저장 처리 실패/일시 의존 장애 | 결과가 불명확하면 동일 ID·본문으로 제한 재시도 |

W07 본문도 32 KiB를 넘지 않는다. MessageClient는 envelope까지 32 KiB이므로 생산 기기는 그 오버헤드까지 반영해 더 작은 payload를 생성한다. HTTP Content-Length만 믿지 않고 실제 수신 바이트 상한을 검증한다.

### 서버 검사 순서와 확정 정책 (S15P31E105-253 확정, 2026-11-02)

지원 schemaVersion은 `"1"`이다. 서버는 아래 순서로 검사하며, 앞 단계에서 거절하면 뒤 단계를 수행하지 않고 어떤 행도 남기지 않는다.

1. **크기:** Content-Length가 32 KiB(32,768바이트)를 넘으면 읽기 전에, Content-Length가 없으면(chunked 등) 실제로 읽은 바이트가 넘을 때 413 FILE_TOO_LARGE. Content-Length가 실제보다 작으면 표시된 길이까지만 읽으므로 잘린 본문은 400이다.
2. **400 VALIDATION_ERROR:** JSON 구문, 중복 키, NaN/Infinity, 최상위 객체 아님, 최상위 필수 필드 누락, 최상위 자료형(id는 UUID v4 문자열, deviceId·sessionId는 양의 int64 정수, schemaVersion·payloadHash는 문자열, items는 배열), payloadHash 형식(소문자 hex 64자리 아님).
3. **422 INVALID_BATCH:** 최상위 추가 필드, 지원하지 않는 schemaVersion, 빈 items, items 안의 모든 위반(객체 아님·미지원 type·키 누락/추가·자료형·단위/범위·DB 자릿수 초과·isHrMeasured 불일치·측정값 없음·measuredAt 형식), 그리고 해시 불일치. measuredAt은 `Z`로 끝나는 UTC이며 소수 초는 6자리(마이크로초)까지다. 24:00·윤초(:60)는 거절한다. 좌표는 PostGIS geography(double)로 저장하므로 별도 자릿수 제한이 없다. 지원하지 않는 키 이름은 오류 details에 되돌려 보내지 않는다. 숫자는 DB NUMERIC 자릿수(심박 7,2 / 케이던스 8,2 / 속도 10,3 / 경사 7,3 / 거리·진행 12,2 / 정확도·고도 10,2)를 넘으면 반올림하지 않고 거절한다.
4. **트랜잭션 안:** 세션(FOR NO KEY UPDATE) → 본인 기기(FOR SHARE) 순서로 잠근다. 회원 행은 잠그지 않는다(로그인·프로필 저장의 회원 행 잠금과 간섭 방지). 건강 동의는 세션·기기 잠금을 얻은 뒤 다시 읽어, 잠금을 기다리는 동안 커밋된 철회는 반영한다. 철회와의 엄격한 순서는 W04가 보장한다. 철회는 본인 세션 행을 FOR SHARE로 잠가 진행 중인 W07의 커밋을 기다리고, 그 뒤의 W07은 철회 커밋을 기다렸다가 철회 값을 읽는다(S15P31E105-250).
   - 탈퇴·없는 회원: 401 UNAUTHORIZED.
   - 없는·삭제된·타인 세션: 403 SESSION_FORBIDDEN. 존재 여부를 구분해 알리지 않는다.
   - 없는·타인 기기: 403 DEVICE_FORBIDDEN.
   - 건강정보 동의(`users.health_data_access`)가 DISAGREE이고 items에 METRIC_SAMPLE이 하나라도 있으면 batch 전체를 403 CONSENT_REQUIRED로 거절한다. GPS_POINT만 있는 batch는 받는다. 위치 동의는 가입 필수이므로 다시 검사하지 않는다. 이 검사는 5의 재응답보다 먼저이므로, 저장 후 응답이 유실된 뒤 동의를 철회하면 같은 batch 재전송도 403이며 폰은 해당 batch를 저장 미확인으로 남긴다.
5. **이미 저장된 batch:** 같은 `(deviceId, id)` 행이 있으면 session·schemaVersion·해시가 모두 같을 때 기존 ACK(200)를 반환하고, 하나라도 다르면 409 BATCH_HASH_CONFLICT다. 이 재응답은 기기 해제·세션 종료·폰 인계 뒤에도 적용한다. 기존 행이 COMMITTED가 아니면(이전 프로토콜의 RECEIVED/REJECTED) 같은 ID로 저장할 수 없으므로 409다.
6. **새 batch 조건:**
   - W03으로 해제된 기기: 403 DEVICE_FORBIDDEN.
   - 기기가 세션의 controlDeviceId·relayDeviceId가 아님: 폰 인계(PHONE_FALLBACK) 세션에서 이 세션의 제어 기록이 있는 본인 워치이면 409 CONTROL_DEVICE_CHANGED, 그 밖에는 403 SESSION_FORBIDDEN.
   - 세션 상태: RUNNING·PAUSED는 받는다(END 승인 후 결과 확정 전 포함). READY는 START 명령이 PENDING/UNKNOWN일 때만 받는다(워치가 이미 측정을 시작했을 수 있음). 그 밖의 READY, COMPLETED, CANCELLED, INTERRUPTED, 기존 기록(state_version=0)은 409 INVALID_SESSION_STATE.
7. **저장:** sync_batches를 COMMITTED·committed_at과 함께 넣고 원본 행을 넣은 뒤 커밋한다. 다른 요청이 같은 키를 먼저 커밋했으면 그 행을 다시 읽어 5와 같이 판정한다.

DB 쓰기 오류는 재시도 가능한 장애면 503, 그 밖에는 500이며 batch 기록과 원본이 모두 롤백된다. 오류 로그에는 SQLState만 남기고 드라이버 메시지의 바인딩 값은 남기지 않는다. 세션·기기 잠금 대기는 서버 공통 잠금 대기 상한(기본 5초, S15P31E105-294)을 따르며, 넘으면 503 SERVICE_UNAVAILABLE이고 아무것도 저장하지 않는다. 클라이언트는 위 재시도 규칙대로 같은 ID·본문으로 다시 보낸다.

ACK 대기 초기값은 10초, 추가 시도는 1초·2초와 jitter를 두고 최대 2회다(구간별 최초 포함 3회). Retry-After가 있으면 우선하며 대기 중 새로운 batch로 제한을 우회하지 않는다. 상한 이후 저장 미확인으로 표시한다. timeout은 저장 실패의 증거가 아니다. 세션 종료 후 최대 2분의 마무리 전송에도 개별 시도 상한을 적용하고 인터넷 단절 후 장기 복구는 요구하지 않는다.

생산 기기당 미확인 batch 64개의 ACK 대기 버퍼를 초기값으로 둔다. 상한·반복 실패 시 미확인 payload를 자동 폐기하지 않고 새 수집·자동 코칭을 중단해 실패를 표시하며 가능한 종료 조작은 유지한다. DB 용량·기기 부하·AI 유효 입력 기간은 구현 시 검증한다.

### 종료와 분석

WATCH 모드는 워치 실제 종료 후 마지막 batch까지 W07 COMMITTED를 확인한 뒤 S06 RESULT에 uploadComplete=true를 보고한다. 폰·워치 각각의 전송 대기함을 확인하며 별도 마감 목록·ID 해시는 보내지 않는다. 종료 확정 전 온라인 마무리는 최대2분이다. 확인이 안 되면 저장 미확인을 표시하고 분석 완료로 처리하지 않는다. END 확정 뒤 새 batch는409 INVALID_SESSION_STATE로 거절하지만 이미 저장된 동일 batch의 ACK는 재응답한다. 그룹 종료는 실제 END 확인 전 PENDING인 개인 세션의 지연 batch를 받고 그룹 종료시각 이후 샘플은 집계에서 제외한다. 종료 후 자동 재집계·장기 복구는 제외한다.

## 173번 온라인 확정 계약

측정값 업로드는 위 W07 계약을, 폰·워치 간 메시지는 [MessageClient 명세](../watch-mobile-server-integration.md#9-워치폰-messageclient-메시지-명세)를 따른다.

### 저장 단위와 관련 계약

서버는 기기 ID와 batch ID를 기준으로 중복 저장을 막는다. 기기는 같은 측정 기록을 여러 batch에 넣지 않는다. 서로 다른 batch에 중복 포함된 측정 기록까지 서버가 찾아 제거하지는 않는다.

운동 제어 결과는 [세션 제어 공통 계약](sessions.md#세션-제어-공통-계약)을, 서버 시각·GPS 선택·기기 내 기록 보관은 [통합 설계 9.7절](../watch-mobile-server-integration.md#97-서버-api와-저장-매핑)을 따른다.

### 폰 인계 후 업로드·종료

워치 연결이 끊겨 폰으로 기록을 계속하는 경우, 아래 순서로 처리한다.

1. **이미 받은 워치 기록부터 저장한다.** 폰은 새로운 워치 batch 수신과 수신 확인(ACK)을 멈추고, 그때까지 폰에 저장한 batch 목록을 확정한다. 목록을 확정하는 동안 새 수신이 끼어들지 않도록 큐를 잠근다. 목록의 모든 batch가 W07에서 서버 저장 완료(COMMITTED)로 확인될 때까지 기다린다. 워치 안에만 있고 폰이 받지 못한 기록은 기다리지 않는다.
2. **운동 기록 제어를 폰으로 바꾼다.** S08에 TAKE_OVER_PHONE을 요청한다. 전환 결과를 확인하지 못하면 워치 batch 수신을 계속 차단하고, 새로 도착한 batch에 수신 ACK를 보내지 않는다.
3. **이후 기록은 폰 GPS로 수집한다.** 전환이 확인되면 해당 세션에 등록된 폰(relay PHONE)의 기기 ID로 GPS_POINT를 만들어 W07에 업로드한다. 심박이 없어도 GPS 기록만 전송할 수 있으며, 심박을 임의로 만들어 METRIC_SAMPLE에 넣지 않는다.
4. **폰에서 종료하고 마지막 기록을 저장한다.** S06 REQUEST로 폰의 END 명령을 먼저 승인받는다. 폰은 승인된 commandId로 GPS·타이머를 멈추고 마지막 폰 batch까지 COMMITTED를 확인한 뒤, 같은 S06에 RESULT와 uploadComplete=true를 보낸다. 이는 폰이 확보한 기록의 저장 완료를 뜻하며, 워치 전체 기록까지 받았다는 뜻은 아니다. 워치 응답이나 워치의 저장 대기 개수(pendingBatchCount)는 기다리지 않는다.
5. **저장 확인에 실패하면 미확인으로 표시한다.** 종료 후 마무리 전송은 최대 2분 동안 시도한다. 정해진 재시도 횟수 안에서 같은 요청을 다시 보내며, 끝내 저장을 확인하지 못하면 저장 미확인으로 표시한다.

서버는 다음 규칙을 적용한다.

- 본인 기기·세션인지와 필요한 동의를 먼저 확인한다. 폰 전환 뒤 처음 도착한 워치 batch는 409 CONTROL_DEVICE_CHANGED로 거절한다. 이미 서버에 저장된 batch를 다시 보내면 기존 정보·해시가 같은지 확인하고 저장 완료를 다시 알려 준다.
- batch 저장·폰 전환·종료가 동시에 요청돼도 같은 세션을 잠가 한 번에 하나씩 처리한다. 폰 전환 뒤 새 워치 기록이 저장되거나 현재 상태를 바꾸지 않도록 한다.

### 시작 미확인 중단 세션의 batch

S08 ABORT_UNCONFIRMED_START로 관리상 중단된 INTERRUPTED 세션에는 새 batch를 저장하지 않고 `409 INVALID_SESSION_STATE`를 반환한다. 이미 COMMITTED인 동일 batch는 권한·기기·내용 확인 후 기존 ACK를 반환한다. 미전송·미확인 payload를 새 운동에 재편입하거나 저장 완료로 표시하지 않는다. 관리상 중단은 W07 저장 완료·실제 END 확인을 대신하지 않는다.
