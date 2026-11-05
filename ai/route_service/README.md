# RunWay Route 서비스

부산 러닝 코스 추천 엔진을 FastAPI 컨테이너 하나로 띄운다(ADR-0019 option B: `ai/service`와 별도 컨테이너,
Spring 백엔드가 호출). 팀원이 가장 먼저 보는 문서다. Jira S15P31E105-381.

| 더 알고 싶으면 | 문서 |
|---|---|
| 백엔드 연동 계약 (요청·응답·오류·타임아웃·준비 상태). BE 쪽 정본은 `docs/design/api/ai-service.md` "Route 코스 생성 내부 HTTP 계약 초안"(MR !183) | [API.md](API.md) |
| 현재 기술 구조 상세 (알고리즘, 가중치, 데이터, cache, 성능, GPX 검증, 전국 확장) | [ROUTE_TECHNICAL_GUIDE.md](ROUTE_TECHNICAL_GUIDE.md) |
| 왜 지금 구조가 되었는가 (문제 → 실험 → 선택 → 검증), 향후 고도화 후보 | [ROUTE_DEVELOPMENT_HISTORY.md](ROUTE_DEVELOPMENT_HISTORY.md) |
| config 값을 바꾸면 무엇이 바뀌는가 | [runway_routing/config/CONFIG_NOTES.md](runway_routing/config/CONFIG_NOTES.md) |
| 회귀 검증 / 데이터 재생성 | [tools/route_regression/README.md](tools/route_regression/README.md), [tools/data/README.md](tools/data/README.md) |

## 1. 무엇을 하는 서비스인가

사용자의 현재 위치, 목표 거리, 코스 형태(순환·왕복·편도), 선호 조건을 받는다. 그러면 부산 OSM 도로 중 **달릴 수 있는 길(RUNNABLE)**만 써서 러닝 코스 후보를 매번 새로 만든다.

후보마다 거리·도로·환경 feature를 계산하고 규칙 기반 점수로 순위를 매긴다. 안전 규칙(Usability Gate)을 통과한 **TOP3**를 이유 설명과 함께 돌려준다.

- 저장된 코스를 찾는 것이 아니다. 학습 모델도 쓰지 않는다.
- 같은 요청과 같은 데이터면 항상 같은 결과가 나온다.
- 고도·경사 값은 응답에 넣지 않는다. 코스 경사는 백엔드가 계산하고, 엔진은 DEM을 "평지 위주" 선호에만 쓴다([API.md](API.md) 3절).

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
| **rollback** | 환경변수로 최적화·Gate를 끌 수 있다(7절) |
| 전국 1 km grid index | **생성·검증 완료 / production 미연결.** 현재 서비스는 부산 extract만 읽는다 |

## 3. 전체 동작 흐름 (요청 하나)

```
POST /internal/v1/routes/recommendations: 현재 위치 · 목표 거리 · shape · 도착점(P2P) · 선호 · seed
   │                                                          [app/main.py  recommend_core()]
   ▼
① 범위 검사: 1–15 km, P2P 직선 17 km 초과 거절(F-1)              [app/main._p2p_out_of_range_m]
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
⑪ TOP3 선택 (선호 있으면 preference 순위, 없으면 baseline 순위)    [app/main.py]
   ▼
⑫ 자연어 설명 / 주의 문구 → JSON 응답 (+ 서버 Gate 로그)           [explain.py, app/main._notices]
```
순서상 점수와 순위(⑧⑨)가 Gate(⑩)보다 먼저다. Gate가 FAIL을 빼면 순위와 중복 제거를 처음부터 다시 한다. 단계별 상세는 [기술 가이드](ROUTE_TECHNICAL_GUIDE.md) 4–14절에 있다.

## 4. 파일 지도

| 경로 | 한 줄 역할 |
|---|---|
| `app/reroll.py` | 재추천 제외용 코스 결과 cache(TTL 10분, TOP3 edge id만)와 seed → 되돌아볼 묶음 수 |
| `app/main.py` | 엔드포인트(`/internal/v1/...`), 준비 상태(로드 → 예열 → ready), 실행 슬롯 1초 대기(`BUSY`)·`X-Request-Deadline`(`TIMEOUT`), 응답 조립(운영은 BE 계약의 최소 필드, `ROUTE_DEBUG=1`이면 전체 + debug) |
| `app/config.py` / `schemas.py` / `errors.py` / `ai_logging.py` | 환경변수 / 요청 형식 / 오류 코드·메시지 / `runway.ai` 로그 |
| `runway_routing/pipeline.py` | 엔진 전체 흐름(`RoutePipeline.run`), rollback 스위치 |
| `runway_routing/data.py` | 외부 데이터 로딩(extract, env, env cache, DEM, config). 데이터 root = `RUNWAY_DATA_DIR` |
| `runway_routing/graph.py` | 요청 graph, fast builder, LRU, RouteCSR |
| `runway_routing/snap.py` / `substrate.py` | GPS → 길 위 node / P2P app-max 영역을 배열로 |
| `runway_routing/candidates.py` | LOOP·OAB·P2P 후보, 거리 규칙, 선호 bias, LegMemo |
| `runway_routing/shortest_path.py` | D-exact 최단 경로 kernel |
| `runway_routing/features.py` / `scorer.py` | feature·유효성·적합도 / 점수·순위·중복 제거 |
| `runway_routing/gate.py` / `usability_gate.py` | Gate 적용 / 동결 규칙(수정 금지) |
| `runway_routing/explain.py` | 사용자용 문장 |
| `runway_routing/config/` | 정책값(CONFIG_NOTES.md 먼저) |
| `analysis/` | canonical LOOP generator, OSM 추출·분류. **엔진이 실행 중 import하는 5개 모듈** + 부산 extract 만들기(`runway_busan_graph.py extract`) |
| `tools/route_regression/`, `tools/data/` | golden 회귀 검증·엔진 단위 테스트, 데이터 재생성·검사 |
| `tests/` | API 테스트(`test_api.py`: 가짜 엔진, `test_engine_api.py`: 실제 엔진+데이터) |
| `Dockerfile`, `requirements.txt`, `constraints.txt` | 이미지와 고정 버전 |

데이터 파일과 그로부터 만든 network store / source snapshot / Numba cache는 git에 넣지 않는다. 데이터 묶음은
`route_data_bundle_v2/`(DATA_MANIFEST.md에 경로·크기·sha256)이고 출처·재배포 검토가 끝나지 않았다.
v2(S15P31E105-435)부터 강·바다·공원 환경층과 DEM이 도로망과 같은 부산 전체 범위(경도 128.73~129.35, 위도 34.85~35.42)를
덮는다. v1은 데모 지역(경도 128.99~129.23, 위도 35.10~35.23)만 덮었다. 파일 이름·경로는 v1과 같아서 코드 변경은 없다.
v2 묶음은 비공개 Hugging Face 저장소 `AnSeongYun/runway-hr-models`의 `route_data_v2/` 폴더에 있다(revision `4952478476ce2d76579e1b6ba16363214e6a6914`).
받은 폴더를 그대로 `RUNWAY_DATA_DIR`나 아래 build context로 쓰고, 먼저 `tools/data/verify_bundle.py <폴더>`로 sha256을 확인한다.

## 5. 로컬 실행

Python 3.12(검증: 3.12.10), 이 폴더(`ai/route_service`)에서. Windows 기준이고 macOS/Linux는 `Scripts/python.exe` 대신 `bin/python`을 쓴다.

```bash
# 1. Route 전용 venv + 고정 의존성 (networkx 3.7 / osmnx 2.1.1 / osmium 4.3.2 등, 이유는 requirements.txt 주석)
py -3.12 -m venv .venv-route
.venv-route/Scripts/python.exe -m pip install -r requirements.txt -c constraints.txt
# 2. 데이터 root: data/osm/busan, reports/_route_canonical_work 가 있는 폴더 (기본값은 이 폴더)
set RUNWAY_DATA_DIR=C:\path\to\data-root
.venv-route/Scripts/python.exe -B tools/data/build_env_cache.py info      # 마지막 줄이 "valid"
# 3. 압축 도로망 + extract snapshot (처음 한 번, 약 15초. 코드·라이브러리가 바뀌면 다시)
.venv-route/Scripts/python.exe -B -m runway_routing.network_store build
.venv-route/Scripts/python.exe -B -m runway_routing.source_snapshot build
# 4. 서버 (worker 1개). GET /internal/v1/ready 가 200 {"ready": true}이면 준비 완료
.venv-route/Scripts/python.exe -B -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

- `analysis/` 없이 `runway_routing/`만 복사하면 import 단계에서 깨진다.
- 개발 중 응답에 `debug`가 필요하면 `ROUTE_DEBUG=1`, 예열을 건너뛰려면 `ROUTE_WARMUP=0`.

## 6. Docker

Docker 빌드 때 데이터 묶음을 이름 붙은 build context로 넘긴다. 빌드는 묶음 sha256을 검사하고, store/snapshot을 만들고,
엔진을 한 번 시작해(로드 + 예열) Numba cache를 이미지에 넣는다.

```bash
docker build -t runway-route --build-context route_data=/path/to/route_data_bundle_v2 ai/route_service
docker run --cpus 1 --memory 1.5g --read-only --tmpfs /tmp -p 8000:8000 runway-route
```

- 목표 자원: 1 vCPU / 1.5 GiB, worker 1개, graph 캐시 2칸(`RUNWAY_GRAPH_CACHE_SIZE=2`). HR 컨테이너와 따로 띄운다.
- 근거(Linux, 15 km 위주 14개 요청 열의 최대 VmHWM, `reports/route_linux_validation_2026-11-04/REPORT.md` 9.4절):
  캐시 4칸 **1.83 GiB**(1.5 GiB 초과), 2칸 **1.37 GiB**. 두 설정의 추천 결과는 같다(`from_cache` 표시만 다를 수 있음).
- 이미지의 Numba cache는 빌드한 CPU 기준이다. 배포 CPU가 다르면 시작할 때 다시 컴파일한다(읽기 전용이면 cache에
  쓰지 못한다는 경고만 나고 동작은 같다). 다른 OS/CPU에서 만든 JIT cache를 따로 복사해 넣지 않는다.

## 7. 설정과 rollback

모두 프로세스 시작 시 1회 읽는다(바꾸면 재시작). 서비스 설정(`ROUTE_DEBUG`, `ROUTE_WARMUP`, Gate 로그 폴더)은 [API.md](API.md) 6절.

| 환경변수 | 끄는 것 | 추천 결과 |
|---|---|---|
| `ROUTE_REROLL_EXCLUDE=0` | 재추천에서 이전 2개 응답 코스 빼기(S15P31E105-383, `app/reroll.py`) | 첫 요청(seed 1~24) 같음, 재추천은 예전(seed만 바꿈) 결과 |
| `RUNWAY_P2P_SUBSTRATE=0` | P2P 배열 substrate → networkx | 같음(느려짐) |
| `RUNWAY_SP_KERNEL=nx` | D-exact → networkx 최단 경로 | 같음(느려짐) |
| `RUNWAY_SP_ENGINE=python` | Numba D-exact → Python D-exact | 같음(느려짐), Numba import·컴파일 없음 |
| `RUNWAY_ARRAY_LOOP=0` | LOOP 배열 graph → 기존 NetworkX G/H 준비 | 같음(첫 요청 느려짐), Numba 탐색은 유지 |
| `RUNWAY_ARRAY_SHAPES=0` | OAB/P2P 생성 disk 배열 graph → networkx | 같음(cold 느려짐) |
| `RUNWAY_ARRAY_PAIR_FAST=0` | LOOP 배열 graph 생성의 배열/Numba 처리(full_status·component·key) → 기존 Python 반복문 | 같음(LOOP cold 느려짐) |
| `RUNWAY_FAST_GRAPH=0` | fast graph builder → canonical builder | 같음(느려짐) |
| `RUNWAY_USABILITY_GATE=shadow` | Gate FAIL 제거 | **달라질 수 있음**(비상용) |
| `RUNWAY_SOURCE_SNAPSHOT=0` | 검증된 extract snapshot 읽기 → 매번 PBF 파싱 | 같음(기동 약 3초 느려짐) |
| `RUNWAY_ENV_PREPARED=0` | env 범위 polygon 1회 준비(prepared) → 요청마다 within | 같음(느려짐) |
| `RUNWAY_ADAPTER_LEAN_ROUTING=0` | 읽지 않는 CSR/components/KD-tree 생략 → 다시 생성 | 같음(느려짐, 메모리 증가) |
| `RUNWAY_NETWORK_STORE=0` | 압축 도로망(배열 view) → extract를 dict로 들고 있음(snapshot 또는 PBF) | 같음(기동 메모리 약 250 MiB 증가) |

**cache 크기** (1 이상의 정수만, 잘못된 값이면 기동 단계에서 `ValueError`로 멈춤)

| 환경변수 | 기본 | 정하는 것 | 추천 결과 |
|---|---:|---|---|
| `RUNWAY_GRAPH_CACHE_SIZE` | 4 (이미지 2) | 요청 graph LRU와 generator (G, rg) LRU 칸 수(둘을 함께) | 같음. 칸이 적으면 메모리↓, 다른 출발점 사이를 오가는 반복 요청은 cold로 느려짐 |
| `RUNWAY_MASK_CACHE_SIZE` | 4 | P2P disk mask LRU 칸 수(칸당 수 MB) | 같음 |

코드 기본값 4는 Golden baseline(Windows·Linux)을 만든 설정이다. worker를 늘리면 프로세스마다 이만큼 따로 쓴다.

**extract snapshot (기동 단축):** PBF 파싱 결과를 `data/osm/busan/source_snapshot/`(npz + json, pickle 없음)에 미리
만들어 두면 기동 때 읽는다. key(extract sha256, 파서·snapshot 코드 hash, Python/numpy/osmium/pyproj/PROJ 버전, 형식
버전)나 파일 hash가 하나라도 다르면 PBF를 파싱한다. 런타임은 읽기만 하므로 배포·image build 단계에서 만든다.
`RUNWAY_SOURCE_SNAPSHOT=<dir>`로 위치를 바꿀 수 있다.

**압축 도로망 (기동 메모리 단축):** extract 전체(way·node·tag를 하나도 빼지 않음)와 선분을 `data/osm/busan/network_v1/`
(npz + json, 약 46 MB, pickle 없음)에 두면, 기동 때 Python dict 대신 배열로 읽고 필요한 값만 그때그때 꺼낸다(준비 완료
메모리 약 −250 MiB). 분류(classify)는 저장하지 않고 기동 때 계산한다. key(extract sha256, 파서·이 모듈 hash,
Python/numpy/osmium/pyproj/PROJ/osmnx 버전, 형식 버전)나 파일 hash가 다르면 snapshot → PBF 순으로 내려간다(같은 결과,
`gen.network_store["reason"]`에 이유). `RUNWAY_NETWORK_STORE=<dir>`로 위치를 바꿀 수 있다. Gate 버전에 PBF sha256이
들어가므로 PBF 파일은 그대로 둔다.

**Numba:** 명시적 signature로 import 시 컴파일·warm-up하므로 첫 추천 요청 중에 컴파일하지 않는다. Numba가 없거나
컴파일에 실패하면 시작 단계에서 실패한다. 임시 복구는 `RUNWAY_SP_ENGINE=python`이다. `NUMBA_CACHE_DIR`는 짧은 경로로
지정한다(예: Windows `C:/Temp/runway-numba`, 이미지 `/opt/route/numba_cache`).

**데이터 재생성:** extract → env layer → env edge cache 순서다. [tools/data/README.md](tools/data/README.md)에 명령이 있다.

## 8. 테스트와 Golden 회귀

```bash
pip install pytest==9.2.0 httpx==0.28.1
python -B -m pytest -q tests/test_api.py                                  # 데이터 없이
python -B -m pytest -q tools/route_regression tests/test_engine_api.py   # RUNWAY_DATA_DIR 필요
```

Golden 회귀(결과가 한 글자도 안 바뀌었는지, 약 8분): [tools/route_regression/README.md](tools/route_regression/README.md).
합격은 `RESULT PASS`, 모든 mode `"fails": 0`(shadow 모드의 허용된 차이 GS-26 1건만 보임; 기능 차이가 아니라 cache 플래그).
- 엔진 동일성: 저장된 baseline은 예전 데모 앱으로 찍었으므로 `--app demo --demo-dir <!180 커밋의 route_demo 사본>`으로 돌린다.
- 서비스 동일성: `--app service`로 찍고 `service_identity.py`가 데모 응답에서 고도·debug만 뺀 것과 같은지 본다.

## 9. 바꾸면 안 되는 것

- `analysis/runway_walk_filter.py`: 파일 sha256이 모든 Gate 로그에 기록된다(한 바이트도 바꾸지 않는다).
- `runway_routing/usability_gate.py`, `config/ug-v*.json`: Gate 규칙 고정본.
- `runway_routing/data.py`의 `edge_distances`: 소스 텍스트가 env edge cache 키다.
- `pipeline.run`의 `out` key 순서, 응답 key 순서: Golden 계약.

## 10. 처음 읽는 순서

1. 이 문서와 [API.md](API.md)
2. `app/main.py`: `recommend_core`
3. `runway_routing/pipeline.py`: 모듈 docstring과 `RoutePipeline.run`
4. `runway_routing/candidates.py`: `loop`, `route_through`, `LegMemo`, `p2p_candidates`, `distance_rule`
5. `runway_routing/snap.py` / `substrate.py`
6. `runway_routing/shortest_path.py`
7. `runway_routing/features.py` / `scorer.py`
8. `runway_routing/gate.py` / `usability_gate.py`(규칙 목록만)
9. `runway_routing/config/CONFIG_NOTES.md`
10. [ROUTE_TECHNICAL_GUIDE.md](ROUTE_TECHNICAL_GUIDE.md) → [ROUTE_DEVELOPMENT_HISTORY.md](ROUTE_DEVELOPMENT_HISTORY.md)

모든 엔진 모듈 맨 위에 `요약 / 위치 / 주의` 세 줄이 있다.
