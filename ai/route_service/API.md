# Route 서비스 API (백엔드 연동용)

러닝 코스 TOP3를 만드는 내부 API다. Spring 백엔드만 내부 네트워크로 호출한다(앱이 직접 부르지 않는다). Jira S15P31E105-381.
BE 쪽 계약 정본: `docs/design/api/ai-service.md` "Route 코스 생성 내부 HTTP 계약 초안"(S15P31E105-370, MR !183). 이 문서는 그
계약에 맞춘 구현 설명이다.

- 기본 주소: 컨테이너 `8000` 포트 (예: `http://route:8000`). HR 추론 `ai/service`와 다른 origin.
- 형식: JSON, UTF-8. 이 서비스는 snake_case를 쓴다.
- 같은 입력 + 같은 `seed` = 언제나 같은 추천 결과(코스·순서·문구). 처리 시간 같은 측정값과 내부 cache 표시는 매번 다를 수 있다.
- 회원 JWT·userId·HR·페이스·건강정보는 받지 않는다. DB에 접근하지 않고 코스를 저장하지 않는다.

## 1. 엔드포인트

| 메서드 | 경로 | 용도 |
|---|---|---|
| POST | `/internal/v1/routes/recommendations` | 코스 생성 |
| GET | `/internal/v1/ready` | 생성 요청을 받을 수 있으면 200, 아니면 503 |
| GET | `/health/live` | 프로세스가 살아 있으면 200 `{"status": "UP"}` (재시작 판단용) |

### 준비 상태 (`GET /internal/v1/ready`)

엔진은 시작할 때 도로망·환경 데이터·DEM·Gate 설정을 읽고(로드), 예열 요청을 한 번 처리한 뒤에야 준비된다. 보통 수십 초 걸린다.

| `phase` | HTTP | 본문 `ready` | 생성 요청 결과 |
|---|---|---|---|
| `loading` | 503 | false | 503 `NOT_READY` |
| `warming` | 503 | false | 503 `NOT_READY` |
| `ready` | 200 | true | 정상 처리 |
| `failed` | 503 | false | 503 `UNAVAILABLE` (재시작 필요) |

응답 예: `{"ready": true, "phase": "ready", "load_s": 7.1, "warmup_s": 2.3}`. 컨테이너 healthcheck는 이 경로를 본다.
ready를 확인한 뒤에도 생성 요청이 `NOT_READY`/`BUSY`를 받을 수 있으므로 생성 응답의 오류도 처리한다.

- 이 표는 **프로세스(app import)가 뜬 뒤**의 상태다. 잘못된 환경변수 값 일부와 Numba 컴파일·cache 폴더 문제는 import
  단계에서 실패해 live조차 응답하지 않는다(README 7절 표).
- `failed`가 되는 경우: 엔진 로드 예외, 부산 PBF가 없거나 여러 개(S15P31E105-441 이전에는 `loading`에 머물렀다), 예열 요청이
  200(코스 1개 이상)으로 끝나지 않음.
- **예열 성공 기준(441):** 예열 요청(광안리 중심 순환 5 km, 조건 없음, seed 1)은 정상 데이터·엔진이면 늘 코스가 나오는 고정
  요청이다. 그래서 **200이어야 ready**다. 4xx(예: 잘못된 데이터 묶음 → `OUT_OF_AREA`, Gate·생성 고장 → `NO_ROUTE`,
  `USABILITY_GATE_ALL_FAILED`)도 데이터·엔진 문제로 보고 `failed`로 둔다(전에는 4xx면 ready). 예열은 모든 지역·모양을
  검증하지는 않는다. `ROUTE_WARMUP=0`이면 예열 없이 로드만으로 ready.
- `/health/live`, `/internal/v1/ready`는 계산 thread pool을 쓰지 않는다(async). 추천 요청이 몰려도 바로 답한다.

## 2. 요청 `POST /internal/v1/routes/recommendations`

| 필드 | 타입 | 필수 | 기본값 | 규칙 |
|---|---|---|---|---|
| `lat` | number | O | | 유한수, -90~90. 출발 위도 (WGS84) |
| `lon` | number | O | | 유한수, -180~180 |
| `distance_km` | number | O | | 유한수. 1.0~15.0 km 밖이면 422 `DISTANCE_RANGE`. 결과는 목표의 ±10 % |
| `shape` | string | (BE는 항상 보냄) | `"loop"` | `"loop"` 순환 / `"out_and_back"` 반환점 왕복 / `"point_to_point"` 편도 |
| `end_lat`, `end_lon` | number | 편도만 | null | 편도에서 둘 다 필요(없으면 422 `DESTINATION_REQUIRED`). 범위는 위와 같음 |
| `filters` | object | (BE는 9개 모두 보냄) | 모두 false | 아래 9개 boolean. **모르는 key는 400** |
| `seed` | integer | (BE는 항상 보냄) | 1 | 1~10,000,000 |

`filters` (켜면 강도 5로 반영, 끄면 "고려 안 함"; 반대로 피한다는 뜻이 아니다):
`river` 강변, `beach` 해변·바다, `park` 공원·녹지, `trail` 산책로·트레일, `pedestrian` 보행로,
`avoid_major_road` 큰길 피하기, `avoid_steps` 계단 피하기, `avoid_tunnel` 터널 피하기, `flat` 평지 위주.

최상위의 모르는 필드는 무시한다.

### 요청 헤더 (선택)

| 헤더 | 값 | 뜻 |
|---|---|---|
| `X-Request-Deadline` | epoch milliseconds 정수 | 이 시각까지 결과가 필요 없으면 계산하지 않는다. 계산 **시작 직전**(실행 슬롯을 잡기 전과 잡은 뒤)에 이미 지났으면 503 `TIMEOUT`. 숫자가 아니면 400 `VALIDATION_ERROR`. **시작한 계산은 끊지 않는다.** |

```json
{"lat": 35.1532, "lon": 129.1186, "distance_km": 5.0, "shape": "loop", "seed": 1,
 "filters": {"river": false, "beach": true, "park": false, "trail": false, "pedestrian": false,
             "avoid_major_road": true, "avoid_steps": false, "avoid_tunnel": false, "flat": false}}
```

재추천: 첫 요청은 `seed: 1`. "다시 추천"은 다른 입력을 그대로 두고 `seed`만 직전 응답의 `next_seed`(= seed + 24)로
바꾼다. 출발 위치·거리·모양·조건 중 하나라도 바뀌면 `seed`를 1로 되돌린다. `next_seed`는 언제나 1~10,000,000 안이다:
seed + 24가 10,000,000을 넘으면 1부터 다시 센다(예: seed 10,000,000 → `next_seed` 24). 그대로 다음 요청에 넣어도 400이 되지
않는다(S15P31E105-441).

재추천에서 이미 보여 준 코스 빼기(S15P31E105-383, 요청·응답 형식은 그대로):
- `seed`가 25 이상이면 Route가 같은 조건의 직전 응답 최대 2개(`seed - 24`, `seed - 48`, 1 이상만)의 코스 3개씩을 찾아,
  그 코스와 사실상 같은 후보(겹침 60 % 이상)를 빼고 이번 묶음의 나머지 후보로 채운다. 덜 채워지면 기존
  "서로 다른 코스를 N개만 찾았어요" 안내가 붙는다. 다 빠지면 빈 응답 대신 빼지 않은 결과를 준다.
- `seed` 1~24(첫 요청)는 예전과 똑같다. 같은 입력 + 같은 `seed`는 여전히 언제나 같은 결과다.
- 이전 응답은 Route 프로세스 안의 짧은 cache(10분, 256칸, 칸당 수 KB)에서 찾고, 없으면(재시작·10분 경과) 같은 규칙으로
  다시 계산한다. 그래서 결과는 같고 그 요청만 느려진다(이전 묶음 1~2번 더 계산).
- 리롤 상한(첫 추천 + 재추천 2회)은 앱/BE가 지킨다. 3회째 이상(`seed` 73 이상)도 오류 없이 직전 2개만 빼고 답한다.

## 3. 성공 응답 (HTTP 200)

```json
{"routes": [{"rank": 1, "coords": [[35.1532, 129.1186], ...], "distance_m": 5012.3,
             "summary": "해변을 지나는 코스예요.", "reasons": ["..."], "caveats": [],
             "score": 1.2345, "score_terms": [{"term": "distance_fit", "label": "목표 거리 적합도", "group": "base",
                                                "feature_value": 0.998, "weight": 1.0, "contribution": 0.998}, ...]}],
 "notices": ["..."],
 "next_seed": 25}
```

| 필드 | 설명 |
|---|---|
| `routes` | 코스 1~3개, `rank` 오름차순. Gate(enforce)를 통과한 후보만. 0개면 422: 후보가 있었지만 Gate에서 모두 탈락하면 `USABILITY_GATE_ALL_FAILED`, 그 밖에는 `NO_ROUTE` |
| `routes[].rank` | 1부터 연속 |
| `routes[].coords` | `[[lat, lon], ...]` WGS84 경로 좌표(2점 이상, 진행 방향 순서) |
| `routes[].distance_m` | 코스 거리(m), 목표의 ±10 % 안 |
| `routes[].summary`, `reasons`, `caveats` | 한 줄 요약, 추천 이유, 주의 문구(한국어 일반 텍스트, 그대로 보여 줘도 됨) |
| `routes[].score` | 규칙 기반 총점 = `score_terms[].contribution`의 합(소수 넷째 자리 반올림 차이 가능) |
| `routes[].score_terms[]` | 항목별 점수. key는 정확히 `term`, `label`, `group`, `feature_value`, `weight`, `contribution` (테스트로 고정). `term`은 열린 문자열 집합 |
| `notices` | 응답 전체 안내 문장(스냅 거리, 후보 부족, 선호 정보 부족 등) |
| `next_seed` | 요청 seed + 24 (10,000,000을 넘으면 1부터 다시 셈, 2절) |

점수는 같은 요청 안의 후보 설명용이다. 요청 사이 비교·저장·재정렬에 쓰지 않는다. 순위는 `rank`를 따른다.

**고도·경사 값은 보내지 않는다.** 코스 경사는 백엔드가 계산한다(ADR-0019 개정, S15P31E105-369). 엔진은 고도 자료를
**점수에는** "평지 위주(`flat`)" 선호를 반영할 때만 쓴다. 설명 문장에는 `flat`이 꺼져 있어도 쓰일 수 있다(예: 평지에 가까운
코스면 "평지 위주예요" 같은 문장). `flat`을 켜면 `reasons`/`caveats`에 "평지 위주예요", "오르막이 있어요
(누적 상승 N m)" 같은 문장이 나온다.

`flat`을 켜면 `score_terms`에 `difficulty_flat` 항목이 있고, 그 `feature_value`는 코스의 평균 경사(%)다. 이 값은
**추천 점수를 설명하는 용도로만** 쓴다. 저장·화면 표시·HR 입력에 쓰는 코스 경사(100 m 단위 elevationProfile)는
백엔드가 직접 계산한 값이 기준이다. 두 계산은 같은 DEM 파일을 써야 한다:
`reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif`
(sha256 `45faaa5e36c710a235658e1172183279007ac3b3fdcc29a14246222fdabb3a1f`, 8,266,122 bytes, `route_data_bundle_v2/DATA_MANIFEST.md`).
이 파일은 부산 전체(경도 128.73~129.35, 위도 34.85~35.42)를 덮는 Copernicus GLO-30 4타일 mosaic이다(S15P31E105-435).
이름은 v1과 같으므로 파일은 이름이 아니라 sha256으로 확인한다. v1 clip(sha256 `2d5bb838…7d49`)은 경도 129.00 동쪽만 덮었다.
받는 곳: 비공개 Hugging Face `AnSeongYun/runway-hr-models`, revision `4952478476ce2d76579e1b6ba16363214e6a6914`,
경로 `route_data_v2/reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif`.

### 개발용 debug 응답 (`ROUTE_DEBUG=1`)

서버를 `ROUTE_DEBUG=1`로 띄우면 성공 응답이 예전 데모의 전체 필드가 된다: `ok`, `seed`, `target_m`, `filters`, `mode`,
`start`, `end`(편도), `return_trip`(편도), `shape`, `generation`, 경로별 `edges`, `features`, `details`, `candidate_id`,
`shape_notes`, `turnaround`(왕복), 그리고 `debug`. 고도·경사 값(`elevation_profile_m`, `features`의 고도 key,
`details`의 누적 상승·평균 경사)은 debug에서도 없다. 오류 응답에도 `debug`가 붙는다. **운영에서는 끈다.**

## 4. 오류 응답

모양: non-2xx + `{"code": "...", "message": "...", "details": null | {...}}`. `ok` 필드는 없다. `message`는 한국어
문장이다. 백엔드는 `code`로 분기한다.

| HTTP | `code` | 언제 | `details` |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | 필수값 누락, 타입·유한수·좌표 범위 오류, `shape` 값, `seed` 범위, `filters`의 모르는 key, 잘못된 `X-Request-Deadline` | `{"fields": [{name, reason}]}` |
| 422 | `DISTANCE_RANGE` | `distance_km`가 1~15 밖 | null |
| 422 | `DESTINATION_REQUIRED` | 편도인데 도착 위치 없음 | null |
| 422 | `OUT_OF_APP_RANGE` | 편도 출발–도착 직선 17 km 초과 등 (계산 없이 거절) | null |
| 422 | `OUT_OF_AREA` | 코스를 만드는 데 필요한 작업 영역(출발점 중심 원, 편도는 중점 원도)을 부산 extract가 다 덮지 못함. 출발점이 extract 안이어도 경계 가까이면 나올 수 있다 | null |
| 422 | `NO_ROAD_NEARBY` | 실제 출발 지점(주변과 이어진 달릴 수 있는 길)이 250 m 넘게 떨어짐 / 주변에 길이 없음 / 길은 있지만 달릴 수 있는 길·교차로가 없음 (아래 주 1, 2) | null |
| 422 | `DESTINATION_TOO_FAR` | 편도 목표 거리가 너무 짧음 | `{"min_target_km", "alternatives_from_km"}` |
| 422 | `END_SNAP_PE1`, `END_SNAP_PE2`, `END_SNAP_PE4`, `END_SNAP_PE5` | 도착 위치 근처에 안전하게 달릴 길이 없음 | null |
| 422 | `USABILITY_GATE_ALL_FAILED` | 안전 기준을 통과한 코스 없음 | null |
| 422 | `NO_ROUTE` | 조건에 맞는 코스를 못 만듦 | null |
| 503 | `NOT_READY` | 엔진 준비 중 | null |
| 503 | `BUSY` | 다른 요청 처리 중이라 1초 안에 실행 슬롯을 못 잡음 | null |
| 503 | `TIMEOUT` | `X-Request-Deadline`이 계산 시작 전에 지남 | null |
| 503 | `UNAVAILABLE` | 엔진 시작(로드·예열) 실패 | null |
| 500 | `INTERNAL` | 처리 중 예외: 계산·응답 조립·JSON 변환(비정상 숫자) 어디서든 (서버 로그 `runway.ai`에 `ai_error code=INTERNAL ...`) | null |
| 500 | `SAFETY_CHECK` | 안전 확인 실패(안전망, 발생한 적 없음) | null |
| 500 | `SNAP_NODE_NOT_IN_GENERATION_GRAPH` | 편도 내부 처리 문제 | null |

주 1 (250 m 기준, 441에서 바뀜): 250 m는 요청 위치에서 **실제 출발 node**까지의 거리다. 가장 가까운 길이 주변과 이어지지
않는 고립 구간이면 출발점은 이어진 주 연결망의 node로 옮겨지는데, 이제 그 옮긴 node까지의 거리로 판단한다(전에는 옮기기
전 고립 길까지의 거리여서, 고립 길 20 m·실제 출발 500 m도 통과했다). Gate의 출발 거리 규칙(ug-v1 `max_start_snap_m` 250 m)에도
같은 값을 넘긴다. 250 m 안에서 옮겨진 경우에는 지금처럼 `notices`에 "…m 떨어진 연결된 길에서 출발해요"가 나온다.

주 2 (길이 없는 영역): osmnx가 작업 영역 안에서 길을 하나도 찾지 못하거나, 길은 있지만 달릴 수 있는(RUNNABLE) 길이나 waypoint
후보 교차로가 하나도 없으면 422 `NO_ROAD_NEARBY`다(441부터; 전에는 뒤의 경우가 500 `INTERNAL`). 서버 로그에는
`ai_error code=NO_USABLE_ROAD`(WARNING)로 남는다.

Gate 검토 로그(서버 JSONL, 응답에는 없음): 요청마다 한 줄. `gate_version`(설정·classify·PBF 해시) 다음에
`gate_files_sha256`(ug-v1.json, ug-v2.json, usability_gate.py 파일 해시)가 있다(S15P31E105-441에서 추가, 데모 로그에는 없던 key).

## 5. 동시성·시간·재시도

- 엔진은 thread-safe가 아니라 한 번에 한 요청만 계산한다(worker 1개). 엔진 안에서 실행 슬롯을 **최대 1초** 기다리고 못
  잡으면 503 `BUSY`. 엔진 안에 대기열을 두지 않는다.
- 이 1초는 **엔진 lock 대기만**이다. 추천 endpoint는 서버 thread pool(Starlette 기본 40칸)에서 돈다. 요청이 아주 많이 몰리면
  endpoint에 들어가기 전에 thread pool에서 기다릴 수 있고, 그 시간은 1초에 들어가지 않는다. 서비스는 입구에서 동시 요청 수를
  제한하지 않는다(BE가 호출 시간 상한을 둔다). 상태 확인 경로(live/ready)는 thread pool을 쓰지 않아 이 대기와 무관하다.
- 응답 시간(측정값): 처음 요청한 지역 1~5초, 같은 지역 반복 0.3~1.2초. 1 vCPU에서는 더 길 수 있다.
- BE 계약 제안: BE→Route 전체 호출 15초, Route 처리 상한 12초(대기 1초 포함). 지금 구현은 **시작 전 deadline 확인**까지
  만 한다. 시작한 계산은 끝까지 가며 늦은 결과는 BE가 버린다. 계산 중단·자원 회수는 MVP 범위 밖이다.
- BE 자동 재시도는 0회(계약). 같은 입력은 같은 결과이므로 422 재시도는 의미가 없다.

## 6. 응답 크기 상한 (제안, 미확정)

BE 계약은 payload·문구 길이 상한을 실연동 전에 정하기로 했다. Golden 시나리오 측정값과 제안:

| 항목 | 측정 최대 | 제안 상한 |
|---|---:|---:|
| `summary` 길이 | 35자 | 100자 |
| `reasons` / `caveats` / `notices` 개수 | 4 / 3 / 2개 | 각 20개(BE 적용, 아래 참고) |
| 경로당 `coords` 점 수 | 576 | 3,000 |
| 응답 전체 크기(운영 응답) | 40,505 B (약 41 KB) | 256 KB |

측정 범위: Golden 시나리오 88개(main 43 + random P2P 30 + 나머지 모드)의 성공 응답. 15 km 코스·다른 지역에서는 더 클 수 있어
상한은 측정 최대의 몇 배로 잡았다. 서비스는 아직 상한을 강제하지 않는다.

문구 개수: 처음 제안은 각 6개였다. 서비스는 문구 개수를 자르지 않으며 코드상 최악값은 `caveats` 12개(`explain.py`, 환경 필터 5종 등), `notices` 9개(`app/main.py` `_notices`), `reasons` 4개다. 6개면 정상 후보 전체가 BE에서 503 `ROUTE_INVALID_RESPONSE`가 되므로 BE는 각 20개를 적용한다(`docs/design/api/ai-service.md` "Route 응답 크기 상한", S15P31E105-423). 문구 종류를 늘려 20개를 넘을 수 있으면 BE와 먼저 맞춘다.

## 7. 운영 설정 (환경변수)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `RUNWAY_DATA_DIR` | 코드 폴더 | 데이터 root (`data/osm/busan`, `reports/_route_canonical_work`). 이미지는 `/data` |
| `RUNWAY_GRAPH_CACHE_SIZE` | 4 (이미지 2) | 지역 graph 캐시 칸 수. 메모리와 반복 요청 속도의 교환 |
| `RUNWAY_MASK_CACHE_SIZE` | 4 | 편도 마스크 캐시 칸 수 |
| `ROUTE_DEBUG` | 0 | 1이면 debug 응답(3절) |
| `ROUTE_WARMUP` | 1 | 0이면 예열 없이 로드만 끝나면 ready |
| `RUNWAY_USABILITY_GATE` | enforce | `shadow`는 비상용(안전 기준 탈락 코스를 지우지 않고 기록만) |
| `RUNWAY_USABILITY_LOG_DIR` | `<코드 폴더>/reports/_usability_gate_log` | 안전 기준 검토 로그(JSONL, 요청 좌표 포함). 이미지는 `/tmp/...` |
| `ROUTE_REROLL_EXCLUDE` | 1 | 0이면 재추천에서 이전 코스를 빼지 않는다(seed만 바꾸는 예전 재추천, 2절) |
| `ROUTE_REROLL_CACHE_SIZE` | 256 | 재추천용 코스 결과 cache 칸 수(TTL 10분). 0이면 cache 없이 매번 다시 계산(결과 같음, 느려짐) |
| `NUMBA_CACHE_DIR` | | 이미지는 `/opt/route/numba_cache`(빌드 때 생성) |

엔진 되돌리기 스위치(`RUNWAY_SP_ENGINE`, `RUNWAY_SP_KERNEL`, `RUNWAY_ARRAY_LOOP`, `RUNWAY_ARRAY_SHAPES`, `RUNWAY_ARRAY_PAIR_FAST`,
`RUNWAY_NETWORK_STORE`, `RUNWAY_SOURCE_SNAPSHOT`, `RUNWAY_ENV_PREPARED`, `RUNWAY_ADAPTER_LEAN_ROUTING`,
`RUNWAY_P2P_SUBSTRATE`, `RUNWAY_FAST_GRAPH`)는 결과를 바꾸지 않고 느린 검증 경로로 돌아가는 비상용이다(README 7절).
