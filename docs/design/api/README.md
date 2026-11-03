# RunWay API 명세 — 1차 MVP

> **2026-10-23 동작 결정 반영:** [자동 처리 요구사항](../requirements.md)에 따라 공개 요청과 내부 자동 처리를 분리했다. 자동 평가·전략 생성·코칭·종료 후 분석은 API 목록에서 제외되더라도 필수 구현 대상이다. 전송 기술과 미정 정책은 각 상세 문서에서 별도 표시한다.

RunWay 서비스의 **클라이언트 공개 API 설계**이다. 저장소의 [1차 MVP 요구사항](../requirements.md)과 [최신 ERD](../db/erd.md)를 기준으로 정리했으며, 이 문서의 공통 규약과 색인에서 도메인별 상세 명세로 연결한다.

> **상태:** 173의 W07·S03~S06·S08 준비 결과·폰 인계·시작 미확인 중단·S10·P07·G09 및 워치 연동 계약은 사용자 승인 설계다. 문서의 예시값은 합성 데이터이며 구현/배포 완료를 뜻하지 않는다. 다른 도메인의 미정 항목은 각 상세 명세에서 구분한다.

## 문서 구성

| 문서 | 도메인 | API 수 |
|---|---|---:|
| [인증·사용자·러닝 프로필](./users.md) | 인증·사용자·러닝 프로필 | 25 |
| [워치·건강 데이터](./devices-health.md) | 워치·건강 데이터 | 7 |
| [운동 준비도](./readiness.md) | 운동 준비도 | 1 |
| [러닝 코스](./courses.md) | 러닝 코스 | 5 |
| [러닝 세션](./sessions.md) | 러닝 세션 | 10 |
| [AI 페이스·실시간 분석·BPM](./pace-coaching.md) | AI 페이스·실시간 분석·BPM | 1 |
| [러닝 기록·분석](./running-records.md) | 러닝 기록·분석 | 5 |
| [그룹런](./group-runs.md) | 그룹런 | 13 |
| [크루](./crews.md) | 크루 | 11 |
| [커뮤니티](./community.md) | 커뮤니티 | 13 |
| [공통 파일](./files.md) | 이미지 업로드·조회 | 2 |

총 **93개 공개 API 설계**. 크루 멤버 내보내기(M09)는 선택 기능이다. 내부 자동 처리와 개별 이벤트 종류는 이 수에 포함하지 않는다. SSE 접속 endpoint S10은 포함한다.

운영 워치·폰 batch의 서버 계약은 [W07](devices-health.md#w07-워치-운동-배치-동기화), 앱 간 MessageClient 계약은 [통합 설계 9장](../watch-mobile-server-integration.md#9-워치폰-messageclient-메시지-명세)을 따른다.

알림 발생 계기·수신자와 추가 후보는 [알림 정책](../requirements.md#알림-정책)에 정리했다. 미확정 제안은 해당 절에서 구분하며 알림함·조회 API를 자동으로 추가하지 않는다.

## 공통 규약

### 기본 URL 및 콘텐츠

- Base path: `/api/v1`
- `Content-Type: application/json; charset=utf-8` (예외: [F01 이미지 업로드](./files.md#f01-이미지-업로드)는 `multipart/form-data`, [F02 이미지 조회](./files.md#f02-이미지-조회)는 `image/jpeg` 또는 `image/png` 바이너리)
- 키: `camelCase`; 서버 엔티티 식별자: BIGINT에 대응하는 정수(`int64`); URL Path에서는 십진 정수 표기; 시간: ISO 8601 UTC 문자열
- 거리: m; 구간·경과 시간: sec; 페이스: sec/km; 심박수: bpm; 케이던스: spm
- 좌표: WGS84, GeoJSON 좌표 순서 `[longitude, latitude]`
- 로그인은 아이디·비밀번호 방식이다(화면 설계 v10). [ADR-0014](../../adr/0014-common-api-authentication.md)에 따라 JWT Access Token은 10분, 갱신 권한은 최초 로그인부터 최대 30일이다. 로그아웃 시 갱신 권한을 폐기하며 기존 Access Token은 남은 유효기간(최대 약 10분) 동안 유효하다. 요청마다 로그인 상태를 조회하거나 Access Token 차단 목록을 운영하지 않는다. 자원 소유자·동의·공개 범위 검사는 별도로 유지한다. 전달 형식·재사용 처리 등 상세 계약은 [U01~U03](users.md#u01-로그인)을 따른다.

가입 후에는 초기 설정 페이지로 이동한다. U07 완료 요청으로 러닝 수준과 평소 페이스를 한 번에 저장한 뒤 홈으로 이동한다. U01의 초기 설정 완료 기준·Argon2id 저장·아이디별 5회 실패/10분 제한 정책을 따른다.

### 인증 요청과 복구

현재 공통 인증 결정은 [ADR-0014](../../adr/0014-common-api-authentication.md)를 따른다. 회원 API는 HS256 JWT의 검증된 sub로 사용자를 식별하고 X-User-Id를 신뢰하지 않는다. 로그인·가입·갱신·로그아웃의 POST와 아이디 확인의 GET만 Access Token 검증을 생략하며, 이 정확한 조합은 오래된 Authorization 값으로 차단하지 않는다. 회원 API는 인증 실패를 입력 검증보다 먼저 처리하고 401 UNAUTHORIZED, message=인증이 필요합니다., details={}를 반환한다. WWW-Authenticate는 Bearer이며 내부 검증 이유나 토큰 원문을 노출하지 않는다. 인증 성공 후 기존 입력·도메인 권한 검사를 수행한다. 공통 권한 거절은 403 FORBIDDEN, message=접근 권한이 없습니다., details={}이며 기존 도메인 코드(NOT_ADMIN 등)는 유지한다.

탈퇴·향후 정지 후 기존 JWT는 원래 만료시각까지 최대 10분 유효하다. 즉시 차단용 요청별 상태 조회·차단 목록은 두지 않으며 기존 자원 권한·동의 검사는 유지한다.


토큰은 JSON 본문으로 반환하며 회원 API는 `Authorization: Bearer <accessToken>`을 사용한다. U01 로그인·U15 가입·U16 아이디 확인은 Access Token을 요구하지 않는다. U02 갱신·U03 로그아웃은 JSON 본문의 Refresh Token으로 처리하며 Access Token이 없거나 만료돼도 호출할 수 있다. 이 예외가 회원 데이터 조회 권한을 부여하지는 않는다.

U02는 Refresh Token을 교체하고 이전 토큰 재사용 시 해당 로그인 계열의 갱신 권한을 폐기한다. U03은 해당 계열만 폐기하고 `204 No Content`를 반환한다. 앱은 갱신을 한 번으로 모으고 결과가 불확실한 갱신을 무조건 재시도하지 않는다. 오류 응답·로그아웃 반복·갱신 경합의 정확한 결과는 [U01~U03](users.md#인증-정책-적용-범위)을 따른다. 이 절과 U01~U03에서 확정한 항목은 문서 전체의 일반적인 초안 표시와 구분한다.

[ADR-0015](../../adr/0015-redis-refresh-token-store.md)에 따라 Refresh Token 해시·로그인 계열·사용 및 폐기 상태·교체 이력은 Redis에 저장한다. 사용자·비밀번호 해시는 PostgreSQL을 사용한다. 2026-10-28 승인한 저장 모델·원자적 처리·보존/복구 기준은 [갱신 권한 저장소](users.md#갱신-권한-저장소)를 따르고 실행 변수·검증·운영 준비는 [백엔드 실행 안내](../../../backend/README.md#8-로그인과-redis)를 따른다.

### ERD 응답 형식 적용

- 서버 PK/FK의 논리 타입은 `integer (int64)`다. JSON의 큰 정수를 처리하는 클라이언트는 정밀도를 보존해야 한다. 전체 BIGINT 범위의 JSON 숫자/십진 문자열 전송 선택은 별도 확인 사항이며, 이 문서의 작은 정수 예시는 문자열 전송 정책을 확정하지 않는다.
- 설치 ID·클라이언트 배치 ID·명령 ID·원본 측정 ID·이미지 참조는 서버 PK와 구분하며 일괄 BIGINT 변환하지 않는다.
- 응답의 필수 키와 nullable 값을 구분한다. 저장 행/중첩 객체 자체가 없을 때의 표현은 해당 응답에서 별도로 확인한다.
- 기존 단위가 포함된 camelCase 필드명은 유지하고 SQL 컬럼 대응을 각 응답에 명시한다. 저장 컬럼이 없다는 이유로 기존 API 기능을 제거하지 않는다. 파생·집계·표시 값의 형식은 근거가 없으면 확인 필요로 남긴다.
- 각 도메인의 **ERD 응답 대응 기준**과 Response 표를 함께 읽는다. ERD 정합성 단계에서는 API ID·Method·경로 구조·개수·역할과 오류 응답을 유지했다. 후속 오류 검토는 아래 오류 분류와 상세 오류 절을 따른다.

### 성공·오류 응답

- 성공 응답은 **각 엔드포인트의 Response 필드 표와 대응 설명**을 우선한다. 공통 `{data: ...}` 래퍼 도입 여부는 미정이다. 본 파일 예시는 래퍼 없는 응답으로 작성했다.
- 목록 응답은 `items`/`page` 패턴을 제안하지만 `cursor` 형식, `limit` 상한과 정확한 페이지 정보는 미정이다.
- 오류는 HTTP 상태와 오류 코드·설명으로 반환한다. 공통 오류 형태(제안):

```json
{
  "code": "VALIDATION_ERROR",
  "message": "요청 값이 유효하지 않습니다.",
  "details": {
    "fields": [
      { "name": "value", "reason": "비어 있을 수 없습니다." }
    ]
  }
}
```

`fields`에는 필드 이름과 검증 사유만 넣고 거절된 입력값은 넣지 않는다. 타입 변환 실패의 사유는 `형식이 올바르지 않습니다.`다. 필수 쿼리·파트·헤더가 없으면 같은 `400 VALIDATION_ERROR`와 사유 `필수 값입니다.`를 쓴다. `ApiException`이 넘긴 `details`는 유지하되 값이 없는 항목은 빼고, 그 외 오류의 `details`는 빈 객체다. `message`가 없으면 `요청을 처리할 수 없습니다.`를 넣는다. 예상하지 못한 실패의 코드 후보는 `INTERNAL_ERROR`, 메시지는 `서버 오류가 발생했습니다.`다. 매핑되지 않은 경로는 `404 NOT_FOUND`이며 도메인 자원의 404 코드와 구분한다. 허용되지 않은 HTTP 메서드는 `405 METHOD_NOT_ALLOWED`, 메시지는 `허용되지 않는 메서드입니다.`다. 이미 503인 예외는 `503 SERVICE_UNAVAILABLE`, 메시지는 `일시적으로 처리할 수 없습니다.`다. 도메인 코드가 따로 처리하지 않은 일시적 데이터 접근 장애(잠금 대기 초과·교착 상태·쿼리 시간초과·DB/Redis 연결 실패·트랜잭션 시작 실패)도 공통 처리기가 같은 `503`으로 응답한다(S15P31E105-255 확정, 2026-10-30). 서버는 DB 연결 획득 5초·잠금 대기 5초·쿼리 실행 10초·DB 무응답 소켓 15초를 대기 지점별 기본 상한으로 두어, DB 장애나 잠금 경합에서 무한 대기 없이 이 `503`을 응답한다. 상한은 대기 1회 기준이라 여러 잠금·쿼리를 거치는 요청은 더 오래 걸릴 수 있으며 클라이언트 타임아웃보다 먼저 응답한다고 보장하지 않는다(S15P31E105-294 확정, 2026-11-02, 값과 재정의는 [백엔드 README](../../../backend/README.md) 환경변수 표). 503은 저장 미완료를 보장하지 않으므로 클라이언트는 결과를 확인한 뒤 제한 재시도한다. 분류는 Spring 예외 변환을 따르므로 커밋 도중 연결 끊김처럼 다른 예외로 감싸진 장애는 500일 수 있고, DB 자원 한도 초과처럼 재시도로 해결되지 않는 일부 오류가 503일 수 있다. 제약 위반 등 재시도해도 결과가 같은 데이터 오류는 `500 INTERNAL_ERROR`를 유지한다. 406은 공통 JSON 코드를 만들지 않고 상태만 유지한다.

- 공통 HTTP 오류 후보: `400` 요청 유효성 실패, `401` 인증 실패, `403` 권한·동의 부족, `404` 리소스 없음, `405` 메서드 불일치, `406` 수락 불가, `409` 상태 충돌, `413`·`415` 업로드 제한, `422` 의미적 검증 실패, `500` 서버 오류, `503` 일시적 의존 장애.
- 사용자·건강·GPS 개인정보 접근은 동의·공개 범위·소유자 및 참가자 권한을 확인한다.

### 호출 목적에 따른 응답 검토

각 API의 Response에는 호출 후 표시·선택·다음 요청·복구에 필요한 출력을 검토한 내용을 적었다. DB에 컬럼이 없더라도 인증수단·이미지 참조·동기화 ACK·집계 결과처럼 기능상 필요한 정보는 별도 계약이 필요하다. 반대로 단순 명령은 HTTP 성공으로 충분할 수 있어 모든 응답에 success를 강제하지 않는다.

사용자 결정 반영: 회원가입은 기본 사용자 정보와 건강정보 동의 값을 수집한 뒤 실행하고, 환경은 코드(environmentTypes)로 전달한다. 게시물 코스 공유 해제는 제공하지 않으며 G04에서 출발 전 목표를 수정한다. 사용자 선호 환경의 저장 위치·인증 전달 방식·준비 상태·동기화 범위 등 남은 구조는 별도 확정이 필요하다.

### 오류 분류와 재시도 기준

[G09 그룹런 시작](group-runs.md#g09-그룹런-시작)의 오류 응답은 해당 절의 확정 계약을 따른다. 아래의 일반적인 초안 표시는 G09에 적용하지 않는다.

**검토용 오류 계약:** 도메인별 오류 표의 기존 HTTP·코드는 제안 상태다. 추가 오류 후보는 확정된 처리 규칙이 아니다. API 종류·개수·역할과 성공 응답을 바꾸지 않고 실패 가능성을 정리한다.

| 종류 | HTTP·대표 코드 후보 | 발생 상황 | 재시도·표현 기준 |
|---|---|---|---|
| 요청 형식 | 400 VALIDATION_ERROR | JSON 파싱·필수 필드·필수 파트·필수 헤더·타입·날짜·BIGINT 범위 오류 | 같은 입력 재시도 불가. 필드 이름·검증 사유만 전달. 타입 변환 사유에 거절 값을 넣지 않음 |
| 메서드 불일치 | 405 METHOD_NOT_ALLOWED | 허용되지 않은 HTTP 메서드 | 같은 메서드로 재시도 불가. `Allow` 헤더로 허용 메서드를 알림 |
| 인증 | 401 UNAUTHORIZED | 회원 API의 토큰 누락·만료·변조 | 인증 복구 후 재시도. 공개 로그인/가입/아이디 확인에 Bearer 인증을 일괄 요구하지 않음 |
| 권한·동의 | 403 및 도메인 코드 | 타인 자원·미승인 팔로우·그룹 권한·동의 철회 | 권한 회복 전 재시도 금지. 존재 은닉을 위한 404 선택은 미정 |
| 대상 없음 | 404 및 도메인 코드 | 잘못된 ID·삭제·필수 관계 부재 | NULL 선택값·빈 목록과 구분. 단순 재시도보다 대상 확인 |
| 상태·중복 충돌 | 409 및 도메인 코드 | 허용되지 않는 상태 전이·상반된 동시 변경 | 현재 상태 재조회. 동일 명령의 멱등 성공과 충돌을 구분 |
| 값·참조 규칙 | 422 및 도메인 코드 | 형식은 맞지만 목표 조합·부모 댓글·참조 소유권 등이 유효하지 않음 | 입력 수정. 400/422 분류와 소유권 403의 우선순위는 구현 전 통일 |
| 업로드 제한 | 413 FILE_TOO_LARGE / 415 UNSUPPORTED_MEDIA_TYPE | 크기 초과·지원하지 않는 형식 | 파일 변경. 최대 크기·지원 목록은 미정 |
| 호출 제한 | 429 | 로그인 실패 제한·요청 빈도 초과 | 제한 해제 후 재시도. Retry-After와 세부 제한값은 확인 필요 |
| 내부 실패 | 500 INTERNAL_ERROR (후보) | 예상하지 못한 처리 실패 | 원인·저장 결과 확인 없이 쓰기 요청 자동 재실행 금지 |
| 일시적 의존 장애 | 503 SERVICE_UNAVAILABLE | DB·저장소 등 의존 시스템의 일시 장애. 공통 처리기 기준은 위 공통 오류 응답 절 | 재시도 가능한지 저장/처리 완료 여부와 함께 판단. 재시도 간격·횟수 미정 |

- 네트워크 단절·클라이언트 시간초과는 HTTP 오류 응답을 받지 못한 상황이며 서버 실패 코드로 단정하지 않는다. 쓰기 완료 여부를 재조회하거나 기존 commandId/배치 식별자로 중복 판정한다. 새 멱등 키를 임의 도입하지 않는다.
- 같은 요청의 반복과 다른 요청의 경합은 다르다. 팔로우 승인/취소, 크루 정원 승인, 그룹 시작/취소, 개인 종료/강제 종료 등에서 검사와 저장 사이 상태가 바뀔 수 있다.
- 미측정 센서·목표 미설정·추천 결과 없음은 오류와 구분한다. 분석 준비 중·부분 데이터·계산 실패의 응답 상태는 아직 미정이다.
- 동기화는 요청 전체 실패와 일부 항목 거절을 구분해야 한다. ACK는 영속 저장을 확인한 범위를 뜻하며 수신 성공과 COMMITTED를 혼동하지 않는다. W06은 레코드별 거절을 `errors[index]`로 돌려주고 유효 레코드는 한 트랜잭션으로 저장한다([W06](devices-health.md#w06-samsung-health-데이터-동기화)).
- 오류 본문은 기존 `{code, message, details}` 제안을 유지한다. details에 비밀번호·토큰·전화번호·원본 건강/GPS 값·SQL·스택 추적·외부 응답 원문을 넣지 않는다. HTTP와 code, 안전한 필드 오류 이유를 대응시킨다.
- 오류 처리 우선순위와 개인정보를 숨기는 403/404 선택은 공통 결정이 필요하다. 이 문서의 후보만으로 계정·자원 존재를 외부에 노출하지 않는다.

### 러닝 목표와 세션 상태

- 평소 러닝 정보는 개인화 추천용 기준값이며 특정 세션의 목표가 아니다.
- 이번 러닝 목표는 코스 추천 조건에서 입력하고 러닝 세션 생성 시 전달한다.
- 목표는 출발 전 S08로 수정 가능하며 실제 운동 시작 시 고정. 러닝 중 AI가 갱신하는 것은 **안내 페이스·코칭**이다.
- 개인런·그룹런 모두 코스 지정과 자유러닝 허용(`courseId = null`).
- 개인 세션은 S06으로 종료한다. 실제 시작 참가자 전원 개인 종료 시 그룹은 자동 종료하며, G12는 그룹장만 실행하는 예외 상황의 그룹 전체 강제 종료다.
- 같은 코스 과거 기록의 **동일 거리 도달 시간**을 비교한다. 여러 과거 기록 중 기본 선택 정책은 미정.
- 지정 코스 그룹은 코스 진행률을, 자유 그룹은 선두의 실제 주행 경로를 기준으로 순위 산정을 검토한다. GPS만으로 동일 선상 선후 관계가 자동 확정되는 것은 아니다.
- 삼성 헬스 과거 운동 기록의 세부 저장 구조, 실시간 전송 수단 및 동기화 빈도는 미정이다.

### 공용 코스 상태와 사용자 저장 목록

- 코스 추천 조건 필터에는 `ACTIVE` 상태의 공용 코스만 사용한다. 공용 이름 검색은 없으며 저장 별명은 사용자 북마크에만 둔다.
- `MERGED`, `BLOCKED` 코스는 추천에서 제외한다. 저장한 코스가 `MERGED`이면 대표 코스를 함께 안내한다.
- 러닝 경로가 공용 코스로 자동 등록되어도 코스 원본을 직접 수정하거나 삭제할 수 없다.
- 코스 저장 해제는 사용자의 북마크 관계만 삭제하며 공용 코스 원본과 상태를 변경하지 않는다.

### 문서 표기

- ID는 기존 v2 후보 ID(U01, W01, … CMT11)를 유지하며 재사용하지 않는다.
- `O`는 필수, `X`는 선택, `조건부`는 다른 필드 값에 따라 필수임을 뜻한다. 예시 필드 중 타입을 확인할 수 없는 경우 `(확인 필요)`라고 표시한다.
- 상세 응답 JSON의 값은 **구조 예시**이지 실데이터 계약 완료를 의미하지 않는다.
- `M09`는 1차 MVP 필수 범위 밖 선택 기능이다.

## 전체 API 목록

| ID | 이름 | Method | Endpoint | 문서 |
|---|---|---|---|---|
| U01 | [로그인](./users.md#u01-로그인) | POST | `/auth/login` | [users.md](./users.md) |
| U02 | [토큰 갱신](./users.md#u02-토큰-갱신) | POST | `/auth/refresh` | [users.md](./users.md) |
| U03 | [로그아웃](./users.md#u03-로그아웃) | POST | `/auth/logout` | [users.md](./users.md) |
| U04 | [내 프로필 조회](./users.md#u04-내-프로필-조회) | GET | `/users/me` | [users.md](./users.md) |
| U05 | [내 프로필 수정](./users.md#u05-내-프로필-수정) | PATCH | `/users/me` | [users.md](./users.md) |
| U06 | [러닝 프로필 조회](./users.md#u06-러닝-프로필-조회) | GET | `/users/me/running-profile` | [users.md](./users.md) |
| U07 | [러닝 프로필 저장·부분 수정](./users.md#u07-러닝-프로필-저장부분-수정) | PATCH | `/users/me/running-profile` | [users.md](./users.md) |
| U08 | [평소 러닝 정보 조회 (U06 통합)](./users.md#u08-평소-러닝-정보-조회) | — | — | [users.md](./users.md) |
| U09 | [평소 러닝 정보 설정 (U07 통합)](./users.md#u09-평소-러닝-정보-설정) | — | — | [users.md](./users.md) |
| U10 | [러닝 환경 유형 조회](./users.md#u10-러닝-환경-유형-조회) | GET | `/environments` | [users.md](./users.md) |
| U11 | [선호 환경 조회](./users.md#u11-선호-환경-조회) | GET | `/users/me/preferences` | [users.md](./users.md) |
| U12 | [선호 환경 설정](./users.md#u12-선호-환경-설정) | PUT | `/users/me/preferences` | [users.md](./users.md) |
| U13 | [개인 공개 설정 조회](./users.md#u13-개인-공개-설정-조회) | GET | `/users/me/privacy-settings` | [users.md](./users.md) |
| U14 | [개인 공개 설정 변경](./users.md#u14-개인-공개-설정-변경) | PATCH | `/users/me/privacy-settings` | [users.md](./users.md) |
| U15 | [회원가입](./users.md#u15-회원가입) | POST | `/auth/signup` | [users.md](./users.md) |
| U16 | [아이디 사용 가능 여부 확인](./users.md#u16-아이디-사용-가능-여부-확인) | GET | `/auth/login-id/availability` | [users.md](./users.md) |
| U17 | [회원탈퇴 사전 정보 조회](./users.md#u17-회원탈퇴-사전-정보-조회) | GET | `/users/me/withdrawal-summary` | [users.md](./users.md) |
| U18 | [회원탈퇴](./users.md#u18-회원탈퇴) | DELETE | `/users/me` | [users.md](./users.md) |
| U19 | [앱 설정 조회](./users.md#u19-앱-설정-조회) | GET | `/users/me/settings` | [users.md](./users.md) |
| U20 | [앱 설정 변경](./users.md#u20-앱-설정-변경) | PATCH | `/users/me/settings` | [users.md](./users.md) |
| U21 | [러너 프로필 조회](./users.md#u21-러너-프로필-조회) | GET | `/users/{userId}/profile` | [users.md](./users.md) |
| U22 | [러너 팔로우·요청](./users.md#u22-러너-팔로우요청) | PUT | `/users/{userId}/follow` | [users.md](./users.md) |
| U23 | [러너 팔로우·요청 취소](./users.md#u23-러너-팔로우요청-취소) | DELETE | `/users/{userId}/follow` | [users.md](./users.md) |
| U24 | [받은 팔로우 요청 목록](./users.md#u24-받은-팔로우-요청-목록) | GET | `/users/me/follow-requests` | [users.md](./users.md) |
| U25 | [팔로우 요청 승인·거절](./users.md#u25-팔로우-요청-승인거절) | PATCH | `/users/me/follow-requests/{requesterId}` | [users.md](./users.md) |
| W01 | [기기 등록](./devices-health.md#w01-기기-등록) | POST | `/devices` | [devices-health.md](./devices-health.md) |
| W02 | [등록 기기 조회](./devices-health.md#w02-등록-기기-조회) | GET | `/devices` | [devices-health.md](./devices-health.md) |
| W03 | [기기 연결 해제](./devices-health.md#w03-기기-연결-해제) | DELETE | `/devices/{deviceId}` | [devices-health.md](./devices-health.md) |
| W04 | [수집 동의·철회](./devices-health.md#w04-수집-동의철회) | POST | `/consents` | [devices-health.md](./devices-health.md) |
| W05 | [동의 상태 조회](./devices-health.md#w05-동의-상태-조회) | GET | `/consents` | [devices-health.md](./devices-health.md) |
| W06 | [Samsung Health 데이터 동기화](./devices-health.md#w06-samsung-health-데이터-동기화) | POST | `/health-records/sync` | [devices-health.md](./devices-health.md) |
| W07 | [워치 운동 배치 동기화](./devices-health.md#w07-워치-운동-배치-동기화) | POST | `/sync/batches` | [devices-health.md](./devices-health.md) |
| R02 | [최신 준비도 조회](./readiness.md#r02-최신-준비도-조회) | GET | `/readiness-assessments/latest` | [readiness.md](./readiness.md) |
| C01 | [코스 추천](./courses.md#c01-코스-추천) | POST | `/courses/recommendations` | [courses.md](./courses.md) |
| C03 | [코스 상세 조회](./courses.md#c03-코스-상세-조회) | GET | `/courses/{courseId}` | [courses.md](./courses.md) |
| C07 | [코스 저장](./courses.md#c07-코스-저장) | PUT | `/courses/{courseId}/bookmark` | [courses.md](./courses.md) |
| C08 | [코스 저장 해제](./courses.md#c08-코스-저장-해제) | DELETE | `/courses/{courseId}/bookmark` | [courses.md](./courses.md) |
| C09 | [저장 코스 목록](./courses.md#c09-저장-코스-목록) | GET | `/users/me/bookmarked-courses` | [courses.md](./courses.md) |
| S01 | [러닝 세션 생성](./sessions.md#s01-러닝-세션-생성) | POST | `/running-sessions` | [sessions.md](./sessions.md) |
| S02 | [러닝 세션 조회](./sessions.md#s02-러닝-세션-조회) | GET | `/running-sessions/{sessionId}` | [sessions.md](./sessions.md) |
| S03 | [러닝 시작](./sessions.md#s03-러닝-시작) | POST | `/running-sessions/{sessionId}/start` | [sessions.md](./sessions.md) |
| S04 | [러닝 일시정지](./sessions.md#s04-러닝-일시정지) | POST | `/running-sessions/{sessionId}/pause` | [sessions.md](./sessions.md) |
| S05 | [러닝 재개](./sessions.md#s05-러닝-재개) | POST | `/running-sessions/{sessionId}/resume` | [sessions.md](./sessions.md) |
| S06 | [개인 러닝 종료](./sessions.md#s06-개인-러닝-종료) | POST | `/running-sessions/{sessionId}/finish` | [sessions.md](./sessions.md) |
| S07 | [러닝 취소](./sessions.md#s07-러닝-취소) | POST | `/running-sessions/{sessionId}/cancel` | [sessions.md](./sessions.md) |
| S08 | [러닝 설정·제어 기기 변경](./sessions.md#s08-러닝-설정제어-기기-변경) | PATCH | `/running-sessions/{sessionId}` | [sessions.md](./sessions.md) |
| S09 | [러닝 세션 삭제](./sessions.md#s09-러닝-세션-삭제) | DELETE | `/running-sessions/{sessionId}` | [sessions.md](./sessions.md) |
| S10 | [활성 러닝 이벤트 구독](./sessions.md#s10-활성-러닝-이벤트-구독) | GET | `/running-sessions/{sessionId}/events` | [sessions.md](./sessions.md) |
| P07 | [세션 BPM 조절](./pace-coaching.md#p07-세션-bpm-조절) | PUT | `/running-sessions/{sessionId}/bpm` | [pace-coaching.md](./pace-coaching.md) |
| H01 | [러닝 기록 목록](./running-records.md#h01-러닝-기록-목록) | GET | `/running-records` | [running-records.md](./running-records.md) |
| H02 | [러닝 기록 상세](./running-records.md#h02-러닝-기록-상세) | GET | `/running-records/{sessionId}` | [running-records.md](./running-records.md) |
| H03 | [구간별 러닝 분석 결과 조회](./running-records.md#h03-구간별-러닝-분석-결과-조회) | GET | `/running-records/{sessionId}/splits` | [running-records.md](./running-records.md) |
| H06 | [러닝 통계 요약](./running-records.md#h06-러닝-통계-요약) | GET | `/running-records/statistics` | [running-records.md](./running-records.md) |
| H07 | [평균 페이스 추이](./running-records.md#h07-평균-페이스-추이) | GET | `/running-records/statistics/pace-trend` | [running-records.md](./running-records.md) |
| G01 | [그룹런 생성](./group-runs.md#g01-그룹런-생성) | POST | `/group-runs` | [group-runs.md](./group-runs.md) |
| G02 | [그룹런 검색](./group-runs.md#g02-그룹런-검색) | GET | `/group-runs` | [group-runs.md](./group-runs.md) |
| G03 | [그룹런 상세](./group-runs.md#g03-그룹런-상세) | GET | `/group-runs/{groupRunId}` | [group-runs.md](./group-runs.md) |
| G04 | [그룹런 정보 수정](./group-runs.md#g04-그룹런-정보-수정) | PATCH | `/group-runs/{groupRunId}` | [group-runs.md](./group-runs.md) |
| G05 | [그룹런 참가](./group-runs.md#g05-그룹런-참가) | POST | `/group-runs/{groupRunId}/join` | [group-runs.md](./group-runs.md) |
| G06 | [그룹런 참가 취소](./group-runs.md#g06-그룹런-참가-취소) | DELETE | `/group-runs/{groupRunId}/participants/me` | [group-runs.md](./group-runs.md) |
| G07 | [그룹런 참가자 조회](./group-runs.md#g07-그룹런-참가자-조회) | GET | `/group-runs/{groupRunId}/participants` | [group-runs.md](./group-runs.md) |
| G09 | [그룹런 시작](./group-runs.md#g09-그룹런-시작) | POST | `/group-runs/{groupRunId}/start` | [group-runs.md](./group-runs.md) |
| G10 | [그룹런 실시간 현황·순위](./group-runs.md#g10-그룹런-실시간-현황순위) | GET | `/group-runs/{groupRunId}/live` | [group-runs.md](./group-runs.md) |
| G12 | [그룹런 전체 강제 종료](./group-runs.md#g12-그룹런-전체-강제-종료) | POST | `/group-runs/{groupRunId}/force-finish` | [group-runs.md](./group-runs.md) |
| G13 | [그룹런 취소](./group-runs.md#g13-그룹런-취소) | POST | `/group-runs/{groupRunId}/cancel` | [group-runs.md](./group-runs.md) |
| G14 | [그룹런 결과 조회](./group-runs.md#g14-그룹런-결과-조회) | GET | `/group-runs/{groupRunId}/results` | [group-runs.md](./group-runs.md) |
| G16 | [그룹런 대기방 준비 완료](./group-runs.md#g16-그룹런-대기방-준비-완료) | POST | `/group-runs/{groupRunId}/participants/me/ready` | [group-runs.md](./group-runs.md) |
| M01 | [크루 검색](./crews.md#m01-크루-검색) | GET | `/crews` | [crews.md](./crews.md) |
| M02 | [크루 상세](./crews.md#m02-크루-상세) | GET | `/crews/{crewId}` | [crews.md](./crews.md) |
| M03 | [크루 생성](./crews.md#m03-크루-생성) | POST | `/crews` | [crews.md](./crews.md) |
| M04 | [크루 가입 신청](./crews.md#m04-크루-가입-신청) | POST | `/crews/{crewId}/join-requests` | [crews.md](./crews.md) |
| M05 | [크루 가입 신청 목록](./crews.md#m05-크루-가입-신청-목록) | GET | `/crews/{crewId}/join-requests` | [crews.md](./crews.md) |
| M06 | [크루 가입 승인·거절](./crews.md#m06-크루-가입-승인거절) | PATCH | `/crews/{crewId}/join-requests/{userId}` | [crews.md](./crews.md) |
| M07 | [크루 멤버 목록](./crews.md#m07-크루-멤버-목록) | GET | `/crews/{crewId}/members` | [crews.md](./crews.md) |
| M08 | [크루 탈퇴](./crews.md#m08-크루-탈퇴) | DELETE | `/crews/{crewId}/members/me` | [crews.md](./crews.md) |
| M09 | [크루 멤버 내보내기](./crews.md#m09-크루-멤버-내보내기) | DELETE | `/crews/{crewId}/members/{userId}` | [crews.md](./crews.md) |
| M10 | [내 크루 목록](./crews.md#m10-내-크루-목록) | GET | `/users/me/crews` | [crews.md](./crews.md) |
| M11 | [크루 해산](./crews.md#m11-크루-해산) | DELETE | `/crews/{crewId}` | [crews.md](./crews.md) |
| CMT01 | [게시물 작성](./community.md#cmt01-게시물-작성) | POST | `/posts` | [community.md](./community.md) |
| CMT02 | [게시물 목록](./community.md#cmt02-게시물-목록) | GET | `/posts` | [community.md](./community.md) |
| CMT03 | [게시물 상세](./community.md#cmt03-게시물-상세) | GET | `/posts/{postId}` | [community.md](./community.md) |
| CMT04 | [게시물 수정](./community.md#cmt04-게시물-수정) | PATCH | `/posts/{postId}` | [community.md](./community.md) |
| CMT05 | [게시물 삭제](./community.md#cmt05-게시물-삭제) | DELETE | `/posts/{postId}` | [community.md](./community.md) |
| CMT06 | [댓글 목록](./community.md#cmt06-댓글-목록) | GET | `/posts/{postId}/comments` | [community.md](./community.md) |
| CMT07 | [댓글 작성](./community.md#cmt07-댓글-작성) | POST | `/posts/{postId}/comments` | [community.md](./community.md) |
| CMT08 | [댓글 수정](./community.md#cmt08-댓글-수정) | PATCH | `/comments/{commentId}` | [community.md](./community.md) |
| CMT09 | [댓글 삭제](./community.md#cmt09-댓글-삭제) | DELETE | `/comments/{commentId}` | [community.md](./community.md) |
| CMT10 | [반응 등록·변경](./community.md#cmt10-반응-등록변경) | PUT | `/posts/{postId}/reactions/me` | [community.md](./community.md) |
| CMT11 | [반응 취소](./community.md#cmt11-반응-취소) | DELETE | `/posts/{postId}/reactions/me` | [community.md](./community.md) |
| CMT12 | [커뮤니티 지역 목록](./community.md#cmt12-커뮤니티-지역-목록) | GET | `/regions` | [community.md](./community.md) |
| CMT13 | [통합 검색](./community.md#cmt13-통합-검색) | GET | `/search` | [community.md](./community.md) |
| F01 | [이미지 업로드](./files.md#f01-이미지-업로드) | POST | `/images` | [files.md](./files.md) |
| F02 | [이미지 조회](./files.md#f02-이미지-조회) | GET | `/images/{imageId}` | [files.md](./files.md) |

## 화면 설계 v10 대조 (2026-10-23)

화면 설계서 `RUNWAY 화면 맵 v10`과 대조해 빠진 API를 추가하고 부족한 파라미터를 보완했다. 추가·수정한 API에는 `관련 화면` 항목을 달았다. **응답 형식은 ERD 수정 중이라 화면 표시 항목 기준 후보로만 적었으며 ERD 확정 후 갱신한다.**

| 구분 | API | 내용 |
|---|---|---|
| 방식 변경 | U01 | 외부 제공자 토큰 로그인 → 아이디·비밀번호 로그인, 5회 실패 시 10분 제한 |
| 필드 변경 | U04·U05 | `ageGroup` → `birthDate`(생년월일), 프로필 사진 `profileImageId` |
| 신규 | U15~U23 | 회원가입, 아이디 중복 확인, 회원탈퇴(사전 정보·실행), 앱 설정 조회·변경, 러너 프로필, 팔로우·취소 |
| 신규 | H06·H07 | 러닝 통계 요약(주·월·년), 평균 페이스 추이 |
| 신규 | G16 | 대기방 준비 완료. 화면 v10에 있던 불참 기능은 사용자 결정에 따라 제외 |
| 신규 | M10 | 내 크루 목록(승인 대기 포함). M11 크루 자주 만난 장소는 사용자 결정으로 제외 |
| 신규 | CMT12·CMT13·F01 | 커뮤니티 지역 목록, 통합 검색, 이미지 업로드 |
| 파라미터 보완 | W01·W04 | 푸시 토큰, 이용약관·개인정보 동의 유형 |
| 파라미터 보완 | C01·C07·C09 | 준비도 자동 반영, 개인 저장 별명, 조건·난이도 필터 |
| 파라미터 보완 | S01 | 자유 러닝 목표 생략 허용, 경쟁 모드 비교 기록 |
| 파라미터 보완 | H01 | 개인/그룹런 탭, 정렬 |
| 파라미터 보완 | G01·G02·G13 | 만남 장소 상세·응답 마감·반복, 내 근처·내 참가·레벨 필터, 취소 사유·남길 말 |
| 파라미터 보완 | M01·M03 | 내 근처·레벨 필터, 대표 사진·지역·레벨·정원 |
| 파라미터 보완 | CMT01·CMT02·CMT04 | 사진·계정 공개 정책, 지역·팔로잉 필터, 코스 공유 수정 |

화면과 기존 정책이 충돌해 결정이 필요한 항목:

- [x] C04 수동 코스 등록 제외. 러닝 경로 자동 등록으로 변경, 개인 코스 저장 유지
- [ ] 8.2 프로필 수정 '연령대' UI ↔ 생년월일 입력 (U05)
- [x] 크루 가입 방식 — 크루장 승인 필수로 확정 (M03·M04)
- [x] 그룹런은 참가·참가 취소만 제공. 별도 불참 응답 제외
- [ ] 7.1 검색창 유지 여부 (CMT13)

## 설계 확정 범위와 착수 전 확인

아래 구분은 설계 기준이며 코드 구현·배포·실기기 검증 완료를 뜻하지 않는다. 각 상세 명세의 확정 절을 우선하며, 다른 API의 초안까지 확정한 것으로 해석하지 않는다.

| 구분 | 확정 내용 | 기준 문서 |
| --- | --- | --- |
| 인증 | JWT 서명·만료, Argon2id, 로그인 실패 제한, Redis 갱신 권한 저장·폐기 | [인증 정책](users.md#인증-정책-적용-범위), ADR-0014·0015 |
| 온라인 러닝 연동 | 워치↔폰 MessageClient, 폰→서버 HTTPS, 서버→폰 SSE, 5초 배치·단계별 저장 확인 | [173번 온라인 계약](devices-health.md#173번-온라인-확정-계약), [통합 설계](../watch-mobile-server-integration.md) |
| 기록 삭제 | 종료된 기록과 본인 공유 게시물의 일괄 삭제 표시, 개인 조회 제외·그룹 결과/코스 보존 | [S09](sessions.md#s09-러닝-세션-삭제), [공유 게시물](community.md#운동-기록과-공유-게시물의-삭제) |
| 준비 취소 | 본문 없음, 200 id/status, 인증·소유권·부재 오류, 미확정 START 차단·동일 취소 재응답 | [S07](sessions.md#s07-러닝-취소) |
| 세션 제어·코칭 | 서버 승인→실행→결과 저장, 단일 상태 버전, 코칭 유효성·만료 명령 결과 확인 | [세션 제어](sessions.md#세션-제어-공통-계약), [코칭](pace-coaching.md) |
| 시작 미확인·그룹 종료 | 명시적 중단, 재연결 시 측정 중지, 늦은 시작·기록 복구 제외 | [시작 미확인 중단](sessions.md#s08-러닝-설정제어-기기-변경), [그룹런](group-runs.md) |
| 기기 등록·조회·해제 | 회원별·유형별 연결 중 기기 1대, 신규 201·같은 유형 재요청 200, 해제 멱등 200·타인/없음 404, 설치 식별자·메타데이터·푸시 토큰·lastSeenAt 미저장, 기기 교체는 W03 후 W01 | [W01~W03](devices-health.md#w01-기기-등록) |
| 건강정보 동의 변경·조회 | W04는 HEALTH_DATA만 `{consentType, granted}`로 변경(같은 값 멱등 200, 필수 3종 422), W05는 4종 고정 순서. 이력·약관 버전 미저장. 중복 키 400. 철회는 세션 생성 잠금 → 회원 행 갱신 → 본인 진행 가능 세션 행 FOR SHARE 순서로 W06·W07·준비도와 순서 보장, 기존 기록 미삭제 | [W04~W05](devices-health.md#w04-수집-동의철회) |

**착수 전 결정이 필요한 항목**

| 대상 | 남은 결정 | 구현에 미치는 영향 |
| --- | --- | --- |
| [W06 건강 기록](devices-health.md#w06-samsung-health-데이터-동기화) | 일상 심박 추정값 외 지표(수면·활동량·과거 운동)의 형식·외부 기록 ID·저장 매핑·W07 중복 처리 | 일상 심박 추정값은 S15P31E105-252에서 확정. 다른 지표는 SDK에서 읽을 수 있는 값과 서버 저장 항목을 대조한 뒤 `type` 추가 |
| 코스·그룹 집계 | 동일 코스 다회 완주의 기본 비교 대상, 자유 그룹런 선두·경로·순위·선두 교체 | 세션 연결·종료 계약과 구분해 해당 기능 착수 전에 확정 |
| 개인정보·삭제·알림 | 현재 확정한 계정 공개·알림 종류 이외의 보존·삭제·추가 알림 정책 | 확정된 공통 정책을 유지하고 상세 미정 사항은 해당 API에서 결정 |

기기 등록·동의 확인은 온라인 러닝 준비에도 필요한 선행 기능이다. 워치·폰·서버 통신 계약은 구현 기준으로 사용할 수 있지만, 기기 등록 계약(W01~W03)은 S15P31E105-251에서 확정했다. 설치 식별자 기반 충돌 판정과 푸시 토큰 등록은 후속 업무다. 가입·동의 상세 계약은 별도 업무에서 확정하며 이번 MR의 확정 범위에 포함하지 않는다.

## 자동 처리 분리 결과 (2026-10-23)

| 기존 ID | 공개 API에서 제외한 이유 | 기능 제공 방식 |
|---|---|---|
| R01 | 컨디션 입력·평가 실행 요청 없음 | 건강·활동 데이터 변경 시 자동 평가, R02 결과 조회 |
| P01 | 세션 준비 후 별도 전략 생성 요청 불필요 | 내부 자동 생성, 세션 준비 결과·갱신 전달 |
| P05 | 운동 중 기록 비교는 자동 계산 | 세션 복구 상태와 지속 전달에 포함 |
| P06 | 내부 개인화 프로필 조회 화면 없음 | 모델 내부 관리, 필요한 목표 BPM만 전달 |
| G08 | 별도 공동 페이스 계산 요청 없음 | 내부 자동 계산, G03 대기방 조회 및 변경 전달 |
| G11 | 알림 목록 조회 화면 없음 | 페이스·격차 등 조건 충족 시 알림 전송 |
| G15 | 사용자 결정에 따라 불참 기능 제외 | G05 참가·G06 참가 취소 |

제외한 ID는 재사용하지 않는다. G10은 그룹 상태 복구용 조회이며 코칭·순위 계산의 실행 조건이 아니다.
P07은 세션 BPM 조절, G12는 그룹장 전용 전체 강제 종료로 변경했다. 경로·필드의 구체적 형식은 설계 제안이며 구현 완료를 뜻하지 않는다.

## 추가 검토 반영 — 코스·지속 수집·계정 공개 정책

| ID | 반영 내용 |
|---|---|
| C02 | 별도 공용 이름 검색 제외. C01 추천 조건 필터로 통합 |
| C04 | 수동 등록 API 제거. 러닝 경로 확정 후 자동 코스 반영 |
| C07·C09 | 공용 코스 이름 없이 본인 저장 관계의 별명 설정·변경·조회 |
| M11 | 크루 자주 만난 장소 기능 제거 후, 동일 ID를 크루 해산(DELETE `/crews/{crewId}`)으로 재사용 |
| W06·W07 | 앱 서비스의 자동 업로드 API. 서버 내부 계산과 구분. W07은 온라인 불변 batch·제한 재시도·서버 저장 ACK |
| P02·P03·P04 | 별도 REST 요청 제외. 전략·코칭은 세션 준비·갱신·복구로 제공, 측정값은 W07 자동 전송 |
| H04 | 원본 GPS 별도 조회 제거. H02·공유 게시물에 표시용 경로 그림 제공 |
| H05 | 기록별 공개 설정 제거. 원본 기록은 본인, 공유 게시물·프로필은 계정 정책 적용 |
| U13·U14 | 계정 공개 여부로 통일. 공개는 전체, 비공개는 본인·승인된 팔로워. 공개 전환 시 유효한 대기 요청 전부 자동 승인 |
| U22·U23 | 공개 계정 즉시 팔로우 / 비공개 계정 요청 생성, 팔로우·대기 요청 취소 |
| U24·U25 | 받은 요청 목록, 본인에게 들어온 요청 승인·거절 추가 |
| CMT13 | 공용 코스 이름 검색 제외. 러너·크루 검색만 유지 |

계정 정책은 [계정 공개·팔로우 명세](./users.md)를 따른다. 기존 ERD와 화면 맵의 이름·공개 필드·조회 전제는 해당 사용자 결정에 맞춰 후속 정리가 필요하다.

## API·자동 실행 재점검

173의 실시간 전달·실제 제어 결과 저장·준비/분석 상태 계약은 아래 정본에 확정했다. API 수91개에는 새 S10 SSE 구독이 포함된다. 설계 승인과 실행 코드·서비스 DB 적용·실기기 검증은 구분한다.

최신 사용자 결정: 출발 전 목표 수정(S08)·출발 후 고정, 자유러닝 목표는 선택 입력이며 모드별 AI 동작 확정([상세 정책](../requirements.md#러닝-모드별-ai-동작)), 실제 시작 참가자만 그룹 진행 판정, 강제 종료 시각까지 기록 반영, 러닝 경로 자동 코스 등록(C04 제거).

## 173 확정 계약과 별도 도메인 항목

온라인 MVP의 데이터 모델 확장은 현재 운동 상태 저장·필요한 제어 결과 기록·오래된 코칭 차단으로 제한한다. [세션 공통 계약](sessions.md#세션-제어-공통-계약)은 서버 BIGINT 명령 ID와 단일 상태 버전, [P07](pace-coaching.md#p07-세션-bpm-조절)은 실제 BPM과 코칭 만료, [통합 설계](../watch-mobile-server-integration.md#9-워치폰-messageclient-메시지-명세)는16개 메시지 경로를 정의한다. S10의 전체 상태 전달과 기존 W07 batch/저장 ACK를 유지한다.

추가 UUID 컬럼·제어 해시·분리된 준비/BPM/전달 버전·분석 임대/재시도·종료 마감 해시는 사용하지 않는다. 데이터 모델은 [ERD](../db/erd.md)를 따른다. API 수91개는 유지하며 서비스 코드·운영 DB 적용·실기기 검증 완료를 뜻하지 않는다.

W06 실제 SDK 지표·권한 실측, 푸시 토큰 교체·해제, 크루·팔로우 알림, 공개/별명/팔로우 정합성은 별도 도메인 항목이다.

워치로 시작한 운동은 폰 인터넷이 유지되면 S08 TAKE_OVER_PHONE으로 GPS 기록을 이어가고 S04/S05/S06에서도 워치와 같은 REQUEST 승인 → 실행 → RESULT 보고로 폰에서 제어·종료·저장한다. 워치 없는 새 시작은 이 경로에 포함하지 않는다.

## 내부 운영 상태 검사

회원 API와 별도로 컨테이너 루프백 관리 포트 `127.0.0.1:8082`에서만 `GET /actuator/health/readiness`를 제공한다.
앱 준비 상태·DB·인증 Redis가 정상이면 `200 {"status":"UP"}`, 비정상이면 `503`과 상태만 반환한다.
일반 API 포트·외부 프록시에서는 접근을 허용하지 않으며, 앱/회원 인증 예외 경로에 추가하지 않는다.
실행·검증 방법은 [백엔드 실행 안내](../../../backend/README.md#내부-상태-검사)를 따른다.