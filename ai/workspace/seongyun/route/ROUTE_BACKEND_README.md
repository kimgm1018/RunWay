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
| **rollback** | 환경변수 6개로 최적화·Gate를 끌 수 있다(6절) |
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
⑤ 구간 최단 경로: LOOP·P2P = Numba D-exact(기존 경로와 동일),     [shortest_path.py, shortest_path_numba.py, graph.RouteCSR]
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
| `RUNWAY_SP_ENGINE=python` | Numba D-exact → Python D-exact | 같음(느려짐), Numba import·컴파일 없음 |
| `RUNWAY_ARRAY_LOOP=0` | LOOP 배열 graph → 기존 NetworkX G/H 준비 | 같음(첫 요청 느려짐), Numba 탐색은 유지 |
| `RUNWAY_FAST_GRAPH=0` | fast graph builder → canonical builder | 같음(느려짐) |
| `RUNWAY_USABILITY_GATE=shadow` | Gate FAIL 제거 | **달라질 수 있음**(비상용) |
| `RUNWAY_SOURCE_SNAPSHOT=0` | 검증된 extract snapshot 읽기 → 매번 PBF 파싱 | 같음(기동 약 3초 느려짐) |
| `RUNWAY_ENV_PREPARED=0` | env 범위 polygon 1회 준비(prepared) → 요청마다 within | 같음(느려짐) |
| `RUNWAY_ADAPTER_LEAN_ROUTING=0` | 읽지 않는 CSR/components/KD-tree 생략 → 다시 생성 | 같음(느려짐, 메모리 증가) |
| `RUNWAY_NETWORK_STORE=0` | 압축 도로망(배열 view) → extract를 dict로 들고 있음(snapshot 또는 PBF) | 같음(기동 메모리 약 250 MiB 증가) |

**cache 크기** (프로세스 시작 시 1회 읽음 → 바꾸면 서버 재시작. 1 이상의 정수만, 잘못된 값이면 기동 단계에서 `ValueError`로 멈춤)

| 환경변수 | 기본 | 정하는 것 | 추천 결과 |
|---|---:|---|---|
| `RUNWAY_GRAPH_CACHE_SIZE` | 4 | 요청 graph LRU와 generator (G, rg) LRU 칸 수(둘을 함께) | 같음. 칸이 적으면 메모리↓, 다른 출발점 사이를 오가는 반복 요청은 cold로 느려짐 |
| `RUNWAY_MASK_CACHE_SIZE` | 4 | P2P disk mask LRU 칸 수(칸당 수 MB) | 같음 |

- **배포 컨테이너(1 worker, 메모리 한도 1.5 GiB): `RUNWAY_GRAPH_CACHE_SIZE=2`.** mask는 기본 4 그대로 둔다.
- 근거(Linux, 15 km 위주 14개 요청 열의 최대 VmHWM, `reports/route_linux_validation_2026-11-04/REPORT.md` 9.4절):
  4칸 **1.83 GiB**(1.5 GiB 초과), 2칸 **1.37 GiB**. 두 설정의 추천 결과는 같다(`from_cache` 표시만 다를 수 있음).
- worker를 늘리면 프로세스마다 이만큼 따로 쓴다. HR과 같은 컨테이너면 HR 메모리를 더한다.
- 코드 기본값 4는 Golden baseline(Windows·Linux)을 만든 설정이다.

**extract snapshot (기동 단축):** PBF 파싱 결과를 `data/osm/busan/source_snapshot/`(npz + json, pickle 없음)에 미리
만들어 두면 기동 때 읽는다. key(extract sha256, 파서·snapshot 코드 hash, Python/numpy/osmium/pyproj/PROJ 버전, 형식
버전)나 파일 hash가 하나라도 다르면 PBF를 파싱한다. 런타임은 읽기만 하므로 배포·image build 단계에서 만든다.
```bash
python -B -m runway_routing.source_snapshot build
```
`RUNWAY_SOURCE_SNAPSHOT=<dir>`로 위치를 바꿀 수 있다. extract나 라이브러리를 바꾸면 다시 만든다(안 만들면 파싱으로 동작).

**압축 도로망 (기동 메모리 단축):** extract 전체(way·node·tag를 하나도 빼지 않음)와 선분을 `data/osm/busan/network_v1/`
(npz + json, 약 46 MB, pickle 없음)에 두면, 기동 때 Python dict 대신 배열로 읽고 필요한 값만 그때그때 꺼낸다(준비 완료
메모리 약 −250 MiB). 분류(classify)는 저장하지 않고 기동 때 계산한다. key(extract sha256, 파서·이 모듈 hash,
Python/numpy/osmium/pyproj/PROJ/osmnx 버전, 형식 버전)나 파일 hash가 다르면 위 snapshot → PBF 순으로 내려간다(같은 결과,
`gen.network_store["reason"]`에 이유). 배포·image build 단계에서 만든다.
```bash
python -B -m runway_routing.network_store build
```
`RUNWAY_NETWORK_STORE=<dir>`로 위치를 바꿀 수 있다. Gate 버전에 PBF sha256이 들어가므로 PBF 파일은 그대로 둔다.

**데이터 재생성:** extract → env layer → env edge cache 순서다. [tools/data/README.md](tools/data/README.md)에 명령이 있다.

### Numba 실행 환경 (2026-11-03)

LOOP는 기본으로 정적 도로 배열에서 요청 graph/CSR·snap index·feature 입력을 구성한다.
canonical 생성·선호·점수·Gate 규칙은 유지하며 OAB/P2P 생성 graph는 기존 경로를 쓴다.
`RUNWAY_ARRAY_LOOP=0`은 LOOP graph 준비만 이전 방식으로 되돌린다. `RUNWAY_FAST_GRAPH=0` 또는
NetworkX kernel rollback에서는 배열 경로를 사용하지 않는다. 최초 시작의 기존 graph self-test는 유지한다.

`requirements-route.txt`의 Numba 0.68.0 / llvmlite 0.50.0을 설치하면 기본 엔진은 `numba`다.
기존 환경은 같은 requirements로 갱신한 뒤 실행한다. 다른 의존성의 고정 버전은 유지했다.
Numba가 없거나 컴파일에 실패하면 시작 단계에서 실패한다. 임시 복구는 `RUNWAY_SP_ENGINE=python`이다.

명시적 signature로 import 시 컴파일·warm-up하므로 첫 추천 요청 중에 컴파일하지 않는다.
새로운 OS/CPU 또는 이미지에서는 시작 시 컴파일이 필요할 수 있다. `NUMBA_CACHE_DIR`는 짧고 쓰기 가능한
런타임 cache 경로로 지정한다(예: Windows `C:/Temp/runway-numba`, Docker `/tmp/runway-numba`).
다른 OS/CPU에서 생성한 JIT cache를 배포 artifact로 복사하지 않는다. 첫 요청의 graph 생성 비용은 별개다.

```powershell
# 선택: 런타임에 맞는 짧은 쓰기 가능 경로를 지정
$env:NUMBA_CACHE_DIR = "$PWD/.route-numba-cache"
.venv-route/Scripts/python.exe -B -m uvicorn route_demo.app_runway:app --host 127.0.0.1 --port 8002
# rollback (서버 재시작 필요)
$env:RUNWAY_SP_ENGINE = "python"
```

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
