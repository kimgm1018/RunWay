# 알림함 API

> **상태:** S15P31E105-458 사용자 확정(2026-11-06). **앱 내 알림함만** 다룬다. FCM 등 앱 밖 푸시는 포함하지 않는다. S10 SSE·G10 `loadAlert`와 채널을 공유하지 않는다.
>
> 발생 계기·수신자·제외 정책은 [알림 정책](../requirements.md#알림-정책)을 따른다. 저장 컬럼·종류 코드는 [ERD 알림](../db/erd.md#5-알림-종류와-화면-이동)을 따른다.

## API 목록

| ID | 제목 | Method | Path | 단계 | 인증 |
|---|---|---|---|---|---|
| [N01](#n01-알림-목록) | 알림 목록 | GET | `/notifications` | 1차 MVP | 회원 |
| [N02](#n02-알림-전체-읽음) | 알림 전체 읽음 | POST | `/notifications/read-all` | 1차 MVP | 회원 |

총 **2개** 공개 API. 공통 알림 **생성**은 공개 API가 아니며, 도메인 사건 트랜잭션 안에서 모듈 호출로 처리한다.

## 공통 규칙

### 채널과 설정

- 알림함 행 생성만 수행한다. 디바이스 푸시 토큰·FCM 전송은 없다.
- 설정 키는 기존 U19/U20만 사용한다. 팔로우·크루·댓글은 `notifications.community`, 그룹런 취소·시작 임박은 `notifications.groupRun`이다. 새 설정 컬럼은 추가하지 않는다.
- 해당 설정이 false이면 **행을 만들지 않는다**. 나중에 설정을 켜도 과거 사건은 소급 생성하지 않는다.
- `delivery_status`/`sent_at` 컬럼은 유지한다. 앱 내 저장이 확정되면 `SENT`와 `sent_at`을 채운다(푸시 전송 성공과 동의어가 아니다).

### 종류·대상

응답 `kind`는 `notifications.notification_type`과 같다. FE mock 별칭(`GROUP_RUN_CANCELED` 등)으로 저장·응답하지 않는다.

| kind | targetId | 설정 | 비고 |
|---|---|---|---|
| `GROUP_RUN_PARTICIPATION_CANCELLED` | `group_runs.id` | groupRun | G13 크루 멤버 대상. 참가 취소(G06)는 알림 없음 |
| `GROUP_RUN_START_REMINDER` | `group_runs.id` | groupRun | 발송 시각·횟수는 미정. 타입·무효화만 계약 |
| `CREW_JOIN_APPROVED` | `crews.id` | community | M06 승인 |
| `CREW_JOIN_REJECTED` | `crews.id` | community | M06 거절 |
| `POST_COMMENT` | `posts.id` | community | CMT07. 본인 댓글은 자기 알림 제외 |
| `NEW_FOLLOWER` | 행위자 `users.id` | community | 공개 계정 즉시 팔로우. 249 Kind |
| `FOLLOW_REQUEST` | 행위자 `users.id` | community | 비공개 PENDING. 249 Kind |
| `FOLLOW_APPROVED` | 승인자 `users.id` | community | U25 수동 승인만. 공개 전환 자동 승인 제외. 249 Kind |

### 중복 방지

`notifications.dedupe_key` UNIQUE로 같은 논리 사건의 중복 행을 막는다. 충돌 시 기존 행을 유지하고 새로 삽입하지 않는다.
`CREW_JOIN_APPROVED`/`CREW_JOIN_REJECTED`는 신청자·크루·종류당 **생애 1회**다. 거절 후 재신청·재거절처럼 같은 쌍이 반복돼도 추가 행을 만들지 않는다.

| kind | dedupe_key 형식 |
|---|---|
| `NEW_FOLLOWER` / `FOLLOW_REQUEST` / `FOLLOW_APPROVED` | `{kind}:{requestId}` (`user_follows.id`) |
| `CREW_JOIN_APPROVED` / `CREW_JOIN_REJECTED` | `{kind}:{crewId}:{applicantUserId}` |
| `POST_COMMENT` | `POST_COMMENT:{commentId}` |
| `GROUP_RUN_PARTICIPATION_CANCELLED` | `GROUP_RUN_PARTICIPATION_CANCELLED:{groupRunId}:{recipientUserId}` |
| `GROUP_RUN_START_REMINDER` | `GROUP_RUN_START_REMINDER:{groupRunId}:{recipientUserId}:{scheduledSlot}` — slot 규칙은 발송 정책 확정 후 |

### 팔로우 사건 소비

249 `FollowNotificationEvent`는 발행 트랜잭션과 **같은 트랜잭션**에서 소비·저장한다(`@EventListener`). `AFTER_COMMIT`으로 바꾸지 않는다. 공개 전환 자동 승인은 이벤트를 발행하지 않으므로 알림이 없다.

### 생성과 조회 책임

| 책임 | 위치 |
|---|---|
| 사건 확정·이벤트/모듈 호출 | 각 도메인 서비스(팔로우·크루·커뮤니티·그룹런) |
| 설정 검사·dedupe·행 insert | 공통 알림 모듈(458) |
| 목록·읽음 | N01·N02 |

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
| 비고 | 2026-11-06 사용자 확정(S15P31E105-458). 단건 읽음 API는 두지 않는다 |

### 설명

본인 알림 중 미읽음(`read_at IS NULL`)을 모두 현재 시각으로 읽음 처리한다.

### 인증 및 권한

- Access Token 회원만. 본인 행만 갱신한다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

없음

### Response

`204 No Content`

이미 모두 읽음이어도 204다. 본문은 없다.

### 오류 응답

| HTTP·코드 | 발생 조건 |
|---|---|
| `401 UNAUTHORIZED` | 인증 실패 |

### 처리 규칙

- `UPDATE notifications SET read_at = now() WHERE user_id = :me AND read_at IS NULL`.
- 이미 `read_at`이 있는 행은 덮어쓰지 않는다.
