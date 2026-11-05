# Route 서비스 API (백엔드 연동용)

러닝 코스 TOP3를 만드는 내부 API다. Spring 백엔드만 내부 네트워크로 호출한다(앱이 직접 부르지 않는다). Jira S15P31E105-381.
BE 쪽 계약 정본: `docs/design/api/ai-service.md` "Route 코스 생성 내부 HTTP 계약 초안"(S15P31E105-370, MR !183). 이 문서는 그
계약에 맞춘 구현 설명이다.

- 기본 주소: 컨테이너 `8000` 포트 (예: `http://route:8000`). HR 추론 `ai/service`와 다른 origin.
- 형식: JSON, UTF-8. 이 서비스는 snake_case를 쓴다.
- 같은 입력 + 같은 `seed` = 언제나 같은 결과.
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
바꾼다. 출발 위치·거리·모양·조건 중 하나라도 바뀌면 `seed`를 1로 되돌린다.

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
| `routes` | 코스 1~3개, `rank` 오름차순. Gate(enforce)를 통과한 후보만. 0개면 422 `NO_ROUTE` |
| `routes[].rank` | 1부터 연속 |
| `routes[].coords` | `[[lat, lon], ...]` WGS84 경로 좌표(2점 이상, 진행 방향 순서) |
| `routes[].distance_m` | 코스 거리(m), 목표의 ±10 % 안 |
| `routes[].summary`, `reasons`, `caveats` | 한 줄 요약, 추천 이유, 주의 문구(한국어 일반 텍스트, 그대로 보여 줘도 됨) |
| `routes[].score` | 규칙 기반 총점 = `score_terms[].contribution`의 합(소수 넷째 자리 반올림 차이 가능) |
| `routes[].score_terms[]` | 항목별 점수. key는 정확히 `term`, `label`, `group`, `feature_value`, `weight`, `contribution` (테스트로 고정). `term`은 열린 문자열 집합 |
| `notices` | 응답 전체 안내 문장(스냅 거리, 후보 부족, 선호 정보 부족 등) |
| `next_seed` | 요청 seed + 24 |

점수는 같은 요청 안의 후보 설명용이다. 요청 사이 비교·저장·재정렬에 쓰지 않는다. 순위는 `rank`를 따른다.

**고도·경사 값은 보내지 않는다.** 코스 경사는 백엔드가 계산한다(ADR-0019 개정, S15P31E105-369). 엔진은 고도 자료를
"평지 위주(`flat`)" 선호를 반영할 때만 쓴다. `flat`을 켜면 `reasons`/`caveats`에 "평지 위주예요", "오르막이 있어요
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
| 422 | `OUT_OF_AREA` | 출발 위치가 부산 extract 밖 | null |
| 422 | `NO_ROAD_NEARBY` | 가까운 달릴 수 있는 길이 250 m 넘게 떨어짐 / 주변에 길이 없음 | null |
| 422 | `DESTINATION_TOO_FAR` | 편도 목표 거리가 너무 짧음 | `{"min_target_km", "alternatives_from_km"}` |
| 422 | `END_SNAP_PE1`, `END_SNAP_PE2`, `END_SNAP_PE4`, `END_SNAP_PE5` | 도착 위치 근처에 안전하게 달릴 길이 없음 | null |
| 422 | `USABILITY_GATE_ALL_FAILED` | 안전 기준을 통과한 코스 없음 | null |
| 422 | `NO_ROUTE` | 조건에 맞는 코스를 못 만듦 | null |
| 503 | `NOT_READY` | 엔진 준비 중 | null |
| 503 | `BUSY` | 다른 요청 처리 중이라 1초 안에 실행 슬롯을 못 잡음 | null |
| 503 | `TIMEOUT` | `X-Request-Deadline`이 계산 시작 전에 지남 | null |
| 503 | `UNAVAILABLE` | 엔진 시작(로드·예열) 실패 | null |
| 500 | `INTERNAL` | 처리 중 예외 (서버 로그 `runway.ai`에 `ai_error code=INTERNAL ...`) | null |
| 500 | `SAFETY_CHECK` | 안전 확인 실패(안전망, 발생한 적 없음) | null |
| 500 | `SNAP_NODE_NOT_IN_GENERATION_GRAPH` | 편도 내부 처리 문제 | null |

## 5. 동시성·시간·재시도

- 엔진은 thread-safe가 아니라 한 번에 한 요청만 계산한다(worker 1개). 실행 슬롯을 **최대 1초** 기다리고 못 잡으면
  503 `BUSY`. 대기열을 두지 않는다.
- 응답 시간(측정값): 처음 요청한 지역 1~5초, 같은 지역 반복 0.3~1.2초. 1 vCPU에서는 더 길 수 있다.
- BE 계약 제안: BE→Route 전체 호출 15초, Route 처리 상한 12초(대기 1초 포함). 지금 구현은 **시작 전 deadline 확인**까지
  만 한다. 시작한 계산은 끝까지 가며 늦은 결과는 BE가 버린다. 계산 중단·자원 회수는 MVP 범위 밖이다.
- BE 자동 재시도는 0회(계약). 같은 입력은 같은 결과이므로 422 재시도는 의미가 없다.

## 6. 응답 크기 상한 (제안, 미확정)

BE 계약은 payload·문구 길이 상한을 실연동 전에 정하기로 했다. Golden 시나리오 측정값과 제안:

| 항목 | 측정 최대 | 제안 상한 |
|---|---:|---:|
| `summary` 길이 | 35자 | 100자 |
| `reasons` / `caveats` / `notices` 개수 | 4 / 3 / 2개 | 각 6개 |
| 경로당 `coords` 점 수 | 576 | 3,000 |
| 응답 전체 크기(운영 응답) | 40,505 B (약 41 KB) | 256 KB |

측정 범위: Golden 시나리오 88개(main 43 + random P2P 30 + 나머지 모드)의 성공 응답. 15 km 코스·다른 지역에서는 더 클 수 있어
상한은 측정 최대의 몇 배로 잡았다. 서비스는 아직 상한을 강제하지 않는다.

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
| `NUMBA_CACHE_DIR` | | 이미지는 `/opt/route/numba_cache`(빌드 때 생성) |

엔진 되돌리기 스위치(`RUNWAY_SP_ENGINE`, `RUNWAY_SP_KERNEL`, `RUNWAY_ARRAY_LOOP`, `RUNWAY_ARRAY_SHAPES`,
`RUNWAY_NETWORK_STORE`, `RUNWAY_SOURCE_SNAPSHOT`, `RUNWAY_ENV_PREPARED`, `RUNWAY_ADAPTER_LEAN_ROUTING`,
`RUNWAY_P2P_SUBSTRATE`, `RUNWAY_FAST_GRAPH`)는 결과를 바꾸지 않고 느린 검증 경로로 돌아가는 비상용이다(README 7절).
