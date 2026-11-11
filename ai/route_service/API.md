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
| POST | `/internal/v1/basemaps` | 저장 코스 썸네일용 지도 바탕(바다·도로·강·물·해안·해변·공원·녹지, `detail=full`이면 보행로·건물까지). 전국 모드만. 아래 "지도 바탕" 절 |

### 준비 상태 (`GET /internal/v1/ready`)

엔진은 시작할 때 도로망·환경 데이터·DEM·Gate 설정을 읽고(로드), 예열 요청을 한 번 처리한 뒤에야 준비된다. 보통 수십 초 걸린다.

| `phase` | HTTP | 본문 `ready` | 생성 요청 결과 |
|---|---|---|---|
| `loading` | 503 | false | 503 `NOT_READY` |
| `warming` | 503 | false | 503 `NOT_READY` |
| `ready` | 200 | true | 정상 처리 |
| `failed` | 503 | false | 503 `UNAVAILABLE` (재시작 필요) |

응답 예: `{"ready": true, "phase": "ready", "load_s": 7.1, "warmup_s": 2.3, "response_cache": {"entries": 3, "hits": 1, "misses": 4, "puts": 3, "bytes": 61234}}`.
컨테이너 healthcheck는 이 경로를 본다. `response_cache`는 추천 응답 cache 통계(5절)이며 cache를 끄거나 `ROUTE_DEBUG=1`이면 `null`이다.
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
  "서로 다른 코스를 N개만 찾았어요" 안내가 붙는다. 다 빠지면 제외 없이 재계산하지 않고 HTTP 422 `NO_ROUTE`와
  "이 조건으로 더 보여 드릴 다른 코스가 없어요."를 반환한다. Gate가 모두 제거한 경우는 기존 `USABILITY_GATE_ALL_FAILED`를 유지한다.
- `seed` 1~24(첫 요청)는 예전과 똑같다. 같은 입력 + 같은 `seed`는 여전히 언제나 같은 결과다.
- 이전 응답은 Route 프로세스 안의 짧은 cache(10분, 256칸, 칸당 수 KB)에서 찾고, 없으면(재시작·10분 경과) 같은 규칙으로
  다시 계산한다. 그래서 결과는 같고 그 요청만 느려진다(이전 묶음 1~2번 더 계산).
- 리롤 상한(첫 추천 + 재추천 2회)은 앱/BE가 지킨다. 3회째 이상(`seed` 73 이상)도 직전 2개만 빼고 같은 규칙으로 답한다.

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
| 503 | `BUSY` | 다른 요청 처리 중이라 설정된 대기 시간(기본 8초, `ROUTE_LOCK_WAIT_S`) 안에 실행 슬롯을 못 잡음. 요청 마감으로 대기가 끝나면 `TIMEOUT` | null |
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

- 엔진은 thread-safe가 아니라 한 번에 한 요청만 계산한다(worker 1개). 엔진 안에서 실행 슬롯을 **기본 최대 8초** 기다린다
  (`ROUTE_LOCK_WAIT_S`, 유한한 양수). `X-Request-Deadline`이 있으면 설정값과 마감까지 남은 시간 중 짧은 쪽만 기다린다.
  슬롯을 못 잡으면 설정 대기 상한으로 끝난 경우 503 `BUSY`, 마감으로 끝났거나 이미 마감이 지난 경우 503 `TIMEOUT`이다.
  슬롯을 잡은 직후에도 마감을 확인한다. 대기 요청 수 상한은 두지 않는다. 예열은 마감 없이 무제한 대기한다.
- 이 대기 상한은 **엔진 lock 대기만**이다. 추천 endpoint는 서버 thread pool(Starlette 기본 40칸)에서 돈다. 요청이 아주 많이 몰리면
  endpoint에 들어가기 전에 thread pool에서 기다릴 수 있고, 그 시간은 lock 대기 상한에 들어가지 않는다. 서비스는 입구에서 동시 요청 수를
  제한하지 않는다(BE가 호출 시간 상한을 둔다). 상태 확인 경로(live/ready)는 thread pool을 쓰지 않아 이 대기와 무관하다.
- 응답 시간(측정값): 처음 요청한 지역 1~5초, 같은 지역 반복 0.3~1.2초. 1 vCPU에서는 더 길 수 있다.
- BE→Route 전체 호출은 15초이며, BE는 자신의 마감에서 6초를 뺀 시각(epoch ms)을 `X-Request-Deadline`으로 보낸다.
  이 값은 Route가 **계산을 시작할 수 있는 마지막 시각**이다. 시작한 계산은 끝까지 가며 늦은 결과는 BE가 버린다.
  계산 중단·자원 회수는 MVP 범위 밖이다.
- BE 자동 재시도는 0회(계약). 같은 입력은 같은 결과이므로 422 재시도는 의미가 없다.
- 추천 응답 cache(S15P31E105-630, `app/response_cache.py`): BE가 15초를 넘겨 포기해도 Route는 시작한 계산을 끝까지 한다.
  그 계산이 200으로 끝나면 응답 byte 전체를 **기본 10분·32개**(LRU) 저장하고, 같은 요청이 다시 오면 엔진을 부르지 않고 같은 byte를
  돌려준다("다시 시도", 같은 조건 재요청). 같은 입력 + 같은 데이터 = 같은 결과이므로 응답 내용은 다시 계산한 것과 같다.
  - key: 요청 본문 전체(`lat`, `lon`, `distance_km`, `filters`, `seed`, `shape`, `end_lat`, `end_lon`, 받은 값 그대로) + 서비스 설정
    (데이터 모드·전국 자료 폴더·Gate 모드·graph builder·재추천 제외·debug). `X-Request-Deadline`과 요청 시각은 넣지 않는다.
    데이터와 엔진 스위치는 시작 때 정해지고 cache는 프로세스 메모리에만 있어 재시작하면 비워진다.
  - 재추천(seed 25 이상)도 저장한다. 응답은 (조건, seed)로 정해진다(뺄 이전 코스는 같은 규칙으로 정해짐, 2절). hit 때 그 응답의
    TOP3를 재추천 cache에 다시 넣어 다음 재추천이 이전 코스를 다시 계산하지 않게 한다.
  - 저장: 계산이 끝난 200 응답만. 4xx·5xx(`BUSY`, `TIMEOUT`, `NO_ROUTE` 등)와 예열 요청, `ROUTE_DEBUG=1` 응답(측정 시간이 들어 있음)은
    저장하지 않는다. 마감이 지났거나 BE가 연결을 끊었어도 계산이 끝났으면 저장한다.
  - lock: hit는 실행 슬롯을 기다리지 않는다(마감 확인보다 먼저 본다). miss는 예전처럼 슬롯을 기다리고, 슬롯을 잡은 뒤 한 번 더
    cache를 본다(기다리는 사이 같은 요청이 끝났으면 다시 계산하지 않음).
  - 로그(`runway.ai`, INFO): `route_response_cache miss key=<sha256 앞 12자리>`, `route_response_cache hit key=... stage=before_lock|after_lock bytes=...`.
    좌표는 남기지 않는다. 통계는 ready 응답의 `response_cache`.
  - BE의 `candidateToken`은 BE가 자기 시계·사용자 ID로 서명한다(`CourseCandidateSigner`). 운영 응답(`routes`, `notices`, `next_seed`)에는
    시간에 따라 바뀌는 값이 없다. 만료 시각은 BE가 응답을 받은 때부터 센다.

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
| `ROUTE_LOCK_WAIT_S` | 8.0 | 실행 슬롯 대기 상한(초). 유한한 양수만 허용하며 잘못된 값이면 앱 시작 실패. 요청 마감이 더 가까우면 그때까지만 대기 |
| `RUNWAY_USABILITY_GATE` | enforce | `shadow`는 비상용(안전 기준 탈락 코스를 지우지 않고 기록만) |
| `RUNWAY_USABILITY_LOG_DIR` | `<코드 폴더>/reports/_usability_gate_log` | 안전 기준 검토 로그(JSONL, 요청 좌표 포함). 이미지는 `/tmp/...` |
| `ROUTE_REROLL_EXCLUDE` | 1 | 0이면 재추천에서 이전 코스를 빼지 않는다(seed만 바꾸는 예전 재추천, 2절) |
| `ROUTE_REROLL_CACHE_SIZE` | 256 | 재추천용 코스 결과 cache 칸 수(TTL 10분). 0이면 cache 없이 매번 다시 계산(결과 같음, 느려짐) |
| `ROUTE_RESPONSE_CACHE` | 1 | 0이면 추천 응답 cache를 끈다(매번 계산, 예전 동작, 5절) |
| `ROUTE_RESPONSE_CACHE_SIZE` | 32 | 추천 응답 cache 칸 수(응답 1개 보통 수십 KB, 최대 약 256 KB). 0 이상의 정수, 0이면 끔 |
| `ROUTE_RESPONSE_CACHE_TTL_S` | 600 | 추천 응답 cache 유지 시간(초, 저장 시각부터). 유한한 양수만 허용 |
| `NUMBA_CACHE_DIR` | | 이미지는 `/opt/route/numba_cache`(빌드 때 생성) |

엔진 되돌리기 스위치(`RUNWAY_SP_ENGINE`, `RUNWAY_SP_KERNEL`, `RUNWAY_SP_ASTAR`, `RUNWAY_ARRAY_LOOP`, `RUNWAY_ARRAY_SHAPES`, `RUNWAY_ARRAY_PAIR_FAST`,
`RUNWAY_NETWORK_STORE`, `RUNWAY_SOURCE_SNAPSHOT`, `RUNWAY_ENV_PREPARED`, `RUNWAY_ADAPTER_LEAN_ROUTING`, `RUNWAY_FAST_ROUTING`, `RUNWAY_GATE_FAST_CONTEXT`,
`RUNWAY_P2P_SUBSTRATE`, `RUNWAY_FAST_GRAPH`)는 결과를 바꾸지 않고 느린 검증 경로로 돌아가는 비상용이다(README 7절).
# 데이터 모드 (S15P31E105-586)

요청·성공 응답·오류 구조는 모드와 관계없이 같다. 거리 상한은 15 km다.
기본 `ROUTE_DATA_MODE=busan`은 기존 부산 경로와 문구를 유지한다.
`ROUTE_DATA_MODE=national`은 `ROUTE_NATIONAL_DIR`의 전국 자료에서 요청별 창을 선택한다.
`ROUTE_WINDOW_CACHE_SIZE`는 준비된 창 LRU 크기(기본 1, 양의 정수)다.
`ROUTE_NATIONAL_DIR`는 `store/`, `store_prep/`, env 메타데이터가 있는 읽기 전용 마운트 폴더여야 한다.
설정 오류는 시작 시 실패하며, store/prep 불일치 또는 엔진/예열 실패는 ready 503 및 추천 `UNAVAILABLE`이다.
기본 예열은 전국 모드에서 서울 SSAFY 인근 `37.5013,127.0396`, LOOP 5 km다.

`OUT_OF_AREA`는 양쪽 모드 모두 HTTP 422다. 전국 모드에서는 출발점 또는 P2P 도착점이
전국 자료 bbox 밖인 경우, 최종 anchor 창에도 작업 영역이 들어가지 않는 경우에 반환한다.
작은 창의 `OUTSIDE_CANONICAL_EXTRACT`는 anchor ±20 km 창에서 같은 입력으로 한 번 재시도한 뒤 판정한다.

| 모드 | OUT_OF_AREA message |
|---|---|
| busan (기본) | 현재 위치는 아직 추천 지역(부산) 밖이에요. 지도에서 부산 안의 출발 위치를 골라 주세요. |
| national | 출발 위치나 도착 위치가 전국 도로 자료의 추천 범위 밖이에요. 자료 범위 안의 위치를 골라 주세요. |

재추천의 next_seed, lookback, cache, 엔진 잠금과 deadline 계약은 기존과 같다.
데이터 마운트·설정·검토 명령은 [README](README.md)의 전국 도로 자료 및 배포 안내를 따른다.

# 지도 바탕 `POST /internal/v1/basemaps` (S15P31E105-612)

백엔드가 저장 코스 썸네일의 바탕 지도를 그릴 때 부르는 읽기 전용 내부 API다. Route가 이미 가진 전국 OSM 자료에서
bbox 안의 바다·도로·강·물·해안·해변·공원·녹지만 골라 GeoJSON 조각 99개 이하로 돌려준다. 구현: `app/basemap.py`.

## 요청

```json
{"bbox": [127.02, 37.49, 127.06, 37.52], "detail": "thumb"}
```

`detail`(선택): `"thumb"`(기본, 생략과 같음) | `"full"`. `thumb`는 아래 "성공 200"의 99개 썸네일 바탕이고, `full`은 서버 렌더
평면 PNG 썸네일용 상세 자료다(아래 "상세 모드" 절). 다른 값이나 문자열이 아닌 값은 400 `VALIDATION_ERROR`(`details.fields[0].name`이
`detail`).

`meters_per_pixel`(선택, 숫자): 그림 1 px가 덮는 땅의 길이(m). 0 초과 100(`MAX_METERS_PER_PIXEL`) 이하의 유한한 숫자이고, 어기거나
숫자가 아니면(문자열·bool 포함) 400 `VALIDATION_ERROR`(`name`이 `meters_per_pixel`). `null`은 생략과 같다. `full`에서만 쓰며
(아래 "축척 단계"), 생략하면 `bbox 가로(m) / 600`이다. `thumb`에서는 범위만 검사하고 응답에 영향이 없다.

`bbox` = `[west, south, east, north]` WGS84. 다음을 어기면 **400** `VALIDATION_ERROR`
(`details.fields = [{name, reason}]`, 추천 경로와 같음):
정확히 4개의 유한한 숫자(문자열·bool·NaN·Infinity 불가), 경도 -180~180·위도 -90~90, `west < east`·`south < north`,
경도 폭(`east - west`)과 위도 폭(`north - south`) 각각 1도(`MAX_SPAN_DEG`) 이하(날짜변경선을 감싸는 `[-180, …, 180, …]`처럼
haversine 가로가 작게 접히는 입력을 막는다), 가로(남·북 변 중 긴 쪽)와 세로 각각 haversine 8,000 m 이하. JSON이 아니거나 `bbox`가 없어도 같은 400이다. 모르는 최상위 필드는 무시한다.

## 성공 200

```json
{"osm_data_timestamp": "2026-10-20T20:23:47Z",
 "features": [{"kind": "sea", "geometry": {"type": "Polygon", "coordinates": [[[127.02, 37.49], ...]]}},
              {"kind": "park", "geometry": {"type": "Polygon", "coordinates": [[[127.04, 37.5], ...]]}},
              {"kind": "road", "road_class": "primary",
               "geometry": {"type": "LineString", "coordinates": [[127.02, 37.505], ...]}}]}
```

| 필드 | 설명 |
|---|---|
| `osm_data_timestamp` | 전국 자료 메타데이터의 OSM 시각(문자열), 없으면 null. 출처 표기에 쓴다 |
| `features` | 0~99개. 그리는 순서(배경 먼저) `sea`, `green`, `park`, `beach`, `water`, `river`, `coast`, `road`로 정렬 |
| `features[].kind` | `sea` \| `road` \| `river` \| `water` \| `coast` \| `beach` \| `park` \| `green` |
| `features[].road_class` | `kind=road`에만 있다. 그 도로의 OSM `highway` 값: `motorway` \| `trunk` \| `primary` \| `secondary` \| `tertiary` \| `unclassified` \| `residential` \| `living_street`. 다른 kind에는 이 필드가 없다 |
| `features[].geometry` | GeoJSON `LineString` 또는 `Polygon`(바깥 ring + 구멍, ring은 닫힘). 좌표 `[lon, lat]` 소수 5자리 |

- 자료: `road`는 전국 저장소 `store/network`의 highway way 중 `motorway`, `trunk`, `primary`, `secondary`, `tertiary`,
  `unclassified`, `residential`, `living_street`만(`*_link`, `service`, `footway`, `path`, `cycleway`, `steps`, `track`,
  `pedestrian` 등 제외). 같은 등급에서 끝점을 공유하는 way는 한 선으로 합친다. `sea`를 뺀 나머지는
  `store/envcache/layers.gpkg` layer `env`의 `env_class`(강은 선·면 둘 다 가능).
- `sea`(Polygon): `coast` 선(OSM `natural=coastline`, 진행 방향 왼쪽이 육지·오른쪽이 바다)으로 만든다. EPSG:5179에서 bbox에
  걸친 해안선을 합쳐(linemerge) bbox 면을 나누고(split), 각 해안선 구간의 bbox 안 부분 가운데에서 오른쪽·왼쪽으로
  `bbox 긴 변 x 1e-4`만큼 띄운 점이 든 조각에 구간 길이만큼 +/- 표를 준다. 합이 양수인 조각이 바다다(섬처럼 bbox 안에서
  닫힌 해안선이면 섬이 구멍인 바다 면). 해안선이 bbox를 나누지 못하면(bbox 안에서 끝나거나 한쪽 변만 넘음) 바다 면은 없다.
  `coast` 선 feature도 그대로 보낸다.
- 모든 도형을 bbox로 자른다. Multi 도형은 조각마다 별도 feature다. EPSG:5179에서 허용 오차 `bbox 긴 변 / 200`
  (8 km면 40 m, topology 유지)로 단순화한 뒤 반올림한다. 반올림 후 선 2점 미만·면 ring 4점 미만은 버린다.
  좌표는 bbox 안이다(반올림 오차 0.00001도 이내).
- 버리는 작은 것: 잘린 면적이 bbox 면적의 0.1 % 미만인 면, 잘린 길이가 bbox 긴 변의 1 % 미만인 선, 같은 면적 기준
  (bbox 면적의 0.1 %) 미만인 면의 구멍(ring).
- 순위: 도로는 등급(motorway > trunk > primary > secondary > tertiary > unclassified > residential > living_street) 다음
  잘린 길이. `sea`는 면적 순. 그 밖의 종류는 면(잘린 면적 순) 다음 선(잘린 길이 순). 동점은 입력 순서라 같은 요청은 같은
  응답이다. 응답의 `road`도 이 순위 순서다(큰 등급이 앞). 그리는 순서(작은 등급 먼저 등)는 앱이 정한다.
- 종류별 상한: `sea` 4, `road` 58, `park` 12, `green` 10, `water` 6, `river` 6, `coast` 4, `beach` 3(합계 103). 한 종류가
  모자라도 다른 종류로 채우지 않는다. 그 뒤 그리는 순서대로 전체 상한 99개(OSMF attribution guideline "fewer than 100
  features")라 모든 종류가 가득 차면 마지막인 `road`가 54개까지만 담긴다.
- 전체 좌표 상한 `MAX_TOTAL_COORDS` = 6,000(`[lon, lat]` 쌍 수, 면 ring은 닫는 점 포함). 넘으면 각 종류 안의 순위가 높은
  feature부터(같은 순위면 응답 앞쪽부터, `sea`는 모두 순위 0이라 가장 먼저) 담고, 남은 예산에 들어가지 않는 feature만 건너뛴다(혼자 상한을 넘는 면 하나 때문에
  다른 feature가 빠지지 않는다). 남은 feature의 순서는 그대로다. 응답 본문이 백엔드
  읽기 상한 256 KB 안에 들게 하려는 것이다(6,000쌍이면 약 130 KB).

## 상세 모드 `detail: "full"`

백엔드가 서버에서 평면 PNG 썸네일(건물 포함)을 그릴 때 쓴다. `thumb` 응답과 형식은 같고(`features[].kind`·`geometry`·
`road_class`), 아래가 다르다. `thumb` 요청의 응답은 이 모드가 생겨도 바뀌지 않는다.

```json
{"osm_data_timestamp": "2026-10-20T20:23:47Z",
 "buildings_available": true,
 "buildings_osm_data_timestamp": "2026-11-01T20:21:00Z",
 "features": [{"kind": "park", "geometry": {"type": "Polygon", "coordinates": [[[127.04, 37.5], ...]]}},
              {"kind": "road", "road_class": "footway",
               "geometry": {"type": "LineString", "coordinates": [[127.03, 37.501], ...]}},
              {"kind": "building", "height_m": 48.0,
               "geometry": {"type": "Polygon", "coordinates": [[[127.041, 37.5], ...]]}}]}
```

| 필드 | 설명 |
|---|---|
| `buildings_available` | 건물 자료 파일(`buildings/buildings.gpkg`)을 읽었으면 true. 파일이 없거나 읽을 수 없으면(아래 "건물 자료 고장") false이고 `building` feature가 없다(나머지는 정상 200) |
| `buildings_osm_data_timestamp` | 건물 자료 `buildings/metadata.json`의 `osm_data_timestamp`(원본 PBF header 시각). 파일·값이 없거나 읽을 수 없으면 null |
| `features` | 그리는 순서 `sea`, `green`, `park`, `beach`, `water`, `river`, `coast`, `road`, `building`으로 정렬. 99개 상한 없음 |
| `features[].kind` | 위 8종 + `building` |
| `features[].road_class` | `kind=road`에만. `thumb`의 8개 등급 + `pedestrian` \| `footway` \| `path` \| `cycleway`(축척에 따라 일부 등급은 없다) |
| `features[].height_m` | `kind=building`에만 있는 숫자(m, 소수 1자리, 2~300). 건물 geometry는 항상 `Polygon`(MultiPolygon은 조각마다 별도 feature) |

- 도로: `thumb` 등급에 `pedestrian`, `footway`, `path`, `cycleway`를 더한다. `motorway_link`·`trunk_link`·`primary_link`·
  `secondary_link`·`tertiary_link`는 상위 등급으로 묶어 `road_class`도 상위 값이다(본선과 끝점이 이어지면 한 선). `service`,
  `steps`, `track` 등은 넣지 않는다. 순위는 등급(위 순서, `cycleway`가 가장 낮음) 다음 잘린 길이.
- 건물: `{ROUTE_NATIONAL_DIR}/buildings/buildings.gpkg` layer `buildings`를 요청마다 GPKG 공간 색인으로 bbox에 걸친 행만
  읽는다(파일을 요청 사이에 열어 두지 않는다). bbox로 자르고 잘린 면적이 건물 기준(아래 축척 단계, 최소 15 m²) 미만이면
  버린다. 응답 안에서는 잘린 면적이 큰 순서다(그리는 순서는 백엔드 렌더러가 정한다). `metadata.json`은 파일의 수정 시각·크기가
  같으면 다시 읽지 않는다.
- 단순화 허용 오차 `max(bbox 긴 변 / 600, 0.5 x mpp)`(4 km·mpp 1이면 약 6.7 m, 점 5개 이하 도형은 단순화하지 않음). 버리는
  작은 것: 건물이 아닌 면은 잘린 면적이 bbox 면적의 0.001 % 미만(4 km x 4 km면 160 m²), 선은 잘린 길이가 bbox 긴 변의 0.2 %
  미만, 면의 구멍은 그 면을 버리는 기준(건물은 건물 기준) 미만. 좌표 규칙(bbox 안, 소수 5자리, 퇴화 도형 제거)과 바다 면
  계산은 `thumb`와 같다.
- 축척 단계(LOD): `mpp` = 요청 `meters_per_pixel`(없으면 `bbox 가로(m) / 600`). 그림에서 보이지 않는 것은 처음부터 보내지 않는다
  (`app/basemap.py` 상수).

  | 상수 | 값 | 규칙 |
  |---|---|---|
  | `MIN_BUILDING_PX` | 1.5 | 건물: 잘린 면적이 `max(15 m², (1.5 x mpp)²)` 미만이면 버린다(mpp 10이면 225 m²) |
  | `PATH_MAX_MPP` | 5 | `mpp > 5`면 `footway`·`path`·`cycleway`·`pedestrian`을 보내지 않는다 |
  | `LOCAL_ROAD_MAX_MPP` | 8 | `mpp > 8`이면 `living_street`·`residential`·`unclassified`도 보내지 않는다(큰길 5등급만) |
  | `SIMPLIFY_MPP_FACTOR` | 0.5 | 단순화 허용 오차 하한 `0.5 x mpp`(반 px) |
  | `FULL_DEFAULT_IMAGE_PX` | 600 | `meters_per_pixel` 생략 시 `mpp = bbox 가로 / 600` |

- 메모리: 건물은 투영·단순화 전에 줄인다. 경위도 근사 면적(`도² x (지구 반지름 x π/180)² x cos(중심 위도)`)이 건물 기준의
  90 % 미만이면 빼고, 그래도 남은 feature 예산(`MAX_FULL_FEATURES` - 도로·env 후보 수)보다 많으면 근사 면적이 큰 것부터 그
  수만큼만 남긴다(정확한 기준은 투영 뒤 다시 적용). 건물 gpkg는 GeoDataFrame 없이 pyogrio raw(WKB)로 읽는다.
- 건물 자료 고장: `buildings.gpkg`가 SQLite가 아니거나 잘렸거나 0 byte이거나, layer `buildings`·열 `height_m`이 없는 등 읽을 수
  없으면 요청을 실패시키지 않는다. 200에 `buildings_available=false`·`buildings_osm_data_timestamp=null`이고 건물 없이 나머지를
  보낸다. 서버 로그에 경고 `ai_error code=BUILDINGS_UNAVAILABLE endpoint=/internal/v1/basemaps cause=<예외 클래스 이름>`을
  요청마다 남긴다(좌표·파일 경로·예외 메시지 없음).
- 상한: feature `MAX_FULL_FEATURES` = 40,000개, 좌표 `MAX_FULL_COORDS` = 300,000쌍, 응답 본문 `MAX_FULL_BYTES` = 7,500,000 byte
  (compact JSON 상한 추정. 숫자마다 소수 5자리를 가정해 실제보다 크거나 같게 센다. 백엔드 읽기 상한 8 MB 안). 하나라도 넘으면
  작은 건물부터 → `footway`·`path`·`cycleway`(짧은 것부터) → 작은 `green` 순서로 하나씩 뺀다. 그래도 넘으면 낮은 등급·짧은
  도로 → 그 밖의 작은 면·짧은 선 → 작은 `sea` 순서다. 남은 feature의 순서는 그대로다.
- 시간·메모리(개발 PC, 합성 자료, 운영 CPU·실제 서울 자료는 미측정): 촘촘한 도심 7.9 km x 7.9 km(건물 약 15만 개, 도로 800개).
  `meters_per_pixel` 1(건물 상한까지 담김)이면 한 요청 약 2~3.5초, 프로세스 peak working set 증가 약 +100 MB(CPU 1개 고정
  full 2건 동시 요청은 직렬로 약 2.3초·4.5초, +176 MB). 생략(약 13 m/px)이면 건물이 모두 기준 미만이라 약 1~2초.
  엔진 lock은 잡지 않는다(아래 "동시성").

### 건물 자료 파일 (`{ROUTE_NATIONAL_DIR}/buildings/`)

`tools/data/national/build_buildings.py`가 원본 PBF에서 만든다(서비스는 만들거나 수정하지 않는다).

```powershell
python -m tools.data.national.build_buildings --pbf C:\data\south-korea.osm.pbf --out C:\data\national-bundle\buildings
```

- `buildings.gpkg` layer `buildings`: EPSG:4326 `MultiPolygon`, 열 `osm_id` INTEGER(way는 way id, multipolygon relation은
  `-relation id`), `height_m` REAL(항상 값 있음), GPKG 공간 색인. 건물은 `building=*`(`no` 제외)인 닫힌 way와 type=multipolygon
  relation이다. 높이: `height`(m, 단위 글자 제거, ft는 0.3048 곱) → `building:levels` x 3.2 → 9.0, 2~300 m로 자른다.
  고장 난 면은 make_valid(실패하면 buffer(0))로 고치고 면 부분만 남긴다.
- `metadata.json`: `format`(1), `source`(PBF 파일 이름), `pbf_md5`, `pbf_sha256`, `osm_data_timestamp`(PBF header의
  `osmosis_replication_timestamp`, 없으면 null), `count`, `built_at`(UTC), `location_index`.
- 두 파일은 같은 폴더의 임시 이름에 쓴 뒤 `os.replace`로 바꾼다(gpkg 먼저). 폴더나 `buildings.gpkg`가 없으면 서비스는
  `buildings_available=false`로 답하고 나머지는 정상이다. 다시 만들면 다음 요청부터 새 파일을 읽는다(재시작 불필요).
- 메모리: node 위치 색인 기본값 `sparse_mem_array`(node당 16 byte, 대한민국 PBF 약 291 MB는 약 1 GB 이하). 모자라면
  `--index sparse_file_array,<파일 경로>`. 건물은 20,000개씩 gpkg에 이어 쓴다.

## 오류

| HTTP | `code` | 언제 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 위 요청 규칙 위반(`detail`·`meters_per_pixel` 포함) |
| 422 | `OUT_OF_AREA` | bbox가 전국 자료 범위(`store.coverage`, 메타데이터 `bbox_wsen`)와 넓이로 겹치지 않음. 일부만 겹치면 200(겹친 부분만 자료) |
| 503 | `NOT_READY` | 엔진 로드·예열 중(추천과 같은 기준) |
| 503 | `BUSY` | `detail=full`만. 다른 full 요청을 계산 중이라 `ROUTE_LOCK_WAIT_S`(기본 8초) 안에 full 실행 슬롯을 못 잡음. 메시지 "다른 지도 바탕 자료를 만드는 중이에요. 잠시 후 다시 시도해 주세요." |
| 503 | `UNAVAILABLE` | 엔진 시작 실패, 또는 `ROUTE_DATA_MODE=busan`(부산 legacy 모드는 큰길용 mmap 도로 저장소가 없어 지원하지 않는다) |
| 500 | `INTERNAL` | 처리 중 예외(서버 로그 `ai_error code=INTERNAL endpoint=/internal/v1/basemaps cause=<예외 클래스 이름>`. 예외 메시지는 좌표가 들어갈 수 있어 로그·`debug`에 남기지 않고, `ROUTE_DEBUG=1`의 `debug`도 예외 클래스 이름만이다). 건물 파일 고장은 500이 아니다(위 "건물 자료 고장") |

## 동시성

엔진 `pipeline.lock`을 잡지 않는다. 읽기 전용 mmap 배열과 gpkg 파일만 읽고 공유 엔진 상태를 바꾸지 않으므로 추천 계산 중에도
바로 처리한다(`X-Request-Deadline`은 보지 않음, `TIMEOUT` 없음). 동기 endpoint라 서버 thread pool에서 돈다.
`detail=full`은 `pipeline.lock`과 별개인 full 실행 슬롯(`BASEMAP_FULL_CONCURRENCY` = 1)을 잡는다. 한 번에 1건만 계산하고 다음 요청은
`ROUTE_LOCK_WAIT_S`(기본 8초)까지 기다린 뒤 못 잡으면 503 `BUSY`다. 촘촘한 도심 full 요청이 수백 MB를 쓰므로 Route(운영 1 CPU·2 GB)가
코스 생성과 함께 버티게 하려는 것이다(백엔드가 시간 초과 뒤 다음 요청을 보내도 계산이 겹치지 않는다). 이미 시작한 계산은 끊지
않는다. `thumb`는 슬롯 없이 바로 처리한다.
bbox를 덮는 1 km grid 칸(+사방 2칸 여유)의 node에 걸친 way와 gpkg 공간 색인으로 bbox에 걸친 행만 읽는다.
