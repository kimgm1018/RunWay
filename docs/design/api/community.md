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
| [CMT14](#cmt14-댓글-좋아요-등록) | 댓글 좋아요 등록 | PUT | `/comments/{commentId}/reactions/me` | 1차 MVP | 회원 |
| [CMT15](#cmt15-댓글-좋아요-취소) | 댓글 좋아요 취소 | DELETE | `/comments/{commentId}/reactions/me` | 1차 MVP | 회원 |
| [CMT16](#cmt16-게시물-스크랩-등록) | 게시물 스크랩 등록 | PUT | `/posts/{postId}/bookmarks/me` | 1차 MVP | 회원 |
| [CMT17](#cmt17-게시물-스크랩-해제) | 게시물 스크랩 해제 | DELETE | `/posts/{postId}/bookmarks/me` | 1차 MVP | 회원 |
| [CMT18](#cmt18-내-스크랩-목록) | 내 스크랩 목록 | GET | `/users/me/bookmarks` | 1차 MVP | 회원 |
| [CMT19](#cmt19-내-좋아요-목록) | 내 좋아요 목록 | GET | `/users/me/likes` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. 저장·전송 정책이 미정인 보완 필드는 구현 완료 계약을 뜻하지 않는다. 확인 필요 필드의 생략은 기능 삭제나 최종 선택 필드 확정을 뜻하지 않는다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

posts는 author_id와 필수 session_id를 가진다. courseId는 posts 컬럼이 아니라 posts.session_id → running_sessions.course_id에서 조회한다. 자유러닝도 사용자가 코스로 저장했거나 게시물 작성에서 코스 공유를 선택하면 연결 세션에 개인 코스가 생긴다([C11](courses.md#c11-완료-기록을-개인-코스로-저장)). 코스 공유 여부는 `posts.course_shared`(S15P31E105-632, V27)로 저장한다. 세션에 코스가 없으면 false이며, false이면 작성자 외 조회자에게 `courseId`를 null로 준다. 댓글은 comments.parent_comment_id로 연결하고 좋아요는 post_likes 관계로 표현한다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 운동 기록과 공유 게시물의 삭제

운동 기록 삭제는 [S09](sessions.md#s09-러닝-세션-삭제)를 따른다. 앱은 연결된 공유 게시물도 함께 삭제됨을 안내하며, 서버는 해당 세션과 본인 게시물을 한 트랜잭션에서 삭제 표시한다. 사용자가 CMT05를 별도로 먼저 호출할 필요는 없다. 반대로 CMT05로 게시물만 삭제하면 운동 기록은 유지한다.

삭제된 게시물은 목록·검색·상세에서 제외한다. 댓글·좋아요 행은 보존하되 부모 게시물이 삭제됐으면 조회·추가·변경 요청을 POST_NOT_FOUND로 거절한다. 댓글·좋아요 쓰기는 부모 게시물을 잠그고 미삭제를 재검사한 뒤 처리하며 게시물→댓글/좋아요 순서를 유지한다. 삭제가 먼저 확정됐으면 후속 쓰기는 거절하고, 쓰기가 먼저면 이후 부모 삭제로 접근을 차단한다. 이미 화면에 표시된 내용은 다음 조회·갱신에서 제거한다.

S09와 새 게시물 생성은 세션→게시물 순서로 잠가 함께 처리한다. CMT01은 세션 잠금 아래 미삭제 여부를 확인하고 게시물을 생성한다. CMT04 수정과 CMT05 삭제도 같은 세션→게시물 순서로 잠그고 게시물 잠금 아래 미삭제를 재확인한 뒤 갱신해, 먼저 확정된 삭제나 다른 수정(`courseShared` 해제 등)을 낡은 값으로 덮지 않는다. CMT01·CMT04·CMT05의 이 잠금은 구현됐고 S09와의 경합을 통합 테스트로 확인했다. 댓글·좋아요 쓰기의 부모 게시물 잠금은 아직 구현되지 않았다(현재는 일반 조회로 미삭제만 확인).

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

본인 완료 러닝 세션(`sessionId`)을 게시물로 공유한다. 세션 소유권·COMPLETED 상태 검증과 `body`·`courseShared` 저장은 **구현됨**. `title`·`imageId` 저장과 `imageUrl` 응답은 명세에 두되 **미구현**이다.

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
| `body` | string / null | O | `posts.body`에 저장. NULL·생략 허용. 최대 500자(앱 작성 화면과 같음), 넘으면 `400 VALIDATION_ERROR`(S15P31E105-779) |
| `sessionId` | integer (int64) | O | 본인의 공유할 완료 러닝 세션 BIGINT 식별자 |
| `imageId` | string (UUID) | X | 결과 화면 사진([F01](files.md#f01-이미지-업로드)). **미구현** — 받아도 저장·검증하지 않음 |
| `imageKey` | string | X | 최대 1024자. 본인이 F01(`purpose=POST`)로 올린 파일 키 `images/post/{userId}/{uuid}.jpg|png`만 받는다(크루 사진과 같은 규칙). 다른 폴더·남의 경로·외부 URL·없는 파일은 `403 RESOURCE_NOT_OWNED`(S15P31E105-778). 앱은 현재 보내지 않는다 |
| `courseShared` | boolean | X | 연결 세션의 코스를 함께 공유할지. 생략·null이면 true. 완료 자유러닝에 코스가 없고 true이면 코스 생성을 시도한다. GPS·경사 자료 부족으로 실패하면 게시물은 생성하고 false로 저장 |
| `regionCode` | string | X | 러닝을 시작한 지역의 `regions.region_code`(최대 40자). `posts.region_code`에 저장(빈 문자열은 NULL). 없는 코드는 `400 INVALID_REGION`으로 거절한다(S15P31E105-778, 앱은 CMT12에서 받은 코드만 보낸다). 앱은 코스 러닝이면 코스 출발점을, 자유 러닝이면 본인 측정 경로의 첫 유효 좌표를 폰 지오코더로 시·군·구 코드로 바꿔 작성 화면에 `지역: 부산 수영구`처럼 보여 준 뒤 보낸다(S15P31E105-725). 코스 공유 여부는 지역 저장 여부에 영향을 주지 않으며, 판정하지 못하면 생략한다. CMT02 지역 필터의 기준 |

```json
{
  "sessionId": 101,
  "body": "오늘 5km를 달렸어요.",
  "courseShared": true
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
  "courseFromFreeRun": true,
  "courseShared": true,
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
| `courseId` | integer (int64) / null | O | 연결 세션의 `course_id` 파생값. 자유러닝도 코스 생성·공유 선택 후에는 ID가 있다. 작성자 본인 응답이므로 `courseShared`와 무관하게 세션 코스를 준다. 쓰기 입력이 아님 |
| `courseFromFreeRun` | boolean | O | 연결 세션의 코스가 이 자유 러닝 기록으로 만든 개인 코스이면 true(`courses.source_session_id`=세션 ID). 코스가 없거나 일반 코스를 쓴 기록이면 false. `courseId`가 숨겨지는 조회자에게는 false. 항상 포함 |
| `courseShareFailureReason` | string / null | O | 코스 공유를 요청했으나 생성할 수 없으면 `INSUFFICIENT_GPS` 또는 `GRADE_UNAVAILABLE`. 이때 게시물은 생성되고 `courseShared=false` |
| `courseShared` | boolean | O | 저장된 `posts.course_shared`. 세션에 코스가 없으면 false |
| `createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

생성 게시물 ID로 상세 이동하고 저장한 본문·연결 세션을 확인한다. `courseId`는 쓰기 입력이 아닌 연결 세션의 읽기 전용 파생값이며, 코스 공유 여부는 `courseShared`로만 바꾼다.

기능상 필요한 응답 필드 보완안(후속·미구현):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `imageUrl` | string / null | O | **미구현** — 게시물 업로드 이미지 표시 참조. image_key URL 매핑 후속 |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `403 RESOURCE_NOT_OWNED` | 소유권 | 공유 세션이 호출자 소유가 아님. `imageKey`가 본인이 올린 POST 이미지가 아님 |
| `400 INVALID_REGION` | 입력/참조 | `regionCode`가 `regions`에 없음 |
| `422 INVALID_POST` | 입력/참조 | 세션이 없거나 COMPLETED가 아님. 게시물로 공유할 수 없는 상태 |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- **중복·경합 점검:** 통신 시간초과는 저장 실패를 뜻하지 않는다. 동일 요청 재전송·다른 요청과의 충돌을 구분한다. 기존 멱등 처리 기준이 없는 경우 성공 재응답/409/재조회 선택은 확인 필요다.
- `imageId`는 현재 저장·검증하지 않으므로 `INVALID_IMAGE_REFERENCE` 후보는 이미지 연동 구현 전까지 적용하지 않는다.

### 처리 규칙

- 새 글은 4.5 러닝 결과·6.7 그룹런 결과 또는 본인의 저장된 기록(내 기록·홈 러닝 분석)의 '기록 공유'에서 쓰며 `sessionId`는 필수다. 저장된 기록에서도 선택한 세션을 그대로 연결하고 같은 게시 작성 흐름을 사용한다(S15P31E105-730). 모든 게시물은 러닝 기록 공유이므로 별도의 게시물 유형 필드를 사용하지 않는다.
- 세션은 호출자 소유이고 상태가 COMPLETED여야 한다. 아니면 `403 RESOURCE_NOT_OWNED` 또는 `422 INVALID_POST`.
- 공유 생성과 기록 삭제의 경합은 [공통 삭제 규칙](#운동-기록과-공유-게시물의-삭제)을 따른다. 세션 잠금 아래 미삭제·소유권·COMPLETED를 재검사하고 게시물 생성까지 같은 트랜잭션에서 처리한다.
- `title`·`imageId`는 요청에 포함해도 되며 null/생략 가능하나 **현재 저장·검증하지 않는다**.
- 코스 공유는 요청 `courseShared`로 선택·해제한다(S15P31E105-632). 생략하면 true다. 완료 자유러닝에 코스가 없을 때 true이면 C11과 같은 변환을 시도한다. GPS·경사 자료가 부족하면 게시물은 생성하되 `courseShared=false`, `courseShareFailureReason`을 응답해 사용자에게 이유를 알린다. `courseShared=false` 게시물의 `courseId`는 CMT02·CMT03에서 작성자 외 조회자에게 null이다. 코스 접근은 현재 게시물 접근권한 또는 이미 저장한 북마크에 따른다.
- 앱의 새 글 작성 화면은 코스 공유 토글 없이 `courseShared=true`를 항상 요청한다. 기존 코스는 해당 코스를, 코스 생성 전 자유러닝은 저장된 GPS 경로를 실제 지도에 미리 보여준다. 코스 생성 실패 시 기록만 게시하고 이유를 안내하는 API 동작과 기존 게시물 수정의 공유 설정은 유지한다(S15P31E105-730).
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

삭제되지 않은 게시물만 반환한다. 작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 접근을 제한한다. 구현 필터는 `scope`·`authorId`·`regionCode`(S15P31E105-687)이고 `cursor`·`limit` 커서 페이지는 **구현됨**(S15P31E105-634).

### 인증 및 권한

- 로그인 사용자 본인 또는 서비스 리소스 접근 권한 검사.
- 건강정보·실시간 위치·타인 기록 조회 시 동의 상태 및 공개 범위가 우선한다.
- 인증 구현 전에는 임시로 `X-User-Id`(BIGINT, `users.id`) 헤더로 호출자를 식별한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `regionCode` | string | X | CMT12 `regions.region_code`. 시·도 코드(시군구 이름이 빈 행, 예: 부산 `26000`)는 그 시·도 전체, 시·군·구 코드는 그 시·군·구와 하위 구(예: 수원시 `41110` → 수원시 장안구 `41111` 포함). 생략·빈 값은 전국. 없는 코드는 빈 목록. 지역이 NULL인 게시물은 지역을 지정하면 제외 |
| `scope` | string | X | `ALL` \| `FOLLOWING`. 기본값 `ALL`. FOLLOWING은 승인된 팔로우 대상 글 + **본인 글** 포함 |
| `authorId` | integer (int64) | X | 특정 러너의 글만. 접근 가능한 게시물에만 적용 |
| `cursor` | string | X | 이전 응답의 `nextCursor`(서버 발급 불투명 문자열). 같은 회원·같은 `scope`·`authorId`·`regionCode`로만 사용 |
| `limit` | integer | X | 한 페이지 최대 개수. 1~50, 기본 20 |

파라미터가 모두 없어도 첫 페이지 20개를 반환한다(S15P31E105-647). 무파라미터 전체 반환 하위 호환은 제거했다. 다음 페이지는 응답 `nextCursor`를 `cursor`로 보낸다. U21 러너 프로필의 `posts`는 CMT02 요청이 아니므로 이 페이지 규칙과 무관하게 볼 수 있는 글 전체를 반환한다.

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
      "courseId": 101,
      "courseFromFreeRun": true,
      "courseShared": true,
      "createdAt": "2026-10-24T09:00:00Z",
      "commentCount": 2,
      "reactionCount": 3,
      "myReaction": "LIKE",
      "bookmarked": false,
      "author": {
        "userId": 101,
        "nickname": "러너",
        "profileImageUrl": "/api/v1/images/3f1c2a4e-0000-4000-8000-000000000101"
      },
      "recordSummary": {
        "distanceM": 5000,
        "movingDurationSec": 1800,
        "averagePaceSecPerKm": 360
      }
    }
  ],
  "nextCursor": "RnwxMDF8QUxMfHwxMDE",
  "hasNext": true
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 접근 가능한 기록 공유 게시물 요약 목록. 최신 게시물 우선(`posts.id` 내림차순) |
| `nextCursor` | string / null | O | 다음 페이지 요청 `cursor`. `hasNext=false`이면 null(키는 항상 포함) |
| `hasNext` | boolean | O | 다음 페이지가 있으면 true. 파라미터 없는 전체 조회는 false |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].authorId` | integer (int64) | O | `posts.author_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].sessionId` | integer (int64) | O | `posts.session_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].courseId` | integer (int64) / null | O | 연결 세션의 `course_id` 파생값. 자유러닝도 코스 생성 후에는 ID가 있다. `posts.course_shared`가 false이고 조회자가 작성자가 아니면 null. 작성자 본인에게는 수정 화면용으로 유지 |
| `items[].courseFromFreeRun` | boolean | O | 연결 세션의 코스가 이 자유 러닝 기록으로 만든 개인 코스이면 true(`courses.source_session_id`=세션 ID). 코스가 없거나 일반 코스를 쓴 기록이면 false. `courseId`가 숨겨지는 조회자에게는 false. 항상 포함 |
| `items[].courseShared` | boolean | O | `posts.course_shared`. 세션에 코스가 없으면 항상 false |
| `items[].body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].imageKey` | string / null | X | `posts.image_key`. **미구현** — 이미지 연동 전까지 응답에 의존하지 않음 |
| `items[].regionCode` | string / null | O | `posts.region_code` (VARCHAR(40)). NULL 허용. `regionCode` 필터의 기준 |
| `items[].createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

피드에는 게시물 ID·작성자 표시·본문·공유 기록요약이 필요하다. `imageKey`를 그대로 공개 URL로 사용하지 않는다.

표시·선택·후속 이동에 필요한 필드(구현/미구현 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].author` | object | O | 작성자 표시 정보 `{ userId, nickname, profileImageUrl }`. `profileImageUrl`은 `users.profile_image_key`로 U21·U26/U27과 같은 방식으로 만든 사진 주소이며 사진이 없으면 null(키는 항상 포함). 비공개 접근 검사 후 제공 |
| `items[].recordSummary` | object | O | 연결 세션에서 파생한 표시용 요약(거리·이동시간·평균 페이스). 원본 GPS 미포함 |
| `items[].imageUrl` | string / null | X | **미구현** |
| `items[].commentCount` | integer | O | 삭제되지 않은(`deleted_at IS NULL`) 댓글 수. 대댓글 포함 |
| `items[].reactionCount` | integer | O | `post_likes` 행 수 |
| `items[].myReaction` | string / null | O | 조회자가 좋아요했으면 `"LIKE"`, 아니면 null(키는 항상 포함) |
| `items[].bookmarked` | boolean | O | 조회자가 스크랩(저장, [CMT16](#cmt16-게시물-스크랩-등록))했으면 true |

### 오류 응답

**상태: 오류 계약 초안.** 기존 오류 코드에 발생 조건을 보완했다. HTTP 상태·코드는 기존 제안을 유지하며, 추가 후보는 아래에 구분한다. 이 표만으로 미정 정책을 확정하지 않는다.

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_FILTER` | 검색 조건 | `scope` 등 허용값/형식이 맞지 않음. `limit`이 1~50 밖이거나, `cursor`가 서버 발급 형식이 아니거나 다른 회원·`scope`·`authorId`·`regionCode`의 커서임(알림 N01·팔로우 목록 U26과 같은 처리) |
| `401 UNAUTHORIZED` | 인증 | `X-User-Id`가 없거나 형식이 맞지 않아 호출자를 확인할 수 없음 |
| `403 FORBIDDEN` | 권한 | 인증된 사용자가 해당 자원·작업에 필요한 권한을 갖지 않음 |
| `400 VALIDATION_ERROR` | 입력 형식 | JSON 구문·필수 필드·자료형·날짜 형식 또는 Path 식별자 형식이 맞지 않음. 서버 BIGINT 식별자의 소수·UUID·범위 초과 포함. 숫자가 아닌 `limit` 포함 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.
- 검색/조회 결과가 0건인 경우 자체는 오류가 아니다. 유효한 빈 목록과 잘못된 조회 조건을 구분한다.

### 처리 규칙

- `deleted_at`이 설정된 게시물은 제외한다.
- 공개(PUBLIC) 작성자 글은 전체에, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워에게만 노출한다. 대기·거절·역방향 관계는 접근할 수 없다.
- 이번 구현 필터: `scope`(`ALL` 기본, `FOLLOWING`), `authorId`, `regionCode`. `FOLLOWING`에는 승인된 팔로우 대상 글과 **본인 글**을 포함한다. 필터는 함께 적용한다(AND).
- `regionCode`(S15P31E105-687): `regions`에서 고른 지역과 게시물 지역을 이름으로 맞춘다. 시·도가 같고, 고른 지역이 시·도 행이면 그 시·도 전체, 시·군·구 행이면 시군구 이름이 같거나 `<고른 시군구> `로 시작하는 하위 구까지다. `posts.region_code`가 NULL이거나 `regions`에 없는 게시물은 지역을 지정하면 나오지 않는다. 기존 게시물은 지역이 비어 있어 전국에서만 보인다.
- 커서 페이지(S15P31E105-634): 정렬은 최신 게시물 우선(`posts.id` 내림차순)이고 커서는 그 페이지의 마지막 게시물 기준이다. 삭제·접근 불가 작성자(비공개·탈퇴) 글은 DB 조회 단계에서 먼저 제외한 뒤 `limit`개를 자르므로, 가려진 글이 섞여도 각 페이지는 남은 글이 있는 한 `limit`개이고 `hasNext`가 정확하다. 서버는 `limit+1`개를 읽어 다음 페이지 여부를 판단한다.
- 커서는 Base64URL 불투명 문자열이며 클라이언트가 해석·조립하지 않는다. 조회 회원·`scope`·`authorId`·`regionCode`를 담으므로 조건을 바꾸면 처음(커서 없이)부터 다시 요청한다. 지역 없는 커서는 예전 형식 그대로라 배포 전에 받은 커서도 이어진다.
- `recordSummary`는 연결 세션에서 파생한다. `commentCount`·`reactionCount`·`myReaction`·`author.profileImageUrl`·`courseShared`는 **구현됨**(S15P31E105-632), `bookmarked`는 **구현됨**(S15P31E105-634). `imageUrl`·경로 그림은 **미구현**.
- 작성자·세션·댓글 수·좋아요 수·조회자 좋아요·조회자 스크랩은 게시물마다 따로 조회하지 않고 각각 IN 조회 한 번으로 모은다.
- 원본 H02 조회 권한을 타인에게 부여하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- `regionCode` 필터는 S15P31E105-687에서 구현했다.
- `cursor`/`limit` 커서 페이지는 S15P31E105-634에서 구현했고, 파라미터 없는 요청의 기본 20개 페이지는 S15P31E105-647에서 적용했다.
- [ ] `imageUrl` 응답
- `commentCount`·`reactionCount`·`myReaction`은 S15P31E105-632에서 구현했다.
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

작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 접근을 검사한다. 본문·세션 파생 `courseId`·`courseShared`·`recordSummary`·`commentCount`·`reactionCount`·`myReaction`·`bookmarked`·`author.profileImageUrl`은 **구현됨**. `title`·`imageUrl`·`routePreviewImageUrl`은 명세에 두되 **미구현**이다.

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
  "courseFromFreeRun": true,
  "courseShared": true,
  "createdAt": "2026-10-24T09:00:00Z",
  "updatedAt": "2026-10-24T09:00:00Z",
  "commentCount": 2,
  "reactionCount": 3,
  "myReaction": null,
  "bookmarked": true,
  "author": {
    "userId": 101,
    "nickname": "러너",
    "profileImageUrl": null
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
| `courseId` | integer (int64) / null | O | 연결 세션의 `course_id` 파생값. 자유러닝도 코스 생성 후에는 ID가 있다. `posts.course_shared`가 false이고 조회자가 작성자가 아니면 null. 작성자 본인에게는 수정 화면용으로 유지 |
| `courseFromFreeRun` | boolean | O | 연결 세션의 코스가 이 자유 러닝 기록으로 만든 개인 코스이면 true(`courses.source_session_id`=세션 ID). 코스가 없거나 일반 코스를 쓴 기록이면 false. `courseId`가 숨겨지는 조회자에게는 false. 항상 포함 |
| `courseShared` | boolean | O | `posts.course_shared`. 세션에 코스가 없으면 항상 false |
| `createdAt` | string (ISO 8601 UTC) | O | `posts.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `updatedAt` | string (ISO 8601 UTC) | O | `posts.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |
| `reactionCount` | integer | O | `post_likes` 행 수 |
| `commentCount` | integer | O | 삭제되지 않은(`deleted_at IS NULL`) 댓글 수. 대댓글 포함 |
| `myReaction` | string / null | O | 조회자가 좋아요했으면 `"LIKE"`, 아니면 null(키는 항상 포함) |
| `bookmarked` | boolean | O | 조회자가 스크랩(저장)했으면 true(S15P31E105-634) |

**사용 흐름과 응답 판단**

상세는 작성자 표시·기록요약·본문을 제공한다. `sessionId`를 타인 원본 기록 접근 권한으로 해석하지 않는다.

표시·선택·후속 이동에 필요한 필드(구현/미구현 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `author` | object | O | 작성자 표시 정보 `{ userId, nickname, profileImageUrl }`. `profileImageUrl`은 `users.profile_image_key`로 U21·U26/U27과 같은 방식으로 만든 사진 주소이며 사진이 없으면 null(키는 항상 포함) |
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
- `recordSummary`는 연결 세션에서 파생한다. `commentCount`·`reactionCount`·`myReaction`·`bookmarked`·`courseShared`·`author.profileImageUrl`은 CMT02와 같은 규칙으로 **구현됨**. `title`·`imageUrl`·`routePreviewImageUrl`은 **미구현**.
- 원본 H02 조회 권한을 타인에게 부여하지 않는다.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책(PUBLIC/PRIVATE)과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [ ] `title`·`imageUrl`·`routePreviewImageUrl` 응답
- `commentCount`·`reactionCount`·`myReaction`은 S15P31E105-632에서 구현했다.
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

본인 글의 `body`와 코스 공유 여부(`courseShared`)를 수정한다. `title` 저장은 **미구현**이며, 연결 세션·코스 자체는 수정하지 않는다.

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
| `body` | string / null | X | `posts.body` 수정. 생략 시 기존 값 유지(부분 수정). null·공백이면 본문을 비움. 최대 500자 |
| `courseShared` | boolean | X | `posts.course_shared` 수정. 생략·null이면 기존 값 유지. 세션에 코스가 없고 `true`이면 CMT01과 같은 변환을 시도한다. 변환 후에도 코스가 없으면(GPS·경사 자료 부족 등) 게시물은 유지하고 `false`로 저장한다(응답은 `courseShared`만 반환하며 실패 사유 필드는 없다) |

```json
{
  "body": "오늘 5km를 달렸어요.",
  "courseShared": false
}
```

### Response

`200 OK (제안)`

```json
{
  "id": 101,
  "body": "오늘 5km를 달렸어요.",
  "courseShared": false,
  "updatedAt": "2026-10-24T09:00:00Z"
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `posts.id` (BIGINT). 저장 값은 NULL 불가. |
| `title` | string | X | **미구현** — 응답에 포함하지 않음 |
| `body` | string / null | O | `posts.body` (TEXT). NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `courseShared` | boolean | O | 저장된 `posts.course_shared`. 세션에 코스가 없으면 false |
| `updatedAt` | string (ISO 8601 UTC) | O | `posts.updated_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. |

**사용 흐름과 응답 판단**

수정 후 저장된 `body`·`courseShared`·`updatedAt`을 돌려주거나 상세 재조회로 복원한다. 연결 세션·코스 자체는 수정하지 않는다.

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

**응답·복구 행동과의 연결:** 게시물 수정은 허용된 `body`·`courseShared`에만 적용한다. `courseId` 입력을 받지 않으며 원본 러닝 세션·코스를 변경하지 않는다. 코스 공유 해제는 `courseShared=false`로 하고, 이후 작성자 외 조회자에게 `courseId`를 숨긴다. `title`·이미지는 현재 저장하지 않는다.

### 처리 규칙

- 본인 글만 수정. 비작성자 → `403 NOT_AUTHOR`. 삭제된 글 → `404 POST_NOT_FOUND`.
- `title`은 요청에 포함해도 **저장하지 않는다**(미구현).
- 연결 `sessionId`·`courseId`는 수정하지 않는다. `courseShared`는 생략 시 유지하고, 변환 후에도 세션에 코스가 없으면 요청 값과 무관하게 false로 둔다. 세션에 코스가 없을 때 `courseShared=true` 요청이면 CMT01과 같은 변환(C11)을 시도하고, 실패하면 `courseShared=false`로 둔다. 공유 해제·게시물 삭제는 이미 타인이 저장한 코스 북마크를 지우지 않는다.
- `body` 생략 시 기존 본문을 유지한다(S15P31E105-632부터 생략과 null을 구분). `courseShared`만 보내도 본문은 바뀌지 않는다.
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

삭제되지 않은 댓글을 평면(`flat`) `items`로 반환한다. 원댓글 바로 뒤에 그 대댓글이 오도록 정렬하고, 삭제됐지만 삭제되지 않은 대댓글이 남은 원댓글은 `deleted: true` 자리 항목으로 남긴다(S15P31E105-633). 댓글별 좋아요 수(`reactionCount`)와 조회자 좋아요(`myReaction`)를 함께 준다. 게시물 접근은 상세(CMT03)와 동일하게 작성자 계정 PUBLIC/PRIVATE와 승인된 팔로우로 검사한다. `cursor`·`limit`·`page`는 명세에 유지하되 **미구현**이다.

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
      "createdAt": "2026-10-24T09:00:00Z",
      "author": {
        "userId": 101,
        "nickname": "러너",
        "profileImageUrl": null
      },
      "deleted": false,
      "reactionCount": 2,
      "myReaction": "LIKE"
    },
    {
      "id": 103,
      "postId": 101,
      "authorId": 102,
      "parentCommentId": 101,
      "body": "@러너 저도요",
      "createdAt": "2026-10-24T09:05:00Z",
      "author": {
        "userId": 102,
        "nickname": "동료",
        "profileImageUrl": null
      },
      "deleted": false,
      "reactionCount": 0,
      "myReaction": null
    },
    {
      "id": 102,
      "postId": 101,
      "authorId": null,
      "parentCommentId": null,
      "body": null,
      "createdAt": "2026-10-24T09:01:00Z",
      "author": null,
      "deleted": true,
      "reactionCount": 0,
      "myReaction": null
    },
    {
      "id": 104,
      "postId": 101,
      "authorId": 101,
      "parentCommentId": 102,
      "body": "남은 답글",
      "createdAt": "2026-10-24T09:06:00Z",
      "author": {
        "userId": 101,
        "nickname": "러너",
        "profileImageUrl": null
      },
      "deleted": false,
      "reactionCount": 0,
      "myReaction": null
    }
  ]
}
```

응답 필드 정의(저장 필드는 ERD ver.3에 대응, 파생·미정 값은 설명에 구분):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | 접근 가능한 게시물의 삭제되지 않은 댓글과 삭제된 원댓글 자리 목록(평면, 원댓글 뒤 대댓글 순) |
| `page` | string / object (확인 필요) | X | **미구현** — cursor/limit 페이지 메타. 현재 응답에 포함하지 않음 |

중첩 객체의 저장 필드 대응(추가 표시·집계 값은 기존 후보를 유지하며 별도 확인):

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items[].id` | integer (int64) | O | `comments.id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].postId` | integer (int64) | O | `comments.post_id` (BIGINT). 저장 값은 NULL 불가. |
| `items[].authorId` | integer (int64) / null | O | `comments.author_id` (BIGINT). 삭제 자리 항목(`deleted: true`)에서는 null(키 포함) |
| `items[].parentCommentId` | integer (int64) / null | O | `comments.parent_comment_id` (BIGINT). NULL이면 루트 댓글. NULL 허용; 미설정·미측정·미발생을 0/false/빈 문자열로 대체하지 않는다. |
| `items[].body` | string / null | O | `comments.body` (TEXT). 삭제 자리 항목에서는 null(키 포함) |
| `items[].createdAt` | string (ISO 8601 UTC) | O | `comments.created_at` (TIMESTAMPTZ). 저장 값은 NULL 불가. 삭제 자리 항목도 원래 작성 시각 |
| `items[].author` | object / null | O | 댓글 작성자 표시 정보 `{ userId, nickname, profileImageUrl }`. `profileImageUrl`은 `users.profile_image_key`로 U21·U26/U27과 같은 방식으로 만든 사진 주소이며 사진이 없으면 null(키는 항상 포함). 탈퇴 회원은 `nickname`이 "탈퇴한 회원"이고 `profileImageUrl`은 null이다. 회원 행을 찾지 못한 경우에만 `nickname`·`profileImageUrl`이 모두 null. 댓글 작성자 집합으로 한 번에 조회. 삭제 자리 항목에서는 null(키 포함) |
| `items[].deleted` | boolean | O | 삭제된 원댓글 자리면 true, 그 밖은 false (S15P31E105-633) |
| `items[].reactionCount` | integer (int64) | O | 이 댓글의 `comment_likes` 행 수. 삭제 자리는 0 (S15P31E105-633) |
| `items[].myReaction` | string / null | O | 조회자가 좋아요했으면 `"LIKE"`, 아니면 null(키 항상 포함). 삭제 자리는 null (S15P31E105-633) |

**사용 흐름과 응답 판단**

댓글 ID·부모 ID·작성자(`author` 닉네임·사진)·본문·시각·좋아요로 목록을 표시한다. 서버는 평면 목록을 반환하되 원댓글 바로 뒤에 그 대댓글을 붙여 정렬하며, 묶음 표시는 클라이언트가 `parentCommentId`로 한다. `deleted: true` 항목은 '삭제된 댓글입니다' 자리로 표시하고 메뉴·좋아요·답글을 두지 않는다. 댓글이 0건이면 빈 `items`다.

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

- `deleted_at`이 설정된 댓글은 제외한다. 단, 삭제된 원댓글은 **삭제되지 않은 대댓글이 1개 이상 있을 때만** `deleted: true` 자리 항목으로 포함한다(작성자·본문 null, `reactionCount` 0, `myReaction` null). 대댓글이 없거나 모두 삭제됐으면 제외한다. 삭제된 대댓글은 항상 제외한다.
- 정렬: 원댓글은 `createdAt`·`id` 오름차순, 각 원댓글 바로 뒤에 그 대댓글을 `createdAt`·`id` 오름차순으로 둔다.
- 게시물 `commentCount`(CMT02·CMT03)는 삭제되지 않은 댓글 수이며 삭제 자리를 세지 않는다.
- 작성자·좋아요 수·조회자 좋아요는 표시 댓글 집합으로 각각 IN 조회 한 번에 모은다(N+1 없음).
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

접근 가능한 게시물에 댓글을 작성한다. `body`는 필수·비공백이며, 선택 `parentCommentId`로 루트 댓글에만 1단계 대댓글을 달 수 있다. 게시물 작성자 대상 알림함 연계는 S15P31E105-458([notifications.md](notifications.md))에서 `POST_COMMENT`로 처리한다.

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
| `body` | string | O | `comments.body`에 저장. 비어 있거나 공백만이면 `422 EMPTY_COMMENT`. 앞뒤 공백을 뺀 길이가 500자를 넘으면 `400 VALIDATION_ERROR`(앱 입력창과 같음, S15P31E105-779) |
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
  "createdAt": "2026-10-24T09:00:00Z",
  "author": {
    "userId": 101,
    "nickname": "러너",
    "profileImageUrl": null
  },
  "deleted": false,
  "reactionCount": 0,
  "myReaction": null
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
| `author` | object | O | 호출자 작성자 표시 정보 `{ userId, nickname, profileImageUrl }`. `profileImageUrl`은 `users.profile_image_key`로 U21·U26/U27과 같은 방식으로 만든 사진 주소이며 사진이 없으면 null(키는 항상 포함). CMT06 `items[].author`와 같은 형식 |
| `deleted` | boolean | O | 항상 false. CMT06 항목과 같은 형태를 위한 값 (S15P31E105-633) |
| `reactionCount` | integer (int64) | O | 항상 0 (S15P31E105-633) |
| `myReaction` | string / null | O | 항상 null(키 포함) (S15P31E105-633) |

**사용 흐름과 응답 판단**

작성 후 댓글을 바로 붙일 수 있는 ID·부모 ID·본문·작성자(`author` 포함)·시각을 CMT06 항목과 같은 형태로 반환한다. 대댓글은 클라이언트가 해당 원댓글 묶음 끝에 붙인다.

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
- 게시물 작성자 대상 댓글 알림은 458 공통 모듈로 연계한다. 작성자 `notifications.community`가 false이거나 본인 댓글이면 행을 만들지 않는다. dedupe는 `POST_COMMENT:{commentId}`.
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 게시물별 공개 설정 없음. 작성자 계정 정책과 게시물 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- [x] 댓글 알림 연계 계약(S15P31E105-458). 구현은 458
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
| `body` | string | O | `comments.body` 수정. 비어 있거나 공백만이면 `422 EMPTY_COMMENT`. 500자 초과면 `400 VALIDATION_ERROR` |

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
- 이미 좋아요한 재요청은 행 존재를 먼저 확인해 INSERT 없이 200이다. 행이 없을 때만 중복 무시 INSERT(`ON CONFLICT DO NOTHING`)를 실행해 동시 요청도 행 1개만 남긴다. 새 저장이 같은 회원의 회원 행 잠금(탈퇴·로그인·토큰 갱신·프로필 저장)과 겹치면 쓰기 차단 트리거의 NOWAIT 잠금 실패(55P03)로 503 `SERVICE_UNAVAILABLE`이며 재시도할 수 있다(S15P31E105-633).
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

러너·크루를 검색한다. 공용 코스는 이름으로 검색하지 않으며, 새 경로는 C01(AI 경로 후보 생성)로 받는다.

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
      "nickname": "러너",
      "profileImageUrl": null
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
| `users[].profileImageUrl` | string / null | O | U21·U26/U27과 같은 방식으로 만든 프로필 사진 주소. 사진이 없으면 null(키는 항상 포함). S15P31E105-632 |
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
- 러너 검색 결과에서도 비공개 프로필 내용을 노출하지 않는다. 팔로우 요청에 필요한 최소 식별정보(`userId`·`nickname`·`profileImageUrl`)만 제공한다. 프로필 사진은 U21처럼 공개 범위와 무관하게 식별용으로 제공한다. 본인 저장 코스 별명은 통합 검색에 포함하지 않는다.

- 사용자 소유권·그룹 참가 권한·상태 전이·재요청 여부를 검증한다(적용 범위는 API별로 결정).
- 예시는 **명세 구조를 보여주는 가상 값**이며, 확정되지 않은 제한·동기화 주기·AI 호출 주기를 의미하지 않는다.

### 상태값

- 해당 없음.

### 미정 사항

- [ ] v10 7.1은 검색창 대신 도시·전체/팔로잉 필터를 쓰므로 검색 기능 유지 여부 확인
- [ ] 응답 필드는 ERD 확정 후 갱신
- [ ] HTTP 성공 코드 및 각 예외의 오류 코드 최종 확정


## CMT14 댓글 좋아요 등록

`PUT` `/api/v1/comments/{commentId}/reactions/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 없음 |
| 비고 | S15P31E105-633. 저장 테이블 `comment_likes`(V28) |

### 설명

호출자가 댓글에 좋아요를 남긴다. 회원당 댓글 좋아요 1개, LIKE 타입이며 이미 좋아요했으면 그대로 성공한다(멱등). 자기 댓글에도 좋아요할 수 있다.

### 인증 및 권한

- 회원 Bearer 토큰으로 호출자를 식별한다.
- 댓글의 부모 게시물 접근은 CMT03·CMT06과 같다. 공개(PUBLIC) 작성자 글은 전체, 비공개(PRIVATE)는 본인·승인된 정방향 팔로워만.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | `comments.id` |

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `reactionType` | string | X | `LIKE`만 허용. 본문 생략·null·빈 값이면 LIKE. 다른 값은 `400 VALIDATION_ERROR`(CMT10과 같음) |

```json
{
  "reactionType": "LIKE"
}
```

### Response

`200 OK`

```json
{
  "commentId": 101,
  "reactionCount": 3,
  "myReaction": "LIKE"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | `comment_likes.comment_id` |
| `reactionCount` | integer (int64) | O | 처리 직후 이 댓글의 `comment_likes` 행 수 |
| `myReaction` | string | O | 항상 `"LIKE"` |

**사용 흐름과 응답 판단**

앱은 낙관적으로 좋아요 표시·수를 바꾼 뒤 호출하고, 응답의 `reactionCount`·`myReaction`으로 맞춘다. 실패하면 되돌린다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 COMMENT_NOT_FOUND` | 대상 없음 | 댓글이 없거나 `deleted_at`이 설정됨 |
| `404 POST_NOT_FOUND` | 대상 없음 | 부모 게시물이 없거나 삭제됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 부모 게시물 작성자가 PRIVATE이고 호출자가 본인·승인된 정방향 팔로워가 아님 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음. 탈퇴가 이미 커밋된 회원의 새 저장이 쓰기 차단 트리거(`rw_active_owner`, 23514)에 걸린 경우도 포함 |
| `503 SERVICE_UNAVAILABLE` | 일시 장애 | 새 행 저장이 같은 회원의 회원 행 잠금(탈퇴·로그인·토큰 갱신·프로필 저장의 `FOR UPDATE`)과 겹침. 쓰기 차단 트리거(`rw_active_owner`)의 회원 `KEY SHARE NOWAIT`가 실패(55P03)해 저장 전체를 롤백하고 `GlobalExceptionHandler`가 503으로 응답한다. 재시도 가능. 이미 좋아요한 댓글의 재요청은 INSERT하지 않으므로 해당하지 않는다 |
| `400 VALIDATION_ERROR` | 입력 형식 | `reactionType`이 LIKE가 아님, Path 식별자 형식 오류 |

- 판정 순서: 회원 → 댓글(`COMMENT_NOT_FOUND`) → 부모 게시물 접근(`POST_NOT_FOUND`·`ACCOUNT_ACCESS_DENIED`) → `reactionType`.
- **중복·경합 점검:** 이미 좋아요한 재요청·재전송은 행 존재를 먼저 확인해 INSERT 없이 200이다(트리거의 회원 잠금을 거치지 않음). 행이 없을 때만 중복 무시 INSERT를 실행하며, 같은 회원의 동시 요청은 `(comment_id,user_id)` 유니크 제약으로 행 1개만 남고 모두 200이다.

### 처리 규칙

- 행이 있으면 LIKE다. 별도 반응 유형 컬럼은 없다.
- 댓글 삭제(CMT09)는 soft delete라 좋아요 행은 남지만 CMT06 집계와 CMT14·CMT15 대상에서 제외된다.
- 댓글 좋아요 알림은 만들지 않는다.

### 상태값

- 작성자 계정 정책과 게시물·댓글 삭제 상태(`deleted_at`)를 적용한다.

### 미정 사항

- 없음


## CMT15 댓글 좋아요 취소

`DELETE` `/api/v1/comments/{commentId}/reactions/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 미정 사항 | 없음 |
| 비고 | S15P31E105-633 |

### 설명

호출자의 댓글 좋아요를 취소한다. 좋아요가 없어도 성공한다(멱등).

### 인증 및 권한

- CMT14와 같다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | `comments.id` |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "commentId": 101,
  "reactionCount": 2,
  "myReaction": null
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `commentId` | integer (int64) | O | 대상 댓글 ID |
| `reactionCount` | integer (int64) | O | 처리 직후 이 댓글의 `comment_likes` 행 수 |
| `myReaction` | null | O | 항상 null(키 포함) |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 COMMENT_NOT_FOUND` | 대상 없음 | 댓글이 없거나 `deleted_at`이 설정됨 |
| `404 POST_NOT_FOUND` | 대상 없음 | 부모 게시물이 없거나 삭제됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 부모 게시물을 볼 수 없음(CMT14와 같음) |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음 |
| `400 VALIDATION_ERROR` | 입력 형식 | Path 식별자 형식 오류 |

### 처리 규칙

- 좋아요가 없으면 아무것도 지우지 않고 200이다. 관계 없음을 충돌 오류로 만들지 않는다.

### 상태값

- CMT14와 같다.

### 미정 사항

- 없음


## 회원탈퇴 콘텐츠 표시 (S15P31E105-248, 2026-11-05)

회원탈퇴 시 해당 게시물 본문·이미지·지역은 제거하고 deleted_at으로 목록/검색에서 제외한다. 인증된 상세 직접 접근은 410 WITHDRAWN_POST, “탈퇴한 회원의 게시물입니다.” 메시지만 반환하며 원문/이미지/연결 건강 기록을 제공하지 않는다. 일반 삭제의 기존 POST_NOT_FOUND는 유지한다. 댓글·좋아요 등 부모 기반 접근은 숨겨진 글에 대해 계속 POST_NOT_FOUND다.

탈퇴자의 댓글은 본문을 “탈퇴한 회원의 댓글입니다”로 교체하고 ID/부모 관계를 보존한다. 타인의 대댓글은 유지한다. 원래 deleted_at이 있던 댓글은 그대로 숨겨져 다시 나타나지 않는다. 탈퇴 계정의 작성자 표시명은 “탈퇴한 회원”이다. 탈퇴 후 쓰기는 허용하지 않으며, 새 댓글/좋아요/댓글 알림의 부모 게시물 상태는 저장 시 다시 확인한다.

게시물 탈퇴 안내 구분: U18이 새로 숨기는 글은 body에 원문 대신 고정 문구 “탈퇴한 회원의 게시물입니다.”를 저장한다. 이미 deleted_at이 있던 글은 body=NULL로 원문만 지우고 계속404를 유지한다. 다른 필드/테이블 추가 없이 두 경우를 구분하며, 410은 고정 문구·삭제 상태·작성자 탈퇴 상태를 모두 확인한다.


## CMT16 게시물 스크랩 등록

`PUT` `/api/v1/posts/{postId}/bookmarks/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 업무 | S15P31E105-634 (2026-11-10 확정 계약, **구현됨**) |

### 설명

조회자가 게시물을 스크랩(저장)한다. `post_bookmarks`(V29)에 회원·게시물당 1행을 저장한다. 멱등이며 자기 글도 저장할 수 있다. 앱 화면 연결(저장 버튼·프로필 탭)은 후속 업무다.

### 인증 및 권한

- 로그인 회원 본인의 저장만 바꾼다.
- 게시물 접근 규칙은 반응 등록([CMT10](#cmt10-반응-등록변경))과 같다. 공개(PUBLIC) 작성자 글은 전체, 비공개(PRIVATE) 작성자 글은 본인·승인된 정방향 팔로워만 저장할 수 있다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "postId": 101,
  "bookmarked": true
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | 대상 게시물 ID |
| `bookmarked` | boolean | O | 처리 후 저장 상태. 항상 true |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 삭제됨(탈퇴 회원 글 포함) |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 작성자가 PRIVATE이고 조회자가 본인·승인된 정방향 팔로워가 아님 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음. 탈퇴가 이미 커밋된 회원의 새 저장이 쓰기 차단 트리거(V17과 같은 `rw_active_owner`, 23514)에 걸린 경우도 포함 |
| `503 SERVICE_UNAVAILABLE` | 일시 장애 | 새 행 저장이 같은 회원의 회원 행 잠금(탈퇴·로그인·토큰 갱신·프로필 저장의 `FOR UPDATE`)과 겹침. 쓰기 차단 트리거(`rw_active_owner`)의 회원 `KEY SHARE NOWAIT`가 실패(55P03)해 저장 전체를 롤백하고 `GlobalExceptionHandler`가 503으로 응답한다. 재시도 가능. 이미 저장한 게시물의 재요청은 INSERT하지 않으므로 해당하지 않는다 |
| `400 VALIDATION_ERROR` | 입력 형식 | Path 식별자 형식이 맞지 않음 |

### 처리 규칙

- 이미 저장했으면 행 존재를 먼저 확인해 INSERT 없이 같은 성공 응답을 준다(트리거의 회원 잠금을 거치지 않음). 행이 없을 때만 `INSERT ... ON CONFLICT DO NOTHING`을 실행하며, 동시 요청은 `(post_id, user_id)` 유니크 제약으로 한 행만 남기고 모두 200이다.
- 게시물 미삭제·접근 확인은 일반 조회로 한다(좋아요와 같음). 부모 게시물 잠금은 하지 않는다.
- 게시물 삭제 시 저장 행은 보존하되 목록([CMT18](#cmt18-내-스크랩-목록))·상세에서 제외된다.

## CMT17 게시물 스크랩 해제

`DELETE` `/api/v1/posts/{postId}/bookmarks/me`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 업무 | S15P31E105-634 (2026-11-10 확정 계약, **구현됨**) |

### 설명

조회자의 스크랩을 해제한다. 저장한 적이 없어도 성공하는 멱등 처리다.

### 인증 및 권한

[CMT16](#cmt16-게시물-스크랩-등록)과 같다. 게시물 접근 규칙은 반응 취소([CMT11](#cmt11-반응-취소))와 같다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | `posts.id` |

### Query Parameters

없음

### Request Body

없음

### Response

`200 OK`

```json
{
  "postId": 101,
  "bookmarked": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `postId` | integer (int64) | O | 대상 게시물 ID |
| `bookmarked` | boolean | O | 처리 후 저장 상태. 항상 false |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 POST_NOT_FOUND` | 대상 없음 | 게시물이 없거나 삭제됨 |
| `403 ACCOUNT_ACCESS_DENIED` | 공개 범위 | 지금 볼 수 없는 게시물(비공개 전환·팔로우 해제 등). CMT11과 같게 거절한다 |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음 |
| `400 VALIDATION_ERROR` | 입력 형식 | Path 식별자 형식이 맞지 않음 |

### 처리 규칙

- 저장 행이 없어도 `bookmarked: false`로 성공한다.
- 볼 수 없게 된 게시물의 남은 저장 행은 해제 요청이 거절되어도 [CMT18](#cmt18-내-스크랩-목록)에 노출되지 않는다.

## CMT18 내 스크랩 목록

`GET` `/api/v1/users/me/bookmarks`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 업무 | S15P31E105-634 (2026-11-10 확정 계약, **구현됨**) |
| 비고 | 경로는 `/users/me` 아래지만 커뮤니티 API다. [사용자 API](users.md)에는 교차 참조만 둔다 |

### 설명

로그인 회원이 스크랩한 게시물을 저장한 시각 최신 순으로 커서 페이지 조회한다. **본인 목록만** 제공하며 다른 회원의 스크랩 목록 API는 없다(2026-11-10 사용자 결정).

### 인증 및 권한

- 로그인 회원 본인의 `post_bookmarks`만 읽는다.
- 항목마다 지금 시점의 게시물 접근 규칙([CMT02](#cmt02-게시물-목록)와 같음)을 다시 적용한다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string | X | 이전 응답의 `nextCursor`. 같은 회원·같은 목록(스크랩)에서만 사용 |
| `limit` | integer | X | 한 페이지 최대 개수. 1~50, 기본 20 |

### Request Body

없음

### Response

`200 OK`

```json
{
  "items": [
    {
      "id": 101,
      "authorId": 102,
      "sessionId": 201,
      "courseId": null,
      "courseFromFreeRun": false,
      "courseShared": false,
      "body": "오늘 5km를 달렸어요.",
      "regionCode": null,
      "createdAt": "2026-10-24T09:00:00Z",
      "commentCount": 2,
      "reactionCount": 3,
      "myReaction": null,
      "bookmarked": true,
      "author": {
        "userId": 102,
        "nickname": "러너",
        "profileImageUrl": null
      },
      "recordSummary": {
        "distanceM": 5000,
        "movingDurationSec": 1800,
        "averagePaceSecPerKm": 360
      }
    }
  ],
  "nextCursor": null,
  "hasNext": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `items` | array | O | [CMT02](#cmt02-게시물-목록) `items[]`와 **같은 형태**. `bookmarked`는 항상 true, `myReaction`은 조회자 좋아요 여부, `courseId`는 CMT02와 같은 조회자 기준 숨김 규칙 |
| `nextCursor` | string / null | O | 다음 페이지 요청 `cursor`. `hasNext=false`이면 null(키는 항상 포함) |
| `hasNext` | boolean | O | 다음 페이지가 있으면 true |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_FILTER` | 조회 조건 | `limit`이 1~50 밖이거나, `cursor`가 서버 발급 형식이 아니거나 다른 회원·다른 목록(CMT19)의 커서임 |
| `400 VALIDATION_ERROR` | 입력 형식 | 숫자가 아닌 `limit` |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음 |

### 처리 규칙

- 정렬은 `post_bookmarks.created_at` 내림차순, 같은 시각이면 `post_bookmarks.id` 내림차순이다. 커서는 마지막 행의 (저장 시각, 저장 행 ID)이다.
- 삭제된 게시물, 지금 볼 수 없는 게시물(작성자 비공개 전환·팔로우 해제·탈퇴)은 제외한다. 제외 조건은 DB 조회 단계에서 적용한 뒤 `limit`개를 자르므로 가려진 행이 섞여도 각 페이지 크기와 `hasNext`가 정확하다.
- 저장 행 자체는 지우지 않는다. 다시 볼 수 있게 되면(재팔로우·공개 전환) 목록에 다시 나타난다.
- 항목 표시값(작성자·세션·댓글 수·좋아요 수·조회자 반응·스크랩)은 게시물마다 따로 조회하지 않고 각각 IN 조회 한 번으로 모은다.

## CMT19 내 좋아요 목록

`GET` `/api/v1/users/me/likes`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | COM-001~004 |
| 관련 업무 | S15P31E105-634 (2026-11-10 확정 계약, **구현됨**) |
| 비고 | 경로는 `/users/me` 아래지만 커뮤니티 API다. [사용자 API](users.md)에는 교차 참조만 둔다 |

### 설명

로그인 회원이 좋아요([CMT10](#cmt10-반응-등록변경))한 게시물을 좋아요한 시각 최신 순으로 커서 페이지 조회한다. **본인 목록만** 제공하며 다른 회원의 좋아요 목록 API는 없다(2026-11-10 사용자 결정).

### 인증 및 권한

[CMT18](#cmt18-내-스크랩-목록)과 같다. 로그인 회원 본인의 `post_likes`만 읽는다.

### Path Parameters

없음

### Query Parameters

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `cursor` | string | X | 이전 응답의 `nextCursor`. 같은 회원·같은 목록(좋아요)에서만 사용 |
| `limit` | integer | X | 한 페이지 최대 개수. 1~50, 기본 20 |

### Request Body

없음

### Response

`200 OK` — 형태는 [CMT18](#cmt18-내-스크랩-목록)과 같다(`{ items, nextCursor, hasNext }`, `items[]`는 CMT02 항목 형태). `items[].myReaction`은 항상 `"LIKE"`, `items[].bookmarked`는 조회자 스크랩 여부다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `400 INVALID_FILTER` | 조회 조건 | `limit`이 1~50 밖이거나, `cursor`가 서버 발급 형식이 아니거나 다른 회원·다른 목록(CMT18)의 커서임 |
| `400 VALIDATION_ERROR` | 입력 형식 | 숫자가 아닌 `limit` |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 회원을 확인할 수 없음 |

### 처리 규칙

- 정렬은 `post_likes.created_at` 내림차순, 같은 시각이면 `post_likes.id` 내림차순이다. 커서는 마지막 행의 (좋아요 시각, 좋아요 행 ID)이다.
- 삭제·볼 수 없는 게시물 제외와 `hasNext` 정확성은 [CMT18](#cmt18-내-스크랩-목록)과 같다.
- 목록 조회용 인덱스 `post_likes(user_id, created_at DESC, id DESC)`를 V29에서 추가했다.

## 알려진 제한 (S15P31E105-633·634)

후속 검토 대상이며 현재 화면 노출·집계에는 영향이 없다.

- 댓글 좋아요(CMT14)·스크랩(CMT16)은 저장 시 부모 댓글·게시물 삭제를 DB에서 다시 확인하지 않는다(V17 가드의 부모 재확인 대상은 `comments`·`post_likes`뿐이다). 대상 확인 직후 부모 삭제가 커밋되면 삭제된 대상에 보이지 않는 행이 남을 수 있다. CMT06·CMT18·집계는 삭제 대상을 제외한다.
- 원댓글 삭제(CMT09)와 그 원댓글에 대한 답글 작성(CMT07)이 동시에 실행되면, 답글이 부모 확인을 통과한 뒤 삭제가 커밋된 경우 답글이 삭제된 원댓글 아래에 저장된다(422가 아니라 201). 목록에는 삭제 자리 아래 대댓글로 보인다.
- 해제(CMT11·CMT15·CMT17)도 등록과 같은 접근 검사를 하므로, 삭제되었거나 지금 볼 수 없는 게시물(비공개 전환·팔로우 해제)의 좋아요·스크랩은 다시 볼 수 있게 될 때까지 해제할 수 없다. 그동안 CMT18·CMT19에는 나타나지 않지만, 다시 볼 수 있게 되면 목록에 다시 나타난다.
