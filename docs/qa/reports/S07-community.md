# S07 커뮤니티·팔로우·알림함 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S07 커뮤니티·팔로우·알림함 |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`:8080`) · API 전용 |
| 계정 | A=`qahost01`(userId=5) / B=`qawatchb01`(userId=4, 닉 `QA워치B`) |
| 실행자 | AI(API) |
| 종합 판정 | Partial (High 게시·팔로우·알림 통과 · Med/기타 미실행) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 Suite 불통과 없음 |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §8

---

## TC-S07-01 — 게시 작성/수정/삭제

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-01 |
| 우선순위 | High |
| 사전조건 | A, 완료 러닝 세션 |
| 절차 | 1. `GET /api/v1/running-records` 2. sessionId=15로 CMT01~05(작성·조회·수정·삭제) |
| 기대 결과 | 본인만 수정·삭제 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

검증(재실행 2026-11-07, OpenAPI `POST/PATCH/DELETE /api/v1/posts`): sessionId=15 → CMT01 `201` postId=`1` → CMT04 body 갱신 `200` → CMT05 `200` 후 CMT03 `404 POST_NOT_FOUND`.

---

## TC-S07-02 — 기록 공유 게시

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-02 |
| 우선순위 | High |
| 사전조건 | 완료 기록 |
| 절차 | sessionId=14로 CMT01 공유 작성 후 CMT03 상세 확인 |
| 기대 결과 | 요약 노출, 원본 GPS 비공개 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

검증: sessionId=14 → CMT01 `201` postId=`2`. CMT03 `recordSummary`=`distanceM=50`, `movingDurationSec=7`, `averagePaceSecPerKm=140`. 상세 응답에 GPS/track 좌표 배열 없음(원본 H02 경로 미포함).

---

## TC-S07-03 — 댓글·좋아요

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-03 |
| 우선순위 | Med |
| 사전조건 | 게시물 |
| 절차 | 미실행 |
| 기대 결과 | POST_COMMENT 등 알림 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

---

## TC-S07-04 — 공개 팔로우

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-04 |
| 우선순위 | High |
| 사전조건 | A 공개(`isPrivate=false`), community 알림 on |
| 절차 | 1. A U14 공개 2. B→A `PUT /users/{A}/follow`(U22) 3. B가 A 프로필 followStatus 확인 4. A N01에 `NEW_FOLLOWER` |
| 기대 결과 | 즉시 FOLLOWING |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

검증: U22 `followStatus=FOLLOWING`, `followerCount=1`. N01에 `NEW_FOLLOWER`(targetId=B).

---

## TC-S07-05 — 비공개 팔로우 요청·승인

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-05 |
| 우선순위 | High |
| 사전조건 | A 비공개 |
| 절차 | 1. A `isPrivate=true` 2. B U22 → PENDING 3. A U24 목록 확인 4. A U25 `APPROVE` 5. B 프로필 FOLLOWING |
| 기대 결과 | 요청·승인 흐름 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

검증: 요청 `PENDING` → U24 1건(`requestId` 확인) → U25 승인 후 B `followStatus=FOLLOWING`. A N01에 `FOLLOW_REQUEST`, B N01에 `FOLLOW_APPROVED`.

---

## TC-S07-06 — 비공개→공개 전환

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-06 |
| 우선순위 | Med |
| 사전조건 | 대기 요청 |
| 절차 | 미실행(승인 경로를 우선 검증) |
| 기대 결과 | 대기 요청 자동 승인 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | PENDING 잔존 상태에서 U14 공개 전환 별도 실행 |

---

## TC-S07-07 — 알림함 목록/읽음 (N01/N02)

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-07 |
| 우선순위 | High |
| 사전조건 | 팔로우 이벤트 발생 |
| 절차 | 1. N01 목록·kind·targetId 확인 2. N02 `POST /notifications/read-all` 3. unreadCount=0 4. community off 시 미생성 재확인 |
| 기대 결과 | kind·target, 읽음 처리, community off면 미생성 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

검증:
- N01: A에 `NEW_FOLLOWER`·`FOLLOW_REQUEST`, B에 `FOLLOW_APPROVED` 등. `targetId` 존재.
- N02: 204 후 A `unreadCount=0`, items 전부 `read=true`.
- community off 재확인: A `notifications.community=false` 후 unfollow→follow 재수행 시 **신규 알림 ID 0건**. (S01 보고서 인용: `community=false` 시 팔로우 알림 0건, `true` 시 `NEW_FOLLOWER` — `docs/qa/reports/S01-auth-profile-settings.md` 검증 메모와 일치)

---

## TC-S07-08 — 그룹런 취소 알림

| 항목 | 내용 |
| --- | --- |
| ID | TC-S07-08 |
| 우선순위 | High |
| 사전조건 | G13 취소 |
| 절차 | 미실행(S06 연계) |
| 기대 결과 | `GROUP_RUN_PARTICIPATION_CANCELLED` |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | S06 G13과 연계 실행 |

---

## 실행 요약

| ID | 결과 |
| --- | --- |
| TC-S07-01 | 통과 (postId=1, sessionId=15 CRUD 후 삭제) |
| TC-S07-02 | 통과 (postId=2, sessionId=14 요약 공유) |
| TC-S07-03 | 미실행 |
| TC-S07-04 | 통과 |
| TC-S07-05 | 통과 |
| TC-S07-06 | 미실행 |
| TC-S07-07 | 통과 (N01/N02 + community off 재확인) |
| TC-S07-08 | 미실행 |
