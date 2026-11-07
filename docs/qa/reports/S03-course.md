# S03 코스 추천 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S03 코스 추천 |
| 실행일 | 2026-11-07 |
| 환경 | 로컬 BE(`:8080`) · Route(`:8001`, `/health/live=UP`, `/internal/v1/ready`=`ready:false`/`phase:failed`) · API 전용 |
| 계정 | A=`qahost01`(userId=5) |
| 실행자 | AI(API) |
| 종합 판정 | Partial (High 1 Blocked · 오류코드 2 Blocked · Med 미실행) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 Suite 불통과 없음(Blocked·미실행만) |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §4  
API: `POST /api/v1/courses/recommendations`(C01, `docs/design/api/courses.md`)

---

## 환경·선검증 (TS-FEAS-06)

| 항목 | 관측 |
| --- | --- |
| Route 프로세스 | `:8001` LISTEN, OpenAPI title=`RunWay Route` |
| `/health/live` | 200 `UP` |
| `/internal/v1/ready` | 503 `ready:false`, `phase:failed` |
| 직접 `POST /internal/v1/routes/recommendations` | 503 `UNAVAILABLE` — 「추천 엔진을 시작하지 못했어요…」 |
| BE→C01 | 503 `SERVICE_UNAVAILABLE`, `details.reason=ROUTE_UNAVAILABLE` |

**환경 리스크:** Route 프로세스만 떠 있고 추천 엔진 워밍업/로드가 실패한 상태. DEM 단계·정상 후보 생성 검증 불가. DEM 파일 후보 경로 존재 여부와 별개로, 엔진 실패가 선행한다. `.env` 실비밀은 조회하지 않음.

---

## TC-S03-01 — 조건 설정 후 추천

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-01 |
| 우선순위 | High |
| 사전조건 | Route+DEM 정상 |
| 절차 | 1. A 로그인 2. `POST /api/v1/courses/recommendations` — Busan `35.1796,129.0756`, `distanceKm=5`, `shape=loop`, filters river/park/avoidMajorRoad, `seed=1` |
| 기대 결과 | 후보 목록, 경로·고도(`elevationProfile`)·`candidateToken` |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음 (환경 차단). C01 응답 503 `SERVICE_UNAVAILABLE` / `ROUTE_UNAVAILABLE`. Route ready 실패·직접 호출도 `UNAVAILABLE` |
| 개선점 | Route 데이터/모델 로드 실패 원인 복구 후 `/internal/v1/ready=true` 확인, 이어서 C01 재실행 |

---

## TC-S03-02 — Route 미설정

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-02 |
| 우선순위 | High |
| 사전조건 | Route URL 없음 |
| 절차 | 1. C01 호출 |
| 기대 결과 | 503 `ROUTE_UNAVAILABLE`, 사용자 안내 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음. 현재 BE에 Route base URL이 연결된 상태로, 「URL 없음」 사전조건을 격리 재현하지 않음(설정 변경·재기동은 본 QA 범위 밖) |
| 개선점 | URL 비우고 BE 재기동한 뒤 동일 C01으로 코드 재확인. 참고: 엔진 실패 시에도 BE가 `ROUTE_UNAVAILABLE`로 매핑되는 것은 이번 실행에서 관측됨 |

---

## TC-S03-03 — DEM 미설정

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-03 |
| 우선순위 | High |
| 사전조건 | DEM 없음(Route는 정상) |
| 절차 | 1. C01 호출 |
| 기대 결과 | 503 `GRADE_NOT_READY` |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음. Route 엔진이 선행 실패하여 DEM/`GRADE_NOT_READY` 단계에 도달하지 못함 |
| 개선점 | Route ready 복구 후 DEM 경로 비우기(또는 해시 불일치)로 격리 재현 |

---

## TC-S03-04 — 추천 0건

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-04 |
| 우선순위 | Med |
| 사전조건 | 극단 조건 |
| 절차 | 미실행 |
| 기대 결과 | CRS-008 안내 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | Route 정상화 후 실행 |

---

## TC-S03-05 — 코스 북마크·별명

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-05 |
| 우선순위 | Med |
| 사전조건 | 후보 1 |
| 절차 | 미실행(C01 차단) |
| 기대 결과 | 본인만 별명 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 없음 |

---

## TC-S03-06 — ACTIVE만 추천

| 항목 | 내용 |
| --- | --- |
| ID | TC-S03-06 |
| 우선순위 | Med |
| 사전조건 | MERGED/BLOCKED 존재 |
| 절차 | 미실행. 현행 C01은 AI 경로 생성이라 DB ACTIVE 필터 계약은 superseded |
| 기대 결과 | (구 계약) ACTIVE만 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **미실행** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 저장 코스(C03/C09) 관점의 상태 규칙은 별도 TC로 분리 검토 |

---

## 실행 요약

| ID | 결과 |
| --- | --- |
| TC-S03-01 | Blocked (Route engine failed → `ROUTE_UNAVAILABLE`) |
| TC-S03-02 | Blocked (URL-없음 격리 불가; 관련 코드는 엔진 실패 경로에서 관측) |
| TC-S03-03 | Blocked (DEM 단계 미도달) |
| TC-S03-04 | 미실행 |
| TC-S03-05 | 미실행 |
| TC-S03-06 | 미실행 |
