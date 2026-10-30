# API 명세 — 공통 파일

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [F01](#f01-이미지-업로드) | 이미지 업로드 | POST | `/images` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** 각 Response의 JSON은 기존 동작과 기능상 필요한 출력을 설명하는 검토용 예시다. `O`는 해당 응답 객체가 존재할 때 키를 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 조회 결과 자체가 없는 경우와 복구 행동은 해당 오류 응답 절을 따른다.

users.profile_image_key, crews.image_key, posts.image_key는 VARCHAR(1024)이며 NULL 가능하다. 독립 images 테이블은 없다. `imageId`(UUID)와 저장 `image_key`(`images/{purpose}/{userId}/{imageId}.{ext}`) 대응은 아래 F01 규칙을 따른다. 바이너리 저장은 서버 볼륨이다([ADR-0016](../../adr/0016-image-volume-storage.md)).

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다.

## F01 이미지 업로드

`POST` `/api/v1/images`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 (JWT Bearer) |
| 관련 요구사항 | USR-002 / MAT-003 / COM-003 |
| 관련 화면 | 8.2 프로필 사진, 2.P′ 프로필 사진 추가, 6.3 크루 대표 사진, 7.3 결과 사진 (화면 설계 v10) |
| 미정 사항 | 없음(MVP 최소) |
| 비고 | 저장소·형식·크기·imageId/key는 217 확정. 미리보기 URL 서빙·도메인 연결은 후속 |

### 설명

이미지를 올리고 다른 API에서 참조할 `imageId`를 받는다. 이 API만 `multipart/form-data`를 사용한다. 서버가 파일을 받아 볼륨에 저장한다.

### 인증 및 권한

- 로그인 사용자(JWT). 업로드한 이미지는 해당 사용자가 후속 API에서 연결할 때만 사용한다.

### Path Parameters

없음

### Query Parameters

없음

### Request Body

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `file` | binary | O | jpeg 또는 png. 최대 5MB. Content-Type과 실제 매직바이트가 일치해야 함 |
| `purpose` | string | O | `PROFILE` / `CREW` / `POST` |

아래 JSON은 텍스트 필드 설명용이며 실제 요청은 `file` 파트를 포함한 multipart/form-data다.

```json
{
  "purpose": "PROFILE"
}
```

### Response

`201 Created`

```json
{
  "imageId": "550e8400-e29b-41d4-a716-446655440000",
  "url": null
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `imageId` | string (UUID) | O | 후속 API(U05/M03/CMT01 등)에 넘기는 참조. 저장 키는 `images/{purpose}/{userId}/{imageId}.jpg\|png` |
| `url` | string / null | O | MVP에서는 항상 null. 미리보기 URL 서빙은 후속 |

**사용 흐름과 응답 판단**

반환한 `imageId`를 U05/M03/CMT01에 넘겨 연결할 수 있어야 한다(연결 구현은 후속). 성공 시 빈 본문은 허용하지 않는다.

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `413 FILE_TOO_LARGE` | 크기 제한 | 5MB 초과 |
| `415 UNSUPPORTED_MEDIA_TYPE` | 파일 형식 | jpeg/png가 아니거나 Content-Type과 바이트 불일치 |
| `422 INVALID_FILE` | 파일 내용 | 빈 파일·이미지로 해석 불가 |
| `503 UPLOAD_UNAVAILABLE` | 저장소 | 볼륨 쓰기 실패 |
| `401 UNAUTHORIZED` | 인증 | 토큰 없음·만료·위변조 |
| `400 VALIDATION_ERROR` | 입력 형식 | purpose 누락·잘못된 값 등 |

- 공통 입력·서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 함께 적용한다.

### 처리 규칙

- 저장 경로(image_key): `images/{purpose}/{userId}/{imageId}.jpg` 또는 `.png` (`purpose`는 소문자 path segment).
- 새 업로드는 업로더 본인이 후속 API로 연결할 때만 사용한다. 연결 시 소유권·purpose·대상 수정 권한 검사는 도메인 API에서 수행한다(후속).
- 연결 후 이미지 조회는 해당 리소스의 계정·게시물 접근 정책을 따른다.
- 업로드 후 미연결 이미지 정리는 후속(제안).

### 상태값

- 해당 없음.

### 미정 사항

- [ ] 미리보기 `url` 서빙·접근 제어
- [ ] 미연결(orphan) 이미지 정리
- [ ] U05/M03/CMT01 `imageId` → `image_key` 저장 연동
