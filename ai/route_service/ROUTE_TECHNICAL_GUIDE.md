# RunWay Route 기술 가이드

[README.md](README.md)(10분 개요)보다 자세한 **현재 기술 구조** 설명이다. 왜 이렇게 되었는지(문제 → 실험 → 선택)는 `ROUTE_DEVELOPMENT_HISTORY.md`에 있다. 각 절은 **쉬운 설명 → 기술 설명** 순서다. 모든 내용은 2026-10-29 production 코드 기준이며, 파일·함수 이름을 함께 적었다.

---

## 1. Route 서비스 한눈에 보기

**쉽게:** "여기서 5 km 뛰고 싶어(강변이면 좋겠어)"라고 하면, 부산 지도에서 실제로 달릴 수 있는 길만 이어 코스 후보를 만들고, 점수와 안전 검사를 거쳐 좋은 코스 3개를 이유와 함께 보여 준다.

**기술적으로:**
- 입력은 (lat, lon, target_m, seed, preferences, shape[, end_lat, end_lon])이고, 출력은 TOP3 경로, 점수 항목, 설명, 주의 문구다.
- 매 요청마다 OSM 도로 graph(RUNNABLE edge만)에서 결정적으로 생성한다. seed와 RNG stream이 고정이다.
- 학습 모델은 없다. 점수는 규칙 기반이고, 안전 검사는 동결된 규칙 엔진이다.

| 단계 | 데이터 | 알고리즘/방법 | 출력 | 최적화 |
|---|---|---|---|---|
| 0 요청 검증 | 요청 JSON | 1–15 km 범위, P2P 직선 > 17 km 거절 (`app/main.recommend_core`) | 통과/오류 | graph 생성 전 거절 |
| 1 graph | 부산 OSM extract (RUNNABLE 분류) | working disk 절단(R = 0.55T + 250 m), fast builder (`graph.build_fast`) | (G, rg) + 요청 graph cg | LRU 4 + 4, fast builder |
| 2 env/DEM | env layer, env edge cache, DEM | edge별 환경 거리 조회, near flag, 고도 표본 (`attach_env`, `attach_elevation`) | cg.ea 배열 | env edge cache |
| 3 snap | rg (P2P: substrate) | 가까운 RUNNABLE node → main component, P2P 도착 PE1/PE4/PE5 | start/end node | graph-level snap cache, P2P substrate |
| 4 후보 | rg.H, bias 배수 | LOOP 원 waypoint / OAB 반환점 / P2P 타원 waypoint | 경로 node 열 | LegMemo |
| 5 최단 경로 | RouteCSR | NetworkX 3.7 bidirectional Dijkstra 정확 이식 | 구간 경로 | Python D-exact |
| 6 feature | cg.ea, DEM, 적합도 level | 길이 가중 비율, 반복/왕복, 고도 profile, 유효성 | features + invalid_reason | 배열 연산 |
| 7 점수 | scoring/RS config | 규칙 점수 + 0.25 × 러닝 적합도 | baseline/preference score | – |
| 8 순위 | 점수, edge 길이 | 점수 정렬(동점 candidate_id) + 60 % 겹침 dedupe | 순위 목록 | – |
| 9 Gate | ug-v1/v2, 요청 graph 전 status edge | PASS/REVIEW/FAIL, FAIL 제거 후 재정렬, Stage B | 최종 순위 + 로그 | Gate context cache |
| 10 응답 | TOP3 features | 이유, 주의 문구 (`explain.py`, `_notices`) | JSON | – |

---

## 2. 현재 지원 기능 (코드 기준)

### 2.1 코스 형태

| | LOOP | OUT_AND_BACK | POINT_TO_POINT |
|---|---|---|---|
| 필수 입력 | lat, lon, distance_km | lat, lon, distance_km | + end_lat, end_lon (없으면 `DESTINATION_REQUIRED`) |
| 거리 규칙 | 길이 ∈ [0.9T, 1.1T], 반복 ≤ 0.20, 왕복 ≤ 0.30 (`features.loop_invalid_reason`) | [0.9T, 1.1T], palindrome, U턴 정확히 1회, ug-v2 F6 비율 (`shape_invalid_reason`) | 생성 전 d_min ≤ 1.1T (`distance_rule`), 이후 [0.9T, 1.1T], 끝점 일치, 반복·되돌아가기·U턴 상한 (F6) |
| 생성 | canonical generator: 원 위 waypoint k = 2–4, 24 attempt (`candidates.loop`) | 반환점 sector 12개, T/2 ± 4 % (`oab_candidates`) | 타원 waypoint 1–2개, 24 attempt (`p2p_candidates`) |
| TOP3 | 가능 | 가능 | 가능(서로 다른 경로가 적으면 1–2개) |
| 실패 응답 | OUT_OF_AREA, NO_ROAD_NEARBY(snap > 250 m 또는 주변에 길 없음), NO_ROUTE, USABILITY_GATE_ALL_FAILED, SAFETY_CHECK | 같음 | + OUT_OF_APP_RANGE, DESTINATION_TOO_FAR(최소 km 안내), END_SNAP_PE1/PE2/PE4/PE5, SNAP_NODE_NOT_IN_GENERATION_GRAPH |

### 2.2 거리
- **앱 범위:** 1–15 km (`app/main.MIN_KM/MAX_KM`, `shape_config.app_km.max = 15`). 범위 밖은 `DISTANCE_RANGE`.
- **허용 오차:** 모든 형태에서 ±10 % (`features.TOLERANCE`, `shape_config.tolerance`).
- **F-1 17 km precheck:** P2P 직선거리가 (1 + 0.10) × 15 km + 2 × 250 m = **17.0 km**를 넘으면 graph를 만들기 전에 `OUT_OF_APP_RANGE`로 답한다 (`app/main._p2p_out_of_range_m`).
- **생성 tolerance:** canonical LOOP는 각 attempt에서 오차가 `ITER_STOP` 3 % 이내가 될 때까지 최대 6번 원 크기를 조정한다. P2P도 `iter_stop` 0.03, `max_iter` 6이다. 최종 유효성은 ±10 %다.

### 2.3 Snap
- **시작점:** 가장 가까운 RUNNABLE node를 고른다. main component(가장 긴 연결망)가 아니면 가장 가까운 main node로 옮긴다(`shift_to_main_m`). 250 m를 넘게 떨어지면 app이 `NO_ROAD_NEARBY`로 거절한다 (`snap.start`, `app/main.MAX_SNAP_M`).
- **P2P 도착점:** main component node 중 250 m(PE1) 이내를 가까운 순서로 본다.
  - PE4: 금지 edge(trunk/motorway(+link), EXCLUDED/UNCERTAIN, 도로 터널)에 붙은 node는 건너뛴다.
  - PE5: 사용자 점 → node 직선이 차단 도로나 강·물·해안을 건너면 건너뛴다(도착 node가 다리 위면 예외 처리, `end_node_on_bridge`).
  - 실패 code 우선순위는 PE5 > PE4 > PE1로 고정이다.
- **same node 처리:**
  - waypoint가 바로 앞 node나 출발/도착과 같으면 추가하지 않는다.
  - route_through는 a == b 구간을 건너뛴다.
  - P2P는 app-max disk에서 정한 출발/도착 node를 생성 단계까지 재사용한다. 생성 graph에 없으면 다시 snap하지 않고 `SNAP_NODE_NOT_IN_GENERATION_GRAPH`로 멈춘다.

### 2.4 Preference (사용자가 줄 수 있는 것)
API의 `filters`는 켜면 5, 끄면 0이다 (`app/main._prefs`). 식과 "생성 vs 순위" 구분은 10절에 있다.

| 선호 | 생성 cost (`GenerationBias`, edge_b04) | 최종 점수 (`scoring_config.json`) |
|---|---|---|
| river (강변) | `river_near` edge 배수 exp(−0.4 × 1) | `river_ratio` × 1.0 |
| beach (해변·바다) | `coastal_near` | `coastal_ratio` × 1.0 |
| park (공원·녹지) | `green_near` | `green_ratio` × 1.0 |
| trail (산책로) | `trail` | `trail_ratio` × 1.0 |
| pedestrian (보행로 위주) | `walk_dedicated` | `walk_dedicated_ratio` × 0.6 |
| avoid_major_road | `major` edge × (1 + 1.0 × 1) | −`major_road_ratio` × 1.0 |
| avoid_steps | `hw_steps` | −`steps_per_km` × 0.15 |
| avoid_tunnel | `tunnel` | −`tunnel_ratio` × 2.0 |
| flat (평지) | **생성에는 반영 안 함** | 난이도 항 −`avg_grade_pct` × 0.15 (DEM이 있을 때만) |

- 생성 배수: m = clip(exp(−beta × Σ선호) × Π(1 + gamma × 회피), 0.4, 4.0). beta = 0.4, gamma = 1.0 (`candidates.DEFAULT_BIAS`, `M_MIN/M_MAX`). config가 아니라 **코드 상수**다.
- 선호가 하나도 없으면(neutral) 생성 bias가 없고, preference 순위도 없다(baseline 순위를 쓴다).

### 2.5 Gate (최종 응답에서의 처리)
- **PASS:** 그대로 추천 후보.
- **REVIEW:** 추천 후보로 남고 순위도 그대로다. 해당 구간이 서버 JSONL 로그(`reports/_usability_gate_log/`)의 review_queue에만 남는다. 응답·debug 어디에도 보내지 않는다.
- **FAIL:** enforce 모드에서 `invalid_reason = "usability_gate:<codes>"`가 되어 유효 후보에서 빠진다. 순위와 dedupe를 다시 계산한 뒤 Stage B가 TOP3를 다시 검사한다. 모두 빠지면 `USABILITY_GATE_ALL_FAILED`. shadow 모드에서는 기록만 한다.

### 2.6 Ranking 순서 (정확한 순서)
1. 후보 생성.
   - LOOP는 canonical 안에서 canonical validity, quality, seed 순 dedupe 0.6을 먼저 거친다.
2. features + 유효성(`loop_pool` / `shape_pool`).
3. 점수.
   - LOOP: `score_loop`(적합도 없이) → `rank` → `counts.final_*` 기록 → `add_running_suitability` + `add_suitability` → `rank` 다시.
   - OAB/P2P: `add_running_suitability` → `score_shape`(적합도 포함) → `rank`.
4. `rank`: 점수 내림차순 정렬(동점은 candidate_id 오름차순)을 한 뒤, 앞에서부터 이미 남긴 경로와 **짧은 쪽 길이 기준 60 % 이상** 겹치면 버린다.
5. Gate: FAIL 제거 → `rank` 다시 → Stage B.
6. app: preference 순위가 있으면 그것, 없으면 baseline의 앞 3개(`TOP_K = 3`).

### 2.7 설명과 주의 문구
- **코스마다** (`explain.explain_shape`):
  - 한 문장 요약(순환/왕복/편도)
  - 이유 목록: 체크한 조건 먼저, 체크했는데 맞지 않으면 주의 문구, 큰길 비율, 계단, 평지 등
  - 상세 정보(`details`)
  - OAB/P2P notes(왕복 안내, 편도의 출발점까지 직선거리, 환경 범위 밖이면 "판단하지 않음")
- **요청 단위** (`app/main._notices`):
  - 출발/도착이 60 m 넘게 떨어진 길에서 시작·끝남
  - 연결되지 않은 길이라 다른 길로 옮김
  - 환경 데이터 일부만 있음
  - 체크한 환경이 주변에 거의 없음
  - 서로 다른 코스가 3개 미만

---

## 3. 전체 데이터 흐름

**쉽게:** 서버가 켜질 때 지도·환경·고도 데이터를 한 번 읽어 두고, 요청이 오면 그 주변만 잘라 쓴다.

**기술적으로:**
```
[시작 시 1회] RoutePipeline.__init__
  FastGraphRouteGenerator: BusanSource(extract) 로드 → Sidecar(way별 node 배열, 분류) → self-test(해운대 5 km)
  RunwayData: scoring / RS / shape config, env layer(wide), DEM(wide), EnvFeatureCache(검증 후)
  Gate: ug-v1/v2 로드, gate_version = hash(config, walk filter, PBF, timestamp)
  Substrate: extract 전체를 배열로(약 30 MB)
[요청마다]
  working disk (center, R = 0.55T + 250 m) → (G, rg) [generator LRU 4] → cg [GraphStore LRU 4]
  cg에 env 거리(cache 조회) + near flag + edge 배열(ea) + DEM node 고도 + 러닝 적합도 level
  → snap → 후보 → features → 점수 → rank → Gate → app 응답, Gate 로그
```

---

## 4. LOOP 알고리즘

**쉽게:** 출발점 근처에 원을 그리고, 원 위 몇 점을 차례로 들렀다 돌아온다. 길이가 안 맞으면 원 크기를 조정한다.

**기술적으로** (`candidates.loop` → `analysis/runway_route_api.RouteGenerator.generate`):
1. `_check_coverage`(부산 extract 범위) → `_graph`(fast builder) → `snap_start`(교체됨 → `snap.start`).
2. attempt i = 0..23, attempt seed = seed + i. `make_candidate`(교체됨 → `make_candidate_biased`).
   - k = (2, 3, 4)[seed % 3], 원 중심 방향 θ와 jitter는 RNG에서 뽑는다(canonical과 같은 stream).
   - 원 반지름 ρ = T / (2π × 1.3)에서 시작하고, waypoint는 원 위 점에 가장 가까운 waypoint pool node(main component, degree ≥ 3)다.
   - 경로 = route_through(start → wps → start, 선호 배수, reuse penalty 4.0) → spur 제거 → 오차 ≤ 3 %면 멈춤, 아니면 ρ × (T/d)^0.9로 조정, 최대 6회.
3. canonical feature → valid(±10 %) → quality(반복 ≤ 0.20 등) → seed 순 dedupe 0.6 → 후보 목록.
4. pipeline이 그 후보를 요청 graph(cg)의 feature로 다시 계산하고 점수를 매긴다.

교체(hook)는 `_PATCH_LOCK` 안에서만 하며 `finally`로 항상 복원한다. 선호가 없으면 `NeutralBias`로 canonical `make_candidate`와 수학적으로 같은 경로를 만든다(배수 1.0은 부동소수점에서도 정확하다).

## 5. OAB 알고리즘

**쉽게:** 목표의 절반쯤 떨어진 반환점을 여러 방향에서 골라, 갔던 길로 돌아온다.

**기술적으로** (`candidates.oab_candidates`):
- 출발점에서 (배수 반영) single-source Dijkstra를 cutoff (T/2 + 4 %) × 최대 배수로 돌린다.
- 실제 길이가 T/2 ± 4 %인 node가 반환점 후보다. PE4 금지 node는 제외한다.
- 후보를 방위 12 sector로 나누고, sector 순서를 RNG([seed, 99])로 섞는다. attempt i는 순서대로 sector를 골라 교차로(degree ≥ 3)를 우선해 RNG([seed, i])로 하나 뽑는다.
- 경로 = path + reverse(path)이므로 palindrome이고 U턴은 반환점 1회다. 구간 최단 경로는 networkx single_source_dijkstra 한 번이다(route_through/D-exact를 쓰지 않는다).

## 6. P2P 알고리즘

**쉽게:** 출발·도착을 길 위에 정확히 찍고, 그 사이 최단 거리가 목표보다 너무 길면 "최소 N km"를 알려 준다. 가능하면 둘 사이를 부풀린 타원 모양으로 돌아가는 코스를 만든다.

**기술적으로** (`pipeline._shape` P2P 분기):
1. (app) 직선 > 17.0 km → `OUT_OF_APP_RANGE`.
2. 사용자 두 점의 UTM 중점에 **app-max snap disk**(반경 R(15 km) = 8.5 km)를 만든다. 출발 snap + 도착 snap(PE1/4/5)을 한다.
   - 기본은 `substrate.Substrate.p2p_endpoints` → `DiskMask.snap_start/snap_end`.
   - rollback 시 `snap.p2p_endpoints` → `graph.disk` + `snap.start/end`.
3. snap된 두 node의 중점에 **d_min disk**(같은 8.5 km)를 만든다(중점이 1 m 넘게 달라질 때만 새로 만든다). RUNNABLE 최단 거리 d_min을 잰다.
   - substrate: scipy `dijkstra` on mask CSR. rollback: `nx.shortest_path_length`.
   - 경로가 없으면 OUT_OF_APP_RANGE sentinel.
4. `candidates.distance_rule`: d_min ≤ 1.1T면 OK. 아니면 DESTINATION_TOO_FAR(min_target_km = ceil_0.5(d_min/1.1)) 또는 OUT_OF_APP_RANGE.
5. **generation disk**(R(T), snapped 중점)를 `graph.disk`로 만든다(networkx, substrate 아님). 출발/도착 node를 재사용한다. 두 node가 연결 안 되면 END_SNAP_PE2.
6. `p2p_candidates`: s, t를 초점으로 하는 타원 위 waypoint 1–2개(attempt seed마다 1, 2 교대). 장축 a는 T/(2 × 1.3)에서 시작해 오차 ≤ 3 %까지 조정한다(최대 6회). 같은 경로는 제거한다.

## 7. Snap

**쉽게:** 사용자가 찍은 점을 "실제로 뛸 수 있는 가장 가까운 길 위 점"으로 옮긴다.

**기술적으로:**
- 시작 snap(`snap.start`, canonical `snap_start`와 같은 규칙)은 rg의 RUNNABLE node 좌표 배열에서 최근접 node를 찾는다(`rrg._nearest`).
  - edge까지 거리는 STRtree(`_edge_index`)로 잰다.
  - main component가 아니면 main mask(`main_component_mask`) 안에서 다시 최근접.
  - edge index와 mask는 rg 객체에 붙여 graph 수명 동안 재사용한다.
- PE 규칙(ug-v2 `end_point_rules`):
  - PE1: 도착 snap ≤ 250 m.
  - PE2: 출발과 연결된 길(생성 graph에서 s → t 경로 존재).
  - PE4: 금지 edge에 붙은 node 금지.
  - PE5: 사용자 점 → node 직선이 차단 도로나 강·물·해안을 건너면 금지(다리 위 도착은 예외 처리).
  - PE5 판정 함수(`usability_gate.pe5_blocked`)는 snap과 Gate 재검사가 같은 것을 쓴다.

## 8. Candidate generation (공통)

- 모든 생성기는 (graph, start, target, seed)로 결정된다. attempt seed = seed + i이고, OAB는 `default_rng([seed, i])`, `[seed, 99]`.
- "다른 코스 추천"은 app이 seed를 + 24 하여 다음 seed 블록을 쓴다.
- `route_through(rg, seq, mult, reuse_penalty, memo)`가 waypoint 열을 구간 최단 경로로 잇는다. LOOP와 P2P가 쓴다.

## 9. Shortest path (D-exact)

**쉽게:** 두 점 사이 가장 짧은(가중치 기준) 길을 찾는다. 길이가 똑같은 길이 여러 개일 때 늘 같은 것을 고르도록, NetworkX와 완전히 같은 순서로 계산한다.

**기술적으로** (`shortest_path.bidirectional`, NetworkX 3.7 `bidirectional_dijkstra` 이식):
- **입력:** `RouteCSR`(H._adj 순서의 node index, 이웃 목록, edge id, 길이), 배수 배열 M, 사용 횟수 배열 used, penalty. **출력:** node index 경로 또는 None.
- **양방향:** forward/backward heap을 번갈아 pop한다(forward 먼저). heap 원소는 `(distance, counter, node)`이고, **counter 하나를 두 heap이 공유**한다. 같은 거리면 먼저 push된 것이 먼저 나오며, 이것이 tie-break 전부다.
- **predecessor 방식:** 각 방향이 `preds[v] = 직전 node`를 기록한다. 이미 확정된 node가 반대 방향에서도 확정되면 멈추고, 그때의 meet node에서 양쪽 preds를 따라 경로를 이어 붙인다.
- **relax:** cost = L[e] × M[e] × (1 + pen × used[e])이고, 연산 순서도 networkx callback과 같다. 처음 보거나 엄격히 짧을 때만 갱신한다. meet 갱신도 엄격히 짧을 때만 한다.
- **neighbor iteration order:** RouteCSR이 H._adj 순서를 그대로 보존한다. 정렬하면 동점 경로가 바뀐다.
- **왜 결과 동일성이 중요한가:**
  - 다른 동점 경로 → 다른 후보 → 다른 TOP3 → golden 불일치가 된다. 사용자 입장에서 같은 요청의 결과가 바뀐다.
  - 그래서 scipy/A*/C 구현처럼 더 빠르지만 tie-break가 다른 방법을 쓰지 않았다.
  - networkx 버전이 3.7이 아니면 자동으로 networkx를 쓴다(`VERIFIED_NETWORKX`).
- **rollback:** `RUNWAY_SP_KERNEL=nx`.
- **RouteCSR이 필요한 이유:**
  - networkx graph는 dict-of-dict라 edge마다 Python callback과 dict 조회를 거친다.
  - RouteCSR은 같은 graph를 평평한 list(ptr / nbr / ned / length)로 한 번 바꿔 둔다. 이렇게 하면 kernel이 정수 index로만 움직인다.
  - 핵심은 **이웃 순서를 networkx(H._adj)와 똑같이 보존**하는 것이다. 그래야 동점 경로 선택이 같다.
  - rg 객체에 붙여 graph 수명 동안 한 번만 만든다.
- **NetworkX가 아직 쓰이는 곳:**
  - 요청 graph 객체 자체(G: MultiDiGraph, rg.H: Graph). fast builder가 만든다.
  - OAB 반환점 탐색(`nx.single_source_dijkstra` 1회).
  - P2P 생성 disk에서의 연결 확인(`nx.shortest_path_length`, PE2).
  - canonical generator 내부(spur 제거, 길이 등)와 Gate 입력용 edge 조회.
  - rollback 경로: `RUNWAY_SP_KERNEL=nx`, `RUNWAY_P2P_SUBSTRATE=0`.
  - 구간 최단 경로(LOOP·P2P)와 P2P app-max snap/d_min은 networkx를 쓰지 않는다.

## 10. 가중치 구조: 후보 생성 bias vs 최종 순위 점수

**쉽게:** 사용자 선호는 두 번 쓰인다.
1. 코스를 **만들 때**: 원하는 길은 조금 싸게, 피하고 싶은 길은 비싸게 보이게 해서 그런 길을 지나는 후보가 더 많이 나오게 한다.
2. 만든 뒤 **순위를 매길 때**: 원하는 특징을 가진 후보에 점수를 더한다.

러닝 적합도(큰길·계단)는 선호와 관계없이 **순위에만** 쓰인다.

```
                 ┌──────────── 후보 생성 (candidates.py) ────────────┐      ┌──────── 최종 순위 (scorer.py) ────────┐
사용자 선호 ──┬──▶ edge 비용 배수 m (GenerationBias, edge_b04)       │      │ preference 항 (선호 있을 때만)        │
              │   cost = length × m × (1 + 4 × 이미 쓴 횟수)        │ ──▶ │ + 거리 적합도 + 모양 penalty          │──▶ 순위
              └─────────────────────────────────────────────────────┼──▶  │ + 0.25 × 러닝 적합도(모든 요청)       │
                                                                    │      └──────────────────────────────────────┘
                 waypoint 위치는 bias 영향 없음(가장 가까운 node)   │
```

### 10.1 후보 생성 bias (`candidates.GenerationBias`, `DEFAULT_BIAS = edge_b04`, 코드 상수)
edge 하나의 배수:

  **m = clip( exp(−β × Σ 선호_flag) × Π(1 + γ × 회피_flag), 0.4, 4.0 )**, β = 0.4, γ = 1.0

체크한 항목은 값이 1이다(app은 체크 시 5를 보내고 /5 한다).

| 선호 | 영향받는 edge(flag) | 배수 |
|---|---|---|
| 강변 river | `river_near` | ×e^−0.4 = 0.67 (그 edge가 1/3 싸게 보임) |
| 해변 beach | `coastal_near` | 0.67 |
| 공원 park | `green_near` | 0.67 |
| 산책로 trail | `trail` | 0.67 |
| 보행로 pedestrian | `walk_dedicated` | 0.67 |
| 선호 2개가 겹친 edge | | e^−0.8 = 0.45, 3개면 0.30 → 하한 0.4 |
| 큰길 피하기 | `major` | ×(1 + 1.0) = 2.0 (두 배 비싸게) |
| 계단 피하기 | `hw_steps` | 2.0 |
| 터널 피하기 | `tunnel` | 2.0 |
| 평지 | – | **생성에는 없음**(점수만) |

- **쓰이는 곳:**
  - LOOP·P2P 구간 최단 경로: cost = length × m × (1 + 4 × 이미 쓴 횟수)
  - OAB 반환점 탐색: length × m
- 선호가 하나도 없으면 bias가 없다(m = 1, canonical과 같은 후보).
- β와 γ는 `scoring_config.json`에 없다(그 파일을 바꿔도 생성은 바뀌지 않는다).
- **reuse penalty** 4.0은 bias와 별개다. 같은 경로에서 이미 지난 edge를 비싸게 만들어 왕복을 막는다.
- **LegMemo:** 구간 i의 비용은 앞 구간이 쓴 edge에 달려 있다. 그래서 memo key가 (a, b)가 아니라 waypoint 열의 prefix다. 요청 하나 동안만 쓴다.

### 10.2 최종 순위 점수 (`scorer.score_route`, `config/scoring_config.json` + `running_suitability_config.json`)
| 항 | 식 / 가중치 | baseline 점수 | preference 점수 |
|---|---|---|---|
| 거리 적합도 | 1.0 × max(0, 1 − \|오차\|/0.10) | O | O |
| 반복 penalty | −1.0 × repeated_edge_ratio | O | O |
| 왕복 penalty | −0.8 × out_and_back_ratio (**LOOP만**) | O | O |
| 선호 river / beach / park / trail | +1.0 × (선호/5) × river_ratio / coastal_ratio / green_ratio / trail_ratio | – | O |
| 선호 pedestrian | +0.6 × (선호/5) × walk_dedicated_ratio | – | O |
| 회피 큰길 / 계단 / 터널 | −1.0 × major_road_ratio / −0.15 × steps_per_km / −2.0 × tunnel_ratio (× 회피/5) | – | O |
| 난이도 "평지" | −0.15 × avg_grade_pct (DEM 있을 때만) | – | O |
| **러닝 적합도** | +0.25 × (0.8 × traffic_score + 0.2 × obstacle_score) | O | O |

- **traffic_score:** 길이 가중 평균. 큰길(primary/secondary/tertiary와 link) 위 0, 큰길 옆(양 끝 node가 교통 중심선 15 m 이내) 0.5, 떨어진 길 1.
- **obstacle_score:** max(0, 1 − 계단 구간 수/km ÷ 0.5).
- **TOP3:** 선호가 있으면 preference 점수 순위, 없으면 baseline 점수 순위를 쓴다(14절).
- **LOOP:** 적합도 없이 한 번 순위를 매긴 뒤(debug의 `counts.final_*`용), 적합도를 더해 다시 매긴다. OAB/P2P는 처음부터 적합도를 넣는다.
- 난이도 "moderate"/"hilly"는 scorer에 있지만 현재 app 화면에서는 보낼 수 없다(평지만).
- **헷갈리기 쉬운 점:** 계단은 세 곳에 나온다.
  1. 생성 bias(계단 피하기 체크 시 ×2)
  2. preference 회피 항(−0.15 × 계단/km, 체크 시)
  3. 러닝 적합도의 obstacle(체크와 무관, 모든 요청)

  GPX 검증(23절)에서 다룬 것은 3번(0.2)이다.

## 11. Feature extraction

`features.route_features`가 경로(cg node index + edge id)에서 계산하고, scorer와 Gate, 설명이 읽는다.

| 묶음 | feature | 사용처 |
|---|---|---|
| 거리 | `distance_m`, `distance_error_pct` | 유효성(±10 %), distance_fit |
| 도로 종류(길이 비율) | footway/pedestrian/path/track/residential/service/tertiary/secondary/primary, `shared_cycleway_ratio`, `major_road_ratio`, `walk_dedicated_ratio`, `trail_ratio` | 선호 점수(pedestrian, trail, major), 설명 |
| 구조 | `steps_count`, `steps_per_km`, `steps_length_m`, `intersection_*`, `bridge_length_m`, `tunnel_ratio` | 회피 점수(steps, tunnel), 적합도(계단), 설명 |
| 모양 | `repeated_edge_ratio`, `out_and_back_ratio`, `unique_edge_ratio`, `shape`, `closed`, `max_dist_from_start_m` | 유효성, shape penalty |
| coverage | `min_dist_to_coverage_edge_m`, `touches_coverage_edge` | Gate 입력 |
| 환경 | `river_ratio`, `water_ratio`, `coastal_ratio`, `beach_ratio`, `waterfront_ratio`, `park_ratio`, `green_ratio`, `env_layer_covered_ratio` | 선호 점수(river, coastal, green), 설명 |
| 고도(DEM) | `elevation_gain/loss/min/max_m`, `avg_grade_pct`, `max_grade_pct`, `steep_segment_ratio`, `gain_per_km`, `profile_m` | 난이도 점수(avg_grade_pct), 고도 그래프 |
| 안전 | `excluded_edges_used`, `uncertain_edges_used`, `unknown_edges_used` (분류 graph로 독립 확인) | 유효성, FORBIDDEN_EDGE_USED |
| 러닝 적합도 | `running_suitability`, `rs_traffic_score`, `rs_obstacle_score`, `rs_on/beside/away_ratio`, `rs_steps_runs_per_km` | 적합도 항, 설명 |

- 고도는 20 m 간격 재표본 → median 5 / mean 3 smoothing → 100 m 창 경사로 계산한다. 다리·터널 구간은 양 끝 사이를 보간한다. DEM 밖 node가 있으면 고도 feature를 뺀다.
- 미제공 feature(`crossing_node_count`, `traffic_signals_count`, `recovered_cycleway_ratio`)는 None이다(0이 아님).

## 12. Scoring

**쉽게:** 목표 거리에 가까울수록, 원하는 환경이 많을수록, 피하고 싶은 것이 적을수록 점수가 높다. 여기에 "일반적으로 달리기 좋은 길" 점수(러닝 적합도)를 조금 더한다.

**기술적으로:**
- 항과 가중치 전체는 10.2절 표에 있다. 생성 bias(10.1)와 섞지 않는다.
- 점수는 항목별 기여도(terms)로 남아 debug와 설명에 쓰인다.
- baseline 점수(선호 무시)와 preference 점수(선호 있을 때만)를 따로 계산한다.

## 13. Usability Gate

**쉽게:** 점수가 높아도 위험하거나 이상한 코스(자동차 전용도로, 규칙 위반)는 최종 추천에서 빼고, 애매한 것은 사람이 나중에 볼 수 있게 기록한다.

**기술적으로:**
- 규칙 엔진 `usability_gate.py`와 `config/ug-v1.json`(LOOP), `ug-v2.json`(형태별, PE 규칙)은 **동결·사전 등록**이다.
- `gate.Gate.apply`가 요청 graph의 전 status edge로 `GateContext`를 만든다(cg에 cache).
- 유효 후보마다 `RouteInput`(node, way, 길이, 시작 snap, P2P면 도착 snap·PE5 입력)을 만들어 `UG.evaluate`를 부른다.
- **pipeline 위치:** scorer와 rank 다음, 응답 직전이다.
  - 점수 다음인 이유: REVIEW 기록에 순위(rank_baseline/preference)를 남기기 위해서다.
  - FAIL은 rank 전 단계(유효 후보 전체)에서 빼고 rank를 다시 한다. 순위표에서 지우기만 하면 FAIL 경로 때문에 중복으로 지워졌던 안전한 경로가 돌아오지 못한다.
- **REVIEW를 남기는 이유:** 확실히 위험하지는 않지만 규칙상 애매한 구간(예: 특정 도로 조건)을 사용자 경험을 해치지 않고 모아 사람이 검토하고, 다음 규칙 버전의 근거로 쓰기 위해서다. 순위에는 영향이 없다.
- **Stage B:** 최종 TOP3 payload(좌표 포함)를 F1–F4로 한 번 더 검사하고, 실패하면 빼고 다시 채운다.
- **기록:** structural code(F1–F7, PE1/2/4/5)는 "일어나면 안 되는 일"이라 incidents로 따로 남긴다.

## 14. Ranking / dedupe / TOP3

- 정렬 key = (−score, candidate_id)이다. Python sort는 stable이고, 동점은 candidate_id(LOOP는 canonical 번호, OAB/P2P는 attempt seed)로 정해진다.
- dedupe: 앞에서부터 남긴 경로들과의 겹침 = 공유 edge 길이 / 두 경로 중 짧은 쪽 길이. 0.6 이상이면 버린다.
- TOP3 = 최종 preference 순위(선호 있을 때) 또는 baseline 순위의 앞 3개 (`app/main.py`, `TOP_K = 3`).

## 15. 사용하는 데이터

| 데이터 | 원본 | 형식 | 위치 | 읽는 곳 | 용도 | 메모리 적재 |
|---|---|---|---|---|---|---|
| 부산 OSM extract | Geofabrik south-korea-261020.osm.pbf (ODbL, 2026-10-20) → bbox [128.73, 34.85, 129.35, 35.42], highway way 73,064개, node 524,108개 | PBF + `EXTRACT.json`(sha) | `data/osm/busan/` | analysis `BusanSource` (graph.FastGraphRouteGenerator 생성 시) | 모든 graph | 시작 시 전체 |
| 도로 분류 | `analysis/runway_walk_filter.classify`(명시 tag만, 추론 없음) | 코드 | analysis | Sidecar, substrate, Gate | RUNNABLE/EXCLUDED/UNCERTAIN | 시작 시 way별 |
| env layer | OSM, 도로 extract와 같은 Geofabrik 스냅샷(2026-10-20), 부산 전체 bbox [128.73, 34.85, 129.35, 35.42] (bundle v2, S15P31E105-435): green 2,638, park 1,158, river 850, water 565, coast 159, beach 14. v1은 Overpass(2026-10-22) 데모 지역 bbox만 | GeoJSON + meta | `reports/_route_canonical_work/env_layers_wide.geojson` | data.load_env | 환경 near flag, PE5 차단 강·물·해안 | 시작 시 |
| env edge cache | 위 layer와 extract로 사전 계산(약 57만 segment × 6 class, 0.1 m) | npz + provenance.json | `reports/_route_canonical_work/env_edge_cache/` | data.EnvFeatureCache | 요청 graph의 env 거리 조회 | 시작 시(검증 통과 때만) |
| DEM | Copernicus GLO-30 4타일(N34/N35 × E128/E129) mosaic, 부산 전체 bbox, 2052 × 2232 px (bundle v2; v1은 N35E129 한 타일 clip) | GeoTIFF | `reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif` | data.Dem | node 고도 → 고도 feature, 난이도 | 시작 시 |
| config | 팀 결정 | JSON | `runway_routing/config/` | data, gate | 가중치, 규칙 | 시작 시 |
| 전국 1 km grid | 전국 PBF(같은 Geofabrik 파일) | npy 19개 + metadata (1.88 GB) | `RunWay_data/route_index_kr_1km_2026-10-28/index/` | **없음** | 미래 전국 확장 | **production 미연결** |

**데이터 출처와 역할 (한눈에)**

| 데이터 | 사용 목적 | production 여부 |
|---|---|---|
| 부산 OSM extract | 요청 graph, 분류, P2P substrate | **runtime 입력** |
| 전국 OSM PBF (Geofabrik south-korea-261020) | 부산 extract의 원본, 전국 grid index와 GPX 분석용 전국 network의 원본 | runtime 입력 아님(데이터 생성 원본) |
| DEM (Copernicus GLO-30 clip) | 고도 feature, "평지" 점수 | **runtime 입력** |
| environment layer (Overpass, 6 class) | 강·해변·공원 비율, 선호 점수, PE5 차단 | **runtime 입력** |
| env edge cache | 환경 거리 사전 계산(속도만, 결과 동일) | **runtime 입력**(없으면 직접 계산) |
| GPX 231개 (팀 공유 ZIP) | 가중치 **검증·연구 자료**(23절). 추천 요청 처리에 쓰지 않음 | **아님.** `raw_redistribution` 금지, `analysis_permission` UNKNOWN: 팀 내부 분석만. 원본·형상 공개·데모 금지 |
| 전국 1 km grid index | 전국 확장 준비(21절) | **아님(생성·검증 완료 / 미연결)** |

**analysis/ 의존.** 엔진이 실행 중 import하는 모듈은 다섯 개다(`ai/route_service/analysis/`). 381에서 서비스로 옮기며 쓰지 않는 조사·리포트 명령은 지웠다. `runway_walk_filter.py`는 파일 sha256이 Gate 로그에 기록되므로 그대로 둔다.

| 모듈 | 쓰는 것 |
|---|---|
| `runway_route_api.py` | `RouteGenerator`(canonical LOOP generator, working radius, coverage, graph cache), `OutOfCoverageError`, `_region`, `SCHEMA` |
| `runway_route_generator.py` (rrg) | `make_candidate`, `snap_start`(교체 대상), `trim_spurs`, `_length`, `_key`, `_nearest`, `RouteGraph`, 상수(`REUSE_PENALTY`, `CIRCUITY0`, `MAX_ITER`, `ITER_STOP`, `EDGE_ATTRS`) |
| `runway_busan_graph.py` (busan) | `BusanSource`(extract PBF 읽기, osmium, `disk_graph`), `route_graph`, `_disk_ll`, `TO_UTM`/`TO_LL`/`UTM`, `classify`, `SURVEY_TAGS`/`RULE_TAGS`, `RUNNABLE`, `BUSAN_DIR`, `working_radius` |
| `runway_walk_filter.py` | `classify`(RUNNABLE/EXCLUDED/UNCERTAIN 규칙), `ROAD_HW` |
| `osm_walk_inspect.py` | `REGIONS`(다섯 지역 중심, 예시 출발지) |

**OSM 상세:**
- way tag는 SURVEY_TAGS ∪ RULE_TAGS만 graph에 싣는다(highway, foot, access, sidewalk류, bridge, tunnel, layer, service, surface, expressway/motorroad/toll 등).
- **EXCLUDED:** area, 미완성(construction 등), foot=no/private, access 금지(foot 허가 없으면), motorway(+link), trunk(foot 허가 없으면), expressway/motorroad/toll = yes, 보도가 따로 그려진 도로(sidewalk=separate).
- **UNCERTAIN:** foot 태그 없는 cycleway, foot 허가된 trunk, 보도 정보 없는 도로 터널, 미처리 highway 값.
- 나머지가 **RUNNABLE**이며, 라우팅은 RUNNABLE edge만 쓴다.
- 전국 PBF와의 관계: 부산 extract는 전국 Geofabrik PBF에서 bbox로 잘라낸 것이다. 전국 grid index도 같은 PBF에서 만들었다.

**DEM:** node 고도를 쌍선형 보간으로 표본하고, 고도 feature(상승·하강, 평균·최대 경사, 가파른 구간 비율, profile)를 계산한다. "평지" 선호의 점수 항이 avg_grade_pct를 쓴다. DEM이 없거나 경로가 DEM 밖이면 그 feature만 없다.

**데이터 재생성:** `tools/data/`(`fetch_env_layer.py`, `fetch_dem.py`, `build_env_cache.py`. 순서와 명령은 그 폴더 README). 부산 extract는 `analysis/runway_busan_graph.py extract`.

**env edge cache:**
- 존재 이유: 요청 graph마다 수십만 edge의 환경 거리(STRtree nearest)를 계산하면 cold가 크게 느려진다. 그래서 extract 전체를 미리 계산해 둔다.
- **source hash가 중요한 이유:** cache의 숫자는 `data.edge_distances` 코드가 만든 값이다. 코드와 숫자가 어긋나면 환경 feature가 조용히 틀린다.
- invalid 조건: cache version, extract sha, env layer 이름/sha, `edge_distances` 소스 + ENV_CLASSES + version hash 중 하나라도 다를 때. 이때 같은 값을 직접 계산한다(결과 같음, 느림). `/api/status`의 `env_cache.valid`로 확인한다.

## 16. Cache

| cache | 위치 | key | 크기 | 결과 영향 |
|---|---|---|---|---|
| generator (G, rg) | `FastGraphRouteGenerator._cache` | (round(lat,6), round(lon,6), round(R)) | LRU 4 | 없음 (internal `from_cache` 플래그만) |
| 요청 graph cg | `GraphStore._graphs` | 같은 key | LRU 4 | 없음 |
| P2P disk mask | `Substrate._masks` | 같은 key | LRU 4 | 없음 |
| snap edge index, main mask | rg 객체 속성 | – | rg 수명 | 없음 |
| PE4 node, PE5 선, Gate context | G / cg 객체 속성 | rule 객체 | G/cg 수명 | 없음 |
| RouteCSR | rg 객체 속성 | – | rg 수명 | 없음 |
| LegMemo | 요청 하나 | waypoint prefix | 요청 끝에 폐기 | 없음 |
| env edge cache | 프로세스 | (osm_u, osm_v, osmid) | 전체 | 없음 (검증 실패 시 직접 계산) |

전역 결과 cache는 없다. 같은 요청을 다시 보내면 다시 생성하며, graph만 재사용한다.

## 17. 성능 최적화

**쉽게:** 결과는 한 글자도 바꾸지 않고, 같은 계산을 반복하지 않거나 더 싼 방법으로 같은 답을 내도록 바꿨다.

### 17.1 현재 production 지연 (2026-10-29 측정, `bench.py`, cold 4회 / warm 4회 p50, 초)
cold = graph cache를 비운 첫 요청, warm = 같은 요청 반복. 같은 프로세스 안에서 측정했으며 EcoQoS를 해제했다.

| 요청 | cold p50 (max) | warm p50 | cold의 graph 준비 (G+rg / cg env·DEM / 적합도 level) | cold 최단 경로 | 판정 |
|---|---:|---:|---|---:|---|
| LOOP 3 km | 0.54 (0.58) | 0.17 | 0.31 (0.20 / 0.07 / 0.03) | 0.08 | GOOD |
| LOOP 5 km | 1.37 (1.40) | 0.31 | 0.85 (0.55 / 0.20 / 0.10) | 0.15 | GOOD |
| LOOP 5 km 선호 | 1.35 (1.39) | 0.31 | 0.91 | 0.16 | GOOD |
| LOOP 10 km | 6.22 (7.22) | 1.71 | 3.69 (2.29 / 0.74 / 0.38) | 1.37 | ACCEPTABLE |
| LOOP 15 km | 9.39 (9.65) | 3.42 | 5.06 (3.23 / 1.11 / 0.69) | 2.64 | TOO SLOW (cold) |
| OAB 5 km | 1.30 (1.32) | 0.22 | 0.94 | 0.02 | GOOD |
| OAB 10 km | 4.73 (4.84) | 1.05 | 3.10 (2.00 / 0.65 / 0.37) | 0.18 | ACCEPTABLE |
| P2P 5 km | 1.24 (1.36) | 0.41 | 0.74 | 0.25 | GOOD |
| P2P 10 km | 6.03 (6.24) | 2.06 | 3.66 (2.43 / 0.78 / 0.46) | 1.73 | ACCEPTABLE |

판정 기준(이 문서의 정의): GOOD = cold ≤ 2 s이고 warm ≤ 1 s. ACCEPTABLE = cold ≤ 7 s이고 warm ≤ 3 s. 그 밖은 TOO SLOW.

### 17.2 들어간 최적화 (모두 결과 동일, golden 0 diff로 확인)

| 최적화 | 기존 문제 | 방법 | 동일성 보장 | 효과(측정) | 남은 한계 |
|---|---|---|---|---|---|
| A. LegMemo (`candidates.LegMemo`) | 한 요청 안에서 같은 waypoint 구간을 반복 탐색(LOOP 5: 374회) | 요청 단위 memo. key = waypoint prefix | reuse penalty 상태가 prefix로 정해짐. (graph, 배수 dict, penalty) 한 조합에 묶음 | LOOP 5 warm 최단 경로 0.69 → 0.35 s(호출 374 → 230) | 요청 사이 공유 없음 |
| B. snap cache (`snap._edge_index`, `main_component_mask`) | snap할 때마다 edge STRtree와 main mask를 재생성 | rg 객체에 붙여 graph 수명 동안 재사용 | 같은 생성 코드, 같은 edge 순서 | LOOP 5 warm start snap 0.14 → 0 s | cold에서는 여전히 1회 생성(LOOP 15 cold 0.73 s) |
| C. P2P 중복 계산 제거 (`pe4_forbidden_nodes`, `pe5_blockers`, Gate context on G) | P2P 도착 snap마다 graph 전체 edge scan, Gate context 재생성 | G 객체에 rule과 함께 1회 저장 | 같은 함수, rule 객체 동일성 확인 | P2P 10 warm snap·PE·Gate context 1.73 → 0 s | OAB 반환점 필터도 같은 함수 사용 |
| D. Python D-exact (`shortest_path.py` + `graph.RouteCSR`) | networkx가 edge마다 Python callback과 dict 조회 | flat list CSR + networkx 3.7 알고리즘 정확 이식 | 같은 heap counter, 이웃 순서, 연산 순서. leg 단위 parity + golden | 최단 경로 −46~−66 %, LOOP 15 warm 7.21 → 4.00 s, LOOP 10 warm 3.37 → 2.08 s | 여전히 순수 Python. LOOP 15 warm의 80 % |
| E. P2P substrate (`substrate.py`) | P2P cold마다 8.5 km networkx graph 2개(약 11만 node) 생성 | 시작 시 extract 전체 배열(약 30 MB) + 요청마다 exact numpy mask | 집합 bit 단위 동일, PE5 선 순서 재현, golden + random 30 동일 | P2P 5 cold 8.9 → 1.7 s, P2P 10 cold 17.8 → 6.9 s, graph 준비 13.45 → 3.92 s, 130요청 후 private 메모리 −348 MB | generation disk는 여전히 networkx |

현재(17.1)는 A–E가 모두 들어간 상태다. 이전 수치의 출처: `PERF_REPORT_2026-10-28.md`(A–C), `DEXACT_REPORT_2026-10-28.md`(D), `P2P_PATCH_AND_KR_GRID_REPORT_2026-10-28.md`(E).

### 17.3 남은 병목 (17.1 실측 순위, cold 기준)
1. **generation disk graph 생성(G + rg, fast builder, networkx 객체):** LOOP 15 3.2 s, P2P 10 2.4 s, LOOP 10 2.3 s.
2. **최단 경로(Python D-exact):** LOOP 15 2.6 s(warm에서는 2.75/3.42 s로 1위), P2P 10 1.7 s.
3. **요청 graph(cg) 구성(adapter, env 조회, DEM):** 0.7–1.1 s. 이 안에 쓰이지 않는 CSR/KD-tree 생성이 포함된다(추정, 분리 측정 안 함).
4. **start snap index(cold 1회):** LOOP 15 0.73 s.
5. **러닝 적합도 level:** 0.4–0.7 s.
6. **OAB 반환점 후보 길이 재합산(Python):** OAB 10 약 0.8 s(warm에서도 같음).

## 18. Rollback

| 환경변수 | 읽는 곳 | 끄는 것 | 결과 | 성능 |
|---|---|---|---|---|
| `RUNWAY_P2P_SUBSTRATE=0` | `RoutePipeline.__init__` | substrate → networkx app-max disk | 동일 | P2P cold 10 km 약 7 → 18 s |
| `RUNWAY_SP_KERNEL=nx` | `shortest_path` import | D-exact → networkx | 동일 | 최단 경로 약 2배 느림 |
| `RUNWAY_FAST_GRAPH=0` | `app/config.py` → `fast=False` | fast builder → canonical builder | 동일 | cold graph 3–4배 느림 |
| `RUNWAY_USABILITY_GATE=shadow` | `app/config.py` → `mode` | Gate FAIL 제거 | **달라질 수 있음** (FAIL 경로가 남음) | 거의 없음 |

모두 프로세스 시작 시 한 번 읽으므로, 바꾸면 재시작해야 한다. 주의: `RoutePipeline` 생성자 기본값은 `mode="shadow"`이며, app은 기본 `"enforce"`를 넘긴다.

## 19. Golden regression

- **무엇:** 고정 시나리오(`tools/route_regression/scenarios.json`: LOOP/OAB/P2P, 선호, 경계 사례 43개 + debug)의 HTTP 응답, `out` dict, Gate 로그를 저장해 두고, 코드 변경 후 같은 입력의 결과를 바이트 단위로 비교한다(시간 key 제외).
- **4 모드:** main / `RUNWAY_FAST_GRAPH=0` / `RUNWAY_USABILITY_GATE=shadow` / env cache 무효. 추가로 random P2P 30개(`scenarios_p2p_random.json`).
- **도구(저장소 안):** `tools/route_regression/`
  - 한 번에: `python -B tools/route_regression/run_regression.py --tag <name>`
  - 저수준: `capture.py --mode <m> --out <dir>`, `compare.py <baseline> <run> [--known known_differences.json]`
  - 기준(baseline): `tools/route_regression/baseline/{main,fastoff,shadow,noenvcache,random}`(약 30 MB). 2026-10-28 P2P substrate patch 직전 production으로 캡처한 것이며, 덮어쓰지 않는다.
  - rollback 확인: `--env RUNWAY_P2P_SUBSTRATE=0 --strict`, `--env RUNWAY_SP_KERNEL=nx`
- **허용 차이(known difference) 1건:** shadow 모드 `GS-26 out.json $[0].canonical.graph.from_cache` False → True.
  - 기능 차이가 아니라 cache side effect다. P2P app-max networkx graph를 더 이상 만들지 않으므로, GS-09가 만든 센텀 graph가 LRU에서 밀려나지 않고 GS-26이 재사용한다.
  - `--known`은 모드, 시나리오, 경로, 값이 정확히 같고 다른 차이가 없을 때만 허용한다.
- **합격 기준:** functional mismatch 0, known difference 정확히 1.

## 20. 현재 제한사항

V1 이후 개선 방향(교차로 feature, LOOP 15 km cold, 전국 grid 연결, NetworkX 의존 축소, 실제 활동 GPS 재검증)은 `ROUTE_DEVELOPMENT_HISTORY.md`의 "향후 고도화 후보"에 정리했다.

1. **지역:** 부산 extract만 지원한다. 밖이면 OUT_OF_AREA.
2. **지연:** LOOP 15 km cold, P2P 10 km cold는 여전히 느린 편이다(17절). 원인은 요청마다 만드는 generation disk networkx graph와 Python 최단 경로다.
3. **graph 객체:** 생성 disk, LOOP/OAB, features, Gate가 networkx/pandas 객체를 읽는다. substrate는 P2P snap/d_min만 대체한다.
4. **단일 처리:** 요청은 lock으로 직렬 처리되며 thread-safe가 아니다. 동시성은 프로세스 수로 늘려야 한다(메모리 약 2.2–2.7 GB/프로세스).
5. **feature:** 횡단보도·신호 개수 등 node tag feature가 없다(None).
6. **로컬 서버(Windows):** EcoQoS를 해제하지 않아, 창이 뒤에 있으면 체감이 느릴 수 있다(regression capture는 해제).
7. **실행되지만 쓰이지 않는 계산:** `CanonicalRoutingGraph._build_routing`의 CSR/component/KD-tree 등(감사 보고서 SUSPICIOUS). 성능 변경이라 남겨 두었다.

## 21. 전국 확장 구조

**현재 상태:** 생성 완료, 검증 완료, mmap-ready, **production 미연결.** 현재 기능이 아니다.
- 전국 PBF의 모든 highway way에서 node 1,732만 개, way 183만 개, segment 1,829만 개를 뽑았다. UTM-K 1 km grid(점유 cell 97,435)를 쓰며, compact npy 19개, 1.88 GB다.
- 무작위·도심·해안·다리·산지·시도경계 disk 168개에서 전체 scan과 결과가 같았다(false negative 0). disk 추출은 전체 scan 0.52 s 대비 0.004–0.05 s(p50)다.

**아직 쓰지 않는 이유(연결 전 필요한 일):**
1. coverage 검사와 app-max sentinel이 부산 extract 범위 기준이다.
2. exact disk 규칙이 UTM 52N 기준인데, 126°E 서쪽은 51N이다. 규칙을 정해야 하고 결과가 달라진다.
3. 부산 extract는 bbox에서 way가 잘려 있고, 전국 index는 way 전체다. 경계에서 결과가 달라지므로 전국 golden이 필요하다.
4. env layer, DEM, env cache가 부산 전용이다.
5. generation disk와 features, Gate가 networkx 객체를 읽는다. index slice에서 graph를 만드는 경로가 필요하다(substrate가 본보기).
6. 메모리 정책(mmap/eager, 어떤 배열을 올릴지)이 정해지지 않았다.

## 22. 팀원이 코드 수정할 때 주의할 곳

| 곳 | 이유 |
|---|---|
| `usability_gate.py`, `ug-v1/v2.json` | 동결. sha가 Gate 로그와 버전에 들어간다. 바꾸면 새 Gate 버전 + 새 golden이 필요하다 |
| `data.edge_distances` | 소스 텍스트가 env cache hash에 들어간다. 공백 하나도 cache를 무효로 만든다 |
| `shortest_path.py`, `graph.RouteCSR` | 순서가 tie-break를 정한다. 바꾸면 추천이 바뀐다 |
| `scorer.rank` | 정렬 key와 dedupe 순서가 TOP3를 정한다 |
| `candidates.loop` / `make_candidate_biased` | canonical RNG stream과 같아야 한다(k, θ, jitter 순서) |
| `graph.build_fast` | canonical builder와 node/edge 순서가 같아야 한다(시작 self-test가 감시) |
| `substrate._pe5_edges_in_G_order` | PE5 선 순서가 Gate 입력이다 |
| `pipeline` out dict | key와 순서가 API/Gate 로그 계약이다 |
| 같은 값이 여러 곳 | ±10 %, 250 m, 15 km, 24, 0.6, 0.20/0.30. `config/CONFIG_NOTES.md` 표 참조 |
| 코드 상수 vs config | 선호 bias, LOOP 유효성, dedupe, 앱 범위는 코드 상수다. config만 바꾸면 반영되지 않는다 |
| 바꾼 뒤 | golden 4 모드 + random P2P 30 + rollback 2종 + 서비스 동일성(`service_identity.py`) (19절) |

**왜 일부는 config가 아니라 코드 상수인가:**
- 선호 bias(edge_b04)와 LOOP 유효성 값은 실험과 사용자 결정으로 고정된 값이다. 바꾸면 결과와 golden이 바뀌므로, 쉽게 조정되지 않도록 코드에 두었다.
- LOOP 생성 상수는 analysis canonical generator(`analysis/runway_route_generator.py`)에 있다.
- config는 "운영 중 조정 후보"(점수 가중치, 적합도, OAB/P2P 생성 파라미터)에 쓴다.

## 23. GPX 기반 weight 검증 (2026-10-29, 결과: HOLD)

**쉽게:**
- 러닝 관련 GPX가 같은 동네의 다른 길보다 어떤 길을 더 고르는지 봤다.
- 그 신호로 현재 가중치를 바꿀지 시험했다.
- 계단 회피 신호는 분명했지만, 계단 가중치를 올려도 추천 TOP3가 바뀌지 않았다. 그래서 **기존 값을 유지**했다.
- "GPX로 가중치를 학습했다"가 아니다.

**왜 GPX를 모았나:** Running Suitability와 선호 가중치는 규칙과 사전 고정 실험으로 정한 값이다. 실제 러닝 코스가 그 방향과 맞는지 **외부 근거로 검증**하려는 연구 자료다. 추천 runtime 입력이 아니다.

**데이터:**
- ZIP 231개 중 **T1 `A_REAL_COMMUNITY_RUNNING` 2 + T2 `B_DESIGNED_RUNNING` 44 + T3 `D_ROAD_RACE` 98 = 144개**를 썼다.
- T4 트레일 러닝 87개는 도심 러닝 추천과 성격이 달라 뺐다.
- 표현은 "국내 러닝 관련 GPX 144개(커뮤니티 러닝, 설계 러닝 코스, 로드레이스)"다. 실제 러너 활동 GPS 전체가 아니다.

**방법:**
1. **map matching:**
   - 기존 HMM matcher(`RunWay_data/gpx_tools`, mm-v1 그대로)와 전국 OSM network를 썼다.
   - 144개 모두 **GOOD 131 / FAIR 13 / POOR 0 / FAILED 0**이다.
   - 이전 freeze 결과와 겹치는 105개는 완전히 같았다.
2. **local baseline:**
   - route = 매칭된 경로의 edge
   - local = 원본 GPS 선 **500 m 안 RUNNABLE edge**(길이 가중)
   - 지역 자체의 특성(예: 해운대는 원래 수변)과 코스의 선택을 구분하기 위해서다.
3. **같은 대회 변형 보정:** route family당 대표 1개만 쓴다. T3 98개는 59 family다. 분석 단위는 **103 family**다(eligibility 제외 2).
4. **통계:**
   - route 중앙값, local 중앙값, 짝지은 차이
   - Cliff's δ와 family 단위 bootstrap 95% CI(B = 10,000)
   - 판정 기준: |δ| ≥ 0.33이고, CI가 0을 포함하지 않으며, T2와 T3가 충돌하지 않으면 GO

**결과:**

| 판정 | feature | 요약 (Cliff's δ: 전체 / T2 / T3) |
|---|---|---|
| GO | steps_per_km, steps_share | −0.61 / −0.46 / −0.71: 모든 tier가 주변보다 계단이 적다 |
| GO | intersection_per_km | −0.37 / −0.21 / −0.47. production 점수에 해당 항이 없다 |
| HOLD | waterfront, grade, steep | 같은 방향이지만 작다 |
| HOLD | major, walk_cycle, green | **T2와 T3가 반대 방향** |
| KILL | traffic_exposed, 개별 footway/path/cycleway, park | T2에서도 신호가 없거나 반대 |
| 제외 | crossing, signal | node 태그 누락으로 신뢰도 부족 |

**T2와 T3가 반대인 이유:**
- T2(설계 러닝 코스)는 주변보다 큰길을 피하고(major δ −0.27) 보행·자전거 시설(+0.38)과 녹지(+0.20)를 고른다.
- T3(로드레이스)는 교통이 통제된 큰길을 쓰므로 반대(+0.65 / −0.51 / −0.28)다.
- 둘을 하나의 강한 weight로 합치면 서로 상쇄되거나 대회 코스 쪽으로 끌려간다. 그래서 합치지 않았다.

**A/B:**
- GO 중 production weight와 연결되는 것은 러닝 적합도의 계단(obstacle) 0.20뿐이다.
- CURRENT 0.20 / MILD 0.25 / STRONG 0.30으로 부산 대표 16개 요청(LOOP 5·10 km, P2P 5·10 km)을 같은 후보 묶음으로 비교했다.
- 결과:
  - TOP3 후보 집합이 세 arm 모두 같았다.
  - 1위도 전부 같았다. 2·3위 순서만 일부(3 / 5건) 바뀌었다.
  - Gate, 거리 오차, route feature가 동일했다.
- 실질적인 개선이 없어서 **최종 HOLD, production 0.20 유지**다.

**자세한 내용:** `reports/gpx_weight_calibration_2026-10-29/GPX_WEIGHT_CALIBRATION_2026-10-29.md`, 결정 과정은 `ROUTE_DEVELOPMENT_HISTORY.md` 12절.

## 24. 왜 이 기술을 썼는가 (현재 사용 중인 것만)

| 기술/알고리즘 | 어디에, 왜 | 대안 | 선택 이유 |
|---|---|---|---|
| **OpenStreetMap** | 도로망과 환경 레이어 | 상용 지도 API, 공공 도로 데이터 | 전국 무료(ODbL)이고, 보행 판단에 필요한 태그(foot, access, sidewalk, steps, bridge, tunnel)가 있으며, 오프라인으로 재현 가능하다 |
| **명시 태그 기반 분류(RUNNABLE/EXCLUDED/UNCERTAIN)** | 경로에 쓸 수 있는 길만 graph에 남김 | osmnx `network_type="walk"` 그대로 | osmnx walk는 자동차 전용·보행 금지 길을 섞어 넣는다. 추론 없이 태그만 쓰면 규칙을 설명하고 감사할 수 있다 |
| **Dijkstra(양방향)** | waypoint 사이 구간 최단 경로 | A*, scipy csgraph, contraction hierarchy | 비용이 길이 × 선호 배수 × 재사용 penalty로 요청마다 달라져 전처리형 기법의 이점이 작다. networkx와 같은 결과를 내야 해서 같은 알고리즘을 그대로 이식했다 |
| **D-exact(Python 정확 이식) + RouteCSR** | 최단 경로 kernel | networkx 그대로, scipy, numba/C | scipy는 동점 처리가 달라 추천이 바뀐다. numba는 환경에 없었다. 같은 결과에 약 2배 빠르다 |
| **NumPy 배열 substrate + exact disk mask** | P2P app-max 영역(snap, d_min) | 요청마다 networkx graph 생성 | 같은 집합을 배열 연산으로 재현한다(bit 동일). P2P cold가 약 2.6–5배 빨라졌다(10 km 17.8 → 6.9 s, 5 km 8.9 → 1.7 s) |
| **LRU cache** | graph, mask 재사용 | 전역 결과 cache | 결과를 바꾸지 않고 같은 위치의 반복 요청만 빠르게 한다. 메모리 상한이 분명하다 |
| **DEM (Copernicus GLO-30)** | 고도, 경사 | GPX 고도, SRTM | 전국 공개 30 m이고 라이선스가 명확하다. GPX 고도는 대부분 없거나 부정확하다 |
| **FastAPI + uvicorn** | Route 서비스 API(`app/`, 별도 컨테이너) | Flask | 타입이 있는 요청 모델(pydantic), 간단한 배포. `ai/service`와 같은 프레임워크 |
| **1 km UTM-K spatial grid (전국 index, 미연결)** | 전국 확장 시 disk 후보 축소 | 행정구역 partition, 500 m / 2 km grid | 행정구역은 polygon 틈 때문에 누락이 생겨 결국 전체 scan이 된다. 500 m는 더 느리고, 2 km는 이점이 없다(개발 기록 8절) |
| **HMM map matching (분석 전용)** | GPX → OSM edge | 최근접 snap | 연속성을 고려해 평행 도로 오매칭을 줄인다. production runtime에는 없다 |
| **Cliff's δ + bootstrap CI (분석 전용)** | GPX feature 비교 | 평균 차이, t-test | 분포 가정이 없고 0이 많은 비율 데이터(계단 등)에 강하다. family 단위 재표집으로 변형 중복을 다룬다 |

