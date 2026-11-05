# runway_routing/config: 이 값을 바꾸면 Route의 무엇이 바뀌는가

이 폴더의 모든 key는 production이 실제로 읽는다(`_comment`, `_basis`, `version` 같은 설명 key는 예외). 2026-10-29 cleanup에서 읽히지 않던 key를 지웠다(맨 아래 표). 남은 값은 하나도 바꾸지 않았다.

| 파일 / key | 읽는 곳 | 바꾸면 바뀌는 것 |
|---|---|---|
| `scoring_config.json` `env_thresholds_m.*` | `data.RunwayData` → `graph.attach_env` / `data.edge_flags` | 어떤 edge를 강·해변·공원 "근처"로 볼지 → 환경 비율 feature, 선호 점수, 설명 문구, 생성 bias flag |
| `scoring_config.json` `distance_fit`, `preference_terms`, `avoid_terms`, `difficulty_terms`, `shape_penalties` | `scorer.score_route` | 후보 점수와 TOP3 순서. 후보 생성은 바뀌지 않는다 |
| `running_suitability_config.json` `traffic.*`, `obstacle.*`, `combine.*` | `graph.edge_levels` / `traffic_node_distance`, `features.route_components` | 러닝 적합도(큰길 위·옆·떨어진 길, 계단) 점수와 설명 |
| `running_suitability_config.json` `ranking.weight` (0.25) | `pipeline`, `scorer.add_suitability` / `score_shape` | 적합도가 최종 순위에 미치는 크기 |
| `shape_config.json` `tolerance` (0.10) | `features.shape_pool`, `candidates.distance_rule`, P2P app-max disk, app 17 km precheck | OAB/P2P 유효 거리 창 [0.9T, 1.1T], P2P 최소 목표 km. **LOOP의 ±10 %는 `features.TOLERANCE`와 analysis canonical이 정한다** |
| `shape_config.json` `app_km.max` (15) | `candidates.distance_rule`, `substrate` / `snap.p2p_endpoints`(app-max disk 반경 8.5 km), app precheck | P2P 앱 범위(OUT_OF_APP_RANGE)와 P2P snap disk 크기 |
| `shape_config.json` `attempts`, `circuity0`, `iter_stop`, `max_iter`, `reuse_penalty`, `p2p_waypoints` | `candidates.p2p_candidates` (attempts는 OAB도) | OAB/P2P 후보 생성. **LOOP는 analysis canonical 상수를 쓴다** |
| `shape_config.json` `oab_window`, `oab_sectors`, `oab_turnaround_min_degree` | `candidates.oab_candidates` | 왕복 반환점 후보 |
| `shape_config.json` `snap_max_m` (250) | `app/main._p2p_out_of_range_m`만 | P2P 17.0 km 사전 거절선 = (1 + tolerance) × app max + 2 × snap_max_m. **이름과 달리 실제 snap 반경이 아니다.** 도착지 snap은 ug-v2 PE1(250 m)을 쓴다 |
| `ug-v1.json`, `ug-v2.json` | `gate.Gate` → `usability_gate.py` | Gate 판정(PASS/REVIEW/FAIL)과 P2P 도착 snap 규칙(PE1/PE4/PE5). **동결·사전 등록.** 파일 sha256이 gate_version과 Gate 로그에 기록되므로, 바꾸면 새 Gate 버전이다 |

## config에 없는 production 값 (코드 상수)

| 값 | 위치 |
|---|---|
| 선호 생성 bias: beta 0.4, gamma 1.0, 배수 clip 0.4–4.0 | `candidates.DEFAULT_BIAS`, `M_MIN`, `M_MAX` |
| LOOP 유효성: ±10 %, 반복 ≤ 0.20, 왕복 ≤ 0.30 | `features.TOLERANCE`, `MAX_REPEATED_RATIO`, `MAX_OAB_LOOP` (+ analysis canonical) |
| dedupe 0.6 | `scorer.DEDUPE_OVERLAP` |
| 앱 거리 1–15 km, attempts 24, start snap 250 m | `app/main.py` `MIN_KM`, `MAX_KM`, `ATTEMPTS`, `MAX_SNAP_M` |
| graph cache 4개, P2P disk mask cache 4개 | `graph.GRAPH_CACHE_SIZE`, `substrate.MASK_CACHE_SIZE` |

## 같은 값이 여러 곳에 있는 경우 (바꿀 때 모두 함께 확인)

| 값 | 위치 |
|---|---|
| 거리 허용 ±10 % | `features.TOLERANCE`, analysis `rrg.TOLERANCE`, `shape_config.tolerance`, ug-v1 F5, ug-v2 F5 |
| snap 250 m | `app.main.MAX_SNAP_M`, analysis `busan.WORK_BUFFER_M`(working radius buffer와 같은 값), `shape_config.snap_max_m`, ug-v1 F7, ug-v2 PE1 |
| 앱 거리 1–15 km | `app.main.MIN_KM/MAX_KM`, `shape_config.app_km.max`, ug-v2 F5 app range |
| attempts 24 | `app.main.ATTEMPTS`, `candidates.POC_DEFAULT_ATTEMPTS`, `shape_config.attempts` |
| dedupe 0.6 | `scorer.DEDUPE_OVERLAP`, analysis `rrg.DEDUP_OVERLAP`(canonical의 seed 순 dedupe) |
| 반복 0.20 / 왕복 0.30 | `features.MAX_REPEATED_RATIO / MAX_OAB_LOOP`, analysis `rrg.REPEATED_MAX / OUT_AND_BACK_MAX`, ug F6 |

## 2026-10-29에 지운 key (production이 읽지 않음, 실제 값은 오른쪽)

| 지운 key | 실제로 쓰이는 값 |
|---|---|
| `scoring_config.generation_bias.*` (beta 0.5–0.9, gamma 1.5–4.0, waypoint_attraction 3.0, min/max_multiplier 0.3/6.0) | `candidates.DEFAULT_BIAS` (beta 0.4, gamma 1.0, clip 0.4–4.0). 숫자가 달라서 오해를 불렀다 |
| `shape_config.repeated_max` (0.20) | P2P: ug-v2 F6, LOOP: `features.MAX_REPEATED_RATIO` |
| `shape_config.oab_max_p2p` (0.30) | ug-v2 F6 |
| `shape_config.dedupe_overlap` (0.6) | `scorer.DEDUPE_OVERLAP` |
| `shape_config.app_km.min` / `step` (1.0 / 0.5) | `app.main.MIN_KM`, (예전 데모 화면 입력 step) |
