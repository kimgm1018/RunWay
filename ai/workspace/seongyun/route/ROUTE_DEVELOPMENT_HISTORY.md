# RunWay Route Development History

"왜 현재 구조가 되었는가"를 기술 의사결정 단위로 남긴 기록이다. 각 결정은 **문제 → 측정/근거 → 후보 → 선택 → 결과 → 검증** 순서다.

- 현재 구조 자체의 설명은 `ROUTE_TECHNICAL_GUIDE.md`, 실행 방법은 `ROUTE_BACKEND_README.md`에 있다.
- 수치는 모두 아래 보고서의 실측값이다.
- 보고서 대부분은 저장소 밖 `RunWay_data/`에 있다(맨 아래 목록).

## 목차
1. OSM RUNNABLE 분류
2. LOOP → OAB / P2P 확장과 거리·snap 규칙
3. Usability Gate 분리
4. NetworkX 병목 분석
5. D-exact (NetworkX 3.7 정확 이식)
6. P2P graph 병목
7. Global substrate (P2P app-max disk 2개)
8. 전국 1 km spatial grid
9. Cache 최적화 (LegMemo, snap cache, P2P 중복 계산, LRU)
10. 코드 정리 / 구조 refactor
11. Handoff 재현성
12. GPX 기반 weight 검증
- 향후 고도화 후보 (V1 범위 밖)
- 성능 변화 타임라인
- 원칙: 결과 동일성 우선
- 참고 보고서

---

## 1. OSM RUNNABLE 분류 (2026-10-22)

**문제**
- 러닝 코스는 "실제로 사람이 달릴 수 있는 길"만 지나야 한다.
- OSMnx의 기본 보행망(`network_type="walk"`)은 자동차 전용·고속화도로(trunk, busway 등)를 넣고, 보행 가능한 자전거 겸용길은 뺀다.

**측정 / 근거** (`reports/runway_custom_walk_filter_audit.md`, 부산 5개 조사 지역)
- OSMnx walk graph에 trunk 16.85 km, trunk_link 7.17 km, busway 4.31 km가 들어 있었다(광안대교, 번영로, 만덕센텀고속화도로 등).
- `cycleway` + `foot=yes/designated` 5.76 km는 빠져 있었다.

**후보**
1. OSMnx walk graph를 그대로 쓴다.
2. 점수로 위험한 길을 감점한다.
3. 명시 태그만으로 graph 자체를 분류한다.

**선택: 3번.** `analysis/runway_walk_filter.classify`가 태그만으로 판정한다(추론 없음).
- **RUNNABLE:** graph에 남김
- **EXCLUDED:** area, 미완성, foot=no/private, access 금지, motorway, foot 허가 없는 trunk, expressway/motorroad/toll, 보도가 따로 그려진 도로
- **UNCERTAIN:** foot 태그 없는 cycleway, 보도 정보 없는 도로 터널 등
- MVP는 strict 정책으로 RUNNABLE만 쓴다.
- **계단은 RUNNABLE로 남긴다.** 사람이 지날 수 있는 길이고, 감점은 다음 단계(러닝 적합도, 계단 피하기 선호)가 맡는다.

**결과**
- 지역별로 OSMnx walk 대비 0.9–8.0 %가 빠졌다(대부분 trunk/busway, 황령산은 황령터널 UNCERTAIN).
- 자동차 전용·고속화도로 edge는 0 km가 됐다.
- 보행 가능 자전거길 5.76 km를 복구했다.

**검증**
- 태그 조합 selftest 32/32를 통과했다.
- 다시 만든 graph가 조사 당시 OSMnx edge를 누락 없이 포함함을 확인했다.
- 대표 edge 109개를 직접 확인했다.

---

## 2. LOOP → OAB / P2P 확장과 거리·snap 규칙

**문제**
- 처음 서비스는 순환(LOOP)만 만들었다(analysis의 canonical generator).
- 왕복(OAB)과 편도(P2P)를 추가하려면 거리를 어떻게 맞출지, 도착점을 어디에 붙일지 규칙이 필요했다.
- 특히 P2P는 출발·도착이 사용자가 고정하는 점이라, 목표 거리와 둘 사이 거리가 충돌할 수 있다.

**측정 / 근거**
- 편도에서 도착점이 너무 멀면 어떤 우회로도 목표 거리 안에 들어오지 않는다.
- 도착점을 생성 disk에서 다시 snap하면 disk 경계에 따라 다른 node가 뽑혀, 거리를 잰 node와 경로를 만든 node가 달라졌다.

**후보**
- 거리: 목표 근처면 허용할지, 고정 허용폭을 둘지
- 먼 도착지: 그래도 생성할지, 사전 거절할지
- snap: 단계마다 snap할지, 한 번 정한 node를 재사용할지

**선택**
- **±10 %**(사용자 결정 3번): 모든 형태에서 길이는 [0.9T, 1.1T]다.
- **P2P 거리 규칙:** 생성 전에 출발–도착 RUNNABLE 최단 거리 d_min을 잰다. d_min > 1.1T면 코스 대신 "최소 N km"(0.5 km 단위 올림)를 안내하고, 앱 최대 15 km를 넘으면 OUT_OF_APP_RANGE로 답한다.
- **app-max disk:** snap과 d_min은 목표와 무관하게 15 km 기준 disk(반경 0.55 × 15 km + 250 m = 8.5 km)에서 잰다.
- **F-1 17 km 사전 거절:** 직선 > (1 + 0.1) × 15 km + 2 × 250 m = 17.0 km면 graph를 만들기 전에 거절한다.
  - 이 검사가 없으면 8.5 km disk가 먼 쪽 끝을 담지 못해 엉뚱한 "근처에 길 없음" 오류가 났다.
- **snap:**
  - 출발은 250 m 이내여야 한다.
  - P2P 도착은 ug-v2 PE1(250 m), PE4(금지 edge 인접 node 금지), PE5(사용자 점 → node 직선이 큰길·강을 건너면 금지)를 따른다.
  - **한 번 정한 node를 끝까지 재사용**한다(E-I3 B3).
- **OAB:** 반환점까지의 실제 거리가 T/2 ± 4 %인 node를 방위 12 sector에서 고르고, 같은 길로 돌아온다(U턴 1회).
- **P2P:** 출발·도착을 초점으로 하는 타원 위 waypoint 1–2개를 지난다.

**결과:** 세 형태가 같은 feature, 점수, Gate를 지난다. LOOP 요청은 확장 전과 같은 단계를 그대로 지나고, 응답에 shape key가 없다(`pipeline.py` 하위 호환 규칙).

**검증:** golden 시나리오에 OAB와 P2P 경계 사례를 넣었다(DESTINATION_TOO_FAR, 부산 밖, 바다 출발, 선호 OAB/P2P 등).

---

## 3. Usability Gate 분리

**문제**
- 점수는 "더 좋은 코스"를 고를 뿐이라, 점수가 높은 위험·이상 코스를 막지 못한다.
- 예: 자동차 전용 구간 근접, 구조 규칙 위반, 도착점이 강 건너편.

**측정 / 근거**
- 점수에 큰 감점을 넣는 방식은 가중치와 섞여 효과를 분리할 수 없다.
- 그 방식으로는 "추천하면 안 됨"을 보장하지 못한다.

**후보**
1. 점수 감점
2. 생성 단계 필터
3. 별도 규칙 엔진(Gate)

**선택: 3번.** 사전 등록·동결된 규칙(`config/ug-v1.json` LOOP, `ug-v2.json` 형태별 + PE 규칙)과 순수 함수 엔진 `usability_gate.py`를 둔다.
- **PASS:** 그대로 추천한다.
- **REVIEW:** 순위는 그대로 두고 서버 로그에만 남긴다. 사람이 검토해 다음 규칙 버전의 근거로 쓴다.
- **FAIL:** 제거한다.
- **FAIL을 dedupe 전에 빼는 이유:** 이미 dedupe된 순위표에서 지우기만 하면, FAIL 경로와 60 % 넘게 겹쳐 중복으로 지워졌던 안전한 경로가 돌아오지 못해 TOP3가 줄어든다. 그래서 유효 후보 전체에서 빼고 순위·dedupe를 다시 한다.
- **Stage B:** TOP3 payload를 다시 검사하고, 실패하면 빼고 보충한다.
- **shadow 모드:** 기록만 하는 비상용 rollback이다.

**결과:** 규칙 파일과 엔진의 sha가 Gate 로그와 `gate_version`에 남아, 어떤 규칙으로 판정했는지 추적된다.

**검증:** golden의 shadow 모드가 판정 기록을 비교한다. GPX A/B 16개 요청의 TOP3 48개는 PASS 38 / REVIEW 10 / FAIL 0이었다.

---

## 4. NetworkX 병목 분석 (2026-10-28)

**문제:** 구조 정리 직후 LOOP 10 km cold 10.4 s, LOOP 15 km cold 17.2 s, P2P 10 km cold 24.6 s로 느렸다.

**측정 / 근거** (`PERF_REPORT_2026-10-28.md` 2–7절, 단계별 exclusive 시간)
- LOOP 10 km warm 4.08 s 중 **최단 경로 3.21 s(79 %)**
- LOOP 15 km cold 14.8 s 중 최단 경로 7.06 s, graph 6.03 s
- LOOP 5 km 한 요청에서 구간 탐색 374회, 그중 같은 prefix 중복 144회
- 최단 경로는 `nx.shortest_path(weight=callable)` → networkx 3.7 `bidirectional_dijkstra`다. edge마다 Python callback과 dict/Counter 조회를 거친다.

**후보** (`DEXACT_REPORT_2026-10-28.md` 16절)
1. scipy csgraph: 빠르지만 동점 경로 선택이 달라 추천이 바뀐다. 새 golden이 필요하다.
2. A*: 휴리스틱 때문에 동점 처리가 다르다.
3. numba/C 이식: venv에 numba가 없다.
4. **networkx 3.7 알고리즘을 순서까지 그대로 Python으로 옮기기(D-exact)**

**선택:** 결과 동일성이 최우선이라 4번(5절)을 골랐다. 그 전에 같은 결과를 유지하는 중복 제거(A–C, 9절)를 먼저 넣었다.

**분석한 networkx 3.7의 동작**
- forward/backward 번갈아 pop(forward 먼저)
- 두 heap이 **counter 하나를 공유**하는 `(distance, counter, node)`
- 이웃은 `H._adj` 순서로 relax
- 엄격히 짧을 때만 갱신
- 양쪽에서 확정된 node에서 멈추고 meet node의 preds로 경로를 복원

같은 거리면 먼저 push된 쪽이 이기는 것이 tie-break의 전부다.

---

## 5. D-exact (Python 정확 이식, 2026-10-28)

**문제:** 최단 경로가 LOOP warm의 대부분이었다. 그런데 더 빠른 알고리즘은 결과(동점 경로)를 바꾼다.

**후보:** 4절과 같다.

**선택**
- `shortest_path.bidirectional`: networkx 3.7을 줄 단위로 이식했다.
- `graph.RouteCSR`: rg.H를 `H._adj` 순서 그대로 flat list로 바꾼다.
- cost 연산 순서까지 callback과 같다(length × mult × (1 + penalty × used)).
- networkx ≠ 3.7이면 자동으로 networkx로 돌아간다. `RUNWAY_SP_KERNEL=nx`가 rollback이다.

**결과** (ABBA, p50 초, p1 = A+B+C → p2 = + D-exact)

| 요청 | cold p1 → p2 | warm p1 → p2 | 최단 경로 p1 → p2 |
|---|---|---|---|
| LOOP 3 | 0.71 → 0.60 | 0.27 → 0.18 | 0.17 → 0.08 (−53 %) |
| LOOP 5 | 1.75 → 1.57 | 0.55 → 0.35 | 0.36 → 0.17 (−53 %) |
| LOOP 10 | 7.27 → **5.68** | 3.37 → **2.08** | 2.91 → 1.42 (−51 %) |
| LOOP 15 | 13.92 → **10.71** | 7.21 → **4.00** | 6.27 → 2.98 (−53 %) |
| P2P 5 | 11.51 → 10.55 | 0.82 → 0.41 | 0.76 → 0.26 (−66 %) |
| P2P 10 | 23.41 → 20.82 | 4.50 → **2.42** | 4.38 → 2.07 (−53 %) |

**검증**
- **leg parity: 26,839 / 26,839 동일.** 모든 kernel 호출을 같은 순간 같은 배열 상태로 `nx.shortest_path`에도 풀어 비교했다. no-path 10건 포함.
  - 합성 920 leg: 등가중 격자(대량 동점, 삽입 순서 섞음), 무작위 배수·사용 횟수·penalty, 끊긴 graph, self-loop
  - 실제 25,919 leg(요청 112개)
- **golden 4 모드 불일치 0.** rollback(`nx`)도 0이다.

---

## 6. P2P graph 병목 (D-exact 이후)

**문제:** D-exact 후에도 P2P cold가 5 km 10.6 s, 10 km 20.8 s였다.

**측정 / 근거**
- `DEXACT_REPORT` 95절: P2P 5 km cold 10.55 s 중 **graph 준비 8.74 s(83 %)**, 10 km 20.82 s 중 16.23 s(78 %). 최단 경로는 0.26 / 2.07 s뿐이다.
- `PERF_REPORT` 2–5절: P2P 10 km cold에서 disk 3개(snap용 app-max, d_min용 app-max, 생성 disk)를 networkx로 만드는 데 12.1 s가 들었다.
  - 8.5 km app-max disk는 약 11만 node / 25만 edge다.
  - 한 요청이 graph cache 4칸 중 3칸을 쓰므로, 다른 위치와 섞이면 다시 cold가 된다.

**후보** (`GLOBAL_GRAPH_SPIKE_REPORT`)
1. numba로 최단 경로만 더 빠르게: 최대 이득이 약 2 s다.
2. **전역 배열 + disk mask로 graph 생성 자체를 없애기:** 최대 이득이 약 15 s다.

**선택:** 2번(7절).

---

## 7. Global substrate: P2P app-max disk 2개 (2026-10-28)

**문제:** app-max disk 2개의 networkx graph 생성이 P2P cold의 대부분이었다.

**측정 / 근거** (spike)
- 시작 시 extract 전체를 배열로 들고(부산 약 28–30 MB), 요청마다 build_fast와 같은 규칙의 exact numpy mask로 같은 집합을 재현할 수 있었다.
- node, edge, 선택 way, 길이, main component, 좌표가 10개 disk에서 bit 단위로 같았다.

**후보**
1. P2P app-max disk 2개만 대체
2. 생성 disk와 LOOP/OAB까지 전역화

**선택: 1번만.**
- app-max disk 2개는 snap과 d_min만 계산하고 후보 생성에 쓰이지 않는다. 그래서 집합 동일을 증명할 수 있었다.
- 생성 disk는 features, Gate, canonical generator가 networkx 객체를 직접 읽는다. 바꾸려면 그 소비자를 모두 옮겨야 해서 HOLD했다.
- 단 하나 출력에 닿는 순서(Gate 입력의 PE5 차단선 순서)는 networkx edge 순서대로 재구성했다.

**결과** (`P2P_PATCH_AND_KR_GRID_REPORT`, 같은 세션 ABBA p50)

| | before | after |
|---|---:|---:|
| P2P 5 km cold | 8.89 s | **1.72 s** (재측정 1.23) |
| P2P 10 km cold | 17.82 s | **6.88 s** (재측정 6.96) |
| graph 준비 (cold) | 5 km 7.39 / 10 km 13.45 s | 0.84 / 3.92 s |
| 요청 130개 후 private 메모리 | 2,561 MB | 2,213 MB (−348) |
| P2P 10 km warm | 2.38 s | 2.25 s(변화 없음) |

**검증**
- golden 4 모드: **기능 불일치 0, 허용 차이 1건**(shadow GS-26 내부 `canonical.graph.from_cache` False → True)
  - 이 차이는 cache 부작용이다. 예전에는 P2P app-max graph가 4칸 LRU에서 다른 graph를 밀어냈는데, 그 일이 없어졌다.
  - 응답, 경로, Gate 로그는 동일하다.
  - `known_differences.json`에 그 위치만 등록했다.
- random P2P 30: 불일치 0
- rollback `RUNWAY_P2P_SUBSTRATE=0`: strict 0

---

## 8. 전국 1 km spatial grid (2026-10-28, production 미연결)

**문제**
- 전국 확장 시 요청마다 전국 1,732만 node를 훑으면, disk 하나 고르는 데만 0.5 s가 넘는다.
- 요청 위치 주변 후보만 빠르게 찾는 index가 필요하다.

**측정 / 근거** (`GRID_SPIKE_REPORT_2026-10-28.md`)

| 후보 | 판정 | 이유 |
|---|---|---|
| 행정구역(구·군) partition | **KILL** | polygon 틈(해안, 다리, 항만)에 있는 node가 disk 안에 들어간다. 미배정 node 22.8만 개(부산의 43 %)를 항상 함께 훑어야 정확해 사실상 전체 scan이 된다. 면적 편차도 140배다 |
| 500 m grid | KILL | 정확하지만 1 km보다 lookup이 3배 느리고(0.013 vs 0.005 s) 저장 크기는 같다 |
| **1 km grid** | **GO(전국 확장 시)** | 정확(누락 0). 전국 mask 0.02–0.40 s로 전체 scan 0.50–0.57 s보다 1.4–30배 빠르다 |
| 2 km grid | HOLD | 정확하고 1 km와 ±5 % 성능. 후보가 더 많고 밀집 도시에서 이점이 없다 |
| 부산 전역 substrate | GO(현재) | 부산에서는 grid와 latency가 같고(6.24 vs 6.23 s) 더 단순하다 |

**선택:** 전국 1 km UTM-K(EPSG:5179) grid index를 만들어 검증만 한다. production 연결은 하지 않는다.

**결과** (`P2P_PATCH_AND_KR_GRID_REPORT` Part 2)
- 전국 OSM에서 node 17.32M, way 1.83M, segment 18.29M을 뽑았다. 점유 cell 97,435개이고, npy 19개 1.88 GB(mmap 가능)다. 빌드에 134 s가 걸렸다.
- disk 추출: 전체 scan p50 0.52–0.53 s 대비 grid + exact mask p50 0.004–0.05 s

**검증**
- 도심·해안·다리·산지·시도경계 28곳 × 2 반경 + 무작위 120곳 = **168개 disk에서 node, segment, way 집합이 전체 scan과 168/168 동일, false negative 0**
- mmap open/read smoke 통과

**아직 연결하지 않은 이유:** coverage 검사, UTM 51/52 zone 규칙, 부산 extract 경계 차이(전국 golden 필요), 전국 env/DEM/cache, networkx 소비자 전환, 메모리 정책이 남아 있다(기술 가이드 21절).

---

## 9. Cache 최적화 (A: LegMemo, B: snap cache, C: P2P 중복 계산, LRU)

**문제:** 같은 요청 안에서 같은 계산을 반복했다(4절의 중복 144회, snap index 재생성, P2P edge 전체 scan).

**측정 / 근거:** `PERF_REPORT` 6–10절(단계별 호출 수와 exclusive 시간).

**선택** (모두 결과가 같은 것만)

| 항목 | 줄인 것 | 동일성 근거 | 효과(warm) |
|---|---|---|---|
| A. LegMemo | 같은 waypoint prefix의 구간 재탐색 | key가 (a, b)가 아니라 prefix라, reuse penalty 상태까지 같을 때만 재사용한다 | LOOP 5 최단 경로 0.69 → 0.35 s(호출 374 → 230) |
| B. snap cache | snap마다 edge STRtree와 main mask 재생성 | 같은 생성 코드를 graph 객체에 1회 저장한다(graph 수명) | LOOP 5 start snap 0.14 → 0 s |
| C. P2P 중복 계산 | 도착 snap마다 PE4/PE5 edge scan, Gate context 재생성 | G 객체에 rule과 함께 1회 저장한다 | P2P 10 snap·PE·Gate context 1.73 → 0 s |
| LRU | 같은 위치의 graph 재생성 | key = (위도·경도 6자리, 반경). generator, 요청 graph, P2P mask 각 4개 | warm 요청에서 graph 준비 0 s |

**결과:** warm LOOP −15~−48 %, P2P 5 warm −69 %(같은 기계 상태 비교). cold는 graph 생성이 대부분이라 효과가 작다.

**검증:** golden 4 모드 불일치 0. parity는 route_through 420건, snap 138개 지점, PE4/PE5 cache 결과를 확인했다.

---

## 10. 코드 정리 / 구조 refactor (2026-10-28 ~ 29)

**문제**
- 기능이 붙을 때마다 파일과 상속이 늘었다.
- live 22개 + 비production 9개 + 4곳에 흩어진 JSON이 있었다.
- 요청 하나가 **9단계 MRO**(mixin 상속)를 지났다.
- `route_through`가 3벌, `trim_spurs`가 2벌이었다.
- 새 팀원이 흐름을 따라갈 수 없었다.

**후보**
- A. 문서만 보강
- B. 일부 병합
- C. 동작 동일을 golden으로 보장하면서 단계적으로 재구성

**선택: C.** 단계 A(config, data, graph) → B(gate) → C(candidates, snap, features, scorer, explain) → D(pipeline: MRO → `RoutePipeline.run()` 하나)로 진행했다.
- 단계마다 golden을 확인했다.
- 구 모듈은 archive로 옮겼다.
- 2026-10-29 cleanup에서 실험 잔재와 읽히지 않는 config key를 지웠다.

**결과**
- runway_routing이 22개에서 현재 **Python 13개**가 됐다(`__init__` 포함, 이후 shortest_path, substrate 추가).
- `pipeline.py` 한 파일에서 LOOP/OAB/P2P 흐름이 보인다.

**검증:** 단계 A, B, C, D, final 모두 golden 4 모드 불일치 0이었다. cleanup 후에도 기능 불일치 0, 허용 차이 1건(GS-26)이었다.

---

## 11. Handoff 재현성 (2026-10-29)

**문제**
- regression harness가 저장소 밖(RunWay_data)에 절대 경로로 있었다.
- requirements에 osmium이 빠져 있었다.
- 데이터 재생성 도구가 archive에만 있었다.
- 팀원이 clone 후 혼자 검증할 수 없었다.

**선택**
- `tools/route_regression/`: run_regression, capture, compare, 시나리오, known_differences, baseline 30 MB
- `tools/data/`: env layer, DEM, env edge cache 재생성
- `requirements-route.txt`: 검증 버전 고정. 특히 networkx 3.7과 osmnx 2.1.1은 코드가 검사하는 버전이다.
- 절대 경로 0
- archive와 옛 데모는 백업 후 제거했다.

**검증**
- **새 clean venv**에서 설치 → 데모 → golden 4 모드 + random 30 + rollback 2종을 모두 통과했다.
- env layer 도구는 production layer를 1,274행 그대로 재현했다.
- env cache 도구는 배열과 hash를 그대로 재현했다.

---

## 12. GPX 기반 weight 검증 (2026-10-29, 결과: HOLD)

**문제**
- Running Suitability(큰길 0.8, 계단 0.2)와 선호 가중치는 규칙과 사전 고정 실험으로 정한 값이다.
- 실제 러닝 코스가 그 방향과 맞는지 외부 근거가 없었다.

**측정 / 근거**
- **데이터:**
  - 팀 공유 ZIP 231개 중 T1 2(커뮤니티 러닝) + T2 44(설계 러닝 코스) + T3 98(로드레이스) = 144개
  - T4 트레일 87개는 성격이 달라 제외했다.
  - 이용허락 UNKNOWN이고 재배포 금지라 내부 분석만 했다.
- **map matching:** 기존 HMM matcher를 그대로 썼다. GOOD 131 / FAIR 13 / POOR 0 / FAILED 0이다.
- **비교:** 실제 route edge vs 원본 GPS 500 m 안 RUNNABLE edge(local baseline). 지역 자체 특성과 선택을 구분하기 위해서다.
- **변형 보정:** family 대표 1개 → 103 family
- **통계:** 중앙값, Cliff's δ, family bootstrap 95 % CI

**결과**

| 판정 | feature |
|---|---|
| GO | steps_per_km, steps_share, intersection_per_km |
| HOLD | waterfront, grade/steep(작음), major, walk_cycle, green(**T2와 T3가 반대**) |
| KILL | traffic_exposed, 개별 footway/path/cycleway, park |
| 제외 | crossing, signal(데이터 신뢰도) |

- T2(설계 코스)는 큰길을 피하고, 보행 친화 길과 녹지를 고른다.
- T3(로드레이스)는 통제된 큰길을 쓴다.
- 그래서 그 feature들은 하나의 강한 weight로 합치지 않았다.

**후보**
- GO 중 production weight와 연결되는 것은 계단(obstacle) 0.20뿐이다.
- 교차로는 점수 항이 없어서, 넣으면 새 feature다(범위 밖).
- CURRENT 0.20 / MILD 0.25 / STRONG 0.30으로 비교했다.

**A/B** (부산 대표 16개 요청: LOOP 5·10 km, P2P 5·10 km, 같은 후보 묶음)
- 세 arm의 TOP3 후보 집합이 같았다. 1위도 전부 같았다.
- 2·3위 순서만 일부(3 / 5건) 바뀌었다.
- Gate, 거리 오차, route feature가 동일했다.

**선택: HOLD.** production 계단 weight 0.20을 유지한다.
- GPX에서 계단 회피 신호가 있었지만, 가중치를 높여도 추천 품질이 개선되지 않았다. 그래서 기존 값을 유지했다.
- **분석 결과를 무조건 production에 반영하지 않았다.** 근거가 있어도 A/B에서 개선이 확인되지 않으면 weight를 바꾸지 않는다.

**검증:** 매칭 shim이 이전 freeze 결과 105개를 완전히 재현했다. A/B는 arm 간 후보 pool 동일성을 요청마다 확인했다.

---

## 향후 고도화 후보 (V1 범위 밖)

Route V1은 다음까지 완료한 상태다.
- LOOP / OAB / P2P 코스 생성, 사용자 선호 반영, 러닝 적합도 평가
- Usability Gate, TOP3 추천
- 성능 최적화, GPX 기반 가중치 검증

아래 항목은 현재 기능의 필수 요소가 아니라, 향후 품질·성능·확장성을 높이기 위한 고도화 후보다. 어느 것도 V1 결과를 바꾸지 않았다. 착수할 때는 golden 기준을 다시 정해야 한다(결과가 바뀌는 항목).

| 후보 | 현재 상태와 근거 | 착수 시 필요한 것 |
|---|---|---|
| **교차로 밀도(`intersection_per_km`)를 러닝 적합도 feature로 추가** | GPX 분석에서 주변 일반 도로보다 교차로를 적게 지나는 경향이 확인됐다(GO, Cliff's δ −0.37, 12절). 현재 production scoring에는 해당 항이 없어 V1에는 반영하지 않았다. feature 값 자체는 이미 계산된다(`features.route_features`) | 새 점수 항과 가중치 정의, 교차로 수가 강변길 비율과 섞이는 효과 분리, A/B로 TOP3 개선 확인, 새 golden |
| **LOOP 15 km cold latency 추가 개선** | 최신 cold 9.39 s(TOO SLOW), warm 3.42 s. 병목: generation graph 생성(G + rg 3.23 s), 최단 경로(2.64 s, warm의 약 80 %)(기술 가이드 17.3) | graph 생성은 아래 "NetworkX 의존 축소"와 연결된다. 최단 경로는 D-exact 위의 compiled 이식(결과 동일 유지) 검토 |
| **전국 1 km spatial grid를 production routing에 연결** | 전국 index 생성과 정확성 검증은 완료했다(168/168 동일, false negative 0, 8절). production은 부산 extract 기준이다 | coverage 검사, UTM zone 규칙, 전국 env/DEM/env cache, networkx 소비자 전환, 메모리 정책, 전국 golden(기술 가이드 21절) |
| **generation graph의 NetworkX 의존 축소** | 반복 최단 경로(D-exact)와 P2P app-max graph 2개(substrate)는 이미 NetworkX에서 분리했다. generation graph 객체, OAB 반환점 탐색(`single_source_dijkstra`), P2P PE2 확인, canonical generator 내부에는 남아 있다(기술 가이드 9절) | features, Gate, canonical generator가 graph 객체 대신 배열을 읽도록 전환. 7절 substrate가 본보기 |
| **실제 러닝 활동 데이터 확대 후 가중치 재검증** | 현재 GPX 검증은 커뮤니티 러닝(2), 설계 러닝 코스(44), 로드레이스(98)를 포함한다. 실제 러너 활동 GPS가 아니다(12절) | 이용허락이 확인된 실제 활동 GPS 확보 → 같은 방법(local baseline, family 보정, Cliff's δ + CI, A/B)으로 preference와 running-suitability weight 재검증 |

---

## 성능 변화 타임라인 (p50 초, 보고서 실측값만)

| 단계 (출처) | LOOP 10 cold | LOOP 10 warm | P2P 5 cold | P2P 10 cold | P2P 10 warm | 핵심 변경 |
|---|---:|---:|---:|---:|---:|---|
| 구조 정리 직후 baseline (`PERF_REPORT` 12절) | 10.44 | 5.48 | 12.69 | 24.57 | 7.73 | – |
| A + B + C (`PERF_REPORT` 12절 final) | 7.03 | 3.43 | 10.71 | 20.86 | 4.28 | LegMemo, snap cache, P2P 중복 계산 |
| D-exact (`DEXACT_REPORT` p2) | 5.68 | 2.08 | 10.55 | 20.82 | 2.42 | Python D-exact + RouteCSR |
| P2P substrate (`P2P_PATCH` 같은 세션 before → after) | (LOOP 영향 없음) | – | 8.89 → **1.72** | 17.82 → **6.88** | 2.38 → 2.25 | app-max disk 2개 → numpy mask |
| 최신 production (2026-10-29 bench, cleanup 후) | 6.22 | 1.71 | 1.24 | 6.03 | 2.06 | – |

**읽는 법**
- 각 행은 서로 다른 세션의 측정이다. 기계 상태 차이가 약 ±10 %이므로, 같은 행 안의 before/after가 정확한 비교다.
  - 예: P2P substrate 행의 before(8.89 / 17.82)는 D-exact 행(10.55 / 20.82)과 다른 날 기계 상태다.
  - LOOP 10 cold 최신값 6.22가 D-exact 행 5.68보다 큰 것도 세션 차이다. substrate와 cleanup은 LOOP 코드를 바꾸지 않았다.
- 최신 production 전체(LOOP 3/5/15, OAB 5/10 포함)와 판정은 기술 가이드 17절에 있다.

## 원칙: 결과 동일성 우선
- 모든 성능 작업은 **추천 결과가 바이트 단위로 같다**는 조건에서만 들어갔다(golden 4 모드 + random P2P 30).
- 결과를 바꾸는 선택지(scipy 최단 경로, 생성 disk 전역화, GPX weight 변경)는 근거와 A/B가 갖춰질 때까지 보류했다.
- 의도된 차이는 GS-26 cache 플래그 1건뿐이며, 그 위치만 정확히 허용한다.

## 참고 보고서 (저장소 밖 `RunWay_data/`, 일부는 `reports/`)
| 결정 | 보고서 |
|---|---|
| 1 | `reports/runway_custom_walk_filter_audit.md` |
| 4, 9 | `route_perf2_2026-10-28/PERF_REPORT_2026-10-28.md` |
| 5, 6 | `route_perf2_2026-10-28/DEXACT_REPORT_2026-10-28.md` |
| 6, 7 | `route_global_poc_2026-10-28/GLOBAL_GRAPH_SPIKE_REPORT_2026-10-28.md`, `route_index_kr_1km_2026-10-28/P2P_PATCH_AND_KR_GRID_REPORT_2026-10-28.md` |
| 8 | `route_grid_spike_2026-10-28/GRID_SPIKE_REPORT_2026-10-28.md`, 같은 P2P_PATCH 보고서 Part 2 |
| 10 | `route_refactor_2026-10-28/REFACTOR_REPORT_2026-10-28.md`, `route_cleanup_2026-10-29/CLEANUP_REPORT_2026-10-29.md` |
| 11 | `route_handoff_2026-10-29/HANDOFF_REPRO_REPORT_2026-10-29.md` |
| 12 | `reports/gpx_weight_calibration_2026-10-29/GPX_WEIGHT_CALIBRATION_2026-10-29.md` |
| 최신 성능 | `route_perf2_2026-10-28/final_audit_2026-10-29.json`, `route_final_audit_2026-10-29/FINAL_AUDIT_REPORT_2026-10-29.md` |
