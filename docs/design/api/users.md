# API 명세 — 인증·사용자·러닝 프로필

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [U01](#u01-로그인) | 로그인 | POST | `/auth/login` | 1차 MVP | 공개 |
| [U02](#u02-토큰-갱신) | 토큰 갱신 | POST | `/auth/refresh` | 1차 MVP | Refresh Token |
| [U03](#u03-로그아웃) | 로그아웃 | POST | `/auth/logout` | 1차 MVP | Refresh Token |
| [U04](#u04-내-프로필-조회) | 내 프로필 조회 | GET | `/users/me` | 1차 MVP | 회원 |
| [U05](#u05-내-프로필-수정) | 내 프로필 수정 | PATCH | `/users/me` | 1차 MVP | 회원 |
| [U06](#u06-러닝-프로필-조회) | 러닝 프로필 조회 | GET | `/users/me/running-profile` | 1차 MVP | 회원 |
| [U07](#u07-러닝-프로필-저장부분-수정) | 러닝 프로필 저장·부분 수정 | PATCH | `/users/me/running-profile` | 1차 MVP | 회원 |
| [U08](#u08-평소-러닝-정보-조회) | 평소 러닝 정보 조회 (U06 통합) | — | — | 1차 MVP | 회원 |
| [U09](#u09-평소-러닝-정보-설정) | 평소 러닝 정보 설정 (U07 통합) | — | — | 1차 MVP | 회원 |
| [U10](#u10-러닝-환경-유형-조회) | 러닝 환경 유형 조회 (제외) | — | — | 제외 | — |
| [U11](#u11-추천-기본값-조회) | 추천 기본값 조회 | GET | `/users/me/preferences` | 1차 MVP | 회원 |
| [U12](#u12-추천-기본값-저장) | 추천 기본값 저장 | PUT | `/users/me/preferences` | 1차 MVP | 회원 |
| [U13](#u13-개인-공개-설정-조회) | 개인 공개 설정 조회 | GET | `/users/me/privacy-settings` | 1차 MVP | 회원 |
| [U14](#u14-개인-공개-설정-변경) | 개인 공개 설정 변경 | PATCH | `/users/me/privacy-settings` | 1차 MVP | 회원 |
| [U15](#u15-회원가입) | 회원가입 | POST | `/auth/signup` | 1차 MVP | 공개 |
| [U16](#u16-아이디-사용-가능-여부-확인) | 아이디 사용 가능 여부 확인 | GET | `/auth/login-id/availability` | 1차 MVP | 공개 |
| [U17](#u17-회원탈퇴-사전-정보-조회) | 회원탈퇴 사전 정보 조회 | GET | `/users/me/withdrawal-summary` | 1차 MVP | 회원 |
| [U18](#u18-회원탈퇴) | 회원탈퇴 | DELETE | `/users/me` | 1차 MVP | 회원 |
| [U19](#u19-앱-설정-조회) | 앱 설정 조회 | GET | `/users/me/settings` | 1차 MVP | 회원 |
| [U20](#u20-앱-설정-변경) | 앱 설정 변경 | PATCH | `/users/me/settings` | 1차 MVP | 회원 |
| [U21](#u21-러너-프로필-조회) | 러너 프로필 조회 | GET | `/users/{userId}/profile` | 1차 MVP | 회원 |
| [U22](#u22-러너-팔로우요청) | 러너 팔로우·요청 | PUT | `/users/{userId}/follow` | 1차 MVP | 회원 |
| [U23](#u23-러너-팔로우요청-취소) | 러너 팔로우·요청 취소 | DELETE | `/users/{userId}/follow` | 1차 MVP | 회원 |
| [U24](#u24-받은-팔로우-요청-목록) | 받은 팔로우 요청 목록 | GET | `/users/me/follow-requests` | 1차 MVP | 회원 |
| [U25](#u25-팔로우-요청-승인거절) | 팔로우 요청 승인·거절 | PATCH | `/users/me/follow-requests/{requesterId}` | 1차 MVP | 회원 |
| [U26](#u26-팔로워-목록) | 팔로워 목록 | GET | `/users/{userId}/followers` | 1차 MVP | 회원 |
| [U27](#u27-팔로잉-목록) | 팔로잉 목록 | GET | `/users/{userId}/following` | 1차 MVP | 회원 |
| [U28](#u28-휴대전화-인증번호-요청) | 휴대전화 인증번호 요청 | POST | `/auth/phone-verifications` | 1차 MVP | 공개 |
| [U29](#u29-휴대전화-인증번호-확인) | 휴대전화 인증번호 확인 | POST | `/auth/phone-verifications/confirm` | 1차 MVP | 공개 |
| [U30](#u30-비밀번호-재설정) | 비밀번호 재설정 | POST | `/auth/password-reset` | 1차 MVP | 공개 |

`GET /users/me/bookmarks`(내 스크랩 목록)와 `GET /users/me/likes`(내 좋아요 목록)는 경로만 `/users/me` 아래에 있는 커뮤니티 API다. 계약은 [커뮤니티 CMT18](community.md#cmt18-내-스크랩-목록)·[CMT19](community.md#cmt19-내-좋아요-목록)를 따른다(S15P31E105-634).

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

회원 응답은 users, 러닝 기준값은 user_profiles, 앱 설정은 user_settings를 사용한다. 비밀번호·전화번호·건강 동의 등 DB 컬럼을 공개 프로필에 자동 노출하지 않는다. user_follows는 follower_id → followee_id 방향이며 is_approved로 요청/성립을 구분한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 인증 정책 적용 범위

[ADR-0014](../../adr/0014-common-api-authentication.md)과 2026-10-27 사용자 승인에 따라 U01~U03의 토큰 전달·갱신·로그아웃 계약을 아래와 같이 확정한다. API 구현 완료를 뜻하지 않는다. 비밀번호 해시는 Argon2id, 로그인 실패 제한과 초기 설정 완료 기준은 아래 사용자 확정 정책을 따른다. 해시 비용의 실측과 저장 모델 구현은 후속 작업이다.

2026-10-28 사용자 결정으로 갱신 권한 저장소는 Redis를 사용한다. 선택 이유와 고려한 대안은 [ADR-0015](../../adr/0015-redis-refresh-token-store.md)를 따른다. 저장소 선택은 확정됐으며 영속화·복구 설정과 키·원자적 처리 구현은 후속 작업이다.

같은 날 193번의 추가 정책 결정으로 로그인 실패 횟수·잠금 상태도 기존 인증용 Redis에 저장한다. [ADR-0017](../../adr/0017-redis-login-attempt-store.md)과 아래 「로그인 연속 실패 제한」을 따른다. 1~4회 실패의 24시간 만료, 성공 초기화 시점, 완전 유실 복구 예외까지 확정했으며 193번의 구현·검증 기준으로 사용한다.

### 공통 토큰 계약

[ADR-0014](../../adr/0014-common-api-authentication.md)에 따라 회원 API는 HS256 JWT를 검증한다. 필수 claim은 iss=runway-backend, aud에 runway-api, sub=양의 BIGINT 사용자 ID의 십진 문자열, iat·exp=UTC 정수 초다. iat <= 서버 현재 시각 < exp, 0 < exp-iat <=600초를 요구한다. nbf가 있으면 현재 시각 이상으로 미래에 설정된 토큰은 거절한다. X-User-Id는 인증 근거가 아니다. 토큰에 개인정보·서명 키를 넣지 않는다.

로그아웃·탈퇴·향후 정지 후에도 기존 JWT는 원래 만료시각까지 최대 10분 인증에 사용할 수 있다. 즉시 차단을 위한 요청별 계정/로그인 상태 조회는 추가하지 않는다. 새 발급·갱신 허용을 뜻하지 않으며 기존 자원 존재·소유권·현재 동의·공개 범위 검사는 유지한다.


- 토큰은 JSON 본문으로 전달한다. 회원 API는 `Authorization: Bearer <accessToken>`을 사용한다. 쿠키와 `X-User-Id`를 인증수단으로 사용하지 않는다.
- Access Token은 JWT이며 수명은 최대 600초다. 최초 로그인부터 30일의 절대 상한도 넘지 않는다. 갱신으로 이 상한을 연장하지 않는다.
- Refresh Token은 추측 불가능한 난수 문자열로 발급하고 서버에는 원문 대신 해시를 저장한다. 사용할 때 교체하며 사용한 토큰의 계열 관계를 보관한다. 클라이언트는 값을 해석·변경하지 않는다.
- 토큰 발급 성공 응답은 아래 네 필드를 포함하며 모두 필수·NULL 불가다. U01은 사용자 정보와 초기 설정 상태를 추가한다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `accessToken` | string | 새 JWT. 민감 개인정보를 넣지 않음 |
| `refreshToken` | string | 새 갱신 토큰. U02 성공 시 이전 값 교체 |
| `expiresInSec` | integer | 발급 시점 Access Token의 실제 유효 초, 1~600. 절대 상한 직전에는 더 짧음 |
| `refreshExpiresAt` | string (ISO 8601 UTC) | 최초 로그인부터 30일의 절대 만료시각. 갱신해도 동일 |

- 서버 시각이 만료시각 이상이면 만료다. 1초 이상의 Access Token을 발급할 수 없는 상한 직전에는 갱신을 거절한다. 클라이언트 시각·응답 지연으로 유효기간을 연장하지 않는다.
- Access Token은 앱 메모리, Refresh Token은 OS 보호 저장소에 보관한다. 로그인 유지 30일은 사용자가 10분마다 비밀번호를 입력해야 한다는 뜻이 아니다.
- HTTPS를 사용하며 토큰 반환 응답에는 `Cache-Control: no-store`를 적용한다. 요청·응답·오류 로그에 토큰·비밀번호·원본 건강/GPS 데이터를 남기지 않는다.
- JWT 서명·만료 검증에 더해 자원 소유자·현재 동의·공개 범위를 검사한다. 매 요청의 로그인 상태 조회와 Access Token 차단 목록은 운영하지 않는다.
- 로그인 1회마다 독립된 갱신 권한(토큰 계열)을 만든다. 여러 로그인을 허용하며 일반 로그아웃은 제출한 토큰의 계열만 폐기한다. 같은 계정의 다른 로그인은 유지한다. 설치 식별자나 기기 ID만으로 폐기 대상을 신뢰하지 않는다.
- 사용한 토큰의 해시와 계열 연관은 해당 계열의 절대 만료까지 Redis에 유지한다. 교체 직전 토큰으로도 로그아웃 대상을 식별하고 재사용을 탐지할 수 있어야 한다. Redis 키·자료구조와 영속화·정리 구현은 후속 설계 대상이다.
- 오류는 공통 `{code, message, details}` 구조를 사용한다. 인증 실패의 `details`는 빈 객체로 하며 토큰 존재 여부·원문·내부 폐기 이유를 노출하지 않는다.

### 갱신 권한 저장소

- Redis를 Refresh Token 해시·사용자와 로그인 계열의 연결·절대 만료시각·사용 및 폐기 상태·교체 이력의 기준 저장소로 사용한다. 서버에 토큰 원문을 저장하지 않는다. 사용자·비밀번호 해시·러닝 프로필은 PostgreSQL에 유지한다.
- 로그인마다 독립 계열을 만들고 현재 토큰 및 사용한 토큰의 해시·계열 연결을 절대 만료까지 보관한다. 사용자 ID 하나에 현재 토큰만 덮어쓰는 구조로 다중 로그인·이전 토큰 재사용 탐지를 대체하지 않는다.
- TTL은 최초 로그인부터의 절대 만료시각에 맞춰 설정한다. 갱신으로 상한을 연장하지 않고, 서버의 만료시각 검사도 유지한다. 2026-10-28 플랜 승인으로 아래 저장 모델과 실행·복구 기준을 확정했다.
- U02의 소비·새 토큰 저장·재사용 시 계열 폐기와 U03의 계열 폐기는 같은 계열에서 순서가 보장되는 원자적 처리로 구현한다. Redis 내부 원자성이 PostgreSQL 사용자 상태 변경과의 공동 트랜잭션을 의미하지 않으므로 탈퇴·발급·갱신의 교차 실행과 실패 처리를 별도로 설계한다.
- Redis 연결·읽기·쓰기 장애를 단순한 토큰 미존재로 처리하거나 성공으로 위장하지 않는다. 접근 가능한 저장소에서 유효 토큰을 찾지 못한 경우와 저장소 장애를 구분하고 U01~U03의 기존 오류 계약을 따른다. Redis 장애 시 PostgreSQL이나 애플리케이션 메모리로 자동 대체하는 동작은 정의하지 않는다.
- 영속화·메모리·복구는 아래 승인 기준을 따른다. 인증 상태를 일반 캐시처럼 조기 퇴출하지 않으며, 과거 백업의 사용·폐기 상태를 그대로 활성화하지 않는다. 단일 Redis 프로세스 장애와 정상적인 fsync 영속 볼륨을 대상으로 검증하며 하드웨어·파일시스템의 확인된 쓰기 유실까지 무손실이라고 주장하지 않는다.
- ADR-0015는 Refresh Token 저장소 결정이다. 193번 로그인 연속 실패 제한은 별도로 승인된 ADR-0017에 따라 같은 인증용 Redis를 사용한다.

#### Redis 저장 모델과 복구 기준

- Refresh Token은 패딩 없는 Base64URL 난수 16바이트 계열 식별자와 난수 32바이트 secret을 점으로 연결한 66자 opaque 문자열이다. 클라이언트는 구조를 해석하지 않는다. 서버는 전체 문자열의 SHA-256 해시만 저장하며 계열 식별자만으로 인증하지 않는다.
- `runway:auth:family:<familyId>` Hash에 schemaVersion=1, userId, createdAt·expiresAt(UTC 정수 초), state, currentTokenHash를 저장한다. state는 초기 저장 중 PENDING, 사용 가능 ACTIVE, 폐기 REVOKED다. 194번의 교체 토큰 해시는 같은 Hash의 `used:<hash>`에 보관하고 기존 계열 TTL을 유지한다.
- `runway:auth:user:<userId>:families` ZSET은 계열 식별자를 member, 절대 만료시각을 score로 저장하는 조회 인덱스다. 현재 보유 계열의 가장 늦은 만료까지 유지하며 만료 항목은 등록 시 정리한다. 인덱스만 남은 상태나 PENDING·필수 필드/유효 TTL이 없는 계열은 갱신 권한이 아니다.
- 최초 등록 스크립트는 인수·키 자료형을 먼저 확인하고 인덱스 등록, PENDING 구성, 절대 만료 설정 후 마지막 HSET으로 ACTIVE를 확정한다. Lua 오류에 롤백을 기대하지 않으며 실패·시간초과는 503이다. 응답 유실이나 PostgreSQL 종료 실패 뒤에는 고아 계열이 남을 수 있어 가능한 폐기를 시도하고 원문을 성공 응답으로 반환하지 않는다. 결과 불확실한 쓰기를 자동 재전송하지 않는다.
- Redis 8.2.11의 단일 primary·전용 영속 볼륨을 사용하고 AOF always, rewrite 중 디스크 반영 유지, 손상 AOF 기동 거부, noeviction을 적용한다. 연결 1초·명령 2초 timeout을 사용한다. 자동 replica/Cluster 장애 전환은 이번 범위에 없다. 구체 실행 설정·용량과 Secret 주입은 [백엔드 실행 안내](../../../backend/README.md#8-로그인과-redis)를 따른다.
- 정상 최신 볼륨 재시작은 상태를 유지한다. 볼륨 유실·AOF 손상·과거 백업만 남은 경우 인증 경로를 중단하고 운영자 확인 후 새 빈 인증 저장소로 재개한다. 이때 기존 Refresh Token은 모두 무효이며 재로그인한다. 앱이 볼륨 삭제·과거 복구·자동 초기화를 실행하지 않는다. 이미 발급된 JWT의 최대 10분 잔여 효력은 유지한다.

## U01 로그인

`POST /api/v1/auth/login`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 공개, Access Token 불필요 |
| 관련 요구사항 | USR-001 / SYS-002 |
| 상태 | 토큰·Argon2id·실패 제한·초기 설정 완료 기준 확정. 구현 및 비용 실측은 후속 |

### Request Body

필드 모두 필수·NULL 불가. Path·Query Parameters 없음.

| 필드 | 타입 | 설명 |
|---|---|---|
| `loginId` | string | 영문·숫자 4~16자. 기존 로그인 아이디 규칙 적용. 대소문자 구분 없이 같은 아이디로 본다(서버가 소문자로 바꿔 조회, S15P31E105-831) |
| `password` | string | 필수·NULL 불가, 8~20 Unicode 코드 포인트. 공백 문자 불가, 특수문자 허용. 임의 trim·대소문자 변경·정규화 금지. 기존 계정 보호를 위해 U15·U30의 새 비밀번호 문자 제한(ASCII·아이디 동일 금지)은 적용하지 않는다 |

```json
{
  "loginId": "minjun01",
  "password": "password-placeholder"
}
```

### Response

`200 OK`

```json
{
  "user": { "id": 101, "loginId": "minjun01" },
  "accessToken": "access-token-placeholder",
  "refreshToken": "refresh-token-placeholder",
  "expiresInSec": 600,
  "refreshExpiresAt": "2026-11-26T09:00:00Z",
  "onboardingCompleted": false
}
```

위 만료시각은 2026-10-27T09:00:00Z에 최초 로그인한 예시다. 네 토큰 필드는 공통 토큰 계약을 따른다.

| 추가 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `user` | object | O | 로그인 사용자. NULL 불가 |
| `user.id` | integer (int64) | O | users.id. 큰 정수의 전송·정밀도는 공통 규약의 미정 사항을 따름 |
| `user.loginId` | string | O | users.login_id(소문자로 저장된 값) |
| `onboardingCompleted` | boolean | O | 러닝 수준과 유효한 평소 페이스가 모두 저장됐으면 true, 그 외 false. 아래 초기 설정 정책 적용 |

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | 잘못된 JSON, 필수 필드 누락·NULL·빈 값, 자료형·loginId 형식 불일치, 비밀번호 8자 미만·20자 초과 또는 공백 문자 포함 |
| `401 INVALID_CREDENTIALS` | 없는 아이디·비밀번호 불일치·WITHDRAWN 계정. 모두 message=`아이디 또는 비밀번호가 올바르지 않습니다.`, details={}로 응답하며 계정 존재·탈퇴 여부를 구분하지 않음. 입력 검증·로그인 잠금·저장소 장애의 별도 응답은 유지 |
| `429 LOGIN_LOCKED` | 아이디별 연속 5번째 실패부터 10분 제한. 제한 중에는 올바른 비밀번호도 거절하며 종료시각을 연장하지 않음 |
| `503 SERVICE_UNAVAILABLE` | 필수 인증 저장소에 접근하지 못해 발급·판정을 완료할 수 없음. 자격증명 오류로 표시하지 않음 |

### 처리 규칙 및 미정 사항

- 자격증명을 확인하고 갱신 권한을 영속 저장한 뒤 토큰을 반환한다. 저장 실패 시 사용 가능한 토큰을 성공 응답으로 반환하지 않는다.
- 외부 제공자 로그인은 범위에서 제외한다. 가입은 U15를 사용한다.
- 초기 설정 미완료나 건강정보 동의 거절을 임의로 로그인 실패로 처리하지 않는다. 데이터별 허용 범위는 해당 API 규약을 따른다.
- 네트워크 오류가 발생한 로그인 요청의 성공 여부는 불확실할 수 있다. 재로그인은 새 계열을 생성할 수 있으며 동일 응답을 재전송하는 멱등 API라고 보장하지 않는다.
- [ ] 아래 확정한 Argon2id 비용·형식을 실제 배포 서버에서 재측정한다. 로컬 합성 실험과 제품 통합 테스트를 운영 부하 검증으로 대신하지 않는다.
- 실패 집계는 아래 확정 정책과 Redis 저장 모델을 따른다. 실패 제한용 PostgreSQL 테이블은 추가하지 않으며 실행·검증 방법은 [백엔드 실행 안내](../../../backend/README.md#8-로그인과-redis)를 따른다.
- 초기 설정은 U07에서 수준과 페이스를 한 번에 저장한다. user_profiles의 필수값 제약을 유지하며 임시 행을 만들지 않는다.
- WITHDRAWN 계정에는 새 인증수단을 발급하지 않으며 일반 자격증명 실패와 동일한 401을 반환한다. 비밀번호 계산은 DB 잠금 밖에서 수행하고 발급 직전 PostgreSQL users 행 잠금 아래 ACTIVE·검증한 비밀번호 해시 불변을 재확인한다. 잠금 대기는 최대 2초이며 실패는 503이다. Redis 저장·DB 트랜잭션 종료 확인 뒤 성공 응답한다. 탈퇴가 먼저 확정되면 401이며, 로그인 발급이 먼저라면 후속 탈퇴가 같은 사용자 잠금 뒤 계열을 폐기한다. 후속 갱신·탈퇴도 사용자 잠금 → Redis 변경 순서를 준수해야 하며 U18 전체 구현은 192번 범위가 아니다. JWT 서명·키 정책은 ADR-0014를 따르고 비활성 만료 등 미정 정책을 이 응답 결정으로 확정하지 않는다.


### 비밀번호 저장·검증

- 2026-10-28 사용자 확정: U01 로그인과 U15 회원가입의 비밀번호는 최소 8자·최대 20자이며 공백 문자를 허용하지 않고 특수문자는 허용한다. 공백 금지는 앞뒤·중간의 스페이스·탭·줄바꿈 등 공백 문자를 포함한다. 입력을 trim해 통과시키지 않고 원문을 검증한다.
- 특수문자 허용은 필수 포함 조건이 아니다. 영문·숫자·특수문자의 필수 조합은 추가하지 않는다. Unicode 코드 포인트로 8~20자를 계산하며 올바른 보충 평면 문자는 1자로 계산한다. 고립 surrogate는 잘못된 입력으로 거절하고 Character.isWhitespace 또는 Character.isSpaceChar에 해당하는 공백은 허용하지 않는다. 원문의 Unicode 정규화를 하지 않는다.
- 2026-11-13 사용자 확정(S15P31E105-773): U15 가입·U30 재설정에서 새로 정하는 비밀번호는 위 형식에 더해 영문·숫자·키보드 특수문자(ASCII `0x21`~`0x7E`)만 허용하고, 아이디와 대소문자 무시로 같은 값을 허용하지 않는다. 위반은 `422 INVALID_PASSWORD_POLICY`다. 기존 계정을 막지 않도록 U01 로그인·탈퇴의 비밀번호 형식 검증에는 적용하지 않는다.
- 가입 시 비밀번호는 Argon2id 해시로 저장하고 로그인 시 같은 형식으로 검증한다. 원문 저장이나 복호화 가능한 저장을 사용하지 않는다.
- 선택 이유는 계산 시간과 메모리 비용을 함께 조절해 DB 유출 후 대량 비밀번호 추측 공격의 비용을 높이기 위해서다. 해시가 온라인 로그인 제한을 대신하지 않는다.
- 비밀번호마다 독립적인 salt를 사용하는 검증된 구현을 사용하고 해시에는 검증에 필요한 알고리즘·비용·salt 정보를 보존한다. 입력 비밀번호를 임의로 잘라내거나 변환하지 않는다.
- 2026-10-28 플랜 승인: Argon2id v=19, 메모리 65536KiB(64MiB)·반복 3회·병렬도 1·salt 16바이트·hash 32바이트다. Spring Security 7.1.1 Argon2PasswordEncoder와 Bouncy Castle 1.86을 사용하고 `$argon2id$v=19$m=65536,t=3,p=1$...` 형식을 users.password에 그대로 저장한다. 가입과 로그인에서 동일한 형식을 사용하며 문서 인증 BCrypt와 분리한다.
- 저장 해시의 형식·비용·salt/hash 길이를 검증한 뒤 비교한다. 미지원·손상된 저장값은 원문·파싱 예외를 노출하지 않는 503으로 처리하고 과도한 비용을 실행하지 않는다. 없는 계정·탈퇴 계정은 같은 비용의 합성 더미 해시를 검증한 뒤 동일한 401을 반환한다. 로그인 중 자동 재해싱은 하지 않는다. 알고리즘·로컬 측정만으로 운영 성능·보안 검증이 완료됐다고 표현하지 않는다.

### 로그인 연속 실패 제한

2026-10-28 사용자 승인: Redis 저장, 마지막 실패 후 24시간 미실패 시 1~4회 기록 초기화, 자격증명 확인·Redis 토큰 저장 완료 시 성공 초기화, 운영자가 빈 저장소로 복구할 때 실패·잠금 초기화 예외를 채택했다. 기존 DB 영속 저장·시간 제한 없는 1~4회 누적 정책을 이 절의 정책으로 변경한다. 정책 확정은 구현 완료를 뜻하지 않는다.

| 상황 | 저장 상태·응답 |
|---|---|
| 유효한 형식의 아이디로 비밀번호 검증 실패 1~4회 | 해당 아이디 실패 횟수 증가, 401 INVALID_CREDENTIALS. 실패가 반영될 때마다 기록 만료를 해당 시각+24시간으로 설정 |
| 1~4회 상태에서 마지막 실패 후 24시간 이상 추가 실패 없음 | 기존 실패 기록 초기화 후 현재 요청을 새 시도로 처리 |
| 5번째 실패 | 실패 반영 시각부터 10분 제한 설정, 429 LOGIN_LOCKED |
| 제한 중 재시도 | 비밀번호 일치 여부와 무관하게 429, 횟수·종료시각 변경 없음 |
| 서버 시각이 제한 종료시각 이상 | 횟수·제한 상태 초기화 후 현재 요청을 새 시도로 처리 |
| 제한 전에 자격증명 확인과 Redis 토큰 저장 완료 | 해당 아이디 실패 횟수 초기화. 클라이언트 응답 수신 여부를 기다리지 않음 |
| JSON·입력 형식 오류 | 실패 횟수·만료시각 변경 없음, 400 VALIDATION_ERROR |
| 인증 저장소 장애 | 장애 자체를 실패로 집계하지 않고 503 SERVICE_UNAVAILABLE. 쓰기 전 실패는 상태 불변, 쓰기 후 시간초과·응답 유실은 이미 변경됐을 수 있음 |

- 집계 단위는 소문자로 바꾼 제출 로그인 아이디이며(S15P31E105-831, 대소문자 조합을 바꿔 제한을 우회할 수 없다) 기존 인증용 Redis에 저장해 정상 영속 볼륨 재시작·여러 애플리케이션 인스턴스에서도 공유·유지한다. 계정 존재 여부와 무관하게 형식이 유효한 제출 아이디에 같은 외부 제한 규칙을 적용한다. 아이디를 trim하지 않는다.
- 저장 모델은 `runway:auth:attempt:<소문자 loginId>` String의 `횟수:종료시각(ms)`이며 횟수는 1~5다. 만료시각은 Redis 서버 시각으로 계산하고 SET PXAT 한 명령으로 값·TTL을 함께 기록한다. 키가 없으면 초기 상태이며 잘못된 자료형·형식·유효 TTL이 없는 상태는 503이다. 같은 Lua에서 최종 잠금 확인·계열 활성화·성공 초기화를 처리한다. 키·상태를 외부 응답이나 로그에 노출하지 않는다.
- 1~4회 기록은 마지막으로 반영한 자격증명 실패부터 86400초, 5번째 실패로 생긴 잠금은 그 실패부터 600초다. 두 만료 기준을 혼용하지 않는다. 5번째 실패 시 24시간 기록 만료를 10분 잠금 만료로 전환하며, 조회·입력 오류·장애·잠금 중 재시도로 만료를 연장하지 않는다. 경계시각 이상이면 만료다. 24시간은 승인된 초기 제품 정책이며 보안 표준의 의무값이 아니다.
- 존재하지 않는 아이디와 잘못된 비밀번호는 동일한 인증 실패 응답을 사용한다. 실패 횟수·내부 계정 상태를 응답에 노출하지 않는다.
- 동일 아이디의 상태 확인·실패 증가·잠금 설정·성공 초기화가 교차 실행으로 누락되지 않도록 원자적으로 처리한다. 4회 상태에서 두 실패가 동시에 들어오면 한 요청이 5번째 실패로 제한을 만들고 나머지도 429이며 종료시각을 연장하지 않는다.
- 제한 전 로그인 성공·실패가 동시에 실행되면 서버가 확정한 처리 순서에 따라 초기화 후 1회 실패 또는 실패 반영 후 초기화가 된다. 잠금 확정 후에는 올바른 비밀번호도 잠금 해제 전까지 허용하지 않는다.
- 성공 초기화는 자격증명·현재 계정 상태 확인과 Redis의 사용 가능한 로그인 계열 저장 완료를 기준으로 한다. 비밀번호 일치만으로 먼저 초기화하지 않으며 최종 잠금 재확인·토큰 저장·초기화 사이에 다른 실패가 끼어 잠금을 우회하지 않도록 한다. 이 시점 뒤 응답 유실이나 PostgreSQL 트랜잭션 종료 오류가 생기면 횟수는 이미 초기화됐을 수 있다. 기존 503·미전달 토큰 폐기 보상을 유지하며 과거 횟수를 덮어써 이후 실패를 지우지 않는다.
- 시간초과만으로 Redis 쓰기 미실행을 단정하지 않는다. 결과 불확실한 쓰기는 자동 재전송하지 않으며, 장애를 근거로 카운터를 추가 증가·삭제하거나 성공을 반환하지 않는다. Redis와 PostgreSQL의 공동 롤백을 보장하지 않는다.
- 정상 재시작에는 미만료 상태를 보존한다. 볼륨 유실·AOF 손상 등으로 신뢰할 수 있는 상태를 복구할 수 없으면 기존 인증 복구 절차대로 중단·운영자 확인 후 새 빈 저장소로 재개하며, 이때 실패 횟수·기존 잠금도 초기화되는 예외를 허용한다. 일시적 연결 장애를 빈 저장소로 해석하거나 앱이 자동 초기화하지 않는다.
- 타인 아이디에 실패를 유발하는 잠금 악용 가능성은 남는다. 24시간 만료는 오래된 기록의 정리 기준이며, 대량의 새 아이디로 24시간 내 메모리를 소진시키는 공격을 막는 보장은 아니다. IP 등 추가 속도 제한과 저장 공간 고갈 방어는 별도 후속 범위이며 메모리 부족을 잠금 해제·인증 허용으로 처리하지 않는다.

### 초기 설정과 화면 분기

- 가입 성공은 초기 설정 완료가 아니다. U15는 `onboardingCompleted: false`를 반환하고 앱은 토큰을 보관한 뒤 초기 설정 페이지로 이동한다.
- 서버에 러닝 수준과 유효한 평소 페이스가 모두 저장됐을 때만 `onboardingCompleted: true`다. 프로필이 없거나 입력 중이거나 저장에 실패하면 false다.
- 건강정보 동의, 선호 환경, 과거 운동 기록은 완료 조건에 추가하지 않는다. 건강정보 미동의 상태의 기능 제한은 별도로 유지한다.
- 화면에서 두 정보를 입력한 뒤 완료 버튼으로 U07에 한 번에 제출한다. 서버 저장 성공 후 홈으로 이동한다. 입력만 마친 상태나 낙관적 UI 갱신으로 완료 처리하지 않는다.
- 설정 도중 종료하면 다음 로그인 U01에서도 false를 받아 설정 페이지로 이동한다. 이후 true인 사용자는 홈으로 이동한다.
- 가입 시 user_profiles에 기본 수준·가짜 페이스를 채운 행을 만들지 않는다. 초기 설정 완료를 위한 별도 boolean 컬럼을 임의 추가하지 않는다.
- 이 분기는 앱의 이동 정책이다. 미완료 사용자의 로그아웃·프로필 설정을 막지 않으며, 다른 API의 데이터 전제·인가 규칙을 대신하지 않는다.

## U02 토큰 갱신

`POST /api/v1/auth/refresh`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | Refresh Token 검증. Access Token 불필요 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 상태 | 아래 외부 계약 확정. 저장 구조와 원자성 구현은 후속 |

### Request Body

Path·Query Parameters 없음. Refresh Token을 URL·쿠키·Authorization으로 전달하지 않는다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `refreshToken` | string | O | 현재 갱신 토큰. NULL·빈 문자열·공백만인 값 거절. 값 trim 등 변환 금지 |

```json
{ "refreshToken": "refresh-token-placeholder" }
```

### Response

`200 OK` — 공통 토큰 계약의 필드 네 개, 모두 필수·NULL 불가.

```json
{
  "accessToken": "new-access-token-placeholder",
  "refreshToken": "new-refresh-token-placeholder",
  "expiresInSec": 600,
  "refreshExpiresAt": "2026-11-26T09:00:00Z"
}
```

### 오류 응답

| HTTP·코드 | 발생 조건·복구 |
|---|---|
| `400 VALIDATION_ERROR` | 잘못된 JSON, refreshToken 누락·NULL·빈 값·자료형 오류. 요청 형식을 수정 |
| `401 INVALID_REFRESH_TOKEN` | 비어 있지 않은 토큰이 알려지지 않았거나 만료·폐기·이미 사용됨. 계열이 폐기됐거나 절대 상한 내 새 토큰 발급 불가인 경우 포함. 재로그인 필요 |
| `503 SERVICE_UNAVAILABLE` | 저장소 장애로 갱신 판정·저장을 완료할 수 없음. 자동으로 인증정보를 삭제하지 않음 |

### 교체·재사용·경합 규칙

1. 유효한 현재 토큰을 단 한 번 소비하고 같은 계열의 새 토큰을 저장한 뒤 성공 응답한다. 절대 만료시각은 유지한다. 소비와 새 토큰 저장은 한 원자적 처리로 수행한다.
2. 이미 사용한 토큰이 다시 제출되면 그 계열의 갱신 권한 전체를 폐기하고 401을 반환한다. 알 수 없는 토큰만으로 다른 계열을 폐기하지 않는다.
3. 같은 토큰으로 동시에 갱신하면 한 요청만 소비에 성공할 수 있다. 뒤의 요청은 재사용으로 처리되어 계열을 폐기한다. 첫 요청이 200을 받더라도 새 Refresh Token은 이후 사용할 수 없을 수 있다. 기존 Access Token은 만료까지 남는다.
4. 앱은 동일 로그인에서 갱신 요청을 하나로 모으고 성공 응답의 토큰 쌍을 함께 교체한다. 원래 API의 401에 대해 갱신·재시도를 무한 반복하지 않는다. 403 권한 오류를 갱신으로 해결하려 하지 않는다.
5. 응답 유실·시간초과로 교체 성공 여부를 알 수 없으면 이전 Refresh Token을 자동 재전송하지 않고 재로그인으로 복구한다. 503 응답도 토큰 소비 여부를 보장하지 않으므로 무조건 재시도하지 않는다. 운동 기록은 보존한다.
6. 갱신과 로그아웃은 같은 계열 단위로 순서를 보장한다. 로그아웃이 먼저 확정되면 갱신은 401이다. 갱신이 먼저 확정되면 로그아웃은 이전 토큰의 이력으로 계열 전체(새 Refresh Token 포함)를 폐기한다.
7. 이미 발급된 Access Token은 갱신 권한 폐기로 즉시 무효화되지 않는다. 앱은 로그아웃 시작 후 도착한 갱신 응답을 저장하지 않도록 요청 세대를 구분한다.

## U03 로그아웃

`POST /api/v1/auth/logout`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 제출한 Refresh Token으로 해당 계열만 폐기. Access Token 불필요 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 상태 | 아래 외부 계약 확정. 저장 구조와 원자성 구현은 후속 |

### Request Body

Path·Query Parameters 없음. 클라이언트가 userId·기기 ID로 폐기 대상을 지정하지 않는다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `refreshToken` | string | O | 현재 또는 같은 로그인에서 교체된 이전 토큰. NULL·빈 문자열·공백만인 값 거절. 값 변환 금지 |

```json
{ "refreshToken": "refresh-token-placeholder" }
```

### Response

`204 No Content` — 본문 없음. `success` 래퍼를 반환하지 않는다.

- 제출한 토큰의 계열을 식별할 수 있으면 그 계열의 갱신 권한 전체를 폐기한다. 다른 로그인 계열에는 영향을 주지 않는다.
- 이미 폐기·만료된 토큰이나 알려지지 않은 토큰도 204를 반환해 존재 여부를 구분하지 않는다. 알려지지 않은 토큰을 제출했을 때 다른 실제 로그인까지 폐기됐다는 뜻은 아니다.
- 반복 요청은 같은 결과를 반환한다. 저장소 장애로 대상 조회·폐기를 확인할 수 없으면 204로 위장하지 않는다.
- 서버 폐기 완료 뒤 성공 응답한다. 앱은 로컬 토큰을 정리한다. 응답 유실 시 같은 토큰으로 로그아웃을 재시도할 수 있다. 서버 성공을 확인하지 못한 오프라인 토큰 삭제를 서버 폐기 완료로 표시하지 않는다.
- Access Token이 만료돼도 로그아웃할 수 있다. U02·U03에서는 불필요하게 첨부된 Access Token의 만료 때문에 해당 계약을 차단하지 않도록 클라이언트와 인증 필터를 구성한다.
- 기존 Access Token은 최대 약 10분의 잔여 유효기간 동안 사용할 수 있다. 즉시 차단·전체 기기 로그아웃을 약속하지 않는다.

### 오류 응답

| HTTP·코드 | 발생 조건·복구 |
|---|---|
| `400 VALIDATION_ERROR` | 잘못된 JSON, refreshToken 누락·NULL·빈 값·자료형 오류. 요청 형식을 수정 |
| `503 SERVICE_UNAVAILABLE` | 저장소 장애로 조회·폐기를 확인하지 못함. 같은 토큰으로 로그아웃 재시도 가능 |

로그아웃의 토큰 유효성 차이는 401/403으로 공개하지 않는다. 토큰이 가진 해당 계열 폐기 권한만 사용하며 회원 데이터 조회 권한을 부여하지 않는다.

### 구현 검증 사례

| 상황 | 기대 결과 |
|---|---|
| 로그인 후 갱신 | 200, 새 토큰 쌍, refreshExpiresAt 유지 |
| 최초 로그인 30일 경과 | U02 401, 상한을 넘는 Access Token 발급 금지 |
| 로그아웃 후 기존 JWT로 회원 요청 | 만료 전에는 인증 가능, 자원별 인가는 별도 검사 |
| 로그아웃 후 갱신·반복 로그아웃 | U02 401, U03 204 |
| 만료 Access Token과 유효 Refresh Token | U02 갱신 및 U03 로그아웃 가능 |
| 갱신 직전 토큰으로 로그아웃 | 새 Refresh Token을 포함한 같은 계열 폐기 |
| 동시 갱신·교체된 토큰 재사용 | 최대 한 번 소비 성공, 재사용 감지로 계열 폐기 |
| 로그아웃과 갱신 교차 실행 | 위 U02 6번 순서별 결과, 폐기 권한 부활 없음 |
| 다른 로그인 계열 | 일반 로그아웃의 영향을 받지 않음 |
| 인증 저장소 장애 | 성공/자격증명 실패로 위장하지 않고 503 |
| JWT는 유효하지만 타인 기록 요청 | 해당 자원 인가 규칙으로 거절 |


## U04 내 프로필 조회

`GET` `/api/v1/users/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 관련 화면 | 2.1 홈 인사, 7.4b 내 프로필, 8.2 프로필 수정 (화면 설계 v10) |
| 미정 사항 | 없음(MVP) |
| 비고 | 러닝 프로필(U06/U07)과 구분. 온보딩은 `onboardingCompleted` |

### 설명

본인 기본 계정 프로필을 조회한다. 온보딩 완료는 U01·U06과 같이 러닝 수준과 유효 평소 페이스 저장 여부로 판정한다.

### 인증 및 권한

- 로그인 사용자(JWT) 본인만.

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
  "id": 101,
  "nickname": "러너",
  "gender": "MALE",
  "birthDate": "2000-01-01",
  "loginId": "runner01",
  "status": "ACTIVE",
  "profileImageUrl": "/api/v1/images/550e8400-e29b-41d4-a716-446655440000",
  "onboardingCompleted": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `users.id` |
| `nickname` | string | O | `users.nickname` |
| `gender` | string / null | O | MALE / FEMALE |
| `birthDate` | string (YYYY-MM-DD) / null | O | `users.birth_date` |
| `profileImageUrl` | string / null | O | [F02](files.md#f02-이미지-조회) 경로. `profile_image_key`가 없으면 null |
| `loginId` | string / null | O | `users.login_id`(소문자로 저장된 값) |
| `status` | string | O | ACTIVE / WITHDRAWN (`account_status`) |
| `onboardingCompleted` | boolean | O | 러닝 수준·유효 페이스가 있으면 true |

탈퇴 계정은 nickname="탈퇴한 회원", status="WITHDRAWN", gender/birthDate/loginId/profileImageUrl=null, onboardingCompleted=false로 반환한다. DB의 개인정보 대체값과 해시 로그인 ID를 노출하지 않는다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |

### 처리 규칙

- 본인 행만 조회한다. phone·password는 반환하지 않는다.

## U05 내 프로필 수정

`PATCH` `/api/v1/users/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 관련 화면 | 1.5 초기 설정 1/2, 8.2 프로필 수정 (화면 설계 v10) |
| 미정 사항 | 없음(MVP) |
| 비고 | 부분 수정. 러닝 수준은 U07 |

### 설명

닉네임·성별·생년월일·프로필 사진을 부분 수정한다.

### 인증 및 권한

- 로그인 사용자(JWT) 본인만.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `nickname` | string | X | U15와 동일: 완성형 한글·영문·숫자만 2~10자·대소문자 무시로 중복 불가(본인 닉네임의 대소문자만 바꾸는 것은 허용, S15P31E105-831). 저장된 값과 다를 때만 문자 규칙을 검사하므로 규칙 이전에 저장된 닉네임은 생략하거나 그대로 보내면 유지된다(S15P31E105-781) |
| `gender` | string | X | MALE / FEMALE |
| `birthDate` | string (YYYY-MM-DD) | X | 1950-01-01 이상(앱 생년 휠과 같음, S15P31E105-779), 오늘(UTC) 이하 |
| `profileImageId` | string (UUID) / null | X | F01 PROFILE 업로드 ID. null이면 사진 삭제. 생략 시 유지 |

```json
{
  "nickname": "러너"
}
```

### Response

`200 OK`

```json
{
  "id": 101,
  "nickname": "러너",
  "gender": "MALE",
  "birthDate": "2000-01-01",
  "updatedAt": "2026-10-24T09:00:00Z",
  "profileImageUrl": "/api/v1/images/550e8400-e29b-41d4-a716-446655440000",
  "onboardingCompleted": true
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `users.id` |
| `nickname` | string | O | 저장 후 닉네임 |
| `gender` | string | O | 저장 후 성별 |
| `birthDate` | string (YYYY-MM-DD) | O | 저장 후 생년월일 |
| `updatedAt` | string (ISO 8601 UTC) | O | `users.updated_at` |
| `profileImageUrl` | string / null | O | F02 경로 또는 null |
| `onboardingCompleted` | boolean | O | U04와 동일 판정 |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건 |
|---|---|---|
| `400 INVALID_PROFILE` | 입력 값 | 닉네임·생년월일·성별 형식 불일치 |
| `409 NICKNAME_DUPLICATED` | 중복 | 다른 사용자가 쓰는 닉네임(대소문자만 다른 경우 포함) |
| `422 INVALID_IMAGE` | 이미지 | 없거나 본인 PROFILE 업로드가 아닌 imageId |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON·자료형 오류 |

### 처리 규칙

- 요청에 있는 필드만 변경한다. 생략 필드는 유지한다.
- `profileImageId`가 있으면 `images/profile/{userId}/{imageId}.jpg|png` 존재·소유를 검사한 뒤 `profile_image_key`에 저장한다.
- `profileImageId: null`이면 `profile_image_key`를 null로 둔다.

## U06 러닝 프로필 조회

`GET /api/v1/users/me/running-profile`

| 항목 | 값 |
|---|---|
| 단계·인증 | 1차 MVP · 회원 Bearer JWT |
| 관련 | USR-003·USR-007, U07, 기존 U08 통합 |
| 상태 | 2026-10-30 S15P31E105-223 사용자 승인으로 수준·평소 페이스 조회 통합 확정 |

본인의 러닝 수준과 평소 페이스·거리·시간을 하나의 프로필로 조회한다. Path·Query·Body는 없다. 회원 ID는 JWT에서만 얻으며 요청 본문·쿼리·헤더로 다른 회원을 선택하지 않는다.

### Response

`200 OK`. U07 저장 응답과 같은 구조이며 모든 필드를 포함한다. 거리·시간만 null을 허용한다.

```json
{
  "selfReportedLevel": "BEGINNER",
  "baselineDistanceM": 5000,
  "baselineDurationSec": 1800,
  "usualPaceSecPerKm": 360.00,
  "onboardingCompleted": true,
  "updatedAt": "2026-10-30T00:00:00Z"
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| selfReportedLevel | string | user_profiles.running_level, BEGINNER / INTERMEDIATE / ADVANCED |
| baselineDistanceM | integer(int32) / null | user_profiles.distance, 미터 |
| baselineDurationSec | integer(int32) / null | user_profiles.duraction, 초. 기존 DB 컬럼명 유지 |
| usualPaceSecPerKm | number | user_profiles.average_pace, 초/km |
| onboardingCompleted | boolean | 프로필에 수준과 양수·유한 페이스가 모두 있으면 true. U01과 동일 판정 |
| updatedAt | string (ISO 8601 UTC) | DB에서 관리하는 user_profiles.updated_at |

거리·시간 방식은 입력 거리·시간과 프론트가 계산해 제출한 페이스를 반환한다. 직접 페이스 방식은 거리·시간이 null이며 임의의 거리·시간을 생성하거나 null을 0으로 바꾸지 않는다. inputType은 응답하지 않는다. 화면에서는 저장 방식과 관계없이 두 입력 방식을 항상 제공한다. assessedLevel·assessedAt을 임의 생성하지 않는다.

### 오류 응답

| HTTP·코드 | 조건 |
|---|---|
| 404 PROFILE_NOT_SET | 본인 프로필 행 없음. 선택 거리·시간의 null과 구분 |
| 401 UNAUTHORIZED | 회원 JWT 누락·만료·위변조 |
| 403 FORBIDDEN | 해당 자원·작업 접근 권한 없음 |
| 503 SERVICE_UNAVAILABLE | 조회 저장소 장애 |

건강정보 동의는 회원가입 U15에서 저장한다. 이 API는 동의를 다시 받거나 수정하지 않으며 동의 여부는 초기 설정 완료 조건에 포함하지 않는다.

## U07 러닝 프로필 저장·부분 수정

`PATCH /api/v1/users/me/running-profile`

| 항목 | 값 |
|---|---|
| 단계·인증 | 1차 MVP · 회원 Bearer JWT |
| 관련 | USR-003·USR-007, U01 초기 설정 정책, 기존 U09 통합 |
| 상태 | 2026-10-30 S15P31E105-223 사용자 승인으로 최초 생성·부분 수정 통합 확정 |

프로필이 없으면 수준과 페이스를 함께 저장해 생성한다. 기존 프로필이 있으면 제출한 항목만 수정한다. 생성·수정 모두 200과 U06의 전체 프로필 구조를 반환한다. PATCH의 최초 생성 동작은 이 API에서 명시적으로 허용한다. 임시 행이나 가짜 기본값은 만들지 않는다.

### Request Body

Content-Type은 application/json이다. 별도 JSON Patch 연산 배열을 사용하지 않는다. Path·Query는 없다. 제출한 필드의 명시적 null은 허용하지 않으며 필드 생략은 기존 값 보존을 의미한다.

| 필드 | 타입 | 조건 |
|---|---|---|
| selfReportedLevel | string | 최초 생성 시 필수. BEGINNER / INTERMEDIATE / ADVANCED. 기존 페이스만 수정하면 생략 |
| inputType | string | 페이스를 제출할 때 필수. PACE / DISTANCE_TIME |
| usualPaceSecPerKm | number | 두 입력 방식 모두 필수, 양수 초/km. 프론트에서 계산한 값을 제출. PACE일 때 거리·시간 생략 |
| baselineDistanceM | integer(int32) | DISTANCE_TIME이면 필수, 양수 미터. 직접 페이스는 생략 |
| baselineDurationSec | integer(int32) | DISTANCE_TIME이면 필수, 양수 초 |

- 최초 생성은 수준과 완전한 페이스 입력을 모두 요구한다. 수준 누락은 422 INVALID_LEVEL, 페이스 묶음 전체 누락은 422 INVALID_RUNNING_BASELINE이며 행을 생성하지 않는다.
- 기존 프로필에서는 수준만, 페이스 묶음만, 또는 둘 다 제출할 수 있다. 수준 생략 시 수준을 보존하고 페이스 관련 네 필드 전체 생략 시 페이스·거리·시간을 보존한다.
- 빈 객체는 400 VALIDATION_ERROR다. 제출 필드 null·잘못된 자료형·int32 범위 초과·JSON 구문 오류도 400이다.
- PACE는 inputType과 usualPaceSecPerKm만, DISTANCE_TIME은 inputType과 거리·시간·페이스 세 값을 모두 제출한다. 부분·혼합 입력, 미지원 방식, inputType 없이 페이스 필드 제출은 422다.
- 페이스 계산 책임은 프론트에 있다. 백엔드는 두 방식 모두 제출한 usualPaceSecPerKm의 자료형·양수·저장 범위를 검증한 뒤 NUMERIC(10,2)에 맞춰 소수 둘째 자리 HALF_UP으로 저장한다. 거리·시간으로 페이스를 재계산하거나 비교·덮어쓰기하지 않는다. 거리·시간은 각각 양수 int32인지 검사한다.
- 원값과 최종 반올림값 모두 0 초과·99999999.99 이하여야 한다. 0.004는 거절, 0.005는 0.01로 허용, 99999999.994는 원값 초과로 거절한다. 극소 지수 수치는 반올림 전에 0.005 하한으로 검사하여 과도한 계산을 방지한다. 비표준 NaN·Infinity JSON은 형식 오류다.
- PACE로 변경하면 기존 거리·시간은 서버에서 모두 null로 정리한다. 클라이언트는 이를 위해 null을 보내지 않는다.

최초 생성 또는 전체 수정:

```json
{
  "selfReportedLevel": "BEGINNER",
  "inputType": "DISTANCE_TIME",
  "baselineDistanceM": 5000,
  "baselineDurationSec": 1800,
  "usualPaceSecPerKm": 360
}
```

기존 프로필의 수준만 수정:

```json
{ "selfReportedLevel": "INTERMEDIATE" }
```

기존 프로필의 페이스만 수정:

```json
{ "inputType": "PACE", "usualPaceSecPerKm": 400 }
```

### Response

`200 OK`. 생성·부분 수정 모두 U06과 동일한 전체 프로필을 반환한다. 부분 수정 시에도 보존한 필드를 함께 반환한다. 정상 저장 후 onboardingCompleted는 true이며 updatedAt은 DB 갱신 시각이다. inputType은 반환하지 않는다.

### 오류 응답

| HTTP·코드 | 조건 |
|---|---|
| 400 VALIDATION_ERROR | 빈 요청, JSON·자료형·정수 범위 오류, 제출 필드 null |
| 422 INVALID_LEVEL | 미허용 수준 코드 또는 최초 생성 시 수준 누락 |
| 422 INVALID_RUNNING_BASELINE | 최초 페이스 누락, 부분·혼합·방식 오류, 양수·저장 범위 위반 |
| 404 PROFILE_NOT_SET | JWT가 가리키는 회원 행이 없어 저장할 소유자가 없음 |
| 401 UNAUTHORIZED | 회원 JWT 누락·만료·위변조 |
| 403 FORBIDDEN | 해당 작업 접근 권한 없음 |
| 503 SERVICE_UNAVAILABLE | 저장소·커밋 실패 또는 잠금 대기 실패 |

프로필 부재는 유효한 최초 생성 요청을 거절하는 사유가 아니다. 입력 오류가 여러 개이면 형식400을 먼저 검사하고, 업무 입력 오류는 수준 코드·페이스 조합을 검사한다. 최초 생성의 필수값 검사는 잠금 뒤 프로필 부재 확인 후 수준→페이스 순서로 수행한다. 오류에는 입력 원문·토큰·SQL을 노출하지 않는다. 형식 오류는 공통 Bean Validation의 message/details.fields 응답을 사용한다.

### 저장·재시도·동시성

- 같은 회원의 users 행을 먼저 잠그고 user_profiles를 조회·생성·수정한다. users→profile 순서를 유지하며 잠금 대기는 최대 2초, 실패503이다. 조회 API는 쓰기 잠금을 사용하지 않는다.
- 최초 생성·전체 수정·부분 수정 모두 단일 트랜잭션이다. 실패하면 변경 전체를 롤백하고 커밋 성공 뒤에만 성공 응답을 반환한다. 수준·페이스 NOT NULL과 user_id UNIQUE는 그대로 유지한다.
- 동시 최초 요청은 한 행만 만든다. 수준만 변경하는 요청과 페이스만 변경하는 요청이 교차해도 서로의 값을 보존한다. 전체 변경과 부분 변경은 잠금 획득 순서대로 반영한다.
- 같은 입력 재요청은 같은 업무 상태와200을 반환하되 updatedAt 동일성은 보장하지 않는다. 응답 유실을 저장 실패로 단정하지 않는다. 앱은 같은 프로필의 저장 요청을 순차 처리하고 최신 수정 뒤 오래된 요청을 무조건 재전송하지 않는다.
- U15 가입은 프로필을 만들지 않고 onboardingCompleted=false다. U07 최초 저장 성공 뒤 true가 되며 U01 로그인도 같은 저장값으로 판정한다. 건강 동의·선호·과거 기록은 완료 조건이 아니다.

## U08 평소 러닝 정보 조회

2026-10-30 사용자 승인으로 **U06 러닝 프로필 조회에 통합**했다. 독립 API와 `/api/v1/users/me/running-baseline` 경로는 제공하지 않는다. 기존 요구사항 번호 추적을 위해 이 절만 유지한다.

## U09 평소 러닝 정보 설정

2026-10-30 사용자 승인으로 **U07 러닝 프로필 저장·부분 수정에 통합**했다. 독립 API는 제공하지 않으며 페이스만 수정할 때도 PATCH running-profile을 사용한다. 기존 요구사항 번호 추적을 위해 이 절만 유지한다. PUT running-profile 및 기존 running-baseline 쓰기 경로는 제공하지 않는다.

## U10 러닝 환경 유형 조회

**제외 확정 (2026-11-03, 설계 S15P31E105-386 / 구현 S15P31E105-245).** 기존 `GET /api/v1/environments`는 구현 대상에서 제외한다. ID는 변경 이력과 기존 링크를 위해 남긴다.

- 코스 형태와 9개 선호·회피 조건은 고정 선택지로 앱에서 관리한다. 필드와 의미는 U11의 계약을 따른다.
- 기존 PARK/RIVERSIDE/URBAN/BEACH/TRACK 목록과 `environmentTypes` 배열은 U11·U12의 추천 기본값 계약으로 사용하지 않는다.
- 이 결정은 코스 태그 데이터나 C01 추천 API의 계약을 변경하지 않는다. 추천 API 변경은 별도 업무에서 처리한다.

## U11 추천 기본값 조회

`GET` `/api/v1/users/me/preferences`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 본인 |
| 계약 | 2026-11-03 사용자 합의: 추천 기본값 조회·저장 |
| 미정 사항 | 없음 — 아래 확정 계약 적용 |

### 목적과 사용 흐름

추천 화면에 사용자의 기본 선택을 미리 표시한다. 사용자는 그날 원하는 형태와 조건으로 수정할 수 있으며, 화면에서 바꾼 값은 이번 추천에 사용한다.

- 회원가입 시 필수 입력으로 요구하지 않는다. 기본값을 저장하지 않은 사용자도 추천을 이용할 수 있다.
- 화면에서 조건을 수정하거나 추천을 요청하는 것만으로 저장된 기본값을 변경하지 않는다.
- 사용자가 **‘이 조건을 기본값으로 저장’**을 선택했을 때만 U12를 호출한다.
- 이번 추천에 사용할 최종 조건의 전달과 AI 호출은 추천 API 업무에서 처리한다.

### 요청

Path Parameters, Query Parameters, Request Body 없음. 인증된 사용자 본인을 식별하며 사용자 ID를 입력받지 않는다.

### Response

`200 OK`. 저장된 값이 있으면 해당 값을 반환한다. 미설정이면 아래 기본값을 반환하며, 조회만으로 기본값을 영속 저장하지 않는다.

```json
{
  "shape": "loop",
  "filters": {
    "river": false,
    "beach": false,
    "park": false,
    "trail": false,
    "pedestrian": false,
    "flat": false,
    "avoid_major_road": false,
    "avoid_steps": false,
    "avoid_tunnel": false
  }
}
```

### 필드 계약 — U11 응답 및 U12 요청·응답 공통

| 필드 | 타입 | 필수 | 미설정 조회 기본값 | 의미 |
|---|---|:---:|---|---|
| `shape` | string | O | `loop` | `loop` 순환 / `out_and_back` 반환점 왕복 / `point_to_point` 편도 |
| `filters` | object | O | 아래 9개 값 모두 false | 선호·회피 조건. 9개 boolean 필드를 항상 포함 |
| `filters.river` | boolean | O | false | 강변 선호 |
| `filters.beach` | boolean | O | false | 해변·바다 선호 |
| `filters.park` | boolean | O | false | 공원·녹지 선호 |
| `filters.trail` | boolean | O | false | 산책로·트레일 선호 |
| `filters.pedestrian` | boolean | O | false | 보행로 선호 |
| `filters.flat` | boolean | O | false | 평지 위주 선호. false는 경사 선호가 아니라 고려하지 않음 |
| `filters.avoid_major_road` | boolean | O | false | 큰길 피하기 |
| `filters.avoid_steps` | boolean | O | false | 계단 피하기 |
| `filters.avoid_tunnel` | boolean | O | false | 터널 피하기 |

- 모든 필드는 null을 허용하지 않는다. 선호 조건의 true는 해당 환경 선호, 회피 조건의 true는 해당 요소 회피를 뜻한다.
- **false는 항상 ‘고려하지 않음’이다.** 강변 선호가 false라고 강변을 피하거나, 큰길 피하기가 false라고 큰길을 선호하는 의미가 아니다.
- API에는 `shape`와 `filters`만 포함한다. 기존 `environmentTypes` 배열과 선택 응답 필드 `updatedAt`은 사용하지 않는다.
- 출발·도착 좌표, 목표 거리, seed, 추가 추천 횟수는 추천 기본값에 저장하거나 반환하지 않는다.
- `point_to_point`를 기본값으로 저장할 때 도착 좌표는 필요하지 않다. 도착 좌표 검증은 추천 요청의 책임이다.
- AI 입력의 필드명과 맞춰 `filters`를 사용하되, 이 API는 AI를 호출하지 않는다. U11·U12에서는 꺼진 조건도 false로 명시한다.

### 오류 및 저장 계약

- 회원 JWT가 없거나 유효하지 않으면 `401 UNAUTHORIZED`, 접근 권한이 없거나 유효한 토큰의 계정이 존재하지 않거나 ACTIVE 상태가 아니면 `403 FORBIDDEN`이다(2026-11-04 확정). 공통 오류 본문은 [공통 규약](README.md#공통-규약)을 따른다.
- 미설정은 오류나 빈 배열이 아니라 위 기본값 객체로 응답한다. 저장소 조회 실패를 미설정으로 취급하지 않는다.
- 사용자별 기본값은 user_recommendation_preferences에 저장한다. 자동 생성 BIGINT id가 PK이고, user_id는 NOT NULL·UNIQUE이며 users.id를 참조하는 FK로 사용자당 최대 1행을 보장한다. id와 user_id는 내부 저장 필드이며 API 응답에 추가하지 않는다. shape와 9개 boolean 컬럼은 위 필드에 일대일 대응한다. [ERD](../db/erd.md)와 [기준 SQL](../db/schema.sql)을 따른다.
- 일시적 저장소 장애는 공통 기준의 `503 SERVICE_UNAVAILABLE`로 응답한다. 그 밖의 장애 분류는 [공통 오류 규약](README.md#공통-규약)을 따르며 실패를 기본값 응답으로 숨기지 않는다.

## U12 추천 기본값 저장

`PUT` `/api/v1/users/me/preferences`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 본인 |
| 계약 | 2026-11-03 사용자 합의: 명시적 저장 및 전체 교체 |
| 미정 사항 | 없음 — 아래 확정 계약 적용 |

### 목적과 요청

사용자가 **‘이 조건을 기본값으로 저장’**을 선택하면 현재 선택한 코스 형태와 9개 조건을 본인의 추천 기본값으로 전체 교체한다. 최초 저장과 이후 변경에 같은 API를 사용한다.

Path Parameters, Query Parameters 없음. 사용자 ID는 인증 정보에서 식별한다.

Request Body는 [U11 필드 계약](#필드-계약--u11-응답-및-u12-요청응답-공통)을 따른다.

```json
{
  "shape": "loop",
  "filters": {
    "river": false,
    "beach": false,
    "park": true,
    "trail": false,
    "pedestrian": false,
    "flat": false,
    "avoid_major_road": true,
    "avoid_steps": false,
    "avoid_tunnel": false
  }
}
```

- `shape`, `filters` 및 9개 boolean 필드는 모두 필수이고 null을 허용하지 않는다. 부분 수정이나 누락 필드의 기본값 보충을 하지 않는다.
- `shape`는 `loop`, `out_and_back`, `point_to_point`만 허용한다.
- 모든 조건을 false로 저장할 수 있다. 이 경우 환경 선호·회피를 고려하지 않는 기본값이다.
- 편도 형태도 좌표 없이 저장한다. 이 API에는 `DESTINATION_REQUIRED` 검증을 적용하지 않는다.
- 기존 환경 코드 배열로 새 조건을 추정하거나 변환하지 않는다.

### Response

`200 OK`. 저장된 `shape`와 9개 `filters`를 U11과 같은 구조로 반환한다.

```json
{
  "shape": "loop",
  "filters": {
    "river": false,
    "beach": false,
    "park": true,
    "trail": false,
    "pedestrian": false,
    "flat": false,
    "avoid_major_road": true,
    "avoid_steps": false,
    "avoid_tunnel": false
  }
}
```

### 저장·검증 규칙

- 본인의 추천 기본값만 변경한다. 형태와 조건 전체를 하나의 저장 단위로 취급하여 일부만 반영하지 않는다.
- 저장 성공 후 U11로 조회하면 저장한 값을 반환한다. 검증 실패 시 기존 기본값은 유지한다.
- 기본값 저장은 선택 사항이며 추천 실행이나 회원가입 완료의 필수 조건이 아니다.
- 화면 수정·추천 요청·다른 코스 추천만으로 이 API를 자동 호출하지 않는다.
- 거리·위치·seed·AI 요청 및 응답·추천 횟수 제한은 본 API 범위에 포함하지 않는다.

### 오류 및 저장 계약

- JSON 구문·필수 필드 누락·null·잘못된 자료형은 `400 VALIDATION_ERROR`로 거절한다.
- 회원 JWT가 없거나 유효하지 않으면 `401 UNAUTHORIZED`, 접근 권한이 없거나 유효한 토큰의 계정이 존재하지 않거나 ACTIVE 상태가 아니면 `403 FORBIDDEN`이다(2026-11-04 확정).
- 허용되지 않은 문자열 shape는 `422 INVALID_SHAPE`로 거절한다. 최상위 또는 filters 안에 정의되지 않은 필드가 있으면 `400 VALIDATION_ERROR`로 거절한다. 기존 environmentTypes와 위치·거리·seed도 이 API의 허용 필드가 아니다. 이 엄격한 필드 검증은 U12에만 적용하며 공통 설정을 변경하지 않는다.
- 일시적 저장소 장애는 공통 기준의 `503 SERVICE_UNAVAILABLE`를 따른다. 그 밖의 장애는 공통 분류를 유지한다. 오류 응답은 저장 미완료를 보장하지 않으므로 재조회로 결과를 확인한다.
- 최초 명시적 저장 시 user_recommendation_preferences 행을 만들고 이후 요청은 전체 교체한다. user_profiles 유무와 무관하며 가입 시 자동 생성하지 않는다.
- 동일 사용자의 저장은 최초 생성부터 직렬화한다. 마지막으로 처리되어 커밋된 요청의 전체 값을 유지하며 서로 다른 요청의 필드가 섞이지 않아야 한다. 실패한 트랜잭션은 기존 상태를 보존한다.
- 동일 값 재전송은 정상 저장으로 처리하고 200을 반환한다. 별도 멱등 키·버전 충돌 응답은 도입하지 않는다.
- 앱은 저장 요청을 순차 처리한다. 응답 유실 시 U11로 확인하고, 새 수정 이후 과거 요청을 자동 재전송하지 않는다. 여러 기기의 오래된 요청까지 감지하는 버전 비교는 제공하지 않는다.
- 회원탈퇴 시 기본값 행을 삭제한다. users 행을 WITHDRAWN으로 남기는 논리 탈퇴에서도 서비스가 명시적으로 삭제해야 한다. 물리 삭제 시 FK의 ON DELETE CASCADE를 적용한다. 탈퇴와 저장은 동일 사용자 단위로 직렬화하고 계정 상태를 확인하여 탈퇴 뒤 설정이 재생성되지 않도록 한다.
- 이 계약의 설계 정리는 S15P31E105-386, 실제 구현은 S15P31E105-245의 확정 범위다. C01의 입력·AI 연동 계약 변경은 별도 추천 업무에서 처리한다. 서비스 마이그레이션과 실제 API 구현은 후속 구현 단계에서 수행한다.

## U13 개인 공개 설정 조회

`GET` `/api/v1/users/me/privacy-settings`

### 246번 확정 구현 계약 — 2026-11-05

본 절의 기존 제안·오류 후보보다 이 계약을 우선한다. 성공은 200과 `isPrivate` boolean이다. 설정 행이 없으면 기존 앱 설정과 동일하게 `503 SERVICE_UNAVAILABLE`이며 조회 중 생성하거나 PUBLIC으로 추정하지 않는다. 본인 계정이 없거나 ACTIVE가 아니면 `401 UNAUTHORIZED`다. 공개 설정과 무관한 건강정보·원본 기록 접근 권한은 확대하지 않는다.

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

계정의 공개·비공개 설정을 조회한다. 프로필과 게시물이 같은 계정 정책을 따른다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "isPrivate": true
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `isPrivate` | boolean | O | user_settings.account_visibility의 PRIVATE=true, PUBLIC=false 변환. 설정 행 부재를 false로 간주하지 않는다. |


**사용 흐름과 응답 판단**

공개 설정 조회는 반드시 isPrivate 값을 제공해야 한다. 설정 행 부재를 PUBLIC으로 추정하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `404 SETTINGS_NOT_SET` | 설정 행 부재. 임의 PUBLIC 처리 금지. 복구/오류 정책 확인 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 본인은 자신의 정보를 볼 수 있다. 비공개 계정의 프로필 내용과 게시물은 승인된 팔로워만 조회할 수 있다. 승인 대기 요청자는 팔로워 권한이 없다.
- 피드·상세·검색·이미지 참조 등 모든 접근에서 같은 계정 정책을 적용한다. 프로필 요청·팔로우를 위한 최소 식별정보의 범위는 U21에서 정의한다.
- 계정 전환과 팔로우 취소·승인·거절의 즉시 권한 반영, 캐시·이미지 접근 제어를 구현한다.

- 계정의 공개·비공개 설정을 조회한다. 프로필과 게시물이 같은 계정 정책을 따른다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 계정의 `isPrivate` true / false. 개별 러닝 기록 공개 상태는 두지 않는다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## U14 개인 공개 설정 변경

`PATCH` `/api/v1/users/me/privacy-settings`

### 246번 확정 구현 계약 — 2026-11-05

본 절의 기존 제안·오류 후보보다 이 계약을 우선한다. 성공은 200과 `isPrivate` boolean, DB에 저장된 UTC `updatedAt`이다. 같은 상태 재요청은 성공하며 갱신시각·관계를 다시 변경하지 않는다. PRIVATE→PUBLIC 전환 때만 현재 유효 PENDING을 같은 트랜잭션에서 승인한다. PUBLIC→PRIVATE 전환은 이미 승인된 팔로우를 제거하지 않는다.

- 본문은 `isPrivate` boolean 하나만 받는다. JSON 오류·중복 키·뒤따르는 JSON·객체가 아닌 본문·필수 필드 누락은 `400 VALIDATION_ERROR`다. null·문자열·숫자 등 boolean이 아닌 값과 미정의 필드는 `422 INVALID_VISIBILITY`다.
- 설정 행 부재는 `503 SERVICE_UNAVAILABLE`, 없는/비활성 본인 계정은 `401 UNAUTHORIZED`다. DB 연결·잠금 시간초과는 기존 공통 장애 매핑을 따른다. 별도 409 충돌 코드는 추가하지 않는다.
- 249번과 공유하는 쓰기 잠금 순서는 대상 `users` 행 → 대상 `user_settings` 행 → 관계 행이다. 설정·관계가 없더라도 대상 계정 잠금을 먼저 획득한다. 설정 행을 잠근 뒤 공개 여부를 다시 읽어 생성·취소·승인·거절을 처리한다. 트랜잭션 대기 상한은 기존 회원 기능처럼 2초이며 실패 시 전체 롤백한다. 249번 HTTP API 자체는 246번 구현에 포함하지 않는다.

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | USR-001~007 / SYS-002 |
| 관련 화면 | 8.1 설정 — 계정 공개 여부(사용자 수정 결정 우선) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

계정의 공개·비공개 여부를 변경한다. 기록별·게시물별 공개 범위는 받지 않는다.

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
| `isPrivate` | boolean | O | true: 승인된 팔로워에게 프로필·게시물 공개, false: 전체 공개 |

```json
{"isPrivate": true}
```

### Response

`200 OK (제안)`

```json
{
  "isPrivate": true,
  "updatedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `isPrivate` | boolean | O | user_settings.account_visibility의 PRIVATE=true, PUBLIC=false 변환. 설정 행 부재를 false로 간주하지 않는다. |
| `updatedAt` | string (ISO 8601 UTC) | O | `user_settings.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

공개 전환 응답은 변경된 공개 상태를 보여준다. 2026-11-05 사용자 확정: 공개 전환과 유효 대기 요청 자동 승인은 하나의 DB 트랜잭션에서 함께 성공하거나 함께 롤백한다. 일부만 저장한 상태로 성공 응답하지 않는다. 응답 유실은 실패를 의미하지 않으므로 현재 설정·관계를 재조회한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 INVALID_VISIBILITY` | 입력 값 | 계정 공개 설정 값의 타입·허용 범위가 맞지 않음. isPrivate와 PUBLIC/PRIVATE 대응 확인 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `409 VISIBILITY_STATE_CONFLICT` | 공개 전환과 팔로우 승인·거절·취소가 겹치는 경우. 내부 재처리와 클라이언트 충돌 구분 미정 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 비공개에서 공개(`isPrivate=false`)로 전환하면 전환 시점에 유효한 모든 PENDING 팔로우 요청을 자동 승인해 FOLLOWING으로 바꾼다. 별도 U25 승인 요청은 요구하지 않는다.
- 공개 전환·자동 승인·팔로우 생성·취소는 공통 순서 규칙으로 처리한다(2026-11-05 사용자 확정). 취소가 먼저 확정된 관계를 자동 승인으로 되살리지 않고, 자동 승인 이후의 취소는 관계를 제거한다. 공개 전환과 겹친 새 팔로우가 과거 비공개 상태만을 근거로 PENDING에 남지 않도록 한다. 구체적인 잠금 대상·획득 순서는 249번과 공유하는 구현 설계에서 정한다.
- 공개 전환 자동 승인에 대해서는 요청자·계정 소유자에게 별도의 승인 알림을 보내지 않는다. 대신 공개 전환 화면에서 계정 소유자에게 대기 중인 팔로우 요청이 모두 자동 승인된다는 안내를 표시한다(2026-11-05 사용자 확정). 이 안내를 위해 알림함 항목·새 알림 API를 추가하지 않는다. 수동 U25 승인 알림과 구분한다.
- 승인 관계·팔로워 수·받은 요청 목록을 일관되게 갱신한다. 이미 취소·거절된 요청은 승인하지 않고 전환 재시도로 관계나 팔로워 수를 중복 반영하지 않는다.

- 본인은 자신의 정보를 볼 수 있다. 비공개 계정의 프로필 내용과 게시물은 승인된 팔로워만 조회할 수 있다. 승인 대기 요청자는 팔로워 권한이 없다.
- 피드·상세·검색·이미지 참조 등 모든 접근에서 같은 계정 정책을 적용한다. 프로필 요청·팔로우를 위한 최소 식별정보의 범위는 U21에서 정의한다.
- 계정 전환과 팔로우 취소·승인·거절의 즉시 권한 반영, 캐시·이미지 접근 제어를 구현한다.

- 계정의 공개·비공개 여부를 변경한다. 기록별·게시물별 공개 범위는 받지 않는다.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 계정의 `isPrivate` true / false. 개별 러닝 기록 공개 상태는 두지 않는다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## U15 회원가입

`POST` `/api/v1/auth/signup` · 공개 · USR-001

2026-10-28 S15P31E105-222 사용자 승인으로 아래 계약을 확정했다. 구현·검증 결과는 별도 기록한다.

### Request Body

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | --- | --- |
| loginId | string | O | 영문·숫자 4~16자, 대소문자 구분 없음(S15P31E105-831). 형식 검사 뒤 소문자로 바꿔 저장하며 trim은 하지 않는다. 대소문자만 다른 아이디를 포함해 탈퇴 계정 포함 중복 불가 |
| password | string | O | 공통 비밀번호 정책: Unicode 코드포인트 8~20자, 공백·고립 surrogate 불가, 특수문자 허용. 새 비밀번호 제한: 영문·숫자·키보드 특수문자(ASCII `0x21`~`0x7E`)만, `loginId`와 대소문자 무시로 같은 값 불가(S15P31E105-773) |
| nickname | string | O | 완성형 한글(가~힣)·영문·숫자만 2~10자. 공백·이모지·특수문자·자모 단독(ㅋㅋ 등)·제어/보이지 않는 문자 불가(S15P31E105-781). 대소문자 무시로 중복을 판정하고 저장은 입력 그대로(유니코드 정규화 없음), ACTIVE 회원 대상 `lower(nickname)` 부분 UNIQUE로 중복 불가(S15P31E105-831). 탈퇴한 회원의 기존 닉네임은 재사용 허용 |
| birthDate | string | O | YYYY-MM-DD의 유효한 날짜, 1950-01-01 이상(앱 생년 휠과 같음, S15P31E105-779), 미래 불가 |
| gender | string | O | MALE 또는 FEMALE |
| phoneNumber | string | O | 국내 휴대전화 010으로 시작하는 숫자 11자리. 하이픈·공백 거절. U28·U29로 인증한 번호여야 하며 ACTIVE 회원이 쓰는 번호는 가입 불가(S15P31E105-560) |
| phoneVerificationToken | string | 조건부 | U29가 `SIGN_UP` 목적으로 발급한 인증 증명. 운영에서는 필수. 개발·테스트 환경에서 서버 설정 `BACKEND_SIGNUP_UNVERIFIED_PHONE_ALLOWED=true`일 때만 생략할 수 있다 |
| consents | array | O | 아래 네 유형을 각각 정확히 한 번 제출. 누락·중복·알 수 없는 유형 거절 |

각 동의는 consentType과 granted(JSON boolean)을 포함한다. 필수3종 중 하나라도 false이면 가입을 거절한다. 약관 버전·동의 시각은 받거나 저장하지 않는다.

| consentType | granted |
| --- | --- |
| TERMS_OF_SERVICE | true 필수 |
| PERSONAL_INFO | true 필수 |
| LOCATION_DATA | true 필수 |
| HEALTH_DATA | true 또는 false, 미동의 가입 허용 |

```json
{
  "loginId": "runner01",
  "password": "Example9!",
  "nickname": "러너",
  "birthDate": "2000-01-01",
  "gender": "MALE",
  "phoneNumber": "01000000000",
  "phoneVerificationToken": "<U29 verificationToken>",
  "consents": [
    {"consentType":"TERMS_OF_SERVICE","granted":true},
    {"consentType":"PERSONAL_INFO","granted":true},
    {"consentType":"LOCATION_DATA","granted":true},
    {"consentType":"HEALTH_DATA","granted":false}
  ]
}
```

예시는 합성 값이다. 비밀번호 예시는 실제 정책 길이에 맞는 값으로 바꾸어 사용한다. 원래 healthDataAccess 직접 입력은 consents로 대체한다. 건강 동의의 단일 원천은 HEALTH_DATA이며 true는 users.health_data_access=AGREE, false는 DISAGREE로 저장한다.

### Response

`201 Created`, `Cache-Control: no-store`. 아래 키는 모두 필수·NULL 불가다.

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| user.id | integer(int64) | 생성된 users.id |
| user.loginId | string | 저장된 아이디(소문자) |
| accessToken | string | 공통 계약의 JWT |
| refreshToken | string | 공통 계약의 opaque 갱신 토큰 |
| expiresInSec | integer | Access Token 실제 유효 초 1~600 |
| refreshExpiresAt | string(ISO8601 UTC) | 최초 발급부터 30일 절대 상한 |
| onboardingCompleted | boolean | 가입 직후 false |

### 저장과 실패 처리

- 필수 사용자 값·네 동의를 모두 검증한 뒤 사용자와 user_settings 1행을 같은 PostgreSQL 트랜잭션에 저장한다. 필수3종 동의는 검증만 하며 별도 필드·이력 테이블을 만들지 않는다. HEALTH_DATA만 기존 users.health_data_access에 저장한다. 임시 사용자·user_profiles는 만들지 않는다.
- 설정 초기값: 음성/BPM/그룹·커뮤니티알림=false, 위치수집 OFF, 공개범위 PRIVATE. 위치 동의와 실제 위치 수집 설정은 별개다.
- 2026-10-29 사용자 정정: 별도 동의 이력·버전·동의 시각 저장은 제외한다. 이후 동의 변경·철회 API는 W04/W05의 별도 범위다.
- 비밀번호는 기존 공통 Argon2id 형식으로 저장하고 U01과 호환한다. 원문 비밀번호·전화번호·생년월일·동의 원문·해시·토큰을 로그·오류 details에 노출하지 않는다.
- 사용자·부속 저장, 발급 또는 커밋이 실패하면 성공 토큰 응답을 보내지 않고 DB 롤백과 Redis 미전달 계열 폐기를 시도한다. 두 저장소의 공동 원자성은 보장하지 않는다. Redis 보상 실패 시 응답하지 않은 계열이 원래 절대 만료까지 남을 수 있다.
- DB 커밋 결과나 성공 응답 전달이 불명확하면 계정이 존재할 수 있다. 같은 아이디 재요청은 409이며 클라이언트는 로그인을 안내한다. 멱등 성공 재응답은 제공하지 않는다.
- 아이디·닉네임은 사전 확인과 별개로 DB의 대소문자 무시 UNIQUE(`lower()` 식)가 최종 경합을 판정한다. 다른 무결성 오류를 중복 오류로 바꾸지 않는다.

#### 휴대전화 인증 (S15P31E105-560, 2026-11-09 확정)

- 처리 순서: 요청 값·동의 검증 → 아이디·닉네임 사전 중복 확인 → 인증 증명 소비 → 전화번호 중복 확인 → 저장 트랜잭션. 아이디·닉네임 사전 확인에서 실패하면 증명을 소비하지 않는다. 전화번호 중복은 증명을 확인한 뒤에 판정한다. 증명이 없거나 틀리면 번호 가입 여부와 관계없이 410이다(증명 없이 가입 여부를 알 수 없게 함, 2026-11-09 리뷰 R-1).
- 인증 증명은 U29에서 발급한 번호·목적(`SIGN_UP`)에 묶인 일회용 값이다. 다른 번호, `PASSWORD_RESET` 목적, 만료·이미 사용한 증명은 `410 VERIFICATION_EXPIRED`이며 원인을 구분해 알려 주지 않는다. 증명은 원자적으로 한 번만 소비한다.
- 같은 번호의 동시 가입은 저장 트랜잭션 안에서 전화번호 단위 잠금(PostgreSQL 트랜잭션 advisory lock)을 잡고 ACTIVE 회원 번호를 다시 확인해 한 건만 성공시킨다. 나머지는 `409 PHONE_ALREADY_REGISTERED`다. `users.phone_number`에는 UNIQUE 제약을 두지 않는다(기존 데이터 중복 가능).
- 증명을 소비한 뒤 저장·발급이 실패하면 증명을 되살리지 않는다. 앱은 다시 인증하도록 안내한다. 기존 실패 처리와 Redis 미전달 계열 폐기는 그대로다.
- 증명 없는 가입(`phoneVerificationToken` 생략)은 `BACKEND_SIGNUP_UNVERIFIED_PHONE_ALLOWED=true`인 개발·테스트 환경에서만 허용한다. 기본값과 운영은 false이며 생략하면 `400 VALIDATION_ERROR`다. 증명을 보냈다면 이 설정과 관계없이 검증·소비한다. 전화번호 중복 거절은 두 경우 모두 적용한다.

### 오류 응답

공통 `{code,message,details}` 형식. 원문 입력은 에코하지 않는다.

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | JSON·필수 필드·자료형·날짜 형식·아이디 형식 오류, 운영 설정에서 `phoneVerificationToken` 누락 |
| 400 | INVALID_PROFILE | 닉네임·전화번호·성별·미래 생일 값 오류 |
| 422 | INVALID_PASSWORD_POLICY | 문자열 비밀번호 정책 위반(ASCII 밖 문자·아이디와 같은 값 포함) |
| 422 | INVALID_CONSENT | 네 유형의 누락·중복·미지원 값, 잘못된 granted, 필수 동의 거절 |
| 409 | LOGIN_ID_DUPLICATED | 기존·탈퇴 아이디(대소문자만 다른 경우 포함) 또는 동일 아이디 동시 가입 |
| 409 | NICKNAME_DUPLICATED | 현재 ACTIVE 회원의 닉네임(대소문자만 다른 경우 포함) 또는 동일 닉네임 동시 가입 |
| 409 | PHONE_ALREADY_REGISTERED | ACTIVE 회원이 쓰는 전화번호 또는 같은 번호 동시 가입 |
| 410 | VERIFICATION_EXPIRED | 보낸 인증 증명이 발급되지 않은 값이거나 만료·사용됨·다른 번호·다른 목적. 필드를 생략하면 운영 설정에서 400 `VALIDATION_ERROR` |
| 503 | SERVICE_UNAVAILABLE | 저장·발급·DB/Redis 처리 결과를 확인할 수 없음 |

## U16 아이디 사용 가능 여부 확인

`GET` `/api/v1/auth/login-id/availability?loginId=runner01` · 공개 · USR-001

2026-10-28 사용자 승인으로 계약 확정. loginId는 U15와 같은 영문·숫자 4~16자이며 필수다. 사용 가능 여부는 U15와 같이 대소문자 구분 없이 판정한다(S15P31E105-831).

### Response

`200 OK`, `Cache-Control: no-store`. 다음 세 필드는 항상 포함한다.

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| loginId | string | 검사한 원래 아이디(소문자로 바꾸지 않고 보낸 값 그대로) |
| available | boolean | 미사용 true, 기존·탈퇴 계정이 있으면 false |
| reason | string/null | 사용 가능하면 null, 중복이면 DUPLICATED |

조회는 가입 예약이 아니며 U15에서 최종 유일성을 확인한다. 조회로 사용자·프로필·예약 행을 생성하지 않는다.

### 호출 제한과 오류

- IP당 최근 60초 동안 60회까지 허용, 61번째부터 `429 TOO_MANY_REQUESTS`. 이전 허용 요청이 집계에서 빠져 여유가 생기면 다시 허용한다. 서버 인스턴스가 같은 Redis 집계를 사용한다.
- 형식 오류 요청도 제한에 포함한다. 아이디만 바꾸어 제한을 우회할 수 없다. 고정된 분 경계에서 횟수를 초기화하지 않는다.
- 직접 연결 IP를 기본 사용하며 명시한 신뢰 프록시에 대해서만 전달 헤더를 해석한다. 설정·위조 방지와 실패 처리는 백엔드 README를 따른다.
- `400 VALIDATION_ERROR`: 누락·빈값·형식 오류. `503 SERVICE_UNAVAILABLE`: DB 조회·호출 제한 저장소 장애. 저장소 장애를 사용 가능이나 제한 없음으로 처리하지 않는다.
- 앱은 입력 종료 후 약500ms 뒤 조회를 권장한다. 서버 제한을 대신하지 않는다.

## U17 회원탈퇴 사전 정보 조회

`GET /api/v1/users/me/withdrawal-summary` · 회원 본인 ACTIVE · 1차 MVP

2026-11-05 S15P31E105-248 사용자 확정 정책을 적용한다. U18에서 현재 상태를 다시 검사하므로 사전 조회가 실행 성공을 보장하지 않는다. 읽기 전용 REPEATABLE_READ로 같은 스냅샷을 사용한다.

200 OK, Cache-Control: no-store.

| 필드 | 타입 | 의미 |
|---|---|---|
| runningRecordCount | integer (int64) | 본인 미삭제 COMPLETED 러닝 기록 수 |
| postCount | integer (int64) | 본인 미삭제 게시물 수 |
| bookmarkedCourseCount | integer (int64) | 본인 북마크 수. 공용 코스 삭제 의미 아님 |
| connectedDevices | array | 연결 중 본인 기기의 id·deviceType |
| ownedCrews | array | 먼저 이양/크루 탈퇴 또는 해산할 크루의 crewId·name |
| ownedGroupRuns | array | 먼저 취소/종료할 그룹의 groupRunId·title·status |
| scheduledGroupRuns | array | 회원탈퇴 시 자동 참가 취소할 일반 참가 그룹의 groupRunId·title·status |
| blockers | array | code·message·resourceIds. 없으면 빈 배열 |

blockers는 CREW_OWNER, GROUP_RUN_HOST, ACTIVE_RUNNING_SESSION, ACTIVE_GROUP_RUN, PENDING_START, ANALYSIS_PENDING을 사용한다. 이름/식별자는 본인이 소유하거나 참여한 자원만 반환하고 건강/GPS 원문은 포함하지 않는다. 일반 크루 멤버의 사전 크루 탈퇴는 요구하지 않는다. 예정 일반 그룹 참가 취소는 이 응답으로 안내한다.

미인증/유효하지 않은 토큰·없는/탈퇴 회원은 401 UNAUTHORIZED, 저장소 장애는 503 SERVICE_UNAVAILABLE다. 실패를 0건/빈 배열로 바꾸지 않는다.

## U18 회원탈퇴

`DELETE /api/v1/users/me` · 회원 본인 · 1차 MVP

2026-11-05 S15P31E105-248 사용자 확정 정책이다. 기존 자동 후임 선정 문구를 대체한다.

### 요청과 응답

| 요청 필드 | 타입·필수 | 규칙 |
|---|---|---|
| password | string, 필수 | 기존 가입/로그인과 동일한 8~20 코드포인트·공백 없음. 원문은 저장/로그에 넣지 않음 |
| agreed | boolean, 필수 | true만 허용. 누락/null/타입 오류와 false를 구분 |

200 OK, Cache-Control: no-store. `{ "withdrawnAt": "2026-11-05T00:00:00Z" }` (합성 예시). 최초 서버 탈퇴시각이며 동일 본인의 재요청은 시각을 변경하지 않는다. 재요청에도 유효한 본인 JWT와 형식상 유효한 요청/동의가 필요하되 이미 제거한 비밀번호와 재비교하지 않는다. 만료 JWT를 탈퇴 복구 명목으로 우회하지 않는다.

| HTTP·code | 조건 |
|---|---|
| 400 VALIDATION_ERROR | JSON·필수값·자료형·비밀번호 형식 오류 |
| 401 UNAUTHORIZED | 본인 인증 불가/회원 없음 |
| 401 INVALID_PASSWORD | ACTIVE 회원 비밀번호 불일치/검증한 해시가 잠금 전 변경됨 |
| 422 AGREEMENT_REQUIRED | agreed=false |
| 409 WITHDRAWAL_CONFLICT | 아래 사전 정리가 필요. details.blockers는 U17과 같은 형식 |
| 503 SERVICE_UNAVAILABLE | 잠금 제한/DB·Redis 장애 또는 상태/시각 불일치·결과 불확실 |
| 503 IMAGE_CLEANUP_PENDING | DB 탈퇴는 확정됐지만 이미지 정리 미완료. details.withdrawalCompleted=true·withdrawnAt, 재요청/서버 worker로 복구 |

### 처리·보존 규칙

- 운동 중(RUNNING/PAUSED 또는 참여 그룹 RUNNING)에는 탈퇴를 막는다. 미확정 START와 종료 후 분석 PENDING/PROCESSING도 정리 후 허용한다. 아직 시작하지 않은 READY는 취소한다. legacy READY(state_version=0)는 U18에서 CANCELLED로 닫고 버전은 유지한다.
- 활성 크루장은 M08에서 지정 후임에게 이양 후 크루 탈퇴하거나 M11 해산을 먼저 해야 한다. U18은 자동 후임 선정/해산을 하지 않는다. 일반 APPROVED 멤버는 자동 LEFT, PENDING 신청은 삭제, 기존 LEFT/REJECTED 이력 유지.
- 예정/진행 그룹장은 G13 취소/G12 종료를 먼저 한다. 시작 전 일반 참가 관계는 기존 나가기·READY 취소 로직으로 자동 정리한다. 다른 참가자의 운동을 탈퇴 API가 자동 종료하지 않는다.
- 비밀번호 검증은 DB 잠금 밖에서, 상태/해시 재검사는 사용자 잠금 안에서 한다. 관련 크루/그룹/세션의 현재 상태를 잠그고 재검사한다. 모든 차단 검증 뒤 Refresh 계열을 선폐기한다. 사용자 DB 상태 변경과 Redis를 공동 트랜잭션이라고 표현하지 않는다. 이후 DB 실패로 로그인 권한이 풀릴 수 있다는 사용자 승인을 적용한다.
- 갱신/로그인은 같은 사용자 잠금 아래 ACTIVE를 재검사한다. Redis 인덱스에서 누락된 계열도 탈퇴 확정 후 새 발급/갱신에 사용할 수 없다. 기존 JWT는 원래 exp까지 최대 10분 유효하고, 자원별 소유권·동의·공개 범위 및 현재 상태 검사는 유지한다.
- users.id·참조는 보존한다. login_id는 SHA-256 소문자 64자리 해시로 예약해 재사용 금지. 해시 입력은 소문자로 저장된 아이디라 대소문자만 다른 재가입도 막는다. S15P31E105-831 이전 탈퇴는 가입 당시 대소문자 그대로의 해시라 가입·U16이 소문자 아이디와 보낸 원래 값의 해시를 모두 확인하며, 대소문자만 다른 예전 탈퇴 아이디의 재사용은 막지 못한다(해시를 되돌릴 수 없어 수용한 한계). nickname은 “탈퇴한 회원”으로 통일하고 이전 닉네임 재사용 허용. 생일=1970-01-01·성별=MALE·전화번호=00000000000·비밀번호=!WITHDRAWN! 대체값으로 원문을 없애고 NOT NULL 유지. 건강 동의는 DISAGREE, 프로필 이미지 연결은 NULL. 대체값을 실제 프로필로 반환하지 않는다.
- 본인 프로필 U04는 WITHDRAWN·탈퇴 이름·기본 이미지 상태만 제공하며 gender/birthDate/loginId/profileImageUrl은 null, onboardingCompleted=false다. 탈퇴 후 프로필 수정은 401이다.
- 본인 설정·러닝 프로필·선호·코스 북마크·게시물 좋아요·댓글 좋아요·게시물 스크랩(본인이 남긴 행만, 타인이 본인 글·댓글에 남긴 행은 보존)·양방향 팔로우·일별 건강/준비도·심박 개인화·배치 메타데이터·GPS/측정/구간/페이스 전략·본인이 발급한 기록 공유 링크([H08](running-records.md#h08-기록-공유-링크-발급) `run_share_links`) 및 건강 파생 코칭은 실제 삭제한다. 탈퇴자가 만든 개인 코스(`is_private=true`)와 이를 참조한 타인의 북마크도 삭제한다. 이는 게시물 삭제·공유 해제 뒤 이미 저장한 코스를 유지하는 일반 규칙과 다른 탈퇴 시 개인정보 정리 규칙이다. SET_BPM/COACHING 이벤트도 삭제하되 그룹 상태 증거 START/END 등은 보존한다.
- 세션 식별 행/FK는 deleted_at과 함께 보존한다. HR/cadence·개인 목표·기기/BPM은 제거한다. 확정 그룹 결과에서 사용하는 거리·시간·페이스·목표 달성·실제 시각은 보존하고, 기타 개인 세션 지표는 제거한다. 공용 코스 행/경로/원본 세션 참조는 변경하지 않는다. 탈퇴자가 만든 개인 코스는 세션의 `course_id`·그룹런 참조와 개인 코스의 썸네일·태그·북마크를 정리한 뒤 경로를 포함한 코스 행을 삭제한다.
- 게시물은 본문·이미지·지역을 제거하고 deleted_at으로 목록/검색에서 숨긴다. 상세 직접 접근은 410 WITHDRAWN_POST, message “탈퇴한 회원의 게시물입니다.”를 반환한다. 댓글은 본문을 “탈퇴한 회원의 댓글입니다”로 교체, 타인 대댓글·관계 보존. 기존 삭제 댓글을 부활시키지 않는다. 숨겨진 부모 글의 댓글 원문은 조회 불가다.
- 서비스 만족도 응답([SV01](satisfaction-surveys.md#sv01-만족도-응답-제출) `satisfaction_survey_responses`)은 점수·의견·제출 경로·시각을 그대로 보존한다(S15P31E105-813, 2026-11-14 사용자 결정). 탈퇴(진행) 회원의 새 제출은 쓰기 guard로 401이다.
- 기기는 연결 해제 이력을 남긴다. PostgreSQL 정리·멤버십 변경은 한 트랜잭션으로 반영/롤백한다. 쓰기 guard가 사용자 상태를 다시 검사해 탈퇴 후 업로드·개인화·소셜/설정 저장으로 개인정보가 재생성되지 않게 한다.
- DB 커밋 후 개인 이미지 실제 삭제·테이블 없는 재시도를 연결한다. 크루가 사용하는 이미지·타인 파일은 보존한다. 상세 계약은 files.md의 회원탈퇴 정리 절을 따른다.

탈퇴 시 현재 팔로우 관계를 제거하면서 해당 요청의 기존 처리 이력은 삭제하지 않고 CANCELLED로 갱신한다. 과거 승인 요청을 재전송해 FOLLOWING 성공으로 오인하는 것을 막고, 이미 끝난 다른 요청 이력은 유지한다.

탈퇴 커밋 뒤 해당 회원의 운동 비교 곡선·일시정지 시각 캐시도 제거한다. 캐시 사용 직전 별도 READ COMMITTED 트랜잭션에서 활성 회원·미삭제 세션을 확인하고 회원별 고정 스트라이프 잠금으로 진행 중인 비교가 캐시를 쓴 뒤 정리되도록 하고, 이후 호출은 삭제 상태를 다시 확인한다. DB 롤백 때는 캐시를 지우지 않는다. 팔로우 처리 이력의 쓰기도 요청자·대상 두 회원의 상태를 검사하여 탈퇴와 겹친 늦은 승인 이력이 새로 저장되지 않도록 한다.

### 탈퇴와 저장의 동시 실행

세션 종속 쓰기(측정·좌표·코칭·페이스·sync_batches)는 부모 running_sessions FOR SHARE로 U18의 세션 FOR UPDATE와 직렬화하고 그 뒤 회원 상태는 잠금 없이 읽는다. running_sessions UPDATE는 자체 행 잠금으로 같은 보장을 얻으며 회원 행을 추가 잠그지 않는다. 기존 W07의 ‘회원 행이 잠겨 있어도 세션 저장은 진행’ 계약을 유지한다.

신규 세션 INSERT 및 나머지 직접 회원 자원은 회원 KEY SHARE NOWAIT를 사용한다. 강한 회원 잠금과 겹치면 해당 저장 전체를 즉시 롤백해503을 반환하고 서버가 자동 재전송하지 않는다. W07의 같은 clientBatchId·같은 payload 재시도 규칙은 유지한다. 세션 없는 과거 sync_batches는 device_id로 회원을 확인한다.

게시물 탈퇴 안내 구분: U18이 새로 숨기는 글은 body에 원문 대신 고정 문구 “탈퇴한 회원의 게시물입니다.”를 저장한다. 이미 deleted_at이 있던 글은 body=NULL로 원문만 지우고 계속404를 유지한다. 다른 필드/테이블 추가 없이 두 경우를 구분하며, 410은 고정 문구·삭제 상태·작성자 탈퇴 상태를 모두 확인한다.

## U19 앱 설정 조회

`GET` `/api/v1/users/me/settings`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | BPM-002 / SYS-003 |
| 관련 화면 | 8.1 설정 (화면 설계 v10) |
| 미정 사항 | 없음 — 아래 247번 확정 계약 적용 |
| 비고 | 2026-11-04 S15P31E105-247 사용자 승인 계약 |

### 설명

러닝 코칭·위치 기록·알림 설정을 조회한다. 계정 공개 여부는 [U13](#u13-개인-공개-설정-조회)에서 관리한다.

### 인증 및 권한

- 로그인 사용자 본인만 조회·변경한다. 사용자 ID는 검증된 JWT에서 식별하며 X-User-Id로 대체하지 않는다.

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
  "voiceCoachingEnabled": true,
  "bpmGuideEnabled": true,
  "locationRecordingMode": "RUNNING_ONLY",
  "notifications": {
    "groupRun": true,
    "community": true
  }
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `voiceCoachingEnabled` | boolean | O | 적용된 음성 코칭 설정. |
| `bpmGuideEnabled` | boolean | O | 적용된 BPM 안내 설정. |
| `locationRecordingMode` | string | O | ALWAYS/RUNNING_ONLY/OFF 중 적용된 값. |
| `notifications` | object | O | groupRun/community는 ERD boolean 설정. coaching은 지원하지 않음. |


`notifications.groupRun`은 user_settings.group_notifications_enabled(그룹런 취소·시작 임박·오늘 준비도 알림, 앱 표시 이름 `러닝 알림`, S15P31E105-847), `notifications.community`는 community_notifications_enabled(모두 boolean NOT NULL)에 대응한다. 2026-11-05 사용자 확정(S15P31E105-249) + 2026-11-06(S15P31E105-458): 공개 계정 새 팔로워·비공개 계정 새 팔로우 요청·수동 승인 **알림함 행**은 `notifications.community`를 따른다. false이면 행을 만들지 않으며 팔로우 전용 설정은 추가하지 않는다. 공개 전환 자동 승인 알림은 발송하지 않는다. 알림함 API는 [notifications.md](notifications.md)를 본다. 기존 `notifications.coaching`에 대응하는 독립 알림 컬럼은 없다. voice_coaching_enabled는 음성 코칭 설정이므로 같은 값으로 간주하지 않는다. 중첩 객체 존재 시 groupRun/community 키를 포함하며 coaching은 요청·응답에서 지원하지 않는다.

**사용 흐름과 응답 판단**

설정 화면이 저장된 유효 설정을 표시한다. PATCH는 보낸 값뿐 아니라 적용 후 전체 설정을 반환한다.

반환 필드는 위 다섯 설정으로 한정한다. OS 권한·개인정보 동의·계정 공개 범위는 이 API에서 변경하지 않는다.

### 오류 응답

**상태: 2026-11-04 S15P31E105-247 확정.** 인증 실패는 기존 공통 계약을 따른다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |

**행 누락·저장소 오류**

| HTTP·코드 | 발생 조건 |
|---|---|
| `503 SERVICE_UNAVAILABLE` | 사용자 또는 설정 행 누락, 일시적인 저장소 접근·잠금 실패. GET/PATCH에서 자동 생성하지 않음 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 본인의 설정만 대상으로 한다. 그룹 참가 권한·러닝 세션 상태는 이 API에서 변경하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 확정 사항과 연계 범위

- 응답 필드는 기존 user_settings의 다섯 설정에 대응한다.
- GET/PATCH는 200으로 전체 설정을 반환한다. 신규 가입 초기값은 BPM 안내=true, 음성/그룹런·커뮤니티 알림=false, 위치 OFF다(BPM 안내 기본 켬은 S15P31E105-706, 기존 사용자 반영은 [ERD](../db/erd.md) V36 참고). 예시 값은 기본값이 아니다.


## U20 앱 설정 변경

`PATCH` `/api/v1/users/me/settings`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | BPM-002 / SYS-003 |
| 관련 화면 | 8.1 설정 (화면 설계 v10) |
| 미정 사항 | 없음 — 아래 247번 확정 계약 적용 |
| 비고 | 2026-11-04 S15P31E105-247 사용자 승인 계약 |

### 설명

보낸 항목만 변경한다.

### 인증 및 권한

- 로그인 사용자 본인만 조회·변경한다. 사용자 ID는 검증된 JWT에서 식별하며 X-User-Id로 대체하지 않는다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `voiceCoachingEnabled` | boolean | X | 코칭 음성 알림(페이스·심박 이탈 시 음성 안내) |
| `bpmGuideEnabled` | boolean | X | BPM 리듬 가이드(목표 케이던스 비트) |
| `locationRecordingMode` | string | X | ALWAYS(항상)/RUNNING_ONLY(러닝 중에만)/OFF(끔) |
| `notifications` | object | X | `{groupRun, community}` boolean; 내부 필드도 생략 가능 |

```json
{
  "bpmGuideEnabled": false,
  "notifications": {
    "community": false
  }
}
```

### Response

`200 OK`

```json
{
  "voiceCoachingEnabled": true,
  "bpmGuideEnabled": false,
  "locationRecordingMode": "RUNNING_ONLY",
  "notifications": {
    "community": false,
    "groupRun": true
  }
}
```

응답 필드 정의(ERD ver.3 대조):



| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `voiceCoachingEnabled` | boolean | O | 적용된 음성 코칭 설정. |
| `bpmGuideEnabled` | boolean | O | 적용된 BPM 안내 설정. |
| `locationRecordingMode` | string | O | ALWAYS/RUNNING_ONLY/OFF 중 적용된 값. |
| `notifications` | object | O | groupRun/community는 ERD boolean 설정. coaching은 지원하지 않음. |

**사용 흐름과 응답 판단**

설정 화면이 저장된 유효 설정을 표시한다. PATCH는 보낸 값뿐 아니라 적용 후 전체 설정을 반환한다.

반환 필드는 위 다섯 설정으로 한정한다. OS 권한·개인정보 동의·계정 공개 범위는 이 API에서 변경하지 않는다.

### 오류 응답

**상태: 2026-11-04 S15P31E105-247 확정.** 인증 실패는 기존 공통 계약을 따른다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 INVALID_SETTING` | 입력 값 | boolean 설정 타입이나 위치 모드(ALWAYS/RUNNING_ONLY/OFF)가 잘못됨. 지원하지 않는 설정 키 포함 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | 본문 없음, JSON 구문 오류, 최상위 비객체, 중복 키 또는 후행 JSON. 설정 필드 타입·값 오류는 422로 구분 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합:** 동일 값 재전송을 허용한다. 생략한 필드는 현재 DB 값을 유지하며 서로 다른 필드의 동시 변경은 모두 보존한다. 같은 필드는 DB에서 나중에 직렬화된 쓰기 값이 최종값이다. 응답은 해당 쓰기가 적용된 시점의 전체 설정이며 이후 요청이 바꿀 수 있다. 응답 유실 시 GET으로 현재값을 확인한다. 버전 필드·409 충돌 응답은 추가하지 않는다.

### 처리 규칙

- 최상위·중첩 필드 생략은 유지한다. 명시적 null, 잘못된 설정 타입·값, 미지원 키(coaching 포함)는 422 INVALID_SETTING이다. 빈 객체 또는 빈 notifications는 변경 없이 현재 설정을 반환한다. 본문 없음·최상위 비객체·잘못된 JSON·중복 키·후행 JSON은 400 VALIDATION_ERROR다. 이 엄격한 파싱은 U20에만 적용한다.
- 사용자·설정 행 누락과 일시적인 저장소·잠금 장애는 503 SERVICE_UNAVAILABLE이며 자동 생성하지 않는다.
- 위치 기록 OFF는 OS 권한과 별개인 앱 내 설정이다. OFF에서 코스 러닝·그룹런 시작은 보류하고 사용자에게 RUNNING_ONLY 등으로 직접 변경하도록 안내한다. 자동으로 ON으로 바꾸지 않으며 OS 권한은 별도로 필요하다. 실제 S01/S03·그룹런 시작 검증은 해당 담당 영역과 연계한다.
- 본인의 설정만 대상으로 한다. 그룹 참가 권한·러닝 세션 상태는 이 API에서 변경하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 확정 사항과 연계 범위

- OFF에서 코스 러닝·그룹런 시작 보류 정책 확정. 해당 시작 API 구현·연계 검증은 별도 추적한다.
- 응답 필드는 기존 user_settings의 다섯 설정에 대응한다.
- GET/PATCH는 200으로 전체 설정을 반환한다. 신규 가입 초기값은 BPM 안내=true, 음성/그룹런·커뮤니티 알림=false, 위치 OFF다(BPM 안내 기본 켬은 S15P31E105-706, 기존 사용자 반영은 [ERD](../db/erd.md) V36 참고). 예시 값은 기본값이 아니다.


## U21 러너 프로필 조회

`GET` `/api/v1/users/{userId}/profile`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 / SYS-002 |
| 관련 화면 | 7.4 러너 프로필, 7.4b 내 프로필 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 2026-11-05 사용자 결정 반영 |

### 설명

계정 정책에 따라 조회 가능한 러너 프로필·러닝 수준·팔로우 수·공유 게시물을 조회한다. 월 요약은 제공하지 않는다. 게시물은 최근 일부로 열람 범위를 제한하지 않고 해당 사용자의 접근 가능한 전체 게시물을 이어서 조회할 수 있어야 한다. 타인의 원본 러닝 기록은 제공하지 않는다.

### 인증 및 권한

- 로그인 사용자. 대상의 계정 공개 여부와 승인된 팔로워 관계(U13·U22·U25)를 적용한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `userId` | integer (int64) | O | 대상 사용자 ID. 내 프로필은 본인 ID |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "userId": 101,
  "followerCount": 0,
  "followingCount": 0,
  "profileAccessible": true,
  "followStatus": "NONE",
  "isFollowing": false
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `userId` | integer (int64) | X | `users.id` 참조. 기존 응답 노출 범위 유지. |
| `nickname` | string | X | 대상 사용자의 닉네임 |
| `profileImageUrl` | string / null | X | users.profile_image_key에서 파생하는 조회 URL. 키가 NULL이면 null. 기존 ImageService의 공개 조회 URL 생성 규칙 재사용. |
| `runningLevel` | string | X | BEGINNER/INTERMEDIATE/ADVANCED. 프로필 설정 미완료로 값이 없으면 생략. 제한 응답에서도 생략 |
| `followerCount` | integer | X | user_follows.followee_id=대상 회원, is_approved=true인 관계 수. 미승인 요청 제외. |
| `followingCount` | integer | X | user_follows.follower_id=대상 회원, is_approved=true인 관계 수. 미승인 요청 제외. |
| `isFollowing` | boolean / null | O | user_follows.is_approved=true인 관계만 true. 본인 조회 시 null이라는 기존 표현을 유지한다. |
| `profileAccessible` | boolean | O | 본인·공개 계정·승인된 팔로워이면 true |
| `followStatus` | string | O | user_follows 행 없음=NONE, is_approved=false=PENDING, true=FOLLOWING. 본인 조회 시 NONE. |
| `posts` | array | 조건부 | 열람 가능한 경우 기존 CMT02 작성자별 게시물 항목 전체를 반환. 임의 최근 N개 제한 없음. 비공개 제한 응답에서는 생략. `recordSummary`의 평균 심박·케이던스는 CMT02와 같이 작성자 건강정보 동의 시에만 포함(S15P31E105-893). |


**사용 흐름과 응답 판단**

2026-11-05 사용자 확정(S15P31E105-249): 제한 응답에서는 최소 정보와 profileAccessible=false 이외 필드를 생략한다. 러닝 수준·게시물·팔로우 수는 포함하지 않는다.

2026-11-05 사용자 확정(S15P31E105-246·249): 비공개 계정의 미승인 사용자에게도 `200 OK`로 제한 프로필을 반환한다. `profileAccessible=false`와 최소 정보(`userId`·`nickname`·팔로우 상태·`profileImageUrl`)를 제공하여 프로필 화면과 팔로우 버튼을 표시한다. `posts`·러닝 수준·팔로우 집계 및 나머지 보호 프로필 내용은 노출하지 않는다. 월 요약은 모든 응답에서 제외한다. 계정이 비공개라는 이유만으로 이 조회를 403으로 처리하지 않는다.

### 오류 응답

**상태: 2026-11-05 사용자 확정(S15P31E105-249).** 성공은 200이며 아래 오류 매핑을 적용한다. 같은 결정 재전송은 처리 이력과 현재 요청을 대조한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 USER_NOT_FOUND` | 대상 없음 | 대상 회원이 없거나 조회 가능한 회원으로 취급할 수 없음. 탈퇴 대상도 404. 비공개 U21은 제한 프로필 200 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `403 ACCOUNT_ACCESS_DENIED` | 비공개 계정이라는 이유만으로 U21에 적용하지 않음(제한 프로필 200 응답으로 확정). 다른 보호 자원에 대한 적용 여부는 해당 API 계약을 따름 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 비공개 계정의 미승인 사용자에게 노출하는 최소 정보는 `userId`·`nickname`·팔로우 상태·프로필 사진이다(2026-11-05 사용자 확정, S15P31E105-246·249). 프로필 사진이 없으면 null로 표시한다. 제한 프로필은 위 200 응답을 따르며 그 밖의 프로필 내용·월 요약·공유 기록은 노출하지 않는다. 본인 조회는 followStatus=NONE, isFollowing=null로 반환한다(2026-11-05 사용자 확정).
- 공개 계정과 승인된 팔로워에게 프로필 내용을 제공한다. 개별 러닝 기록 공개 설정은 적용하지 않는다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [x] 현재 응답 필드와 제한 노출 정책 반영. 추가 필드 신설은 별도 계약 변경
- [x] 성공 200 및 오류 매핑은 2026-11-05 사용자 결정 반영


## U22 러너 팔로우·요청

`PUT` `/api/v1/users/{userId}/follow`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 |
| 관련 화면 | 7.4 러너 프로필 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 2026-11-05 사용자 결정 반영 |

### 설명

공개 계정은 즉시 팔로우하고 비공개 계정에는 승인 대기 요청을 만든다. 반복 요청은 멱등 처리한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `userId` | integer (int64) | O | 팔로우할 사용자 ID |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "followerCount": 0,
  "followStatus": "PENDING",
  "following": false
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `followStatus` | string | O | 성공 결과 PENDING 또는 FOLLOWING. |
| `following` | boolean | O | PENDING이면 false, FOLLOWING이면 true. |
| `followerCount` | integer | X | user_follows.followee_id=대상 회원, is_approved=true인 관계 수. 미승인 요청 제외. |


**사용 흐름과 응답 판단**

팔로우 버튼을 요청 대기 또는 팔로우 중으로 갱신한다. 재전송은 기존 멱등 규칙으로 같은 결과를 확인한다.

응답은 처리 후 상태와 승인된 팔로워 수를 반환한다. 알림함 저장은 S15P31E105-458([notifications.md](notifications.md))과 연계한다.

### 오류 응답

**상태: 2026-11-05 사용자 확정(S15P31E105-249).** 성공은 200이며 아래 오류 매핑을 적용한다. 같은 결정 재전송은 처리 이력과 현재 요청을 대조한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 USER_NOT_FOUND` | 대상 없음 | 대상 회원이 없거나 조회 가능한 회원으로 취급할 수 없음. 탈퇴 대상도 404. 비공개 U21은 제한 프로필 200 |
| `422 CANNOT_FOLLOW_SELF` | 자기 참조 | 본인을 팔로우하려고 함 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 비공개 계정에 새 PENDING 요청이 확정되면 대상에게 `FOLLOW_REQUEST` 알림함 행을 연계한다. 공개 계정의 새 FOLLOWING은 `NEW_FOLLOWER`다. 동일 요청 재전송은 `dedupe_key`로 추가 행을 만들지 않는다. 발행은 249 `FollowNotificationEvent`, 소비·저장은 458([notifications.md](notifications.md)).

- 비공개 대상은 PENDING만 생성한다. 승인 전에는 팔로워 수·비공개 프로필·게시물 접근 권한에 반영하지 않는다.
- 동일 관계의 중복 요청·이미 승인된 관계 재요청은 현재 PENDING/FOLLOWING 상태로 성공 응답하고 새 요청·팔로워 중복을 만들지 않는다(2026-11-05 사용자 확정). 대상 계정 소유자는 U24에서 확인하고 U25로 승인·거절한다.
- 거절 후 즉시 재요청할 수 있다. 별도 재요청 대기 기간은 두지 않는다(2026-11-05 사용자 확정). 재요청은 이전 요청과 구별하며 오래된 승인·거절 명령으로 새 요청을 처리하지 않는다. 구별을 위한 API·DB 구조는 별도 설계·합의한다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- NONE → 공개 계정 FOLLOWING / 비공개 계정 PENDING → 승인 FOLLOWING. 거절·취소 시 NONE.

### 미정 사항

- [x] 대상 users 행 → 대상 설정 행 → 관계 행 순서로 직렬화. U22/U23/U25는 대상 users 행에 FOR NO KEY UPDATE를 사용하며 U14의 FOR UPDATE와 경합한다. 사용자 키를 변경하지 않고 외래키 KEY SHARE와 호환하여 상호 팔로우 교착을 방지한다.
- [x] 팔로워·팔로잉 목록 화면 추가 여부: 2026-11-08 사용자 확정(S15P31E105-534). 승인 관계 목록은 [U26](#u26-팔로워-목록)·[U27](#u27-팔로잉-목록)으로 조회한다.
- [x] 현재 응답 필드와 제한 노출 정책 반영. 추가 필드 신설은 별도 계약 변경
- [x] 성공 200 및 오류 매핑은 2026-11-05 사용자 결정 반영


## U23 러너 팔로우·요청 취소

`DELETE` `/api/v1/users/{userId}/follow`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 |
| 관련 화면 | 7.4 러너 프로필 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 2026-11-05 사용자 결정 반영 |

### 설명

승인된 팔로우 또는 본인이 보낸 승인 대기 요청을 취소한다. 관계가 없어도 멱등 처리한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `userId` | integer (int64) | O | 팔로우 취소할 사용자 ID |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "followerCount": 0,
  "followStatus": "NONE",
  "following": false
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `followStatus` | string | O | 취소 후 NONE. 관계가 원래 없어도 같은 성공 상태. |
| `following` | boolean | O | 취소 후 false. |
| `followerCount` | integer | X | user_follows.followee_id=대상 회원, is_approved=true인 관계 수. 미승인 요청 제외. |


**사용 흐름과 응답 판단**

팔로우/요청 취소 후 버튼을 미관계 상태로 갱신한다.

응답은 처리 후 상태와 승인된 팔로워 수를 반환한다. 알림함 저장은 S15P31E105-458([notifications.md](notifications.md))과 연계한다.

### 오류 응답

**상태: 2026-11-05 사용자 확정(S15P31E105-249).** 성공은 200이며 아래 오류 매핑을 적용한다. 같은 결정 재전송은 처리 이력과 현재 요청을 대조한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 USER_NOT_FOUND` | 대상 없음 | 대상 회원이 없거나 조회 가능한 회원으로 취급할 수 없음. 탈퇴 대상도 404. 비공개 U21은 제한 프로필 200 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 요청자가 자신의 관계만 취소할 수 있다. 취소 후 NONE으로 반영하고 비공개 대상의 프로필·게시물 접근 권한을 제거한다. 승인·취소 경합 시 상태와 팔로워 수를 일관되게 처리한다.
- 이미 관계가 없는 상태에서 같은 취소를 반복해도 NONE 상태의 성공으로 처리하며 추가 부작용을 만들지 않는다(2026-11-05 사용자 확정). 성공 HTTP·응답 본문의 상세 형식은 아래 계약 확정 항목을 따른다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [x] 현재 응답 필드와 제한 노출 정책 반영. 추가 필드 신설은 별도 계약 변경
- [x] 성공 200 및 오류 매핑은 2026-11-05 사용자 결정 반영

## U24 받은 팔로우 요청 목록

`GET` `/api/v1/users/me/follow-requests`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 본인 |
| 관련 요구사항 | COM-004 / SYS-002 |
| 비고 | 2026-10-23 사용자 결정 반영. 2026-11-05 사용자 결정 반영 |

### 설명

내 비공개 계정에 들어온 승인 대기 요청을 조회한다. 요청 생성은 U22, 요청자 취소는 U23으로 처리한다.

### 인증 및 권한

- 본인 계정에 들어온 요청만 조회·처리한다. 다른 계정의 요청은 처리할 수 없다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string | X | 페이지 커서 |
| `limit` | integer | X | 생략 시 10, 지정할 경우 10만 허용. 다른 값은 400 INVALID_FILTER |

### Request Body

없음

### Response

`200 OK`

```json
{
  "items": [
    {
      "requesterId": 101,
      "requestId": 501,
      "nickname": "러너",
      "requestedAt": "2026-10-23T01:00:00Z",
      "status": "PENDING"
    }
  ],
  "nextCursor": null,
  "hasNext": false
}
```


`requesterId`는 user_follows.follower_id → users.id의 BIGINT 식별자다. U24의 requestedAt은 user_follows.created_at이며 PENDING은 is_approved=false의 표시값이다. U25의 FOLLOWING은 승인 후 true의 표시값이며 거절 결과는 기존 NONE 정책을 따른다.

**사용 흐름과 응답 판단**

대기 요청마다 requesterId·requestId·닉네임·요청시각이 있어야 승인/거절 버튼을 연결할 수 있다. 이미 처리된 요청은 다음 조회에서 제외한다.

2026-11-05 사용자 확정(S15P31E105-246·249): `requestId`는 기존 `user_follows.id`의 integer(int64) 값을 활용한다. `requesterId`는 사용자 식별자이고 `requestId`는 해당 팔로우 요청 식별자다. 목록에서 받은 `requestId`를 U25 요청에 전달한다. 이 값은 요청 구별에 사용하며 팔로잉 목록의 표시 순서를 확정하지 않는다.

### 오류 응답

**상태: 2026-11-05 사용자 확정(S15P31E105-249).** 성공은 200이며 아래 오류 매핑을 적용한다. 같은 결정 재전송은 처리 이력과 현재 요청을 대조한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `400 INVALID_FILTER` | 검색 조건 | 정렬·필터·페이지 조건이 명세의 허용값/형식에 맞지 않음 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- PENDING만 승인 대기 목록에 포함한다. 승인·거절·취소된 항목은 제거한다.
- 요청자 닉네임 등 최소 식별정보만 제공하고 요청자의 비공개 프로필 내용을 우회 노출하지 않는다.

### 상태값

PENDING

### 페이지 처리

- 요청 시각 내림차순, 시각 동률은 요청 ID 내림차순으로 10개씩 조회한다.
- nextCursor와 hasNext로 더보기를 처리하며 마지막 페이지는 nextCursor=null, hasNext=false다.
- cursor는 소유자 ID·요청 시각·요청 ID를 인코딩한 불투명 문자열이다. 다른 소유자의 커서와 형식 오류, 지원 날짜 범위(0001-01-01~9999-12-31 UTC) 밖 시각은 400 INVALID_FILTER다. 서명된 인증 토큰이 아니며 조회 소유자는 인증 정보로 결정한다.

### 화면 미정 사항
- [ ] 요청 목록·알림 화면의 진입 위치

## U25 팔로우 요청 승인·거절

`PATCH` `/api/v1/users/me/follow-requests/{requesterId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 본인 |
| 관련 요구사항 | COM-004 / SYS-002 |
| 비고 | 2026-10-23 사용자 결정 반영. 2026-11-05 사용자 결정 반영 |

### 설명

내 계정에 들어온 특정 팔로우 요청을 승인하거나 거절한다.

### 인증 및 권한

- 본인 계정에 들어온 요청만 조회·처리한다. 다른 계정의 요청은 처리할 수 없다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `requesterId` | integer (int64) | O | 내 계정에 요청을 보낸 사용자 ID |

### Query Parameters

없음

### Request Body

```json
{
  "requestId": 501,
  "decision": "APPROVE"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `requestId` | integer (int64) | O | U24에서 받은 기존 user_follows.id. 현재 대상 요청과 일치하는지 확인 |
| `decision` | string | O | APPROVE 또는 REJECT |

### Response

`200 OK`

```json
{
  "requesterId": 101,
  "followStatus": "FOLLOWING"
}
```


`requesterId`는 user_follows.follower_id → users.id의 BIGINT 식별자다. U24의 requestedAt은 user_follows.created_at이며 PENDING은 is_approved=false의 표시값이다. U25의 FOLLOWING은 승인 후 true의 표시값이며 거절 결과는 기존 NONE 정책을 따른다.

**사용 흐름과 응답 판단**

승인은 FOLLOWING, 거절은 NONE 결과로 화면 요청 행을 제거한다. 동일 요청 재전송 성공과 다른 결정의 충돌은 구분한다.

### 오류 응답

**상태: 2026-11-05 사용자 확정(S15P31E105-249).** 성공은 200이며 아래 오류 매핑을 적용한다. 같은 결정 재전송은 처리 이력과 현재 요청을 대조한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `404 REQUEST_NOT_FOUND` | 대상 없음 | 본인에게 속한 요청/이력이 없거나 요청자가 비활성 상태. 다른 소유자의 요청 존재는 노출하지 않음 |
| `409 REQUEST_STATE_CONFLICT` | 상태 충돌 | 승인·거절 전에 요청이 취소되거나 다른 요청/공개 전환으로 이미 처리됨 |
| `422 INVALID_DECISION` | 입력 값 | 승인·거절 결정이 해당 API의 허용값이 아님 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 승인 확정 후 요청자에게 팔로우 승인 알림을 자동 연계한다. 공통 생성·알림함 저장은 S15P31E105-458([notifications.md](notifications.md))이며 수신자의 `notifications.community`가 false이면 행을 만들지 않는다.

- `decision`은 APPROVE 또는 REJECT다. 대상 계정 소유자만 결정할 수 있다.
- 승인 시 팔로우 관계를 확정하고 팔로워 수와 비공개 프로필·게시물 접근 권한을 반영한다. 거절 시 접근 권한을 부여하지 않으며 `followStatus=NONE`을 반환한다.
- 같은 결정 재전송은 멱등 처리한다. 요청 취소·반대 결정·계정 공개 전환과 경합할 때 오래된 승인 요청이 관계를 되살리지 않도록 상태를 검사한다.
- 취소·거절 후 새 요청을 이전 요청과 구별해야 하며, 이전 요청에 대한 늦은 승인·거절이 새 요청에 적용되어서는 안 된다(2026-11-05 사용자 확정). 기존 `user_follows.id`를 `requestId`로 사용하고, 취소·거절 후 재요청은 새 행 ID로 구별한다. 요청자·대상 계정·현재 요청 ID를 함께 검사하며, 이전 requestId로 새 행을 승인·거절하지 않는다. 별도 요청 식별자 컬럼은 추가하지 않는다. 2026-11-05 사용자 확정: 처리 완료 이력 테이블 1개를 별도로 추가하고 요청 ID·요청자·대상·처리 결과·처리 시각을 보관한다. 처리 이력은 자동 삭제하지 않는다. 같은 결정 재전송은 200으로 기존 결과를 반환하고 관계를 다시 변경하지 않는다. 반대 결정·취소된 요청·새 요청을 처리하려는 과거 명령은 409 REQUEST_STATE_CONFLICT, 본인에게 속한 요청이나 이력이 없는 경우는 404 REQUEST_NOT_FOUND로 처리한다. 다른 사람의 요청 존재는 노출하지 않는다. 테이블명·컬럼·제약은 ERD·기준 SQL 및 후속 migration 설계에서 구체화한다.

### 상태값

PENDING → 승인 FOLLOWING / 거절 NONE. 내부 요청 이력 상태는 ERD 검토 대상.

### 미정 사항

- [x] 처리 이력 별도 테이블 1개·자동 삭제 없음·재전송 응답 정책 확정. 물리 스키마와 경합 설계는 구현 계획에서 구체화한다.
- [x] 수동 승인 사건은 458 공통 모듈로 연계하며 community 설정을 적용한다. 공개 전환 자동 승인은 알림을 발송하지 않는다. 거절 알림의 신규 도입은 이번 구현 범위에 포함하지 않는다.

## U26 팔로워 목록

`GET` `/api/v1/users/{userId}/followers`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 / SYS-002 |
| 관련 화면 | 7.4 러너 프로필, 7.4b 내 프로필 → 7.4c 팔로워·팔로잉 목록 |
| 비고 | 2026-11-08 사용자 결정 반영(S15P31E105-534) |

### 설명

대상 회원을 팔로우하는 승인된 러너 목록을 조회한다. U21 `followerCount`가 세는 관계와 같은 기준이다. 팔로잉 목록은 U27이며 두 API의 요청·응답·오류·페이지 규칙은 같다.

### 인증 및 권한

- 로그인 사용자. U21 `profileAccessible`과 같은 기준으로 본인·공개 계정·승인된 팔로워만 조회한다.
- 비공개 계정의 미승인 사용자는 `403 ACCOUNT_ACCESS_DENIED`다(2026-11-08 사용자 확정). U21 제한 프로필이 팔로우 수를 숨기므로 목록·개수·페이지 정보도 제공하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `userId` | integer (int64) | O | 목록을 볼 대상 사용자 ID. 내 목록은 본인 ID |

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string | X | 이전 응답의 `nextCursor` |
| `limit` | integer | X | 생략 시 20, 지정할 경우 20만 허용. 다른 값은 400 INVALID_FILTER |

### Request Body

없음

### Response

`200 OK`

```json
{
  "items": [
    {
      "userId": 101,
      "nickname": "러너",
      "profileImageUrl": null
    }
  ],
  "nextCursor": null,
  "hasNext": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].userId` | integer (int64) | O | 목록 러너의 `users.id`. U21 경로에 사용 |
| `items[].nickname` | string | O | 목록 러너의 닉네임 |
| `items[].profileImageUrl` | string / null | O | U21과 같은 프로필 사진 조회 URL. 키가 없으면 null. 계정 공개 정책의 최소 정보 예외 범위 |
| `nextCursor` | string / null | O | 다음 페이지 커서. 마지막 페이지는 null |
| `hasNext` | boolean | O | 다음 페이지 존재 여부 |

목록 러너의 러닝 수준·게시물·팔로우 수·건강/러닝 데이터와 요청자와의 팔로우 상태는 제공하지 않는다.

### 오류 응답

**상태: 2026-11-08 사용자 확정(S15P31E105-534).** 아래 순서로 검사한다. 접근 거부를 cursor 검사보다 먼저 판단하여 숨긴 목록을 cursor 오류로 확인할 수 없게 한다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 VALIDATION_ERROR` | 입력 형식 | Path `userId` 형식이 맞지 않음(0 이하·소수·범위 초과 포함) |
| `400 INVALID_FILTER` | 검색 조건 | `limit`이 20이 아님. 형식 오류·다른 대상 또는 다른 목록(U26/U27)의 cursor·지원 날짜 범위 밖 cursor는 접근 확인 후 같은 코드 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조, 요청자가 활성 회원이 아님 |
| `404 USER_NOT_FOUND` | 대상 없음 | 대상 회원이 없거나 탈퇴·비활성 |
| `403 ACCOUNT_ACCESS_DENIED` | 권한 | 대상이 비공개 계정이고 요청자가 본인·승인된 팔로워가 아님 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 결과가 0건인 경우는 오류가 아니며 빈 `items`를 반환한다.

### 처리 규칙

- `user_follows.followee_id=대상`, `is_approved=true`인 관계의 `follower_id` 회원만 포함한다. PENDING 요청·취소·거절 관계와 탈퇴·비활성 회원은 제외한다.
- 접근 판단과 목록 조회는 같은 읽기 스냅샷에서 수행한다. 조회 중 팔로우 취소·공개 범위 변경이 있어도 거부된 요청에 목록을 반환하지 않는다.
- 목록 화면에서 팔로우·취소·승인 후 돌아오면 다시 조회하여 U21 팔로우 수와 같은 관계 상태를 표시한다.

### 페이지 처리

- 관계 생성 시각(`user_follows.created_at`) 내림차순, 동률은 관계 ID(`user_follows.id`) 내림차순으로 20개씩 조회한다. 승인 시각은 저장하지 않으므로 공개 계정 즉시 팔로우와 비공개 승인 모두 요청 생성 시각을 기준으로 한다(2026-11-08 사용자 확정, 스키마 변경 없음).
- `nextCursor`와 `hasNext`로 더 보기를 처리하며 마지막 페이지는 `nextCursor=null`, `hasNext=false`다.
- cursor는 대상 ID·목록 종류·관계 생성 시각·관계 ID를 인코딩한 불투명 문자열이다. 서명된 인증 토큰이 아니며 열람 권한은 매 요청의 인증 정보로 다시 판단한다.
- 2026-11-08 사용자 확정(S15P31E105-534): cursor는 서명·암호화하지 않는다. 디코딩하면 각 페이지 마지막 관계의 생성 시각과 관계 ID가 보이며 이 노출을 수용한다(U24와 같은 방식).

## U27 팔로잉 목록

`GET` `/api/v1/users/{userId}/following`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 / SYS-002 |
| 관련 화면 | 7.4 러너 프로필, 7.4b 내 프로필 → 7.4c 팔로워·팔로잉 목록 |
| 비고 | 2026-11-08 사용자 결정 반영(S15P31E105-534) |

### 설명

대상 회원이 팔로우하는 승인된 러너 목록을 조회한다. U21 `followingCount`가 세는 관계와 같은 기준이다.

인증 및 권한·Path·Query·Response·오류 응답·페이지 처리는 [U26](#u26-팔로워-목록)과 같다. U26의 cursor는 U27에 사용할 수 없으며 400 INVALID_FILTER다.

### 처리 규칙

- `user_follows.follower_id=대상`, `is_approved=true`인 관계의 `followee_id` 회원만 포함한다. 대상이 보낸 PENDING 요청과 탈퇴·비활성 회원은 제외한다.
- 목록의 러너가 비공개 계정이어도 최소 정보(`userId`·`nickname`·`profileImageUrl`)만 노출하며 그 계정의 보호 프로필 내용은 U21 권한을 따른다.
- 2026-11-08 사용자 확정(S15P31E105-534): 공개 계정의 U26·U27에는 그 계정과 승인 관계인 비공개 계정도 최소 정보로 포함한다. 여러 공개 계정의 목록을 모으면 비공개 계정의 관계 일부를 알 수 있으나 이 노출을 수용한다. 비공개 계정 자신의 목록은 본인·승인된 팔로워만 조회한다.

## 휴대전화 인증 공통 규칙 (U28~U30)

S15P31E105-560(2026-11-09 사용자 결정, BE-A 확인)으로 확정한다. 목적은 휴대전화 수신 가능 여부 확인이며 명의 기반 본인확인이 아니다.

- 문자는 서버가 SOLAPI SMS로 보낸다. 인증번호는 서버가 보안 난수로 만든 숫자 6자리다. 문구: `[Runway] 본인확인 인증번호 [123456]`. 통신사가 앞에 붙이는 `[Web발신]`은 본문에 넣지 않는다.
- 정책 값: 인증번호 유효 180초, 오입력 5회째에 해당 인증번호 무효, 같은 번호·목적 재발송은 직전 발송 60초 뒤부터, 번호당 최근 24시간 5회, IP당 최근 24시간 100회(같은 네트워크를 여럿이 쓰는 경우를 고려해 20회에서 올림, S15P31E105-799), 인증 증명 유효 600초·일회용.
- 목적(`purpose`)은 `SIGN_UP`(U15 가입)과 `PASSWORD_RESET`(U30) 두 가지다. 인증번호·증명은 번호·목적에 묶이며 다른 목적에 쓸 수 없다.
- 상태는 기존 인증용 Redis에 저장한다. 전화번호·IP는 SHA-256 해시로만 키에 쓰고, 인증번호·증명은 해시만 저장한다. 증명 값에는 가입 대조·재설정 대상 조회를 위해 목적과 전화번호를 함께 둔다(최대 600초). 시각 판단은 Redis 서버 시간 기준이다. 전화번호 해시는 번호 공간이 작아 익명성을 보장하지 않는다.
- IP는 U16과 같은 방식(직접 연결 IP, 신뢰 프록시만 전달 헤더 해석)으로 정한다.
- 전화번호·인증번호·증명·SMS 공급자 응답 본문은 로그·오류 `message`·`details`에 넣지 않는다.
- 인증 상태 저장소(Redis) 장애는 `503 SERVICE_UNAVAILABLE`이며 인증 성공이나 제한 없음으로 처리하지 않는다.
- 응답에는 `Cache-Control: no-store`를 붙인다.
- 번호의 가입 여부는 인증번호를 맞힌 사람(U29 성공 직전)에게만 알려 준다. U28은 가입 여부와 관계없이 같은 규칙으로 보낸다. 휴대전화를 갖지 않은 사람이 번호 가입 여부를 대량으로 알아내지 못하게 하기 위해서다(2026-11-09 리뷰 R-1 사용자 결정).

## U28 휴대전화 인증번호 요청

`POST` `/api/v1/auth/phone-verifications` · 공개 · USR-001

### Request Body

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | --- | --- |
| phoneNumber | string | O | 010으로 시작하는 숫자 11자리. 하이픈·공백 거절 |
| purpose | string | O | `SIGN_UP` 또는 `PASSWORD_RESET` |

```json
{"phoneNumber": "01000000000", "purpose": "SIGN_UP"}
```

### Response

`200 OK`

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| expiresInSec | integer | 인증번호 유효 초(180) |
| resendAvailableInSec | integer | 다시 요청할 수 있을 때까지 초(60) |

### 처리 규칙

- 번호의 가입 여부를 확인하지 않는다. 두 목적 모두 가입된 번호든 아니든 같은 규칙으로 보낸다. 가입 여부는 U29에서 알려 준다.
- 재발송 대기·번호/IP 한도 확인과 새 인증번호 저장을 한 번에 처리한다. 새 인증번호를 저장하면 같은 번호·목적의 이전 인증번호와 오입력 횟수는 무효가 된다. 형식 오류는 발송 한도에 세지 않는다.
- 공급자가 발송을 명확히 거절하면 저장한 인증번호를 지우고 `503 SMS_UNAVAILABLE`. 시간 초과·응답 유실이면 실제 발송됐을 수 있어 인증번호를 남기고 `503 SMS_UNAVAILABLE`. 서버는 자동으로 다시 보내지 않는다(공급자에 중복 방지 키가 없어 중복 발송·과금 위험). 두 경우 모두 한도 사용량은 되돌리지 않는다.
- 서버 설정 `BACKEND_SMS_VERIFICATION_ENABLED=false`면 보내지 않고 `503 SMS_UNAVAILABLE`.
- 공급자 접수 이후 통신사 단계 실패는 확인하지 않는다. 문자를 받지 못하면 재발송 대기 뒤 다시 요청한다.

### 오류 응답

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | JSON·필수 필드·자료형·전화번호 형식·알 수 없는 목적 |
| 429 | VERIFICATION_RESEND_TOO_SOON | 같은 번호·목적의 직전 발송 60초 안. `details.retryAfterSec` |
| 429 | VERIFICATION_SEND_LIMIT_EXCEEDED | 번호 또는 IP의 최근 24시간 한도 초과. `details.retryAfterSec` |
| 503 | SMS_UNAVAILABLE | SMS 기능 꺼짐, 공급자 거절·시간 초과·응답 유실 |
| 503 | SERVICE_UNAVAILABLE | 인증 상태 저장소 장애 |

## U29 휴대전화 인증번호 확인

`POST` `/api/v1/auth/phone-verifications/confirm` · 공개 · USR-001

### Request Body

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | --- | --- |
| phoneNumber | string | O | U28과 같음 |
| purpose | string | O | U28과 같음 |
| code | string | O | 숫자 6자리 |

### Response

`200 OK`

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| verificationToken | string | 일회용 인증 증명(불투명 문자열). U15 `phoneVerificationToken` 또는 U30 `verificationToken`에 쓴다 |
| expiresInSec | integer | 증명 유효 초(600) |

### 처리 규칙

- 인증번호 확인·오입력 횟수 증가·성공 시 인증번호 삭제와 증명 저장을 한 번에 처리한다. 같은 인증번호로 동시에 확인해도 증명은 하나만 발급된다.
- 1~4회째 오입력은 400과 `details.failedCount`(1~4), `details.maxAttempts`(5). 5회째 오입력은 인증번호를 지우고 429. 그 뒤 같은 인증번호는 410이다.
- 인증번호가 없거나(보낸 적 없음·만료·이미 사용·잠금) 시간이 지나면 410. 원인을 구분해 알려 주지 않는다. 재발송하면 이전 인증번호는 새 인증번호와 맞지 않는 번호로 처리된다(400, 오입력 횟수에 셈).
- 형식 오류(6자리 숫자가 아님)는 400 `VALIDATION_ERROR`이며 오입력 횟수에 세지 않는다.
- 인증번호가 맞으면 그 번호의 ACTIVE 회원을 확인한다. `SIGN_UP`인데 ACTIVE 회원이 쓰는 번호면 409 `PHONE_ALREADY_REGISTERED`, `PASSWORD_RESET`인데 ACTIVE 회원이 없으면 404 `PHONE_NOT_REGISTERED`, 2명 이상이면 409 `PHONE_ACCOUNT_AMBIGUOUS`다. 이때는 증명을 돌려주지 않고 지우며, 인증번호도 사용된 것으로 처리한다(다시 하려면 새 인증번호). 확인 중 DB 장애도 증명을 지우고 503이다.
- 가입 상태는 U15·U30에서 다시 확인한다(증명 발급 뒤 바뀔 수 있음).

### 오류 응답

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | JSON·필수 필드·자료형·형식 |
| 400 | VERIFICATION_CODE_MISMATCH | 인증번호 불일치(1~4회째). `details.failedCount`, `details.maxAttempts` |
| 429 | VERIFICATION_ATTEMPTS_EXCEEDED | 5회째 불일치. 인증번호 무효. `details.failedCount`(5), `details.maxAttempts`(5) |
| 410 | VERIFICATION_EXPIRED | 유효한 인증번호 없음 |
| 404 | PHONE_NOT_REGISTERED | 인증번호는 맞지만 `PASSWORD_RESET`인데 그 번호의 ACTIVE 회원 없음 |
| 409 | PHONE_ALREADY_REGISTERED | 인증번호는 맞지만 `SIGN_UP`인데 ACTIVE 회원이 쓰는 번호 |
| 409 | PHONE_ACCOUNT_AMBIGUOUS | 인증번호는 맞지만 `PASSWORD_RESET`인데 그 번호의 ACTIVE 회원이 2명 이상 |
| 503 | SERVICE_UNAVAILABLE | 인증 상태 저장소·DB 장애 |

## U30 비밀번호 재설정

`POST` `/api/v1/auth/password-reset` · 공개 · USR-001

### Request Body

| 필드 | 타입 | 필수 | 규칙 |
| --- | --- | --- | --- |
| verificationToken | string | O | U29가 `PASSWORD_RESET` 목적으로 발급한 증명 |
| newPassword | string | O | U15와 같은 공통 비밀번호 정책과 새 비밀번호 제한(ASCII만, 그 번호 회원의 아이디와 대소문자 무시로 같은 값 불가). 기존 비밀번호와 같아도 허용 |

### Response

`204 No Content`, `Cache-Control: no-store`

### 처리 규칙

- 처리 순서: 요청 값·비밀번호 정책 검증 → 증명을 소비하지 않고 읽어 그 번호의 ACTIVE 회원이 1명이면 아이디 동일 여부 대조(S15P31E105-773. 증명이 없거나 다른 목적이거나 회원이 0·2명이면 대조하지 않고 이후 단계 오류를 따름) → 증명 소비(번호·`PASSWORD_RESET` 대조) → 그 번호의 ACTIVE 회원 확인 → 로그인·갱신과 같은 사용자 잠금 → 비밀번호 해시 갱신 → 같은 잠금 안에서 그 회원의 모든 갱신 권한(로그인 계열) 폐기 → 커밋.
- 비밀번호 정책 위반은 증명을 소비하지 않는다(다시 입력 가능). 증명을 소비한 뒤의 실패는 증명을 되살리지 않으며 앱은 다시 인증하도록 안내한다.
- 갱신 권한 폐기에 실패하면 트랜잭션을 롤백해 비밀번호를 바꾸지 않고 503. 커밋이 실패하면 갱신 권한은 이미 폐기됐을 수 있으나 비밀번호는 그대로다.
- 기존 Access Token은 공통 정책대로 남은 유효기간(최대 10분) 동안 유효하다.
- 로그인 연속 실패 잠금은 초기화하지 않는다(정해진 잠금 시간 뒤 풀린다).
- 비밀번호 변경 알림은 보내지 않는다(후속 업무).
- 비밀번호는 기존 Argon2id 형식으로 저장하고 원문·해시·증명을 로그·오류에 넣지 않는다.

### 오류 응답

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | JSON·필수 필드·자료형 |
| 422 | INVALID_PASSWORD_POLICY | 비밀번호 정책 위반(ASCII 밖 문자, 그 번호 회원의 아이디와 같은 값 포함). 증명을 소비하지 않음 |
| 410 | VERIFICATION_EXPIRED | 보낸 증명이 발급되지 않은 값이거나 만료·사용됨·다른 목적. 필드를 생략하면 400 `VALIDATION_ERROR` |
| 404 | PHONE_NOT_REGISTERED | 증명 발급 뒤 그 번호의 ACTIVE 회원이 없어짐 |
| 409 | PHONE_ACCOUNT_AMBIGUOUS | 그 번호의 ACTIVE 회원이 2명 이상 |
| 503 | SERVICE_UNAVAILABLE | 사용자 잠금 시간 초과, DB·Redis 처리 결과 확인 불가, 갱신 권한 폐기 실패 |

## 계정 공개 정책의 공통 적용 범위

- 피드·검색·프로필·게시물 상세·댓글·반응·공유 결과·이미지 참조 모두 계정 접근 정책을 적용한다. 목록 필터만으로 보호하지 않는다.
- 2026-11-05 사용자 확정(S15P31E105-246·249): 비공개 계정도 사용자 ID·닉네임·팔로우 상태·프로필 사진은 최소 정보로 노출할 수 있다. 이 예외가 게시물 사진·월 요약·공유 기록 공개를 허용하는 것은 아니다. 비로그인 사용자에 대한 최소 정보 제공 여부는 이 결정으로 확대하지 않는다.
- 보호 대상 이미지는 URL·imageId를 알고 있어도 현재 열람 권한이 없으면 조회할 수 없어야 한다. API 응답에서 URL을 숨기는 것만으로 보호하지 않는다. 프로필 사진은 위 최소 정보 예외를 따르며, 이미지 직접 조회·캐시의 권한 우회도 방지한다. 상세 응답·인증·캐시 방식은 F02에서 확정한다.
- 프로필의 월 요약·최근 공유 게시물도 동일한 권한을 따른다. 원본 H02 조회로 타인 기록을 우회 열람시키지 않는다.
- 계정 전환·팔로우 취소·승인·거절 시 접근 권한과 캐시·이미지 접근을 함께 반영한다.
- 기존 ERD의 프로필·세션·위치 공개 필드, 게시물 공개 필드와 팔로우 관계의 대기·승인 모델은 별도 수정·검증 대상이다. 이번 API 문서 수정으로 실제 DB 계약을 변경하지 않는다.
- 공용 코스 이름과 개인 북마크 별명도 별도 데이터 모델 검토 대상이다. 별명은 사용자와 코스의 저장 관계에만 두고 공개하지 않는다.
