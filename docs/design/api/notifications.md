# 알림함 API

> **상태:** S15P31E105-458 사용자 확정(2026-11-06)으로 앱 내 알림함을 정했고, S15P31E105-815 팀 합의(2026-11-14, [ADR-0025](../../adr/0025-fcm-device-push.md))로 같은 알림을 **Android 기기 푸시(FCM)**로도 보낸다. iOS(APNs)·마케팅성 대량 발송은 포함하지 않는다. S10 SSE·G10 `loadAlert`와 채널을 공유하지 않는다.
>
> 발생 계기·수신자·제외 정책은 [알림 정책](../requirements.md#알림-정책)을 따른다. 저장 컬럼·종류 코드는 [ERD 알림](../db/erd.md#5-알림-종류와-화면-이동)을 따른다.

## API 목록

| ID | 제목 | Method | Path | 단계 | 인증 |
|---|---|---|---|---|---|
| [N01](#n01-알림-목록) | 알림 목록 | GET | `/notifications` | 1차 MVP | 회원 |
| [N02](#n02-알림-전체-읽음) | 알림 전체 읽음 | POST | `/notifications/read-all` | 1차 MVP | 회원 |
| [N03](#n03-푸시-토큰-등록) | 푸시 토큰 등록 | PUT | `/notifications/push-tokens` | 1차 MVP | 회원 |
| [N04](#n04-푸시-토큰-해제) | 푸시 토큰 해제 | DELETE | `/notifications/push-tokens` | 1차 MVP | 회원 |

총 **4개** 공개 API. 공통 알림 **생성**은 공개 API가 아니며, 도메인 사건 트랜잭션 안에서 모듈 호출로 처리한다.

## 공통 규칙

### 채널과 설정

- 알림함 행을 만들고, 행이 새로 생기면 생성 트랜잭션 **커밋 후** 수신자의 기기 토큰(N03)들로 FCM 푸시를 보낸다([앱 밖 푸시](#앱-밖-푸시fcm)). 롤백되면 행도 푸시도 없다.
- 설정 키는 기존 U19/U20만 사용한다. 팔로우·크루·댓글은 `notifications.community`, 그룹런 취소·시작 임박·오늘 준비도는 `notifications.groupRun`이다(앱 설정 화면 이름 `러닝 알림`, S15P31E105-847). 새 설정 컬럼은 추가하지 않는다.
- 해당 설정이 false이면 **행을 만들지 않으며 푸시도 보내지 않는다**. 같은 설정이 알림함과 푸시를 함께 결정하며 푸시 전용 설정은 두지 않는다. 나중에 설정을 켜도 과거 사건은 소급 생성하지 않는다.
- `delivery_status`/`sent_at`은 **앱 밖 푸시 결과**다(S15P31E105-815에서 의미 변경). 새 행은 `PENDING`·`sent_at=NULL`로 저장되고 알림함(N01)에는 결과와 관계없이 바로 보인다. 기존(V42 이전) 행의 `SENT`는 앱 내 저장 의미로 남는다.

### 종류·대상

응답 `kind`는 `notifications.notification_type`과 같다. FE mock 별칭(`GROUP_RUN_CANCELED` 등)으로 저장·응답하지 않는다.

| kind | targetId | 설정 | 비고 |
|---|---|---|---|
| `GROUP_RUN_PARTICIPATION_CANCELLED` | `group_runs.id` | groupRun | G13 크루 멤버 대상. 참가 취소(G06)는 알림 없음 |
| `GROUP_RUN_START_REMINDER` | `group_runs.id` | groupRun | 발송 시각·횟수는 미정. 타입·무효화만 계약 |
| `CREW_JOIN_APPROVED` | `crews.id` | community | M06 승인 |
| `CREW_JOIN_REJECTED` | `crews.id` | community | M06 거절 |
| `CREW_JOIN_REQUESTED` | `crews.id` | community | M04 신청 성공(APPROVAL 크루, PENDING). 수신자는 크루장. INSTANT 크루는 알림 없음. 신청 철회(M13) 시 행 삭제 (S15P31E105-678) |
| `POST_COMMENT` | `posts.id` | community | CMT07. 본인 댓글은 자기 알림 제외 |
| `NEW_FOLLOWER` | 행위자 `users.id` | community | 공개 계정 즉시 팔로우. 249 Kind |
| `FOLLOW_REQUEST` | 행위자 `users.id` | community | 비공개 PENDING. 249 Kind |
| `FOLLOW_APPROVED` | 승인자 `users.id` | community | U25 수동 승인만. 공개 전환 자동 승인 제외. 249 Kind |
| `READINESS_TODAY` | `daily_readiness.id` | groupRun | 오늘 준비도 점수와 러닝 권유(S15P31E105-847). 아래 [오늘 준비도 발송](#오늘-준비도-발송). 앱은 targetId로 화면을 고르지 않고 홈 준비도를 연다 |

### 중복 방지

`notifications.dedupe_key` UNIQUE로 같은 논리 사건의 중복 행을 막는다. 충돌 시 기존 행을 유지하고 새로 삽입하지 않는다.
`CREW_JOIN_APPROVED`/`CREW_JOIN_REJECTED`는 신청자·크루·종류당 **생애 1회**다. 거절 후 재신청·재거절처럼 같은 쌍이 반복돼도 추가 행을 만들지 않는다.

| kind | dedupe_key 형식 |
|---|---|
| `NEW_FOLLOWER` / `FOLLOW_REQUEST` / `FOLLOW_APPROVED` | `{kind}:{requestId}` (`user_follows.id`) |
| `CREW_JOIN_APPROVED` / `CREW_JOIN_REJECTED` | `{kind}:{crewId}:{applicantUserId}` |
| `CREW_JOIN_REQUESTED` | `CREW_JOIN_REQUESTED:{crewId}:{applicantUserId}:{requested_at 마이크로초}` — 신청 1건당 1행이며 재신청은 `requested_at`이 갱신돼 새 행이 생긴다. M13 철회 시 같은 키의 행을 삭제한다 |
| `POST_COMMENT` | `POST_COMMENT:{commentId}` |
| `GROUP_RUN_PARTICIPATION_CANCELLED` | `GROUP_RUN_PARTICIPATION_CANCELLED:{groupRunId}:{recipientUserId}` |
| `GROUP_RUN_START_REMINDER` | `GROUP_RUN_START_REMINDER:{groupRunId}:{recipientUserId}:{scheduledSlot}` — slot 규칙은 발송 정책 확정 후 |
| `READINESS_TODAY` | `READINESS_TODAY:{userId}:{KST 날짜 yyyy-MM-dd}` — 회원·날짜당 1회. 점수가 다시 계산돼도 새 행을 만들지 않는다 |

### 오늘 준비도 발송

S15P31E105-847. 준비도 도메인이 공통 알림 모듈로 행을 만든다.

- **본문**: `오늘 준비도는 {점수}점입니다. 달리러 가볼까요?` 점수는 `daily_readiness.readiness_score`를 앱 2.1과 같이 소수 둘째 자리까지, 끝의 0을 지워 쓴다(예 `72.5`, `80`).
- **시각**: 매일 KST 08:00 정기 작업이 그 시각 오늘 결과가 있는 회원에게 보낸다. 08:00 이후 이벤트 평가가 오늘 결과를 처음 저장하면 그때 보낸다. 00:05 정기 평가 등 08:00 전에 저장된 결과는 08:00 작업이 보낸다(자정 발송 방지).
- **대상**: 오늘(KST) `daily_readiness` 행이 있는 활성·건강정보 동의 회원. 결과가 없으면 보내지 않는다. 설정·푸시 규칙은 다른 종류와 같다.
- **로그**: 회원 ID·날짜·예외 종류만 남기고 점수는 남기지 않는다.

### 팔로우 사건 소비

249 `FollowNotificationEvent`는 발행 트랜잭션과 **같은 트랜잭션**에서 소비·저장한다(`@EventListener`). `AFTER_COMMIT`으로 바꾸지 않는다. 공개 전환 자동 승인은 이벤트를 발행하지 않으므로 알림이 없다.

### 앱 밖 푸시(FCM)

S15P31E105-815, [ADR-0025](../../adr/0025-fcm-device-push.md). 현재 생성되는 위 종류는 모두 푸시 대상이다.

- **발송 시점**: 공통 알림 모듈이 행을 새로 넣으면 이벤트를 발행하고, 생성 트랜잭션 커밋 후(`AFTER_COMMIT`) 별도 발송 실행기가 FCM HTTP v1으로 보낸다. 위 팔로우 사건 소비 규칙(`@EventListener`)은 그대로이며 푸시 단계만 커밋 후다. 요청 응답은 푸시를 기다리지 않는다.
- **대상**: 수신자의 `push_device_tokens` 전부(회원당 최대 10개). 발송 직전 행이 없거나 `PENDING`이 아니면 보내지 않는다(예: 가입 신청 철회로 행 삭제).
- **내용**: 제목 `RunWay`, 본문 `message`, Android 채널 `runway_default`, data `{notificationId, kind, targetId}`(모두 문자열). 앱은 data로 알림함과 같은 화면을 연다.
- **결과 기록**: 1개 이상 성공이면 `SENT`·`sent_at=now()`, 토큰이 있었으나 모두 실패면 `FAILED`, 토큰이 없거나 서버 푸시가 꺼져 있으면(`BACKEND_PUSH_ENABLED=false`) `PENDING` 유지.
- **무효 토큰**: FCM `UNREGISTERED`·`INVALID_ARGUMENT`·`SENDER_ID_MISMATCH` 응답 토큰은 삭제한다. 그 밖의 실패(일시 오류·할당량)는 토큰을 유지한다. 자동 재시도·재전송 큐는 없다.
- **소유자 재확인**: 토큰마다 보내기 직전에 아직 수신자 소유인지 다시 확인한다. 발송 중 다른 계정으로 재등록(N03)되거나 해제·탈퇴로 지워진 기기에는 보내지 않는다. 남은 기기가 없으면 `PENDING`으로 둔다.
- **해제**: 앱은 로그아웃 전 N04로 토큰을 지우고 기기에서도 토큰을 삭제한다. 로그인 만료·다시 로그인처럼 로그아웃 없이 세션이 끝나면 N04 없이 기기 토큰만 삭제하며, 서버 행은 다음 발송에서 `UNREGISTERED`로 정리된다. 알림 권한을 거절하면 등록하지 않는다(이전 토큰은 N04). 탈퇴(U18)는 그 회원의 토큰을 모두 삭제한다.
- **장애 시**: FCM SDK 기본 재시도가 끝날 때까지 발송 스레드(2개)가 기다린다. 대기열(1000건)이 차면 그 푸시는 건너뛰고 행은 `PENDING`이다(ADR-0025 감수 사항).
- **로그**: 토큰은 앞 8자만, FCM 오류는 코드만 남긴다. 서비스 계정 키는 환경변수(`BACKEND_FCM_SERVICE_ACCOUNT_BASE64`)로만 주입한다.

### 생성과 조회 책임

| 책임 | 위치 |
|---|---|
| 사건 확정·이벤트/모듈 호출 | 각 도메인 서비스(팔로우·크루·커뮤니티·그룹런) |
| 설정 검사·dedupe·행 insert·푸시 이벤트 발행 | 공통 알림 모듈(458, 815) |
| 커밋 후 FCM 발송·결과 기록·무효 토큰 정리 | 알림 푸시 발송기(815) |
| 목록·읽음 | N01·N02 |
| 기기 토큰 등록·해제 | N03·N04 |

---

## N01 알림 목록

`GET` `/api/v1/notifications`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | [알림 정책](../requirements.md#알림-정책) |
| 관련 화면 | 2.9 알림 |
| 비고 | 2026-11-06 사용자 확정(S15P31E105-458). 페이지 형태는 확정된 U24 목록 패턴을 따른다 |

### 설명

로그인 사용자 본인에게 저장된 알림함 목록과 미읽음 개수를 반환한다.

### 인증 및 권한

- Access Token 회원만. 본인 `user_id` 행만 조회한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string | X | 서버 발급 불투명 커서 |
| `limit` | integer | X | 생략 시 20. 1~50만 허용. 그 외 400 `INVALID_FILTER` |

### Request Body

없음

### Response

`200 OK`

```json
{
  "items": [
    {
      "id": 9001,
      "kind": "FOLLOW_REQUEST",
      "message": "러너님의 팔로우 요청이 도착했습니다.",
      "createdAt": "2026-11-06T01:00:00Z",
      "read": false,
      "targetId": 101
    }
  ],
  "nextCursor": null,
  "hasNext": false,
  "unreadCount": 1
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 본인 알림 목록 |
| `items[].id` | integer (int64) | O | `notifications.id` |
| `items[].kind` | string | O | `notifications.notification_type` |
| `items[].message` | string | O | `notifications.message` (최대 100자) |
| `items[].createdAt` | string (ISO 8601 UTC) | O | `notifications.created_at` |
| `items[].read` | boolean | O | `read_at IS NOT NULL`이면 true |
| `items[].targetId` | integer (int64) | O | `notifications.target_id` |
| `nextCursor` | string / null | O | 다음 페이지 커서. 없으면 null |
| `hasNext` | boolean | O | 다음 페이지 존재 여부 |
| `unreadCount` | integer | O | 본인 알림 중 `read_at IS NULL` 개수(전체 기준, 현재 페이지와 무관) |

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `401 UNAUTHORIZED` | 인증 실패 |
| `400 INVALID_FILTER` | `limit`·`cursor` 형식/범위 오류 |

빈 목록은 200과 `items: []`, `unreadCount: 0`이다.

### 처리 규칙

- `created_at` 내림차순, 동률은 `id` 내림차순.
- `cursor`는 소유자·`created_at`·`id`를 인코딩한 불투명 문자열이다. 다른 사용자 커서·형식 오류는 400 `INVALID_FILTER`.
- 클릭 시 대상 존재·열람 권한은 알림 수신만으로 부여되지 않는다. 대상 API가 별도 검사한다.

### 페이지 처리

- U24와 같이 `nextCursor`/`hasNext`를 사용한다. 마지막 페이지는 `nextCursor=null`, `hasNext=false`.

---

## N02 알림 전체 읽음

`POST` `/api/v1/notifications/read-all`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | [알림 정책](../requirements.md#알림-정책) |
| 관련 화면 | 2.9 알림 |
| 비고 | 2026-11-06 사용자 확정(S15P31E105-458). 단건 읽음 API는 두지 않는다. 2026-11-13 `upToId` 추가(S15P31E105-801) |

### 설명

본인 알림 중 미읽음(`read_at IS NULL`)을 현재 시각으로 읽음 처리한다. `upToId`가 있으면 그 id 이하의 알림만 처리한다. 앱은 알림함(2.9)을 나갈 때 화면에 불러온 알림 중 가장 큰 id를 보내, 보는 사이 새로 생긴 알림이 미읽음으로 남게 한다.

### 인증 및 권한

- Access Token 회원만. 본인 행만 갱신한다.

### Path Parameters

없음

### Query Parameters

| 이름 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `upToId` | long | 아니오 | 이 id 이하의 본인 미읽음 알림만 읽음 처리한다. 1 이상의 정수. 없으면 본인 미읽음 전체 |

### Request Body

없음

### Response

`204 No Content`

이미 모두 읽음이어도 204다. 본문은 없다.

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | `upToId`가 1 미만이거나 정수가 아님 |
| `401 UNAUTHORIZED` | 인증 실패 |

### 처리 규칙

- `UPDATE notifications SET read_at = now() WHERE user_id = :me AND read_at IS NULL`(`upToId`가 있으면 `AND id <= :upToId`).
- `notifications.id`는 증가하는 IDENTITY라 "id 이하" = "그 알림까지 받은 것"이다. 다른 사용자의 id를 넣어도 `user_id = :me` 조건 때문에 본인 행만 바뀐다.
- 이미 `read_at`이 있는 행은 덮어쓰지 않는다.

---

## N03 푸시 토큰 등록

`PUT` `/api/v1/notifications/push-tokens`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | [알림 정책](../requirements.md#알림-정책) |
| 관련 화면 | 로그인 후 알림 권한 요청(앱 공통) |
| 비고 | 2026-11-14 S15P31E105-815 팀 합의, [ADR-0025](../../adr/0025-fcm-device-push.md) |

### 설명

이 기기의 FCM 등록 토큰을 로그인 사용자에게 연결한다. 앱은 로그인 상태에서 알림 권한이 허용되면 호출하고, 토큰이 갱신되면 다시 호출한다.

### 인증 및 권한

- Access Token 회원만.

### Request Body

```json
{ "token": "dXN...:APA91b...", "platform": "ANDROID" }
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `token` | string | O | FCM 등록 토큰. 1~512자, `A-Z a-z 0-9 _ : . -`만 |
| `platform` | string | O | `ANDROID`만 허용 |

### Response

`204 No Content`

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | 본문 누락·형식 오류, `token` 빈 값·길이·문자 위반, `platform`이 `ANDROID`가 아님 |
| `401 UNAUTHORIZED` | 인증 실패. 탈퇴가 커밋된 뒤 남은 JWT로 호출해 DB 쓰기 차단(`rw_active_owner`)에 걸림 |
| `503 SERVICE_UNAVAILABLE` | 저장소 일시 장애, 또는 진행 중인 탈퇴와 겹쳐 회원 행이 잠김(잠금 대기 없이 거절). 탈퇴가 끝나면 401 |

### 처리 규칙

- 같은 토큰이 이미 본인에게 있으면 `updated_at`만 갱신한다(멱등).
- 같은 토큰이 다른 회원에게 있으면 본인으로 소유자를 옮긴다(같은 기기에서 계정 전환). 이전 회원에게는 더 이상 푸시가 가지 않는다.
- 저장 후 본인 토큰이 10개를 넘으면 `updated_at`이 오래된 것부터 지워 10개만 남긴다.
- 탈퇴(진행) 회원의 등록은 저장되지 않는다(`rw_active_owner`, 위 401·503). 요청마다 계정 상태를 따로 조회하지 않는 [공통 인증 규약](README.md#인증-요청과-복구)을 따른다.

---

## N04 푸시 토큰 해제

`DELETE` `/api/v1/notifications/push-tokens`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | [알림 정책](../requirements.md#알림-정책) |
| 관련 화면 | 로그아웃, 알림 권한 거절 |
| 비고 | 2026-11-14 S15P31E105-815 팀 합의 |

### 설명

이 기기의 토큰을 본인에게서 해제한다. 앱은 로그아웃(U03) 직전에 호출한다. U03은 refresh token만 받으므로 토큰 해제를 대신하지 않는다.

### Request Body

```json
{ "token": "dXN...:APA91b..." }
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `token` | string | O | N03과 같은 형식 |

### Response

`204 No Content`

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `400 VALIDATION_ERROR` | 본문 누락·형식 오류 |
| `401 UNAUTHORIZED` | 인증 실패 |

### 처리 규칙

- 본인 소유 토큰만 삭제한다. 없는 토큰이나 다른 회원의 토큰이어도 204이며 아무것도 바꾸지 않는다(존재 여부를 드러내지 않음, 멱등).
- 호출이 실패해도 앱이 기기 토큰을 삭제하므로, 서버에 남은 토큰은 다음 발송에서 `UNREGISTERED`로 정리된다.
