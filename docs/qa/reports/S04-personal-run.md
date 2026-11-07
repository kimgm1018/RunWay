# S04 개인 러닝 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S04 개인 러닝(시작~종료~기록) |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`http://127.0.0.1:8080/api/v1`) · OpenAPI `/v3/api-docs` 확인 · AI(`:8000` health 200) · API 주도(폰/워치 UI 미사용) |
| 계정 | A=`qahost01` |
| 기기(서버) | WATCH `deviceId=5` · PHONE `deviceId=6` (W-A 실물 충전 중 → UI/실센서 Blocked, API 제어만) |
| 주 E2E sessionId | **14** (목표 자유런 → pause/resume → BPM → W07 → finish) |
| 보조 | 무목표 `sessionId=15` · 정리 완료 `8`,`13` |
| 실행자 | AI(API) |
| 종합 판정 | **Partial** (High API 통과, 코스·워치 UI Blocked, AI 코칭 Partial) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 실행 불통과 0건 → 이미지 없음 |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §5  
API: `docs/design/api/sessions.md`(S01~S06), `running-records.md`(H01/H02/H03), `devices-health.md`(W07), `pace-coaching.md`(P07)

---

## 요약표

| ID | 시나리오 | P | 결과 |
| --- | --- | --- | --- |
| TC-S04-01 | 코스 러닝 시작 | High | **Blocked** |
| TC-S04-02 | 목표 있는 자유런 | High | **통과** |
| TC-S04-03 | 무목표 자유런 | High | **통과** |
| TC-S04-04 | 일시정지/재개 | High | **통과** |
| TC-S04-05 | 종료·업로드 | High | **통과** |
| TC-S04-06 | BPM 가이드·수동 조정 | Med | **통과** |
| TC-S04-07 | AI 코칭 수신 | Med | **Partial** |
| TC-S04-08 | 워치 끊김 후 폰 인계 | Med | **Blocked** |
| TC-S04-09 | 기록 목록·상세 | High | **통과** |
| TC-S04-10 | 배치 중복(W07) | Med | **통과** |

---

## 사람이 재현할 실패 목록

| ID | 결과 | 재현 메모 |
| --- | --- | --- |
| (없음) | — | 본 실행에서 **불통과 0건**. |

### 환경·후속 재실행

| 항목 | 메모 |
| --- | --- |
| TC-S04-01 | S03 Route `/internal/v1/ready` 복구 후 ACTIVE `courseId` 확보 → 코스 세션 생성·시작 재검증. W-A UI는 충전 후. |
| TC-S04-07 | AI `:8000` 가동 확인됨. 자동 코칭은 **폰 S10 구독**이 있는 세션에만 발행(계약). API-only로는 Partial. 폰 SSE/구독 + W07 연속 업로드로 재검증. |
| TC-S04-08 | **W-A 충전 완료 후** 실워치 끊김 → 폰 인계(`recordingMode`/`PHONE_FALLBACK`) UI·센서 TC. |
| 잔여 세션 | 이전 S06과 같이 RUNNING+pending START/END가 있으면 `ACTIVE_SESSION_EXISTS`. 정리: pending RESULT=`REJECTED` 또는 END RESULT `APPLIED`+`uploadComplete=true`(`appliedAt` > `startedAt`). |
| 목표 조합 | `targetDistanceM`+`targetDurationSec`+`targetPaceSecPerKm` 동시 → `422 INVALID_GOAL`. 본 실행은 거리 5000m + 페이스 360초/km. |

---

## TC-S04-01 — 코스 러닝 시작

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-01 |
| 우선순위 | High |
| 사전조건 | ACTIVE 코스, W-A(또는 등록 WATCH) |
| 절차 | 1. 북마크·courseId 1~29 조회 2. 코스 세션 생성·시작 |
| 기대 결과 | READY→RUNNING, 워치/폰 표시 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음(환경). ACTIVE course 없음. S03 Route ready 실패로 신규 코스 생성 불가. W-A UI도 충전 중 |
| 개선점 | Route 복구 후 C01→저장→S01(courseId)→S03 start |
| 증거 | `courseId=null`, bookmarked/probe 실패 |

---

## TC-S04-02 — 목표 있는 자유런

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-02 |
| 우선순위 | High |
| 사전조건 | WATCH=5, PHONE=6, 활성 세션 없음 |
| 절차 | 1. `POST /running-sessions` `{targetDistanceM:5000, targetPaceSecPerKm:360}` 2. START REQUEST/RESULT |
| 기대 결과 | plan 생성, READY→RUNNING |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `sessionId=14`, `hasPlan=true`(`planId`·`recommendedPaceSecPerKm`·`segments`), start→`RUNNING` stateVersion=2 |

---

## TC-S04-03 — 무목표 자유런

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-03 |
| 우선순위 | High |
| 사전조건 | 기기 등록, 활성 세션 없음 |
| 절차 | 1. 목표 필드 생략 생성 2. START |
| 기대 결과 | `plan=null`, 사전 계획 대기 없이 시작 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `sessionId=15`, `plan=null`, START→`RUNNING` |

---

## TC-S04-04 — 일시정지/재개

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-04 |
| 우선순위 | High |
| 사전조건 | session 14 RUNNING |
| 절차 | 1. PAUSE REQUEST/RESULT 2. RESUME REQUEST/RESULT |
| 기대 결과 | PAUSED↔RUNNING |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 워치·폰 UI 일시정지 구간 표시는 W-A 충전 후 |
| 증거 | pause→`PAUSED` v3 · resume→`RUNNING` v4 · commandId 22/23 |

---

## TC-S04-05 — 종료·업로드

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-05 |
| 우선순위 | High |
| 사전조건 | session 14 RUNNING, W07 batch 업로드 후 |
| 절차 | 1. FINISH REQUEST 2. RESULT `APPLIED`+`uploadComplete=true`(`appliedAt`>`startedAt`) |
| 기대 결과 | COMPLETED, analysis PENDING→READY |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 동일 초 `appliedAt==startedAt`이면 400「실제 종료시각은 실제 시작시각보다 늦어야」— QA/클라이언트는 ≥1.5s 간격 권장 |
| 증거 | `COMPLETED` v7, `endedAt=2026-11-07T05:52:09Z`, analysis `PROCESSING`→`READY` |

---

## TC-S04-06 — BPM 가이드·수동 조정

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-06 |
| 우선순위 | Med |
| 사전조건 | session 14 RUNNING |
| 절차 | 1. P07 SET_BPM 160 REQUEST/RESULT 2. 155로 재변경 |
| 기대 결과 | `currentBpm` 반영, 영구 고정 아님 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | bpm 160→155, commandId 24 |

---

## TC-S04-07 — AI 코칭 수신

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-07 |
| 우선순위 | Med |
| 사전조건 | AI URL, 러닝 중 W07 |
| 절차 | 1. AI health 확인 2. W07 추가 업로드 3. S02 `coaching`/`pendingCommand` 폴링 |
| 기대 결과 | Cue/가이드, level 변경 시 발행 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Partial** |
| 불통과 사유 | 해당 없음. AI `:8000` 가동·W07 저장은 되나 S10 구독 없이 `coaching=null` 유지(계약상 구독 세션만 자동 코칭) |
| 개선점 | 폰 S10 연결 후 동일 session에 W07 연속 업로드로 재검증 |
| 증거 | AI health 200, coaching null |

---

## TC-S04-08 — 워치 끊김 후 폰 인계

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-08 |
| 우선순위 | Med |
| 사전조건 | W-A 실사용 |
| 절차 | 워치 끊김 → 폰 GPS 인계 → 종료·저장 |
| 기대 결과 | 폰 GPS 계속, 종료·저장 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음. W-A 충전 중, 실센서·끊김 UI 불가 |
| 개선점 | W-A 충전 후 실기기 시나리오 실행 |
| 증거 | — |

---

## TC-S04-09 — 기록 목록·상세

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-09 |
| 우선순위 | High |
| 사전조건 | 완료 세션 14 |
| 절차 | 1. `GET /running-records?runType=SOLO` 2. `GET /running-records/14` 3. `/splits` |
| 기대 결과 | 본인 목록에 포함, 상세·구간 분석 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | list ids `[15,14,13,8]`, detail 200, splits 1구간(`endDistanceM=50`, HR≈149.5) |

---

## TC-S04-10 — 배치 중복(W07)

| 항목 | 내용 |
| --- | --- |
| ID | TC-S04-10 |
| 우선순위 | Med |
| 사전조건 | session 14 RUNNING |
| 절차 | 1. `POST /sync/batches` 합성 METRIC+GPS 2. 동일 body 재전송 |
| 기대 결과 | 둘 다 COMMITTED ACK, 중복 저장 없음(동일 acceptedCount) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `batchId=58667160-4319-4b6f-a0b1-82e06798cea1`, 1st/2nd 모두 `COMMITTED` `acceptedCount=2` |

---

## sessionId 요약

| 용도 | sessionId | 최종 상태 |
| --- | --- | --- |
| 주 E2E(목표·pause·BPM·W07·finish·기록) | **14** | COMPLETED · analysis READY |
| 무목표 자유런 | **15** | COMPLETED(종료 후 목록 포함) |
| 사전 정리 | 13 | pending END → RESULT로 COMPLETED |
| 이전 잔여 | 8 | 사전 실행에서 COMPLETED |
