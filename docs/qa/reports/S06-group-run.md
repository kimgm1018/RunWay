# S06 그룹런 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S06 그룹런 (2인 핵심) |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`http://127.0.0.1:8080/api/v1`) · OpenAPI `/v3/api-docs` 확인 · API 주도(폰/워치 UI 미사용) |
| 계정 | A=`qahost01` / B=`qawatchb01` |
| 크루 | `crewId=9` `[QA] S06 crew` (기존 `crewId=5` `[QA] S05 crew` 존재했으나 B APPROVED 복구 실패 → 신규 생성·B 신청·A 승인) |
| 주 E2E groupRunId | **11** (`[QA] S06 e2e main`, `scheduledAt≈now+15m`) |
| 보조 | far=`9` (대기방 미오픈) · cancel=`10` (G13 전용) |
| 실행자 | AI(API) |
| 종합 판정 | **Partial** (필수 High API TC 통과, 워치 UI TC-S06-22 Blocked) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 실행 불통과 0건 → 이미지 없음 |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §7  
API 계약: `docs/design/api/group-runs.md` (G01/G03/G05/G07/G09/G10/G13/G16)

---

## 요약표

| ID | 시나리오 | P | 결과 |
| --- | --- | --- | --- |
| TC-S06-01 | A 그룹런 생성 (crewId 필수) | High | **통과** |
| TC-S06-03 | B 참가 | High | **통과** |
| TC-S06-06 | 출발 후 수정 불가 | High | **통과** |
| TC-S06-07 | A 취소 G13 (별도 그룹런) | High | **통과** |
| TC-S06-09 | 대기방 미오픈 | High | **통과** |
| TC-S06-10 | 대기방 오픈 | High | **통과** |
| TC-S06-11 | participantCount/readyCount | High | **통과** |
| TC-S06-12 | B 준비 완료 G16 | High | **통과** |
| TC-S06-13 | A 준비 완료 G16 | High | **통과** |
| TC-S06-17 | A만 G09 start | High | **통과** |
| TC-S06-18 | B start → NOT_HOST | High | **통과** |
| TC-S06-19 | 준비 없이 start 실패 | High | **통과** |
| TC-S06-20 | 라이브 G10 | High | **통과** |
| TC-S06-22 | 워치 그룹 순위 UI | Med | **Blocked** |
| TC-S06-26 | RUNNING 재입장 대기방 | High | **통과** |

Med/Low·미실행(FE 전용 등): TC-S06-02/04/05/08/14/15/16/21/23/24/25 — 본 API High 중심 실행에서 미포함.

---

## 사람이 재현할 실패 목록

| ID | 결과 | 재현 메모 |
| --- | --- | --- |
| (없음) | — | 본 실행에서 **불통과 0건**. |

### 환경 주의 (재실행 시)

- G16 ready 전 A/B에 **잔여 RUNNING + pending START**가 있으면 `ACTIVE_SESSION_EXISTS`로 ready 실패.
  - 정리: pending START에 `POST .../start` RESULT=`REJECTED`(`reasonCode`·`appliedAt` null 명시) → `POST .../finish` REQUEST/RESULT.
  - 이전 GR5 강제종료만으로는 세션이 남아 있을 수 있음(본 실행에서 관측).
- `canEnterRoom`은 **FE 헬퍼**(`frontend/.../parts.tsx`). API 응답 필드 없음 → G03 `scheduledAt`+`status`+joined로 동일 규칙 검증.

---

## TC-S06-01 — A 그룹런 생성

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-01 |
| 우선순위 | High |
| 사전조건 | 공동 크루 `9`, B APPROVED |
| 절차 | 1. A `POST /group-runs` (`crewId=9`, title=`[QA] S06 e2e main`, `scheduledAt=now+15m`, meeting·TIME 목표) |
| 기대 결과 | 201, `status=SCHEDULED`, crewId 필수 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `groupRunId=11`, `scheduledAt=2026-11-07T05:57:39Z` |

---

## TC-S06-03 — B 참가

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-03 |
| 우선순위 | High |
| 사전조건 | 모집 중 groupRunId=11 |
| 절차 | 1. B `POST /group-runs/11/join` 2. G07 확인 |
| 기대 결과 | participant 행, joined |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | join 200, `participantCount=2`, userIds `[5,4]` |

---

## TC-S06-07 — A 취소 G13 (별도 그룹런)

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-07 |
| 우선순위 | High |
| 사전조건 | E2E와 분리된 SCHEDULED 그룹런 |
| 절차 | 1. A 생성 `[QA] S06 cancel-only` → B join 2. B cancel 시도 3. A `POST .../cancel` `{cancelReason:OTHER, cancelMessage}` |
| 기대 결과 | CANCELLED; B는 NOT_HOST |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 알림함(S07-08)은 본 Suite 범위 외 — 미검증 |
| 증거 | `groupRunId=10` CANCELLED; B cancel `403 NOT_HOST` |

---

## TC-S06-09 — 대기방 미오픈

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-09 |
| 우선순위 | High |
| 사전조건 | `scheduledAt=now+2h` |
| 절차 | 1. A 생성 far 그룹런 → B join 2. G03 조회 후 FE `canEnterRoom` 규칙 계산 |
| 기대 결과 | 입장 비활성 (`canEnterRoom=false`) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `groupRunId=9`, `canEnterRoom=false` |

---

## TC-S06-10 — 대기방 오픈

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-10 |
| 우선순위 | High |
| 사전조건 | E2E `scheduledAt=now+15m` (30분 창 내) |
| 절차 | 1. G03 상세 2. `canEnterRoom` 계산 |
| 기대 결과 | 입장 가능 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `canEnterRoom=true`, status SCHEDULED |

---

## TC-S06-11 — participantCount/readyCount

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-11 |
| 우선순위 | High |
| 사전조건 | A·B 참가, ready 전 |
| 절차 | 1. `GET /group-runs/11/participants` |
| 기대 결과 | `participantCount=items.length`, `readyCount=0` (이후 ready 후 2) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | ready 전 `2/0`; ready 후 `participantCount=2`, `readyCount=2` |

---

## TC-S06-12 — B 준비 완료 G16

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-12 |
| 우선순위 | High |
| 사전조건 | 대기방 창, B WATCH+PHONE 연결, 활성 세션 없음 |
| 절차 | 1. B `POST .../participants/me/ready` `{ready:true}` |
| 기대 결과 | READY, sessionId 연결, readyCount+1 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `sessionId=6`, `readyCount=1` |

---

## TC-S06-13 — A 준비 완료 G16

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-13 |
| 우선순위 | High |
| 사전조건 | 호스트도 session 필요 |
| 절차 | 1. A G16 ready |
| 기대 결과 | READY + sessionId |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `sessionId=7`, `readyCount=2` |

---

## TC-S06-17 — A만 G09 start

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-17 |
| 우선순위 | High |
| 사전조건 | A·B READY 세션 |
| 절차 | 1. A `POST /group-runs/11/start` 2. G03 status |
| 기대 결과 | RUNNING |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 워치 실시작 확정(S03 RESULT)은 별개 — 서버 승인은 PENDING START 명령 생성까지 확인 |
| 증거 | 200, detail `RUNNING`, sessions 6·7에 START command 14·15 PENDING |

---

## TC-S06-18 — B start → NOT_HOST

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-18 |
| 우선순위 | High |
| 사전조건 | B 참가자 |
| 절차 | 1. B `POST .../start` |
| 기대 결과 | NOT_HOST |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `403 NOT_HOST` |

---

## TC-S06-19 — 준비 없이 start 실패

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-19 |
| 우선순위 | High |
| 사전조건 | 참가만 하고 ready/session 없음 |
| 절차 | 1. A `POST .../start` (ready 전) |
| 기대 결과 | `409 INVALID_GROUP_STATE` |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `409 INVALID_GROUP_STATE` |

---

## TC-S06-20 — 라이브 G10

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-20 |
| 우선순위 | High |
| 사전조건 | RUNNING |
| 절차 | 1. A `GET /group-runs/11/live` |
| 기대 결과 | live 응답, status RUNNING, participants |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | GPS/페이스 표본 업로드 없는 API-only 환경 → 순위·stale 세부는 제한적. 구조·상태·participants(2) 확인 |
| 증거 | 200, `status=RUNNING`, `participantsLen=2` |

---

## TC-S06-06 — 출발 후 수정 불가

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-06 |
| 우선순위 | High |
| 절차 | RUNNING 상태에서 A PATCH title |
| 기대 결과 | 거부 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `409 EDIT_NOT_ALLOWED` |

---

## TC-S06-26 — RUNNING 재입장 대기방

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-26 |
| 우선순위 | High |
| 절차 | RUNNING일 때 FE `canEnterRoom` 규칙 |
| 기대 결과 | 대기방 입장 불가 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |
| 증거 | `canEnterRoomWhileRunning=false` |

---

## TC-S06-22 — 워치 그룹 순위 UI

| 항목 | 내용 |
| --- | --- |
| ID | TC-S06-22 |
| 우선순위 | Med |
| 사전조건 | W-A, W-B |
| 절차 | 워치 UI WAT-008 |
| 기대 결과 | 워치 순위 표시 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음 (미실행) |
| 개선점 | 후속 Wear 시나리오에서 W-A/W-B UI로 검증. 본 실행은 API-only |

---

## 실행 메모

- OpenAPI로 path/body 확인: `CreateGroupRunRequest`(crewId·scheduledAt·meeting* 필수), G16 ready, G09 start(본문 없음), G13 cancelReason, G10 live.
- 1차 시도에서 A/B `ACTIVE_SESSION_EXISTS`(구 GR5 세션 4·5, RUNNING+pending START)로 TC-12/13 실패 → 세션 정리 후 재실행하여 전부 통과.
- 산출 원본(비밀 없음): `.qa-local/s06-results.json`, 실행기 `.qa-local/run_s06_group_run_qa.py`.
