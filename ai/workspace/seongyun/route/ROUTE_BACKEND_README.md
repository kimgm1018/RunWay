# RunWay Route Backend

팀원이 가장 먼저 보는 문서다. 10분 안에 "무엇을 하는가, 어떻게 실행하는가, 어떻게 흘러가는가, 어디부터 읽는가"를 잡는 것이 목표다.

| 더 알고 싶으면 | 문서 |
|---|---|
| 현재 기술 구조 상세 (알고리즘, 가중치, 데이터, cache, 성능, GPX 검증, 전국 확장) | [ROUTE_TECHNICAL_GUIDE.md](ROUTE_TECHNICAL_GUIDE.md) |
| 왜 지금 구조가 되었는가 (문제 → 실험 → 선택 → 검증), 향후 고도화 후보 | [ROUTE_DEVELOPMENT_HISTORY.md](ROUTE_DEVELOPMENT_HISTORY.md) |
| config 값을 바꾸면 무엇이 바뀌는가 | [runway_routing/config/CONFIG_NOTES.md](runway_routing/config/CONFIG_NOTES.md) |
| 회귀 검증 / 데이터 재생성 | [tools/route_regression/README.md](tools/route_regression/README.md), [tools/data/README.md](tools/data/README.md) |

## 1. 무엇을 하는 서비스인가

사용자의 현재 위치, 목표 거리, 코스 형태(순환·왕복·편도), 선호 조건을 받는다. 그러면 부산 OSM 도로 중 **달릴 수 있는 길(RUNNABLE)**만 써서 러닝 코스 후보를 매번 새로 만든다.

후보마다 거리·도로·환경 feature를 계산하고 규칙 기반 점수로 순위를 매긴다. 안전 규칙(Usability Gate)을 통과한 **TOP3**를 이유 설명과 함께 돌려준다.

- 저장된 코스를 찾는 것이 아니다. 학습 모델도 쓰지 않는다.
- 같은 요청과 같은 데이터면 항상 같은 결과가 나온다.

## 2. 현재 실제로 되는 기능

| 구분 | 기능 |
|---|---|
| **코스 형태** | LOOP(출발점으로 돌아오는 순환, 기본값) · OUT_AND_BACK(반환점까지 갔다가 같은 길로 돌아옴) · POINT_TO_POINT(사용자가 고른 도착지까지 편도) |
| **거리** | 1–15 km. 모든 형태에서 목표 거리 **±10 %**([0.9T, 1.1T]) |
| **P2P 거리 규칙** | 출발–도착 최단 거리가 1.1T를 넘으면 코스 대신 "최소 N km" 안내. 직선 **17 km 초과**는 graph를 만들기 전에 거절(F-1) |
| **도로** | OSM에서 RUNNABLE로 분류된 길만 쓴다. 자동차 전용·보행 금지 길은 EXCLUDED, 애매한 길은 UNCERTAIN으로 빠진다 |
| **snap** | 찍은 위치 → 가장 가까운 연결된 RUNNABLE 길. 250 m 넘게 떨어지면 거절. P2P 도착지는 금지 도로·강/큰길 건너기 규칙도 적용 |
| **선호 반영** | 강변·해변·공원·산책로·보행로·큰길/계단/터널 피하기·평지. 후보 생성 비용과 최종 점수에 반영(평지는 점수만) |
| **러닝 적합도** | 큰길 위/옆/떨어진 길과 계단으로 계산한 "일반적으로 달리기 좋은 길" 점수를 모든 요청의 순위에 반영 |
| **Usability Gate** | PASS / REVIEW / FAIL. FAIL은 최종 후보에서 제거, REVIEW는 서버 로그에만 남김 |
| **중복 제거 + TOP3** | 더 좋은 코스와 60 % 이상 겹치면 제거. 결정적 순서로 TOP3 |
| **설명** | 코스별 한 문장 요약, 이유, 주의 문구, 요청 단위 안내 |
| **rollback** | 환경변수 4개로 최적화·Gate를 끌 수 있다(6절) |
| 전국 1 km grid index | **생성·검증 완료 / production 미연결.** 현재 backend는 부산 extract만 읽는다 |

## 3. 전체 동작 흐름 (요청 하나)

```
사용자 입력: 현재 위치 · 목표 거리 · shape · 도착점(P2P) · 선호
   │                                                          [route_demo/app_runway.py  recommend()]
   ▼
① 범위 검사: 1–15 km, P2P 직선 17 km 초과 거절(F-1)              [app_runway._p2p_out_of_range_m]
   ▼                                                          [runway_routing/pipeline.py  RoutePipeline.run()]
② OSM RUNNABLE graph 준비: 요청 위치 working disk, LRU cache      [graph.py  (데이터는 data.py가 시작 시 1회 로드)]
   ▼
③ GPS snap: 출발(+P2P 도착) → RUNNABLE node                       [snap.py · P2P app-max disk 2개는 substrate.py]
   │   P2P: 최단 거리 d_min → 거리 규칙(±10 %) 먼저               [candidates.distance_rule]
   ▼
④ 후보 생성 (선호가 있으면 edge 비용 bias)                       [candidates.py]
   │   LOOP: 원 위 waypoint (analysis canonical generator + hook)
   │   OAB : 반환점 → 같은 길로 복귀
   │   P2P : 타원 위 waypoint
   ▼
⑤ 구간 최단 경로: LOOP·P2P = D-exact(networkx 3.7 정확 이식),      [shortest_path.py, graph.RouteCSR]
   │             OAB = networkx single-source Dijkstra 1회
   ▼
⑥ route feature 계산 + 유효성(±10 %, 모양 규칙)                  [features.py]
   ▼
⑦ Running Suitability(큰길 노출 + 계단)                          [features.route_components]
   ▼
⑧ 점수: 거리 적합도 + 모양 penalty + 선호 항 + 0.25 × 적합도       [scorer.score_route]
   ▼
⑨ 순위 + 중복 제거(동점은 candidate_id, 60 % 겹침 제거)           [scorer.rank]
   ▼
⑩ Usability Gate: FAIL 제거 → ⑨를 다시 → Stage B로 TOP3 재검사    [gate.py → usability_gate.py(동결)]
   ▼
⑪ TOP3 선택 (선호 있으면 preference 순위, 없으면 baseline 순위)    [app_runway.py]
   ▼
⑫ 자연어 설명 / 주의 문구 → JSON 응답 (+ 서버 Gate 로그)           [explain.py, app_runway._notices]
```
순서상 점수와 순위(⑧⑨)가 Gate(⑩)보다 먼저다. Gate가 FAIL을 빼면 순위와 중복 제거를 처음부터 다시 한다. 단계별 상세는 [기술 가이드](ROUTE_TECHNICAL_GUIDE.md) 4–14절에 있다.

## 4. 파일 지도

| 파일 | 한 줄 역할 |
|---|---|
| `runway_routing/pipeline.py` | 전체 흐름(`RoutePipeline.run`), rollback 스위치 |
| `runway_routing/data.py` | 외부 데이터 로딩(extract, env, env cache, DEM, config) |
| `runway_routing/graph.py` | 요청 graph, fast builder, LRU, RouteCSR |
| `runway_routing/snap.py` / `substrate.py` | GPS → 길 위 node / P2P app-max 영역을 배열로 |
| `runway_routing/candidates.py` | LOOP·OAB·P2P 후보, 거리 규칙, 선호 bias, LegMemo |
| `runway_routing/shortest_path.py` | D-exact 최단 경로 kernel |
| `runway_routing/features.py` / `scorer.py` | feature·유효성·적합도 / 점수·순위·중복 제거 |
| `runway_routing/gate.py` / `usability_gate.py` | Gate 적용 / 동결 규칙(수정 금지) |
| `runway_routing/explain.py` | 사용자용 문장 |
| `runway_routing/config/` | 정책값(CONFIG_NOTES.md 먼저) |
| `route_demo/` | backend 확인용 FastAPI prototype(최종 frontend 아님) |
| `tools/route_regression/`, `tools/data/` | golden 회귀 검증, 데이터 재생성 |
| `analysis/` (다른 workstream, 읽기 전용) | canonical LOOP generator, OSM 추출·분류. **Route가 실행 중 import하는 5개 모듈** |

## 5. 처음 5단계 (clone 직후)

RunWay 루트에서, Windows 기준 명령이다. macOS/Linux는 `Scripts/python.exe` 대신 `bin/python`을 쓴다.
```bash
# 1. Python 3.12로 Route 전용 venv를 만든다 (검증: 3.12.10. 프로젝트 .venv는 다른 workstream용이라 Route 패키지가 없다)
py -3.12 -m venv .venv-route
# 2. 고정된 의존성을 설치한다 (networkx 3.7 / osmnx 2.1.1 / osmium 4.3.2 등, 이유는 파일 주석)
.venv-route/Scripts/python.exe -m pip install -r requirements-route.txt
# 3. 데이터가 있는지, env edge cache가 유효한지 확인한다 (마지막 줄이 "valid")
.venv-route/Scripts/python.exe -B tools/data/build_env_cache.py info
# 4. 데모 서버를 띄우고 http://localhost:8002 를 연다 (시작에 15–20초)
.venv-route/Scripts/python.exe -B -m uvicorn route_demo.app_runway:app --host 127.0.0.1 --port 8002
# 5. golden regression으로 결과가 baseline과 같은지 확인한다 (약 8분, RESULT PASS)
.venv-route/Scripts/python.exe -B tools/route_regression/run_regression.py --tag first
```
- 필요한 것: `runway_routing/`, `route_demo/`, `tools/`, `analysis/`(5개 모듈, [기술 가이드 15절](ROUTE_TECHNICAL_GUIDE.md)), 데이터 파일(같은 절).
- `analysis/` 없이 `runway_routing/`만 복사하면 import 단계에서 깨진다.

## 6. 자주 쓰는 명령

**코드를 바꾼 뒤 확인** (합격: `RESULT PASS`, 모든 mode `"fails": 0`)
```bash
python -B tools/route_regression/run_regression.py --tag mychange
```
- shadow 모드에서는 허용된 차이 **GS-26 1건**만 보인다. 기능 차이가 아니라 cache 플래그다([tools/route_regression/README.md](tools/route_regression/README.md)).

**rollback** (모두 프로세스 시작 시 1회 읽음 → 서버 재시작 필요)

| 환경변수 | 끄는 것 | 추천 결과 |
|---|---|---|
| `RUNWAY_P2P_SUBSTRATE=0` | P2P 배열 substrate → networkx | 같음(느려짐) |
| `RUNWAY_SP_KERNEL=nx` | D-exact → networkx 최단 경로 | 같음(느려짐) |
| `RUNWAY_FAST_GRAPH=0` | fast graph builder → canonical builder | 같음(느려짐) |
| `RUNWAY_USABILITY_GATE=shadow` | Gate FAIL 제거 | **달라질 수 있음**(비상용) |

**데이터 재생성:** extract → env layer → env edge cache 순서다. [tools/data/README.md](tools/data/README.md)에 명령이 있다.

## 7. 처음 읽는 순서

1. 이 문서
2. `runway_routing/pipeline.py`: 모듈 docstring과 `RoutePipeline.run`
3. `runway_routing/candidates.py`: `loop`, `route_through`, `LegMemo`, `p2p_candidates`, `distance_rule`
4. `runway_routing/snap.py` / `substrate.py`
5. `runway_routing/shortest_path.py`
6. `runway_routing/features.py` / `scorer.py`
7. `runway_routing/gate.py` / `usability_gate.py`(규칙 목록만)
8. `runway_routing/config/CONFIG_NOTES.md`
9. [ROUTE_TECHNICAL_GUIDE.md](ROUTE_TECHNICAL_GUIDE.md) → [ROUTE_DEVELOPMENT_HISTORY.md](ROUTE_DEVELOPMENT_HISTORY.md)

모든 모듈 맨 위에 `요약 / 위치 / 주의` 세 줄이 있다.
