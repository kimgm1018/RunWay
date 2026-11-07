# S09 권한·보안·회귀 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S09 권한·보안·회귀 |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`http://127.0.0.1:8080/api/v1`) · OpenAPI 확인 · API 주도(에뮬 UI 미사용) |
| 계정 | A=`qahost01` / B=`qawatchb01` / 탈퇴=`qatest`(WITHDRAWN) |
| 실행자 | AI(API) |
| 종합 판정 | **Partial** (High 통과, Med Partial 1, Low Blocked 1) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 실행 불통과 0건 → 이미지 없음 |
| 증거 JSON | `.qa-local/s09-results.json` (Git 제외) |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §10

---

## 요약표

| ID | 시나리오 | P | 결과 |
| --- | --- | --- | --- |
| TC-S09-01 | 타 계정 리소스 | High | **통과** |
| TC-S09-02 | 만료/위조 토큰 | High | **통과** |
| TC-S09-03 | 탈퇴 후 토큰 | Med | **Partial** |
| TC-S09-04 | 에뮬 한글 입력 | Low | **Blocked** |
| TC-S09-05 | 대기방 409 문구 | Med | **통과** |

---

## 사람이 재현할 실패 목록

| ID | 결과 | 재현 메모 |
| --- | --- | --- |
| (없음) | — | 본 실행에서 **불통과 0건**. |

### Partial / Blocked (재현 선택)

| ID | 결과 | 메모 |
| --- | --- | --- |
| TC-S09-03 | Partial | `qatest` 로그인 → 401 `INVALID_CREDENTIALS`. 탈퇴 직전 Access 미보유 → JWT 잔여 10분 실측 불가. 정책: `docs/design/api/users.md` |
| TC-S09-04 | Blocked | Android 에뮬 IME 한글. 지역 검색은 붙여넣기·목업(`광안리`)·실기기 |

---

## TC-S09-01 — 타 계정 리소스

| 항목 | 내용 |
| --- | --- |
| ID | TC-S09-01 |
| 우선순위 | High |
| 사전조건 | A/B 로그인 |
| 절차 | 1. A 전용 크루·그룹런 생성 2. B 토큰으로 해당 `groupRunId` 조회·참가자·참가 3. B로 공유 크루 가입신청 목록 |
| 기대 결과 | 403/404 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 크루 상세 GET은 비멤버도 200(공개 프로필). 권한 거부는 그룹런·관리 API에서 검증 |
| 증거 | A `crewId=12` / `groupRunId=12`. B → G03·G07·join 모두 **403** `CREW_FORBIDDEN`. B → crew9 join-requests **403** `NOT_ADMIN` |

---

## TC-S09-02 — 만료/위조 토큰

| 항목 | 내용 |
| --- | --- |
| ID | TC-S09-02 |
| 우선순위 | High |
| 사전조건 | BE JWT 서명키 로컬 주입 |
| 절차 | 1. garbage·서명 위조 Bearer 2. 만료 JWT 합성(`iat/exp` 과거, HS256) 후 `GET /users/me` |
| 기대 결과 | 401 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | garbage/tampered/emptySig/expired 모두 **401** `UNAUTHORIZED` |

---

## TC-S09-03 — 탈퇴 후 토큰

| 항목 | 내용 |
| --- | --- |
| ID | TC-S09-03 |
| 우선순위 | Med |
| 사전조건 | `qatest` 이미 WITHDRAWN(S01) |
| 절차 | 1. `qatest` 로그인 시도 2. (가능 시) 탈퇴 직전 Access로 보호 API |
| 기대 결과 | 기기·API 거부 / 재로그인 불가 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Partial** |
| 불통과 사유 | 해당 없음(불통과 아님). 탈퇴 직전 토큰 미보유로 잔여 JWT 실측 불가 |
| 개선점 | 신규 탈퇴 계정으로 직전 Access 확보 후 재검증 시 Full Pass 가능 |
| 증거 | 로그인 **401** `INVALID_CREDENTIALS` / `아이디 또는 비밀번호가 올바르지 않습니다.` |
| 정책 | 탈퇴·로그아웃 후 기존 Access는 원래 `exp`까지 **최대 약 10분** 유효. 즉시 차단 목록 없음. 새 발급·갱신 거부 (`docs/design/api/users.md`, API README). 기기 API는 탈퇴 회원 잔여 Access에 대해 401을 명시(`devices-health.md`) |

---

## TC-S09-04 — 에뮬 한글 입력

| 항목 | 내용 |
| --- | --- |
| ID | TC-S09-04 |
| 우선순위 | Low |
| 사전조건 | Android 에뮬 |
| 절차 | 지역 검색 한글 입력 |
| 기대 결과 | IME/붙여넣기 우회 문서화 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 실기기 IME 또는 붙여넣기·목업 키워드(`광안리`)로 우회 |

---

## TC-S09-05 — 대기방 409 문구

| 항목 | 내용 |
| --- | --- |
| ID | TC-S09-05 |
| 우선순위 | Med |
| 사전조건 | S06 잔여 또는 신규 CANCELLED 그룹런 |
| 절차 | 1. CANCELLED 그룹런 G03 2. G16 ready → 409 3. FE 대기방 문구와 G13 취소 안내 구분 |
| 기대 결과 | “취소되었거나 종료” ≠ 실제 G13 취소 안내로 오인되지 않음 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | G13 `cancelMessage`를 넣어도 G03 `cancellation.message`가 null인 관측(알림 일회성 가능). FE는 상태/409를 고정 문구로 매핑 |
| 증거 | `groupRunId=13` CANCELLED. G16 → **409** `INVALID_GROUP_STATE` / `출발 전 대기방에서만 준비를 변경할 수 있습니다.` |
| FE | `watchStart`·`WaitingRoomScreen.observeError` → `그룹런이 취소되었거나 종료되었어요.` (상세 확인 안내). G13 취소 알림/`cancelMessage`와 문구·경로가 다름 |

---

## 환경 주의

- JWT 합성은 `backend/.env`의 `BACKEND_JWT_SECRET_BASE64`를 스크립트가 내부 로드(값 미출력).
- 계정·토큰은 `.qa-local/account-*.env` / 프로세스 메모리. 보고서·콘솔에 비밀 미기재.
