# S02 워치·건강·준비도 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S02 워치·건강·준비도 |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`:8080`) · Android 에뮬(`emulator-5554`, 삼성 헬스 **없음**) · 실물 워치 W-A/`RFAY31E5QKM` · W-B/`RFAXB285QAE` (무선 adb) |
| 계정 | A=`kimgm1018`(비밀번호 로컬 미보유 → DB/TS-FEAS 인용) / B=`qawatchb01`(API 검증) |
| 실행자 | AI |
| 종합 판정 | Partial |
| 스크린샷 정책 | **불통과 항목만** 첨부. 통과·Blocked·미실행은 이미지 없음 |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §3  
선검증: `docs/qa/reports/TS-FEAS-precheck.md` (TS-FEAS-04 = Blocked, 에뮬 삼성헬스 부재)

### 환경 리스크 (시나리오 정합)

| 리스크 | S02 영향 |
| --- | --- |
| Android 에뮬에 삼성 헬스 없음 | 수면/일상 HR(W06)·준비도 **실수집** TC → **Blocked** (TS-FEAS-04와 동일 사유) |
| 서버 A/B 이미 WATCH+PHONE linked | W01/W02는 재확인·멱등 검증. W03 해제는 연계 보존을 위해 미실행 |
| R02 표본 없음 | `GET /api/v1/readiness-assessments/latest` → `404 ASSESSMENT_NOT_FOUND` |
| A 비밀번호 미보유 | A 대상 로그인 API는 수행하지 않음. FEAS/DB로 인용 |

### 실물 워치 adb (실행 시점)

| 구분 | serial | adb | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| W-A | RFAY31E5QKM | `192.168.45.239:37079` | device | 배터리 ~3% (충전 권장) |
| W-B | RFAXB285QAE | `192.168.45.123:34103` | device | 배터리 ~77%, wireless charging |
| 폰 에뮬 | — | `emulator-5554` | device | 삼성 헬스 없음 |

pair 코드 없이 `adb connect`만으로 재확인. mdns에 W-B(`adb-RFAXB285QAE-7NnqUt`) 관측. 매핑: `.qa-local/watch-account-map.env`.

### DB 스냅샷 (비밀번호 미사용)

| loginId | WATCH | PHONE | health_data_access | daily_readiness | daily_health_metrics |
| --- | --- | --- | --- | --- | --- |
| kimgm1018 | id=1 linked | id=2 linked | AGREEE | 0행 | 0행 |
| qawatchb01 | id=3 linked | id=4 linked | AGREEE | 0행 | 0행 |

---

## TC-S02-01 — A 워치 서버 등록

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-01 |
| 우선순위 | High |
| 사전조건 | TS-FEAS-01 |
| 절차 | 1. 앱/API W01 |
| 기대 결과 | W02에 WATCH 1 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

근거: TS-FEAS-01 + DB `kimgm1018` WATCH id=1 · PHONE id=2 linked. A 로그인 API는 비밀번호 미보유로 미호출.

---

## TC-S02-02 — 동일 유형 재등록

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-02 |
| 우선순위 | Med |
| 사전조건 | A WATCH 있음 |
| 절차 | 1. W01 재호출 |
| 기대 결과 | 200 기존 ID (설치 식별자 없음) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

근거: B API `POST /api/v1/devices {deviceType:WATCH}` → **200** `{"id":3,"deviceType":"WATCH"}` (기존 id 유지). PHONE 재호출도 200 id=4. A는 동일 계약·DB id=1 유지(TS-FEAS)로 인용. A 직접 재호출은 비밀번호 미보유.

---

## TC-S02-03 — B 워치 등록

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-03 |
| 우선순위 | High |
| 사전조건 | B 로그인 |
| 절차 | 1. W01 |
| 기대 결과 | B만 WATCH 보유, A와 분리 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

근거: B `GET /devices` → WATCH id=3 · PHONE id=4. DB에서 A(1,2)와 B(3,4) 계정 분리 확인. TS-FEAS-02와 정합.

---

## TC-S02-04 — 워치 해제 후 재등록

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-04 |
| 우선순위 | Med |
| 사전조건 | A |
| 절차 | 1. W03 → W01 |
| 기대 결과 | 새 ID, 이력 보존(includeUnlinked) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 후속 QA·세션 TC를 위해 A/B linked 상태 보존. W03 해제는 사람 승인 후 별도 실행 |

참고: B `GET /devices?includeUnlinked=true`는 200이나, 현재 unlinked 이력 없음(모두 linked만).

---

## TC-S02-05 — 건강 동의 철회/재동의

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-05 |
| 우선순위 | High |
| 사전조건 | A |
| 절차 | 1. W04/W05 |
| 기대 결과 | 수집·준비도 노출 정책 준수 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** (B API로 대리 검증) |
| 불통과 사유 | 해당 없음 |
| 개선점 | A UI 철회 플로우는 사람+실기기에서 재확인 권장 |

근거 (B):

1. W04 `granted=false` → 200, W05 `HEALTH_DATA=false`
2. R02 → **403** `CONSENT_REQUIRED`
3. W04 `granted=true` → 200, W05 `HEALTH_DATA=true`, DB `AGREEE` 복구
4. R02 → **404** `ASSESSMENT_NOT_FOUND` (표본 없음, 동의 후에도 평가 결과 없음)

---

## TC-S02-06 — 일상 HR 업로드(W06)

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-06 |
| 우선순위 | Med |
| 사전조건 | 동의+워치 |
| 절차 | 1. 동기화 |
| 기대 결과 | 저장 또는 스킵 사유 명확 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 실기기(갤럭시+삼성 헬스) 또는 서버 시드 후 재개 |

근거: 에뮬 삼성 헬스 부재(시나리오 §리스크·TS-FEAS-04와 동일). DB `daily_health_metrics` A/B 0행. W06 실업로드 미수행.

---

## TC-S02-07 — 준비도 표시

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-07 |
| 우선순위 | High |
| 사전조건 | 데이터 있음/없음 |
| 절차 | 1. 홈·시작 화면 |
| 기대 결과 | 점수/단계 또는 데이터 부족 안내. 미동의 시 null/비노출 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Partial** (API 없음/미동의만 확인 · UI·점수 표시 Blocked) |
| 불통과 사유 | 해당 없음 |
| 개선점 | 실수집 후 점수 UI·데이터 부족 문구를 사람 확인 |

API:

- 동의+표본 없음: R02 **404** `ASSESSMENT_NOT_FOUND`
- 미동의: R02 **403** `CONSENT_REQUIRED` (TC-S02-05)
- 점수 있는 홈 UI: 표본 없어 **Blocked** (TS-FEAS-04와 동일 사유)

---

## TC-S02-08 — 가상 워치 센서

| 항목 | 내용 |
| --- | --- |
| ID | TC-S02-08 |
| 우선순위 | High |
| 사전조건 | Wear 에뮬 |
| 절차 | 1. 심박·걸음 시뮬레이션 |
| 기대 결과 | 앱/서버 반영 여부 기록 (불가 시 Blocked) |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음 |
| 개선점 | Wear 에뮬 센서 또는 실물 워치+헬스 파이프라인으로 대체 검증 |

근거: Wear 에뮬 미사용. 폰 에뮬만 존재하며 삼성 헬스 없음. 실물 워치 adb는 연결됐으나 OS 센서→W06/준비도 실수집 경로는 에뮬 헬스 부재로 막힘(TS-FEAS-04).

---

## 실행 요약

| ID | 결과 |
| --- | --- |
| TC-S02-01 | 통과 (DB/FEAS, A API 미호출) |
| TC-S02-02 | 통과 (B API 200 동일 id) |
| TC-S02-03 | 통과 |
| TC-S02-04 | 미실행 (W03 연계 보존) |
| TC-S02-05 | 통과 (B W04/W05/R02 정책) |
| TC-S02-06 | Blocked (에뮬 삼성헬스 부재) |
| TC-S02-07 | Partial (404/403 API OK · 점수 UI Blocked) |
| TC-S02-08 | Blocked (센서/헬스 경로 불가) |

불통과 TC 없음 → 스크린샷 첨부 없음.

### 사람 재현 목록 (실기기 헬스)

1. 갤럭시 폰 + 삼성 헬스 연동 계정으로 수면/일상 HR 수집 후 W06 업로드 → TC-S02-06
2. W06 반영 후 준비도 자동 평가·홈 점수/단계 또는 데이터 부족 문구 → TC-S02-07 UI
3. (선택) A 계정으로 W03 해제 → W01 재등록 → `includeUnlinked` 이력·새 device id → TC-S02-04
4. W-A 배터리 충전 후 무선 디버깅 유지(현재 ~3%)
5. A(`kimgm1018`) QA용 자격 파일을 로컬에만 두면 A 직접 API 재검증 가능
