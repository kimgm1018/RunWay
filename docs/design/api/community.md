# API 명세 — 커뮤니티

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [CMT01](#cmt01-게시물-작성) | 게시물 작성 | POST | `/posts` | 1차 MVP | 회원 |
| [CMT02](#cmt02-게시물-목록) | 게시물 목록 | GET | `/posts` | 1차 MVP | 회원 |
| [CMT03](#cmt03-게시물-상세) | 게시물 상세 | GET | `/posts/{postId}` | 1차 MVP | 회원 |
| [CMT04](#cmt04-게시물-수정) | 게시물 수정 | PATCH | `/posts/{postId}` | 1차 MVP | 회원 |
| [CMT05](#cmt05-게시물-삭제) | 게시물 삭제 | DELETE | `/posts/{postId}` | 1차 MVP | 회원 |
| [CMT06](#cmt06-댓글-목록) | 댓글 목록 | GET | `/posts/{postId}/comments` | 1차 MVP | 회원 |
| [CMT07](#cmt07-댓글-작성) | 댓글 작성 | POST | `/posts/{postId}/comments` | 1차 MVP | 회원 |
| [CMT08](#cmt08-댓글-수정) | 댓글 수정 | PATCH | `/comments/{commentId}` | 1차 MVP | 회원 |
| [CMT09](#cmt09-댓글-삭제) | 댓글 삭제 | DELETE | `/comments/{commentId}` | 1차 MVP | 회원 |
| [CMT10](#cmt10-반응-등록변경) | 반응 등록·변경 | PUT | `/posts/{postId}/reactions/me` | 1차 MVP | 회원 |
| [CMT11](#cmt11-반응-취소) | 반응 취소 | DELETE | `/posts/{postId}/reactions/me` | 1차 MVP | 회원 |
| [CMT12](#cmt12-커뮤니티-지역-목록) | 커뮤니티 지역 목록 | GET | `/regions` | 1차 MVP | 회원 |
| [CMT13](#cmt13-통합-검색) | 통합 검색 | GET | `/search` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

posts는 author_id와 필수 session_id를 가진다. courseId는 posts 컬럼이 아니라 posts.session_id → running_sessions.course_id에서 조회하며 자유러닝은 null이다. 댓글은 comments.parent_comment_id로 연결하고 좋아요는 post_likes 관계로 표현한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 운동 기록과 공유 게시물의 삭제

운동 기록 삭제는 [S09](sessions.md#s09-러닝-세션-삭제)를 따른다. 앱은 연결된 공유 게시물도 함께 삭제됨을 안내하며, 서버는 해당 세션과 본인 게시물을 한 트랜잭션에서 삭제 표시한다. 사용자가 CMT05를 별도로 먼저 호출할 필요는 없다. 반대로 CMT05로 게시물만 삭제하면 운동 기록은 유지한다.

삭제된 게시물은 목록·검색·상세에서 제외한다. 댓글·좋아요 행은 보존하되 부모 게시물이 삭제됐으면 조회·추가·변경 요청을 POST_NOT_FOUND로 거절한다. 댓글·좋아요 쓰기는 부모 게시물을 잠그고 미삭제를 재검사한 뒤 처리하며 게시물→댓글/좋아요 순서를 유지한다. 삭제가 먼저 확정됐으면 후속 쓰기는 거절하고, 쓰기가 먼저면 이후 부모 삭제로 접근을 차단한다. 이미 화면에 표시된 내용은 다음 조회·갱신에서 제거한다.

S09와 새 게시물 생성은 세션→게시물 순서로 잠가 함께 처리한다. CMT01은 세션 잠금 아래 미삭제 여부를 확인하고 게시물을 생성한다. 기존 구현의 일반 조회만으로 이 경합이 검증됐다고 보지 않으며, 실제 잠금 반영·통합 검증은 후속 구현 대상이다.

## CMT01 게시물 작성

`POST` `/api/v1/posts`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 화면 | 7.3 글쓰기, 4.5 '기록 공유', 6.7 '커뮤니티에 공유' (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 완료 러닝 세션(`sessionId`)을 게시물로 공유한다. 세션 소유권·COMPLETED 상태 검증과 `body` 저장은 **구현됨**. `title`·`imageId` 저장과 `imageUrl` 응답은 명세에 두되 **미구현**이다.

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
| `title` | string | X | **미구현** — 요청에 포함해도 `posts`에 컬럼이 없어 저장하지 않음 |
| `body` | string / null | O | `posts.body`에 저장. NULL·생략 허용 |
| `sessionId` | integer (int64) | O | 본인의 공유할 완료 러닝 세션 BIGINT 식별자 |
| `imageId` | string (UUID) | X | 결과 화면 사진([F01](files.md#f01-이미지-업로드)). **미구현** — 받아도 저장·검증하지 않음 |

```json
{
  "sessionId": 101,
  "body": "오늘 5km를 달렸어요."
}
```

### Response

`201 Created (제안)`

```json
{
  "id": 101,
  "body": "오늘 5km를 달렸어요.",
  "authorId": 101,
  "sessionId": 101,
  "courseId": 101,
  "createdAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | X | **미구현** — `posts`에 컬럼 없음. 응답에 포함하지 않음 |
| `body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `authorId` | integer (int64) | O | `posts.author_id` (BIGINT). 저장 값은 NULL 불가. 호출자(`X-User-Id`)로 설정 |
| `sessionId` | integer (int64) | O | `posts.session_id` (BIGINT). 저장 값은 NULL 불가. |
| `courseId` | integer (int64) / null | X | 연결 세션의 `course_id` 파생값. 자유러닝은 null. 쓰기 입력이 아님 |
| `createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

생성 게시물 ID로 상세 이동하고 저장한 본문·연결 세션을 확인한다. `courseId`는 쓰기 입력이 아닌 연결 세션의 읽기 전용 파생값이다.

기능상 필요한 응답 필드 보완안(후속·미구현):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `imageUrl` | string / null | O | **미구현** — 게시물 업로드 이미지 표시 참조. image_key URL 매핑 후속 |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 RESOURCE_NOT_OWNED` | 소유권 | 공유 세션이 호출자 소유가 아님 |
| `422 INVALID_POST` | 입력/참조 | 세션이 없거나 COMPLETED가 아님. 게시물로 공유할 수 없는 상태 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.
- `imageId`는 현재 저장·검증하지 않으므로 `INVALID_IMAGE_REFERENCE` 후보는 이미지 연동 구현 전까지 적용하지 않는다.

### 처리 규칙

- 새 글은 4.5 러닝 결과·6.7 그룹런 결과의 '기록 공유'에서만 쓰며 `sessionId`는 필수다. 모든 게시물은 러닝 기록 공유이므로 별도의 게시물 유형 필드를 사용하지 않는다.
- 세션은 호출자 소유이고 상태가 COMPLETED여야 한다. 아니면 `403 RESOURCE_NOT_OWNED` 또는 `422 INVALID_POST`.
- 공유 생성과 기록 삭제의 경합은 [공통 삭제 규칙](#운동-기록과-공유-게시물의-삭제)을 따른다. 세션 잠금 아래 미삭제·소유권·COMPLETED를 재검사하고 게시물 생성까지 같은 트랜잭션에서 처리한다.
- `title`·`imageId`는 요청에 포함해도 되며 null/생략 가능하나 **현재 저장·검증하지 않는다**.
- 코스 공유 선택·해제 요청은 없다. 공유한 세션에 코스가 있으면 응답 `courseId`는 그 세션의 코스를 참조하며 자유러닝은 null이다.
- 게시물별·연결 러닝 기록별 공개 설정은 없다. 공개(PUBLIC) 계정의 게시물은 전체에, 비공개(PRIVATE) 계정은 본인·승인된 팔로워에게만 제공한다. 대기 요청자는 접근할 수 없다.
- 원본 H02 조회 권한을 타인에게 부여하지 않고 공유 표시용 요약만 제공한다. 경로 그림(`routePreview`)은 **미구현**.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `title` 저장 컬럼·응답 형식
- [ ] `imageId`/`imageUrl` 연동(업로드·키 매핑)
- [ ] 결과 사진을 클라이언트 캡처 업로드로 받을지 서버에서 생성할지
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거

## CMT02 게시물 목록

`GET` `/api/v1/posts`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 화면 | 7.1 커뮤니티, 7.1D 다크, 2.P 커뮤니티 탭 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

삭제되지 않은 게시물만 반환한다. 작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 접근을 제한한다. 이번 구현 필터는 `scope`·`authorId`다. `regionCode`·`cursor`·`limit`는 명세에 유지하되 **미구현**이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `regionCode` | string | X | 도시 코드(부산·서울 등). **미구현** — 받아도 필터하지 않음 |
| `scope` | string | X | `ALL` \| `FOLLOWING`. 기본값 `ALL`. FOLLOWING은 승인된 팔로우 대상 글 + **본인 글** 포함 |
| `authorId` | integer (int64) | X | 특정 러너의 글만. 접근 가능한 게시물에만 적용 |
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
      "id": 101,
      "authorId": 101,
      "sessionId": 101,
      "body": null,
      "regionCode": null,
      "createdAt": "2026-10-24T09:00:00Z",
      "author": {
        "userId": 101,
        "nickname": "러너"
      },
      "recordSummary": {
        "distanceM": 5000,
        "movingDurationSec": 1800,
        "averagePaceSecPerKm": 360
      }
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 접근 가능한 기록 공유 게시물 요약 목록 |
| `page` | string / object (확인 필요) | X | **미구현** — cursor/limit 페이지 메타. 현재 응답에 포함하지 않음 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].authorId` | integer (int64) | O | `posts.author_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].sessionId` | integer (int64) | O | `posts.session_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].imageKey` | string / null | X | `posts.image_key`. **미구현** — 이미지 연동 전까지 응답에 의존하지 않음 |
| `items[].regionCode` | string / null | O | `posts.region_code` (VARCHAR(40)). NULL 허용. 목록 필터로는 미사용 |
| `items[].createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

피드에는 게시물 ID·작성자 표시·본문·공유 기록요약이 필요하다. `imageKey`를 그대로 공개 URL로 사용하지 않는다.

표시·선택·후속 이동에 필요한 필드(구현/미구현 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].author` | object | O | 최소 표시용 작성자 정보. 비공개 접근 검사 후 제공 |
| `items[].recordSummary` | object | O | 연결 세션에서 파생한 표시용 요약(거리·이동시간·평균 페이스). 원본 GPS 미포함 |
| `items[].imageUrl` | string / null | X | **미구현** |
| `items[].commentCount` | number | X | **미구현** |
| `items[].reactionCount` | number | X | **미구현** |
| `items[].myReaction` | string / object (확인 필요) | X | **미구현** |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_FILTER` | 검색 조건 | `scope` 등 허용값/형식이 맞지 않음 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- `deleted_at`이 설정된 게시물은 제외한다.
- 공개(PUBLIC) 작성자 글은 전체에, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워에게만 노출한다. 대기·거절·역방향 관계는 접근할 수 없다.
- 이번 구현 필터: `scope`(`ALL` 기본, `FOLLOWING`), `authorId`. `FOLLOWING`에는 승인된 팔로우 대상 글과 **본인 글**을 포함한다.
- `regionCode`·`cursor`·`limit`는 명세에 두되 **미구현**. 서버는 이 파라미터로 필터·페이징하지 않는다.
- `recordSummary`는 연결 세션에서 파생한다. `imageUrl`·`commentCount`·`reactionCount`·`myReaction`·경로 그림은 **미구현**.
- 원본 H02 조회 권한을 타인에게 부여하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `regionCode` 필터 구현
- [ ] `cursor`/`limit` 등 공통 페이지 형식
- [ ] `imageUrl`·`commentCount`·`reactionCount`·`myReaction` 응답
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT03 게시물 상세

`GET` `/api/v1/posts/{postId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 접근을 검사한다. 본문·세션 파생 `courseId`·`recordSummary`는 **구현됨**. `title`·`imageUrl`·`routePreviewImageUrl`·`commentCount`·`reactionCount`·`myReaction`은 명세에 두되 **미구현**이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "body": null,
  "authorId": 101,
  "sessionId": 101,
  "courseId": 101,
  "createdAt": "2026-10-24T09:00:00Z",
  "updatedAt": "2026-10-24T09:00:00Z",
  "author": {
    "userId": 101,
    "nickname": "러너"
  },
  "recordSummary": {
    "distanceM": 5000,
    "movingDurationSec": 1800,
    "averagePaceSecPerKm": 360
  }
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | X | **미구현** — `posts`에 컬럼 없음. 응답에 포함하지 않음 |
| `body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `authorId` | integer (int64) | O | `posts.author_id` (BIGINT). 저장 값은 NULL 불가. |
| `routePreviewImageUrl` | string / null (제안) | X | **미구현** — 경로 표시용 이미지 참조. 원본 GPS로 대체하지 않음 |
| `sessionId` | integer (int64) | O | `posts.session_id` (BIGINT). 저장 값은 NULL 불가. |
| `courseId` | integer (int64) / null | X | 연결 세션의 `course_id` 파생값. 자유러닝은 null |
| `createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `updatedAt` | string (ISO 8601 UTC) | O | `posts.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `reactionCount` | number | X | **미구현** |
| `commentCount` | number | X | **미구현** |
| `myReaction` | string / object (확인 필요) | X | **미구현** |

**사용 흐름과 응답 판단**

상세는 작성자 표시·기록요약·본문을 제공한다. `sessionId`를 타인 원본 기록 접근 권한으로 해석하지 않는다.

표시·선택·후속 이동에 필요한 필드(구현/미구현 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `author` | object | O | 작성자 최소 표시 정보 |
| `recordSummary` | object | O | 연결 세션에서 파생한 표시요약. 원본 GPS 미포함 |
| `imageUrl` | string / null | X | **미구현** — 게시물 업로드 이미지 표시 참조 |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 `deleted_at`이 설정됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 작성자가 PRIVATE이고 열람자가 본인·승인된 정방향 팔로워가 아님. 미승인/역방향 관계 제외 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제와 공개 범위 거부를 구분한다. `404 POST_NOT_FOUND`와 `403 ACCOUNT_ACCESS_DENIED`를 사용한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- `deleted_at`이 설정된 게시물은 `404 POST_NOT_FOUND`.
- 공개(PUBLIC) 작성자 글은 전체에, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워만 열람한다. 그 외는 `403 ACCOUNT_ACCESS_DENIED`.
- `recordSummary`는 연결 세션에서 파생한다. `title`·`imageUrl`·`routePreviewImageUrl`·`commentCount`·`reactionCount`·`myReaction`은 **미구현**.
- 원본 H02 조회 권한을 타인에게 부여하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `title`·`imageUrl`·`routePreviewImageUrl` 응답
- [ ] `commentCount`·`reactionCount`·`myReaction` 응답
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT04 게시물 수정

`PATCH` `/api/v1/posts/{postId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 화면 | 7.2b 게시물 메뉴, 7.3e 게시물 수정 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 글의 `body`만 수정한다. `title` 저장은 **미구현**이며, 연결 세션·코스는 수정하지 않는다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `title` | string | X | **미구현** — 요청에 포함해도 저장하지 않음 |
| `body` | string / null | X | `posts.body` 수정. 생략 시 기존 값 유지(부분 수정) |

```json
{
  "body": "오늘 5km를 달렸어요."
}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "body": "오늘 5km를 달렸어요.",
  "updatedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | X | **미구현** — 응답에 포함하지 않음 |
| `body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `updatedAt` | string (ISO 8601 UTC) | O | `posts.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

수정 후 저장된 `body`·`updatedAt`을 돌려주거나 상세 재조회로 복원한다. 연결 세션·코스는 수정하지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_AUTHOR` | 소유권 | 게시물 작성자가 아닌 사용자의 수정 요청 |
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 `deleted_at`이 설정됨 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 부재/삭제(`404 POST_NOT_FOUND`)와 비작성자(`403 NOT_AUTHOR`)를 구분한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다.

**응답·복구 행동과의 연결:** 게시물 수정은 허용된 `body`에만 적용한다. `courseId` 입력을 받지 않으며 코스 공유 해제나 원본 러닝 세션 변경을 수행하지 않는다. `title`·이미지는 현재 저장하지 않는다.

### 처리 규칙

- 본인 글만 수정. 비작성자 → `403 NOT_AUTHOR`. 삭제된 글 → `404 POST_NOT_FOUND`.
- `title`은 요청에 포함해도 **저장하지 않는다**(미구현).
- 연결 `sessionId`·`courseId`는 수정하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `title` 저장·응답
- [ ] 이미지 교체 필드 연동
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT05 게시물 삭제

`DELETE` `/api/v1/posts/{postId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 화면 | 7.2b 게시물 메뉴, 7.2c 게시물 삭제 확인 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 글을 `posts.deleted_at`에 시각을 기록하는 soft delete로 처리한다. 물리 삭제는 하지 않는다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "deletedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `deletedAt` | string (ISO 8601 UTC) | O | `posts.deleted_at` (TIMESTAMPTZ). soft delete 시각 |

**사용 흐름과 응답 판단**

삭제 성공은 `deletedAt`으로 피드에서 행을 제거한다. 삭제된 글의 재삭제는 아래 POST_NOT_FOUND를 따른다. 댓글·좋아요 접근은 [공유 게시물 삭제 규칙](#운동-기록과-공유-게시물의-삭제)을 따른다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_AUTHOR` | 소유권 | 게시물 작성자가 아닌 사용자의 삭제 요청 |
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 이미 `deleted_at`이 설정됨 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 부재/이미 삭제(`404 POST_NOT_FOUND`)와 비작성자(`403 NOT_AUTHOR`)를 구분한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다.

### 처리 규칙

- 본인 글만 soft delete. `posts.deleted_at`에 시각을 기록한다. 비작성자 → `403 NOT_AUTHOR`. 없거나 이미 삭제됨 → `404 POST_NOT_FOUND`.
- 목록·상세에서는 `deleted_at`이 있는 글을 제외하거나 `404`로 응답한다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- 재삭제 404와 삭제된 부모 게시물의 댓글·좋아요 접근 차단은 위 공통 삭제 규칙으로 확정했다.
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT06 댓글 목록

`GET` `/api/v1/posts/{postId}/comments`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

삭제되지 않은 댓글을 평면(`flat`) `items`로 반환한다. 게시물 접근은 상세(CMT03)와 동일하게 작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 검사한다. `cursor`·`limit`·`page`는 명세에 유지하되 **미구현**이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
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
      "id": 101,
      "postId": 101,
      "authorId": 101,
      "parentCommentId": null,
      "body": "함께 달린 기록",
      "createdAt": "2026-10-24T09:00:00Z"
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 접근 가능한 게시물의 삭제되지 않은 댓글 목록(평면) |
| `page` | string / object (확인 필요) | X | **미구현** — cursor/limit 페이지 메타. 현재 응답에 포함하지 않음 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `comments.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].postId` | integer (int64) | O | `comments.post_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].authorId` | integer (int64) | O | `comments.author_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].parentCommentId` | integer (int64) / null | O | `comments.parent_comment_id` (BIGINT). NULL이면 루트 댓글. NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].body` | string | O | `comments.body` (TEXT). 저장 값은 NULL 불가. |
| `items[].createdAt` | string (ISO 8601 UTC) | O | `comments.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

댓글 ID·부모 ID·작성자·본문·시각으로 목록을 표시한다. 서버는 평면 목록을 반환하며, 트리 구성은 클라이언트가 `parentCommentId`로 한다. 댓글이 0건이면 빈 `items`다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 `deleted_at`이 설정됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 작성자가 PRIVATE이고 열람자가 본인·승인된 정방향 팔로워가 아님. 미승인/역방향 관계 제외 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제와 공개 범위 거부를 구분한다. `404 POST_NOT_FOUND`와 `403 ACCOUNT_ACCESS_DENIED`를 사용한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- `deleted_at`이 설정된 댓글은 제외한다.
- 게시물 접근은 CMT03과 같다. 공개(PUBLIC) 작성자 글은 전체에, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워만 열람한다. 없거나 삭제된 게시물 → `404 POST_NOT_FOUND`. 그 외 접근 거부 → `403 ACCOUNT_ACCESS_DENIED`.
- `cursor`·`limit`·`page`는 명세에 두되 **미구현**. 서버는 이 파라미터로 페이징하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물·댓글 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `cursor`/`limit`/`page` 등 공통 페이지 형식
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT07 댓글 작성

`POST` `/api/v1/posts/{postId}/comments`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

접근 가능한 게시물에 댓글을 작성한다. `body`는 필수·비공백이며, 선택 `parentCommentId`로 루트 댓글에만 1단계 대댓글을 달 수 있다. 게시물 작성자 대상 알림 연계는 **미구현**이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `body` | string | O | `comments.body`에 저장. 비어 있거나 공백만이면 `422 EMPTY_COMMENT` |
| `parentCommentId` | integer (int64) | X | 대댓글 대상 부모. 생략·null이면 루트 댓글. 같은 게시물·미삭제·루트(`parent_comment_id` NULL)만 허용. 아니면 `422 INVALID_PARENT_COMMENT` |

```json
{
  "body": "오늘 5km를 달렸어요.",
  "parentCommentId": null
}
```

### Response

`201 Created (제안)`

```json
{
  "id": 101,
  "postId": 101,
  "authorId": 101,
  "parentCommentId": null,
  "body": "오늘 5km를 달렸어요.",
  "createdAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `comments.id` (BIGINT). 저장 값은 NULL 불가. |
| `postId` | integer (int64) | O | `comments.post_id` (BIGINT). 저장 값은 NULL 불가. |
| `authorId` | integer (int64) | O | `comments.author_id` (BIGINT). 저장 값은 NULL 불가. 호출자(`X-User-Id`)로 설정 |
| `parentCommentId` | integer (int64) / null | O | `comments.parent_comment_id` (BIGINT). NULL이면 루트 댓글 |
| `body` | string | O | `comments.body` (TEXT). 저장 값은 NULL 불가. |
| `createdAt` | string (ISO 8601 UTC) | O | `comments.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

작성 후 댓글을 바로 붙일 수 있는 ID·부모 ID·본문·작성자·시각을 반환한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 EMPTY_COMMENT` | 입력 값 | `body`가 비어 있거나 공백만임 |
| `422 INVALID_PARENT_COMMENT` | 입력/참조 | `parentCommentId`가 없거나 삭제됨·다른 게시물·루트가 아님(대댓글에 대댓글 등 1단계 초과) |
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 `deleted_at`이 설정됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 작성자가 PRIVATE이고 호출자가 본인·승인된 정방향 팔로워가 아님 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 부재/삭제(`404 POST_NOT_FOUND`)와 공개 범위 거부(`403 ACCOUNT_ACCESS_DENIED`)를 구분한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다.

### 처리 규칙

- 게시물 접근은 CMT03·CMT06과 같다. 공개(PUBLIC)는 전체, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워만 작성할 수 있다.
- `body`는 필수이며 공백만이면 `422 EMPTY_COMMENT`.
- `parentCommentId`가 있으면 같은 게시물·미삭제·루트 댓글이어야 한다. 아니면 `422 INVALID_PARENT_COMMENT`. 대댓글은 1단계만 허용한다.
- 게시물 작성자 대상 댓글 알림은 **미구현**.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] 댓글 알림 연계
- [ ] `body` 최대 길이 등 추가 제한
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT08 댓글 수정

`PATCH` `/api/v1/comments/{commentId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 댓글의 `body`만 수정한다. 비어 있거나 공백만인 `body`는 `422 EMPTY_COMMENT`다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | `comments.id` |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `body` | string | O | `comments.body` 수정. 비어 있거나 공백만이면 `422 EMPTY_COMMENT` |

```json
{
  "body": "오늘 5km를 달렸어요."
}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "body": "오늘 5km를 달렸어요.",
  "updatedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `comments.id` (BIGINT). 저장 값은 NULL 불가. |
| `body` | string | O | `comments.body` (TEXT). 저장 값은 NULL 불가. |
| `updatedAt` | string (ISO 8601 UTC) | O | `comments.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

수정된 댓글 ID·본문·`updatedAt`으로 해당 행만 갱신한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `422 EMPTY_COMMENT` | 입력 값 | `body`가 비어 있거나 공백만임 |
| `403 NOT_AUTHOR` | 소유권 | 댓글 작성자가 아닌 사용자의 수정 요청 |
| `404 COMMENT_NOT_FOUND` | 대상 없음 | 댓글이 없거나 `deleted_at`이 설정됨 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 부재/삭제(`404 COMMENT_NOT_FOUND`)와 비작성자(`403 NOT_AUTHOR`)를 구분한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다.

### 처리 규칙

- 본인 댓글만 수정. 비작성자 → `403 NOT_AUTHOR`. 없거나 삭제됨 → `404 COMMENT_NOT_FOUND`.
- `body`만 수정한다. 공백만이면 `422 EMPTY_COMMENT`.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 댓글 삭제 상태(`deleted_at`)를 적용한다. 삭제된 댓글은 수정할 수 없다.

### 미정 사항

- [ ] `body` 최대 길이 등 추가 제한
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT09 댓글 삭제

`DELETE` `/api/v1/comments/{commentId}`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

본인 댓글을 `comments.deleted_at`에 시각을 기록하는 soft delete로 처리한다. 물리 삭제는 하지 않는다. 응답은 `deletedAt`이다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | `comments.id` |

### Query Parameters

없음

### Request Body

없음


### Response

`200 OK (제안)`

```json
{
  "deletedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `deletedAt` | string (ISO 8601 UTC) | O | `comments.deleted_at` (TIMESTAMPTZ). soft delete 시각 |

**사용 흐름과 응답 판단**

삭제 성공은 `deletedAt`으로 화면에서 행을 제거한다. 재삭제·부모/대댓글 후속 처리는 별도 결정한다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 NOT_AUTHOR` | 소유권 | 댓글 작성자가 아닌 사용자의 삭제 요청 |
| `404 COMMENT_NOT_FOUND` | 대상 없음 | 댓글이 없거나 이미 `deleted_at`이 설정됨 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- **대상 없음·접근 차단 점검:** 부재/이미 삭제(`404 COMMENT_NOT_FOUND`)와 비작성자(`403 NOT_AUTHOR`)를 구분한다.
- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다.

### 처리 규칙

- 본인 댓글만 soft delete. `comments.deleted_at`에 시각을 기록한다. 비작성자 → `403 NOT_AUTHOR`. 없거나 이미 삭제됨 → `404 COMMENT_NOT_FOUND`.
- 목록에서는 `deleted_at`이 있는 댓글을 제외한다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 댓글 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] 재삭제·부모/대댓글 후속 처리 정책
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 인증 수단을 토큰으로 교체할 때 `X-User-Id` 제거


## CMT10 반응 등록·변경

`PUT` `/api/v1/posts/{postId}/reactions/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

사용자당 게시물 반응 1개, LIKE 타입.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `reactionType` | string (제안) | O | LIKE |

```json
{
  "reactionType": "LIKE"
}
```

### Response

`200 OK (제안)`

```json
{
  "postId": 101,
  "userId": 101
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `post_likes.post_id` (BIGINT). 저장 값은 NULL 불가. |
| `userId` | integer (int64) | O | `post_likes.user_id` (BIGINT). 저장 값은 NULL 불가. |
| `reactionType` | string (제안) | X | post_likes 행 존재로 LIKE를 표현한다. 별도 반응 유형 컬럼은 없다. |


**사용 흐름과 응답 판단**

LIKE 적용 후 본인 반응과 최신 집계로 버튼·숫자를 갱신한다. 동시 좋아요 수는 응답 시점 값이다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 삭제됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `403 ACCOUNT_ACCESS_DENIED` | 접근 불가 게시물에 반응 등록 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 게시물별·연결 러닝 기록별 공개 설정은 없다. 공개 계정의 게시물은 전체에, 비공개 계정은 본인·승인된 팔로워에게만 제공한다. 대기 요청자는 접근할 수 없다.
- 목록·상세·연결 이미지·댓글·반응 등 관련 접근에서도 작성자 계정 정책을 검증한다. 원본 H02 조회 권한을 타인에게 부여하지 않고 공유 표시용 요약·경로 그림만 제공한다.

- 사용자당 게시물 반응 1개, LIKE 타입.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태를 적용한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## CMT11 반응 취소

`DELETE` `/api/v1/posts/{postId}/reactions/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 있음 |
| 비고 | API 요청/응답 필드와 값 제한은 검토용 제안 |

### 설명

기존 반응 없어도 성공 가능한 멱등 처리.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | ERD 및 화면 요구사항을 기준으로 확정 필요 |

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
| `reacted` | boolean | X | 저장 컬럼과 직접 대응하지 않는 응답 값. 산출·표시 구조 확인 필요 (ERD만으로 응답 형식을 확정하지 않음.) |


**사용 흐름과 응답 판단**

반응이 원래 없어도 reacted=false 성공이다. 관계 없음 자체를 충돌 오류로 만들지 않는다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 삭제됨 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

**추가 오류 후보 — HTTP·코드·판정 정책 확인 필요**

| 후보 | 발생 가능 상황 |
|---|---|
| `403 ACCOUNT_ACCESS_DENIED` | 공개 설정 변경 후 반응 취소의 접근 처리 정책 확인 |

- **대상 없음·접근 차단 점검:** 경로 대상의 부재/삭제, 본인 소유·역할·참가 자격 불충족을 구분한다. 위 표에 없는 경우 `404` 자원 없음 또는 `403` 접근 거부의 추가 매핑을 확인한다. 존재 은닉을 위한 403/404 선택·검사 순서는 미정이며 새 코드로 단정하지 않는다.

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.

### 처리 규칙

- 기존 반응 없어도 성공 가능한 멱등 처리.
- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태를 적용한다.

### 미정 사항

- [ ] 요청·응답의 세부 필드 타입, 허용 범위, nullable 규칙 및 실제 JSON 구조 검토
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
- [ ] 접근 권한과 데이터 정합성의 구체적인 처리 조건 확정


## CMT12 커뮤니티 지역 목록

`GET` `/api/v1/regions`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001 |
| 관련 화면 | 7.1 커뮤니티 '부산 ▾' 도시 선택 시트 (화면 설계 v10) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

커뮤니티 피드 필터에 쓰는 도시 목록을 조회한다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `latitude` | number | X | 현재 위치 위도. 내 위치 도시를 기본 선택으로 표시 |
| `longitude` | number | X | 현재 위치 경도 |

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "items": [
    {
      "regionCode": "26350",
      "sidoName": "부산광역시",
      "sigunguName": "해운대구"
    }
  ]
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | X | 지역 코드·이름 |
| `currentRegionCode` | string / null | X | 현재 위치의 도시 코드 (ERD만으로 응답 형식을 확정하지 않음.) |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].regionCode` | string | O | `regions.region_code` (VARCHAR(40) UNIQUE). 저장 값은 NULL 불가. |
| `items[].sidoName` | string | O | `regions.sido_name` (VARCHAR(100)). 저장 값은 NULL 불가. |
| `items[].sigunguName` | string | O | `regions.sigungu_name` (VARCHAR(100)). 저장 값은 NULL 불가. |


**사용 흐름과 응답 판단**

지역코드·시도/시군구 표시명을 제공한다. 위치 입력 없는 요청에서 currentRegionCode를 계산하려면 별도 근거가 필요하며 미판정은 null이다.

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] 지역 목록을 클라이언트 상수로 둘지 API로 둘지
- [ ] 게시물의 지역을 작성 위치·연결 코스 위치 중 무엇으로 정할지
- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정


## CMT13 통합 검색

`GET` `/api/v1/search`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-004 / MAT-003 / CRS-005 |
| 관련 화면 | 7.1D·2.P 검색 — 러너·크루만(사용자 수정 결정 우선) |
| 미정 사항 | 있음 |
| 비고 | 화면 설계 v10 대조로 추가. 응답 형식은 ERD 확정 후 갱신 |

### 설명

러너·크루를 검색한다. 이름 없는 공용 코스는 C01 조건 필터로 찾는다.

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `q` | string | O | 검색어 |
| `type` | string | X | USER/CREW. 생략 시 러너와 크루를 함께 조회 |
| `cursor` | string / object (확인 필요) | X | 서버 발급 불투명 페이지 커서. 생략하면 첫 묶음 |
| `limit` | number | X | 각 목록의 최대 개수. 상한 미정 |

### Request Body

없음

### Response

`200 OK (제안)`

```json
{
  "users": [
    {
      "userId": 101,
      "nickname": "러너"
    }
  ],
  "crews": [
    {
      "id": 201,
      "name": "러닝 크루"
    }
  ]
}
```

응답 필드 정의(ERD ver.3 대조):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `users` | array | X | 러너 검색 결과. `type=CREW`이면 생략 |
| `crews` | array | X | 크루 검색 결과. `type=USER`이면 생략 |
| `page` | string / null | X | 다음 요청의 `cursor`. 더 없으면 생략 또는 null |

**사용 흐름과 응답 판단**

검색 결과에서 러너 프로필과 크루 상세로 이동할 수 있어야 한다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `users[].userId` | integer (int64) | O | 선택 시 U21로 이동할 회원 ID. |
| `users[].nickname` | string | O | 러너 표시명. 비공개여도 검색용 최소 식별로 노출 가능. |
| `crews[].id` | integer (int64) | O | 선택 시 M02로 이동할 크루 ID. |
| `crews[].name` | string | O | 크루 표시명. |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 QUERY_TOO_SHORT` | 검색 조건 | 검색어가 최소 길이 조건에 맞지 않음. 최소 길이·빈 검색 허용 여부는 확인 필요 |
| `401 UNAUTHORIZED` | 인증 | 인증이 필요한 요청에 토큰이 없거나 만료·위변조되어 사용자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- `limit`은 합산 개수가 아니라 각 목록의 최대 개수다. `type`을 생략하면 러너와 크루를 각각 `limit`개까지 반환한다. 기본 20·상한 50.
- 무한 스크롤은 응답 `page`의 커서 하나를 다음 요청 `cursor`로 보낸다. 이 커서는 러너와 크루의 다음 위치를 함께 담는다(Base64URL, 디코드 예: `u:<token>|c:<token>`). 축 token은 양수 id(다음 위치)·`0`(해당 축 소진)·`-`(해당 type에서 미조회)다. typed 검색(`USER`/`CREW`)이 발급한 `-` 축은 type을 바꿔 재요청해도 처음부터 조회한다.
- 한 종류가 끝나면 그 배열은 빈 배열로 두고, 남은 종류만 이어서 반환한다.
- 러너 검색 결과에서도 비공개 프로필 내용을 노출하지 않는다. 팔로우 요청에 필요한 최소 식별정보만 제공한다. 본인 저장 코스 별명은 통합 검색에 포함하지 않는다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] v10 7.1은 검색창 대신 도시·전체/팔로잉 필터를 쓰므로 검색 기능 유지 여부 확인
- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정
