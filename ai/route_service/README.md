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
- 같은 요청과 같은 데이터면 항상 같은 추천 결과(코스·순서·문구)가 나온다. 처리 시간 같은 측정값과 내부 cache 표시는 다를 수 있다.
- 고도·경사 값은 응답에 넣지 않는다. 코스 경사는 백엔드가 계산하고, 엔진은 DEM을 점수에서는 "평지 위주" 선호에만 쓴다(설명 문장에는 그 밖에도 쓰일 수 있음, [API.md](API.md) 3절).

## 2. 현재 실제로 되는 기능

| 구분 | 기능 |
|---|---|
| **코스 형태** | LOOP(출발점으로 돌아오는 순환, 기본값) · OUT_AND_BACK(반환점까지 갔다가 같은 길로 돌아옴) · POINT_TO_POINT(사용자가 고른 도착지까지 편도) |
| **거리** | 1–15 km. 모든 형태에서 목표 거리 **±10 %**([0.9T, 1.1T]) |
| **P2P 거리 규칙** | 출발–도착 최단 거리가 1.1T를 넘으면 코스 대신 "최소 N km" 안내. 직선 **17 km 초과**는 graph를 만들기 전에 거절(F-1) |
| **도로** | OSM에서 RUNNABLE로 분류된 길만 쓴다. 자동차 전용·보행 금지 길은 EXCLUDED, 애매한 길은 UNCERTAIN으로 빠진다 |
| **snap** | 찍은 위치 → 가장 가까운 연결된 RUNNABLE 길. 실제 출발 node가 250 m 넘게 떨어지면 거절. P2P 도착지는 금지 도로·강/큰길 건너기 규칙도 적용 |
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
| `app/response_cache.py` | 추천 성공 응답 전체 cache(기본 32개·10분, 같은 요청은 슬롯 대기·계산 없이 같은 byte, S15P31E105-630) |
| `app/main.py` | 엔드포인트(`/internal/v1/...`), 준비 상태(로드 → 예열 → ready), 실행 슬롯 기본 최대 8초 대기(`ROUTE_LOCK_WAIT_S`, `BUSY`)·`X-Request-Deadline`으로 대기 제한(`TIMEOUT`), 응답 조립(운영은 BE 계약의 최소 필드, `ROUTE_DEBUG=1`이면 전체 + debug) |
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
받은 폴더를 그대로 `RUNWAY_DATA_DIR`나 아래 build context로 쓰고, 먼저 `tools/data/verify_bundle.py <폴더>`로 확인한다.
목록의 모든 파일 크기·sha256, 필수 파일 목록, 부산 extract가 정확히 1개인지, 목록에 없는 파일이 없는지를 본다
(Hugging Face 내려받기 메타데이터 `.cache/`만 무시). 하나라도 어긋나면 종료 코드 1.

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

Docker 빌드 때 데이터 묶음을 이름 붙은 build context로 넘긴다. 빌드는 묶음을 검사하고, store/snapshot을 만들고,
**실행 계정(uid 10001)으로 코드·데이터를 읽기 전용으로 둔 채** 엔진을 한 번 시작해(로드 + 예열) Numba cache를 이미지에 넣는다.
아래 명령은 **저장소 root**에서 실행한다(5절 명령은 `ai/route_service`에서).

```bash
docker build -t runway-route --build-context route_data=/path/to/route_data_bundle_v2 ai/route_service
docker run --cpus 1 --memory 1.5g --read-only --tmpfs /tmp -p 8000:8000 runway-route
```

- 목표 자원: 1 vCPU / 1.5 GiB, worker 1개, graph 캐시 2칸(`RUNWAY_GRAPH_CACHE_SIZE=2`). HR 컨테이너와 따로 띄운다.
- 근거(Linux, 15 km 위주 14개 요청 열의 최대 VmHWM, `reports/route_linux_validation_2026-11-04/REPORT.md` 9.4절):
  캐시 4칸 **1.83 GiB**(1.5 GiB 초과), 2칸 **1.37 GiB**. 두 설정의 추천 결과는 같다(`from_cache` 표시만 다를 수 있음).
- **Numba cache와 쓰기 권한(S15P31E105-441):** Numba 0.68은 cache 폴더에 임시 파일을 써 볼 수 있을 때만 그 폴더를 쓴다.
  쓸 수 있는 후보(`NUMBA_CACHE_DIR`, 소스 옆 `__pycache__`, 사용자 cache 폴더)가 하나도 없으면 import 단계에서
  `cannot cache function ...: no locator available`로 앱이 시작하지 못한다(경고로 끝나지 않는다). 그래서 이미지는
  - 빌드 때 만든 cache를 읽기 전용 원본 `/opt/route/numba_cache`에 두고,
  - 시작 명령이 그것을 `NUMBA_CACHE_DIR=/tmp/numba_cache`로 복사해(수 MB) 쓰기 가능하게 만든 뒤 uvicorn을 띄운다.
  - 따라서 `/tmp`는 쓰기 가능해야 한다(`--tmpfs /tmp`; Gate 검토 로그도 `/tmp`). 쿠버네티스 등에서는 `/tmp`에 emptyDir를 둔다.
  - 시작 명령은 `NUMBA_CACHE_DIR`를 `/tmp/numba_cache`로 **고정**한다. 배포 설정이 `NUMBA_CACHE_DIR=/opt/route/numba_cache`(읽기 전용
    원본)를 넘겨도 무시된다(그 값을 그대로 쓰면 원본을 자기 자신에게 복사하다 시작이 실패한다). `infra/route/compose.yaml`의 이 값은
    지워도 된다. CMD를 덮어쓰는 배포는 같은 복사 단계를 넣어야 한다.
- 이미지의 Numba cache는 빌드한 CPU 기준이다. 배포 CPU가 다르면 첫 시작 때 `/tmp`에 다시 컴파일한다(결과 같음, 시작만
  느려짐). 다른 OS/CPU에서 만든 JIT cache를 따로 복사해 넣지 않는다.

## 7. 설정과 rollback

모두 프로세스 시작 시 1회 읽는다(바꾸면 재시작). 서비스 설정(`ROUTE_DEBUG`, `ROUTE_WARMUP`, `ROUTE_LOCK_WAIT_S`, Gate 로그 폴더)은 [API.md](API.md) 7절.
`ROUTE_LOCK_WAIT_S`는 실행 슬롯 대기 상한(초)이며 기본값은 `8.0`이다. 유한한 양수만 허용하며 요청 마감이 더 가까우면 그때까지만 기다린다.
추천 응답 cache(S15P31E105-630, `app/response_cache.py`)는 끝난 계산의 200 응답을 기본 32개·10분 저장해 같은 요청에 슬롯 대기 없이 같은
byte를 돌려준다. `ROUTE_RESPONSE_CACHE=0`(끄기), `ROUTE_RESPONSE_CACHE_SIZE`(칸 수, 0이면 끔), `ROUTE_RESPONSE_CACHE_TTL_S`(초)로 바꾼다(API.md 5·7절).

**값 검사(S15P31E105-441):** 아래 on/off 스위치(`*_SUBSTRATE`, `ARRAY_*`, `FAST_GRAPH`, `ENV_PREPARED`,
`ADAPTER_LEAN_ROUTING`)는 없으면 기본(켜짐), `"1"`이면 켬, `"0"`이면 끔이고 **그 밖의 값(`false`, `off`, 공백 포함 등)은
`ValueError`**다(`runway_routing/env_flags.py`). 예전에는 대부분 정확히 `"0"`일 때만 꺼져서 `false`라고 쓰면 조용히 켜진
채였다. `RUNWAY_SP_ENGINE`/`RUNWAY_SP_KERNEL`은 정해진 값만, `RUNWAY_NETWORK_STORE`/`RUNWAY_SOURCE_SNAPSHOT`은 `"0"`이면 끔이고
그 밖에는 폴더 경로, cache 크기는 1 이상의 정수, `ROUTE_DEBUG`/`ROUTE_WARMUP`은 `1/0/true/false/yes/no/on/off`를 받는다.

| 환경변수 | 읽는 때 | 잘못된 값이면 |
|---|---|---|
| `RUNWAY_SP_ENGINE`, `RUNWAY_SP_KERNEL`, `RUNWAY_SP_ASTAR`, `RUNWAY_GRAPH_CACHE_SIZE`, `RUNWAY_ENV_PREPARED`, `RUNWAY_ADAPTER_LEAN_ROUTING`, `RUNWAY_FAST_ROUTING`, `RUNWAY_GATE_FAST_CONTEXT`, `RUNWAY_ARRAY_PAIR_KERNELS`, `RUNWAY_ADAPTER_REUSE`, `RUNWAY_FAST_EDGE_ARRAYS`, `RUNWAY_P2P_MASK_FAST` | `app.main` import 때(엔진 모듈 import) | **app import 실패**: 프로세스가 뜨지 않음(live도 없음) |
| `ROUTE_DEBUG`, `ROUTE_WARMUP`, `ROUTE_LOCK_WAIT_S`, `ROUTE_RESPONSE_CACHE`, `ROUTE_RESPONSE_CACHE_SIZE`, `ROUTE_RESPONSE_CACHE_TTL_S`, `RUNWAY_FAST_GRAPH` | `app.main` import 때(`load_settings`) | **app import 실패** |
| `RUNWAY_MASK_CACHE_SIZE`, `RUNWAY_USABILITY_GATE`, `RUNWAY_P2P_SUBSTRATE`, `RUNWAY_ARRAY_SHAPES`, `RUNWAY_ARRAY_LOOP`, `RUNWAY_ARRAY_PAIR_FAST`, `RUNWAY_NETWORK_STORE`, `RUNWAY_SOURCE_SNAPSHOT`, `RUNWAY_DATA_DIR` | 엔진 로드 때(`Engine.start`) | phase `failed`, 추천 503 `UNAVAILABLE` |

API.md 1절의 준비 상태 표(loading → warming → ready | failed)는 **app import가 성공한 뒤**의 상태다. Numba 예열(import 때
컴파일)과 Numba cache 폴더 문제도 import 단계에서 실패한다.

| 환경변수 | 끄는 것 | 추천 결과 |
|---|---|---|
| `ROUTE_RESPONSE_CACHE=0` | 추천 응답 cache(S15P31E105-630) | 같음(같은 요청도 매번 계산) |
| `ROUTE_REROLL_EXCLUDE=0` | 재추천에서 이전 2개 응답 코스 빼기(S15P31E105-383, `app/reroll.py`) | 첫 요청(seed 1~24) 같음, 재추천은 예전(seed만 바꿈) 결과 |
| `RUNWAY_P2P_SUBSTRATE=0` | P2P 배열 substrate → networkx | 같음(느려짐) |
| `RUNWAY_SP_KERNEL=nx` | D-exact → networkx 최단 경로 | 같음(느려짐) |
| `RUNWAY_SP_ENGINE=python` | Numba D-exact → Python D-exact | 같음(느려짐), Numba import·컴파일 없음 |
| `RUNWAY_SP_ASTAR=0` | 구간 탐색 Numba A* → Numba bidirectional(S15P31E105-621. A*도 동점 근처면 bidirectional로 다시 찾음) | 같음(생성 느려짐) |
| `RUNWAY_FAST_ROUTING=0` | 요청 graph routing edge 준비의 배열 정렬·`pair_to_eid` 배열 조회 → pandas 정렬·dict(S15P31E105-626) | 같음(첫 요청 느려짐) |
| `RUNWAY_GATE_FAST_CONTEXT=0` | Gate context의 incident 배열 색인 → `usability_gate.build_context` Python 반복(S15P31E105-626) | 같음(첫 요청 느려짐) |
| `RUNWAY_ARRAY_PAIR_KERNELS=0` | 생성 disk(`build_array_pair`)의 처음 나온 순번·pair별 최단 간선 Numba 훑기, G node 번호 dict 만들기 → np.unique·lexsort·dict comprehension(S15P31E105-645) | 같음(첫 요청 느려짐) |
| `RUNWAY_ADAPTER_REUSE=0` | 요청 graph(`populate_adapter`)가 G의 node 번호 dict를 같이 쓰고 첫 간선을 창 segment 단위로 고르기 → dict 복사·G 간선 전체 lexsort·searchsorted(S15P31E105-645) | 같음(첫 요청 느려짐) |
| `RUNWAY_P2P_MASK_FAST=0` | 편도 도착점 찾기(`substrate.DiskMask`)의 prepared 원 판정·pair별 최단 선분 Numba 훑기·bool 표시 정렬 집합·PE5 선 순서용 G node 순번(필요한 node만)·PE1 안 node만 정렬 → 예전 식(S15P31E105-653) | 같음(편도 첫 요청 느려짐) |
| `RUNWAY_FAST_EDGE_ARRAYS=0` | `prepare_edge_arrays`의 문자열 열 판정을 서로 다른 값 단위로 → edge마다 `np.isin`(S15P31E105-645) | 같음(첫 요청 느려짐) |
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

**파생 파일이 깨졌을 때(S15P31E105-441):** store·snapshot의 manifest가 깨졌거나(JSON 아님, 객체 아님, `key`/`files` 없음)
파일을 읽지 못하거나 npz가 깨졌으면 이유(`reason`)를 남기고 다음 단계(snapshot → PBF)로 내려간다. env edge cache도
provenance가 깨졌거나, 기록된 배열 크기·sha256과 실제 파일이 다르거나, 배열 모양이 맞지 않거나, **실제 PBF의 sha256**
(EXTRACT.json에 적힌 값만이 아니라 파일 자체, 시작 때 한 번 계산)이 cache를 만든 extract와 다르면 쓰지 않고 거리를 직접
계산한다(`RoutePipeline.status()["env_cache"]`에 `valid: false`와 이유). 정상 bundle v2에서는 셋 다 그대로 쓰인다.
**원본 PBF가 없거나 여러 개면** 폴백하지 않고 엔진 시작이 실패한다(phase `failed`, 추천 503 `UNAVAILABLE`).
store·snapshot의 key에는 자기 코드 파일의 sha256이 들어가므로, 이 코드가 바뀐 배포에서는 store·snapshot을 다시 만든다
(이미지는 빌드 때마다 만든다. 로컬은 5절 3번).

**Numba:** 명시적 signature로 import 시 컴파일·warm-up하므로 첫 추천 요청 중에 컴파일하지 않는다. Numba가 없거나
컴파일에 실패하면 시작 단계에서 실패한다. 임시 복구는 `RUNWAY_SP_ENGINE=python`이다. `NUMBA_CACHE_DIR`는 짧고 **쓰기 가능한**
경로로 지정한다(예: Windows `C:/Temp/runway-numba`, 이미지 `/tmp/numba_cache` + 읽기 전용 원본 `/opt/route/numba_cache`, 6절).

**데이터 재생성:** extract → env layer·DEM → env edge cache 순서다. [tools/data/README.md](tools/data/README.md)에 명령과 v2
env layer·DEM을 만든 스크립트 위치가 있다(v1 전용 수집기 `fetch_env_layer.py`·`fetch_dem.py`는 441에서 삭제).

## 8. 테스트와 Golden 회귀

```bash
pip install pytest==9.2.0 httpx==0.28.1
python -B -m pytest -q tests/test_api.py tests/test_review_fixes.py tools/route_regression/test_identity_checks.py   # 데이터 없이
python -B -m pytest -q tests tools/route_regression                     # 전부, RUNWAY_DATA_DIR 필요
```

Golden 회귀(결과가 한 글자도 안 바뀌었는지, 약 8분): [tools/route_regression/README.md](tools/route_regression/README.md).
**bundle v2 데이터에서는 `--baseline <...>/baseline_v2`를 반드시 준다**(기본값 `baseline`은 v1 데이터용). 합격 기준:
- v2(`baseline_v2`): 모든 mode `"fails": 0`, `--strict`에서도 0(허용 차이 없음).
- v1(`baseline`, 옛 데이터): 모든 mode `"fails": 0`, shadow 모드에만 허용 차이 GS-26 1건(cache 플래그, 기능 차이 아님).
- 엔진 동일성: 저장된 baseline은 예전 데모 앱으로 찍었으므로 `--app demo --demo-dir <!180 커밋의 route_demo 사본>`으로 돌린다.
- 서비스 동일성: `--app service --env ROUTE_WARMUP=0 ROUTE_REROLL_EXCLUDE=0`으로 찍고 `service_identity.py`가 데모 응답에서
  고도·debug만 뺀 것과 같은지 본다(시나리오 누락·산출물 누락·out key 순서 차이도 실패). baseline은 재추천 제외(S15P31E105-383)가 없는
  데모 앱으로 찍었으므로 `ROUTE_REROLL_EXCLUDE=0`이 필요하다. 켠 상태(기본)에서는 seed 25 이상 시나리오가 의도적으로 달라진다
  (2026-11-05 확인: 켠 상태의 두 capture끼리는 같음).

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
# 전국 도로 자료 모드 (S15P31E105-586, 기본 OFF)

`ROUTE_DATA_MODE=busan`이 기본이다. 부산 모드는 기존 파일 로더, 광안리 예열, 요청 처리와 오류 문구를 그대로 사용한다.
전국 모드는 `ROUTE_DATA_MODE=national`로 켜며, `ROUTE_NATIONAL_DIR`는 `store/`, `store_prep/`,
`env_layers_national.json`을 담은 폴더다. `ROUTE_WINDOW_CACHE_SIZE`는 준비된 창 파이프라인 LRU 크기이며 기본 1, 양의 정수다.
알 수 없는 모드, 잘못된 캐시 크기, 전국 모드의 누락·없는 경로는 시작 설정 오류다.
자료 로드·예열 실패는 기존처럼 ready 503, 추천 503 `UNAVAILABLE`이다.

전국 모드는 시작할 때 store/prep mmap과 엔진을 열고 서울 SSAFY 인근 고정점
`37.5013,127.0396`의 LOOP 5 km 창 엔진을 준비한다. 부산 고정점의 생성자 self-test는 이 창에 실행하지 않는다.
기본 `ROUTE_WARMUP=1`이면 이 점에서 실제 추천 1회까지 성공해야 ready다.
`ROUTE_WARMUP=0`이면 추천 예열만 생략하고 store·엔진·창 준비 후 ready가 된다.
Numba import/컴파일은 엔진 준비 과정에서 수행된다. 첫 다른 지역 요청에는 새 창 준비 비용이 있다.

요청은 기존 엔진 잠금 안에서 시작·모양·목표·P2P 원시 도착 좌표로 창을 정하고 LRU에서 재사용한다.
LOOP/OAB는 출발점 중심, P2P는 입력 중점 중심이다. 1 km 여유와 최대 반쪽 길이 20 km를 적용하고,
작은 창이 출발점의 5 km anchor ±20 km 창 안에 들어갈 때만 사용한다.
1 km 셀과 접하는 way는 node·segment까지 통째로 유지한다.
작은 창 결과에 `OUTSIDE_CANONICAL_EXTRACT`가 하나라도 있으면 같은 요청을 anchor 창으로 한 번만 다시 실행한다.
다른 오류와 처음부터 anchor 창을 쓴 요청은 재실행하지 않는다. seed와 선호는 창 key에 넣지 않아 재추천도 같은 창을 고른다.
기존 재추천 lookback/결과 cache를 유지한다. LRU 칸 수는 결과에 영향을 주지 않으며, 퇴출은 새 창 생성 전에 한다.

엔진 주입은 선택 인자 `RoutePipeline(..., region=WindowRegion(...))`에서 시작한다.
RouteGenerator는 source·extract polygon, RunwayData는 env·DEM·환경 거리 cache를 받는다.
Sidecar/Substrate/ArraySource는 선택적인 prepared 인자로 정적 표만 복원하고,
Gate는 검증된 원본 PBF SHA256을 받아 전국 PBF를 창마다 해싱하지 않는다.
인자를 생략하면 기존 초기화와 같은 호출을 수행한다. 점수·Gate 규칙·TOP_K·ATTEMPTS·MAX_KM(15)은 바꾸지 않았다.
현재 ArraySource의 status_code/status_objs도 원래 생성 방식으로 계산한다.

전국 `OUT_OF_AREA` 문구는 “출발 위치나 도착 위치가 전국 도로 자료의 추천 범위 밖이에요. 자료 범위 안의 위치를 골라 주세요.”다.
P2P의 시작·도착 범위는 거리 상한보다 먼저 검사한다. 부산 문구와 오류 상태·응답 구조는 그대로다.
전국 범위는 원본 extract bbox다. 그 안에서도 바다나 도로 없는 지역은 코스를 만들지 못할 수 있다.

배포: `ROUTE_NATIONAL_DIR` 폴더를 컨테이너에 **읽기 전용**으로 마운트한다. 예를 들어
호스트 `C:\data\national-bundle`을 `/data/national:ro`로 마운트하고
`ROUTE_DATA_MODE=national`, `ROUTE_NATIONAL_DIR=/data/national`, `ROUTE_WINDOW_CACHE_SIZE=1`을 주입한다.
기존 부산 `RUNWAY_DATA_DIR` 설정은 부산 모드용이다. 이 업무에서는 compose·Dockerfile·infra를 수정하지 않았다.
자료 생성 순서·디스크·메모리·전체 해시 검증은 [전국 빌더 안내](tools/data/national/README.md)를 따른다.

검토자는 서비스 폴더에서 아래를 실행한다. 실제 자료 없는 전체 테스트도 먼저 수행한다.

```powershell
python -B -m pytest tests -q
python -B tools/data/national/build_prep.py --national-dir C:\Users\SSAFY\Desktop\RunWay_data\route_kr_store_v1 --verify
$env:ROUTE_DATA_MODE = 'national'
$env:ROUTE_NATIONAL_DIR = 'C:\Users\SSAFY\Desktop\RunWay_data\route_kr_store_v1'
$env:ROUTE_WINDOW_CACHE_SIZE = '1'
$env:ROUTE_WARMUP = '1'
python -B -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

다른 PowerShell에서 다음을 확인한다. ready가 true가 된 뒤 서울 LOOP 5/15 km, OAB 10 km, P2P,
seed 1/25/49, 같은 입력 반복과 다른 지역을 끼운 뒤 재실행을 검사한다. 창+준비 시간과 peak RSS는 현재 코드로 별도 측정한다.

```powershell
Invoke-RestMethod http://127.0.0.1:8000/internal/v1/ready
$body = @{lat=37.5013; lon=127.0396; distance_km=5; seed=1} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/internal/v1/routes/recommendations -Method Post -ContentType application/json -Body $body
```

부산 동일성 검사는 전국 환경변수를 해제한 새 프로세스에서 기존 부산 데이터와 수행한다.
아래 명령은 service 캡처와 `service_identity.py` 비교를 함께 실행한다. 사용하는 자료가 v2이면
`--baseline tools/route_regression/baseline_v2 --strict`도 추가한다. tag 출력 폴더는 기존에 없어야 한다.

```powershell
$env:ROUTE_DATA_MODE = 'busan'
Remove-Item Env:ROUTE_NATIONAL_DIR -ErrorAction SilentlyContinue
python -B tools/route_regression/run_regression.py --tag national586-busan-review --app service
```

이 샌드박스에서는 Python 명령을 찾지 못했으므로 테스트·실자료 응답·성능 통과를 확인하지 않았다.
