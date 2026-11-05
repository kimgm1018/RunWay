# API 명세 — W07 워치 기록 → AI06 요청 변환 규칙(백엔드 내부)

[API 명세 색인](README.md)으로 돌아가기.

| 항목 | 내용 |
| --- | --- |
| 관련 업무 | S15P31E105-411, 사용처 S15P31E105-410 |
| 구현 | 참고 구현 `ai/service/tools/w07_to_ai06.py`, 서비스 런타임 미사용 |
| 상태 | 제안, 백엔드(410) 합의 전 |
| 기준 dev | `3b2972d`, 2026-11-04 |

완료 러닝의 W07 저장 기록(`running_metric_samples`, `running_route_points`)을 [AI06 `POST /v1/hr/personalize`](ai-service.md#ai06--hr-개인화) 요청으로 바꾸는 규칙이다. AI06 요청·응답 계약은 바꾸지 않는다. ODE 모델이 바뀌어도([S15P31E105-406](https://ssafy.atlassian.net/browse/S15P31E105-406)) 이 규칙은 그대로다.

- **학습 근거**: ODE v2.1을 학습한 데이터(FitRec canonical v1.1)를 만든 규칙과 뜻이 같다. 출처는 [8절](#8-근거-출처)에 있다.
- **제안**: 학습 데이터에 같은 상황이 없어서 AI 담당이 정한 값이다. 백엔드와 합의 뒤 확정한다.
- 참고 구현: [`ai/service/tools/w07_to_ai06.py`](../../../ai/service/tools/w07_to_ai06.py) (표준 Python, 서비스 런타임에서는 쓰지 않음)
- 예시: [`ai/service/tests/fixtures/w07_ai06/`](../../../ai/service/tests/fixtures/w07_ai06/) · 테스트: [`ai/service/tests/test_w07_ai06_conversion.py`](../../../ai/service/tests/test_w07_ai06_conversion.py)

## 1. 한눈에 보기

| 항목 | 규칙 | 근거 |
| --- | --- | --- |
| 보낼 러닝 | 종료 결과 확정(모든 batch 저장 확인)·`COMPLETED`·미삭제, 시작 최신순으로 변환해 성공한 것 최대 50개 | 제안 (50·25·1441은 AI06 검증) |
| 시간 기준 | 각 값의 `measuredAt`(UTC)을 쓴다. `elapsedDurationSec`는 쓰지 않는다 | 학습 근거 + 워치 코드 확인 |
| 0초 | 첫 유효 HR 측정 시각 = `elapsedSec` 0 = `sessionStartedAt` | 학습 근거 (첫 기록 점) / 제안 (시각 고르기) |
| 5초 격자 | 0, 5, 10, … 초. 마지막 관측까지, 최대 1441행 | 학습 근거 |
| 값 고르기 | 행 시각 이전의 마지막 유효 관측. 15초 넘게 오래되면 null | 학습 근거 |
| `hrIsFilled` | 값은 있지만 최근 5초 안에 새 HR 측정이 없음 | 학습 근거 |
| 품질 | 값 없음 `MISSING`, 최근 5초 안에 버린 원본이 있으면 `LOW`, 그 밖 `GOOD` | 학습 근거 (판정 기준) / 제안 (워치에서 볼 수 있는 표시만 사용) |
| 멈춤·결측 | 행을 빼지 않고 null + `MISSING` 행으로 채운다 | 학습 근거 (뜻이 같음, 3.5절) |
| `gradePercent` | 워치 GPS 우선·폰 GPS 보완으로 고른 경로점의 DEM 고도로 백엔드가 뒤쪽 30m 경사를 계산 | 학습 근거 (계산식) / 제안 (경로점 고르기, DEM 고도 사용, ADR-0019) |
| `workoutQuality` | 버린 원본 비율 > 5% `UNUSABLE`, 표시나 60초 넘는 공백이 있으면 `USABLE_WITH_FLAGS`, 아니면 `CLEAN` | 학습 근거 / 제안 (표시 종류) |

## 2. 입력

| 출처 | 쓰는 열 | 비고 |
| --- | --- | --- |
| `running_sessions` | `id`, `user_id`, `status`, `deleted_at`, `started_at` | |
| `running_metric_samples` | `measured_at`, `heart_rate`, `is_hr_measured`, `total_distance`, `speed` | W07 `METRIC_SAMPLE`의 `measuredAt`·`heartRateBpm`·`isHrMeasured`·`totalDistanceM`·`speedMps`. 워치는 `gradePercent`·`routeProgressM`을 null로 보낸다(`wear/.../batch/BatchFormat.kt`) |
| `running_route_points` + `user_devices` + DEM | `measured_at`, `position`(경도·위도), `device_id`→`user_devices.device_type`(`WATCH`/`PHONE`), DEM 고도. `altitude`(GPS 고도)는 현재 미사용 | W07 `GPS_POINT`의 `measuredAt`·`coordinates`·`altitudeM`. 워치·폰 GPS는 각 기기 `deviceId`의 별도 batch로 저장되어 한 러닝에 섞일 수 있다(3.4절 경로점 고르기). `device_id`가 null이면 `PHONE`으로 본다(제안). DEM 고도 조회는 코스 경사(ADR-0019, S15P31E105-369)와 같은 DEM·조회 코드를 쓴다. `altitude` 사용 여부는 7절 질문 2 |

W07 원본은 지표마다 시각이 다르고 간격이 고르지 않다. 아래 규칙은 이 원본을 시각 기준으로 5초 격자에 맞춘다. 배열 순서나 batch 경계는 쓰지 않는다.

## 3. 변환 규칙

### 3.1 보낼 러닝 고르기 · 제안

1. 같은 `user_id`, `status = 'COMPLETED'`, `deleted_at IS NULL`이고 **종료 결과가 확정된**(모든 batch의 서버 저장 확인이 끝난) 러닝을 `started_at` 최신순으로 읽는다. "종료 처리 중"이나 "저장 미확인" 러닝은 마지막 구간이 빠졌을 수 있으므로 보내지 않는다. 확정을 판단할 DB 값은 7절 질문 7이다. 백엔드의 건강정보 동의·소유권 확인은 AI06 기존 조건 그대로다.
2. 하나씩 3.2~3.7절로 변환한다. 아래는 보내지 않는다.
   - `NO_START_HR`: 35~230bpm 범위의 HR 측정이 하나도 없다.
   - `TOO_SHORT`: 격자가 25행(120초) 미만이다.
3. 성공한 러닝을 50개까지 모은다. 하나도 없으면 AI06을 호출하지 않는다.
4. 2시간(1441행)보다 길면 앞 1441행만 보낸다.

AI06은 받은 러닝 중 출발 HR·2분 이상 action이 없는 러닝을 ODE 계산에서 스스로 뺀다. 백엔드가 이 판정을 미리 할 필요는 없다.

### 3.2 시간 기준과 0초 · 학습 근거 / 제안

- 모든 값의 시각은 `measured_at`(UTC)으로 정한다. `elapsedDurationSec`는 쓰지 않는다. 워치는 이 값을 Health Services의 **활동 시간**(일시정지 제외)으로 채운다(`HealthServicesExerciseGateway.kt`의 `getActiveDurationAtDataPoint`). 학습 데이터의 경과 시간은 멈춤을 포함한 실제 경과 시간이다.
- **0초(앵커)** = 35~230bpm 범위인 첫 HR 측정의 `measured_at`. 학습 데이터는 첫 기록 점(항상 HR이 있음)이 0초다. ODE는 0초 행의 HR이 실측(`hrIsFilled=false`)이어야 그 러닝을 쓴다. 그래서 `started_at`이 아니라 첫 HR 시각을 0초로 둔다(제안). 앵커보다 앞선 값은 버린다.
- `sessionStartedAt` = 앵커 시각(UTC ISO 8601). AI06은 이 값을 러닝 순서와 지난 러닝과의 간격 계산에만 쓴다.
- 원본 시각 `τ` = `measured_at − 앵커`(초, 소수 포함).

### 3.3 5초 격자 · 학습 근거

- 행 시각 `g` = 0, 5, 10, …초. `elapsedSec`는 정수 `g`다. 중복·빠짐 없이 5초씩 이어진다(AI06 검증 조건).
- 마지막 행 = `floor(마지막 관측 τ / 5) × 5`. 마지막 관측은 지표·경로점 중 가장 늦은 것이다.
- 각 행은 **구간 (g−5, g]** 을 본다. "새 측정"·"버린 원본" 판정은 이 구간 안의 원본으로 한다.
- 행 값은 `g` 이전(포함)의 마지막 유효 관측값이다. 그 관측이 15초보다 오래되었으면(`g − τ > 15`) null이다. 미래 값으로 앞을 채우거나 앞뒤 값을 선형 보간하지 않는다.

### 3.4 지표별 규칙

**HR** · 학습 근거

| 단계 | 규칙 |
| --- | --- |
| 원본 | `is_hr_measured = true`인 `heart_rate`, 시각순 |
| 버림 표시 | 35~230bpm 밖이면 버림. 직전 **유효** HR 대비 변화가 초당 4bpm을 넘으면 버림 (같은 시각은 첫 값만) |
| `hrBpm` | 행 시각 이전 마지막 유효 HR. 15초 넘게 오래되면 null |
| `hrIsFilled` | 값이 있고, 그 HR이 `g − 5` 이전 측정(구간 안 새 측정 없음)이면 `true`. 값이 null이면 `false` |
| `hrQuality` | null이면 `MISSING`. 구간 안에 버린 HR이 있으면 `LOW`. 아니면 `GOOD` |

**속도** · 학습 근거(계산식) / 제안(출처)

| 단계 | 규칙 |
| --- | --- |
| 원본 | 워치 누적 거리 `total_distance`(W07 `totalDistanceM`). 학습 데이터도 위치 기록의 누적 거리 차이로 속도를 계산했다 |
| 버림 표시 | 직전 채택 값보다 줄었거나, 직전 채택 값 대비 8m/s보다 빠르게 늘면 버림. 30초 넘게 버리고 있었다면 늘어난 값은 재시작으로 받되 표시는 남긴다 |
| 구간 끊김 | 채택한 거리 관측 사이가 60초를 넘으면 새 구간 |
| `speedMps` | `la` = `g` 이전 마지막 채택 거리, `lp` = `g − 5` 이전 마지막 채택 거리. 둘이 같은 구간이고 `la`가 새 값이면 `(거리[la] − 거리[lp]) / (τ[la] − τ[lp])`. 새 값이 없으면 같은 구간의 직전 속도를 이어 쓴다. `lp`가 없거나(0초 행 포함) 다른 구간이면, 또는 `la`가 15초 넘게 오래되면 null. 소수 3자리 반올림 |
| `speedQuality` | null이면 `MISSING`. 7m/s 초과이거나 구간 안에 버린 거리가 있으면 `LOW`. 아니면 `GOOD` |
| 거리 값이 전혀 없는 러닝 | 워치 속도 `speed`(W07 `speedMps`)의 마지막 값을 15초까지 쓴다(제안). 7m/s 초과면 `LOW` |

**경사** · 학습 근거(계산식) / 제안(DEM 고도)

| 단계 | 규칙 |
| --- | --- |
| 경로점 고르기 (제안) | 워치 GPS 점은 모두 쓴다. 폰 GPS 점은 앞뒤 15초 안(두 시각 차이 15초 이하)에 워치 점이 하나도 없을 때만 쓴다. "구간"은 **시각 기준**이다: 워치 점마다 앞뒤 15초를 워치가 덮는 시간으로 보고, 그 밖의 시간만 폰 점으로 채운다. 같은 시간대를 두 기기 점으로 이으면 서로 몇 m 떨어진 점을 오가며 거리가 부풀고 경사가 작아진다(`mixed_gps` 예시: 2% → 약 1.5%) |
| 원본 | 고른 경로점마다 백엔드가 DEM 고도를 조회한다(ADR-0019 백엔드 경사 계산). DEM 밖 점은 뺀다. 워치 `gradePercent`는 null이므로 쓰지 않는다 |
| 누적 거리 | 고른 경로점을 시각순으로 이은 haversine 거리(지구 반지름 6,371,000m) 누적. 워치↔폰이 바뀌는 곳은 한 번만 이어진다 |
| 구간 끊김 | 고른 경로점 사이가 60초를 넘으면 새 구간(연속 공백 기준. 경사 창이 이 끊김을 넘지 않는다) |
| 고도 평활 | 누적 거리 5m 격자로 고도를 선형 보간 → 가운데 7칸(30m) 이동 평균(가장자리는 있는 칸만 평균) → 원래 점 거리로 선형 보간 |
| 점 경사 | 점 `i`에서 누적 거리가 `cum[i] − 30m` 이하인 마지막 점 `j`. `100 × (고도[i] − 고도[j]) / (cum[i] − cum[j])`, 오르막 양수(코스 `gradePercent`와 같은 부호). `j`가 없거나 다른 구간이면 null |
| `gradePercent` | 행 시각 이전 마지막 경로점의 경사. 15초 넘게 오래되었거나, `j`→`i` 사이가 120초를 넘으면(중간 멈춤) null. ±30%로 자른 뒤 소수 2자리 반올림 |
| `gradeQuality` | null이면 `MISSING`. ±30%를 넘어 잘랐으면 `LOW`. 아니면 `GOOD` |

공통: 값이 null이면 품질은 항상 `MISSING`, 값이 있으면 `GOOD` 또는 `LOW`다. 학습 데이터의 경사 품질 `UNRELIABLE`(멈춤 포함 창·고도 drift)은 AI06 enum에 없으므로 null + `MISSING`으로 보낸다. ODE는 `GOOD`·`LOW`만 유효값으로 보므로 뜻이 같다.

### 3.5 멈춤과 결측 · 학습 근거

- 사용자가 일시정지했거나 측정이 끊긴 동안에도 행을 만든다. 3.3절 규칙에 따라 마지막 값을 15초까지 이어 쓰고(HR은 `hrIsFilled=true`), 그 뒤는 null + `MISSING`이다.
- 학습 데이터는 60초 넘는 공백에 행을 만들지 않고 구간을 나눴다. AI06은 빈틈 없는 5초 격자를 요구하므로 대신 `MISSING` 행을 넣는다. ODE·요약·History 계산은 `MISSING` 행을 쓰지 않으므로 결과의 뜻은 같다.
- ODE는 0초부터 speed·grade가 30초(6행) 넘게 비기 전까지만 계획 입력으로 쓴다(`pv_data.prepare_session`). 그래서 2분 안에 멈춘 러닝은 ODE 적합에서 빠지고, HR 기준값(`hrDangerBpm` 등)과 요약 통계에만 쓰인다. 학습 때도 같다.
- **폰 인계 뒤 구간**: 워치 심박과 워치 누적 거리가 끊기므로 인계 뒤 행은 심박과 속도가 `MISSING`이라 개인화에 거의 쓰이지 않는다. 폰 GPS로 속도를 보완하지 않는다(심박이 없어 얻는 것이 적다).

### 3.6 `workoutQuality` · 학습 근거 / 제안

| 값 | 조건 |
| --- | --- |
| `UNUSABLE` | 버린 원본 비율 > 5% (학습 `LOW_QUALITY`와 같은 기준) |
| `USABLE_WITH_FLAGS` | 버린 원본이 있거나, 지표 관측 사이 60초 넘는 공백이 있음 |
| `CLEAN` | 위 둘이 아님 |

- 비율 = 버린 원본 시각 수 / 0초~마지막 행 사이 `running_metric_samples` 행 수.
- 버린 원본 = 버린 HR, 버린 누적 거리, 7m/s를 넘는 워치 `speed`. 학습 데이터는 GPS·고도 표시도 셌지만, 워치 기록에는 그 표시가 없어 제외했다(제안).
- AI 서비스는 `CLEAN`과 `USABLE_WITH_FLAGS`를 똑같이 쓴다. 결과를 바꾸는 것은 `UNUSABLE` 여부뿐이다.

### 3.7 출력

러닝 하나가 `sessions[]` 원소 하나다. 필드 이름과 범위는 AI06 표 그대로다.

```json
{"sessionId": 9002, "sessionStartedAt": "2026-11-01T00:00:02Z", "workoutQuality": "CLEAN",
 "samples": [{"elapsedSec": 0, "hrBpm": 97.0, "speedMps": null, "gradePercent": null,
              "hrQuality": "GOOD", "speedQuality": "MISSING", "gradeQuality": "MISSING", "hrIsFilled": false}]}
```

## 4. 상수

| 상수 | 값 | 근거 |
| --- | --- | --- |
| 격자 | 5초 | 학습 `GRID_S` |
| 마지막 값 이어 쓰기 | 15초 | 학습 `MAX_FORWARD_FILL_GAP_S` |
| 구간 끊김 | 60초 | 학습 `MAX_GAP_S` |
| HR 유효 범위 | 35~230bpm | 학습 `HR_MIN_BPM`·`HR_MAX_BPM` |
| HR 변화 상한 | 초당 4bpm (오름·내림) | 학습 `HR_MAX_RISE/FALL_BPM_PER_S` |
| 거리 튐 | 8m/s, 30초 뒤 재시작 | 학습 `SPEED_GPS_JUMP_MPS`·`GPS_JUMP_RESET_S`(GPS 점 대신 누적 거리에 적용 — 제안) |
| 속도 LOW | 7m/s 초과 | 학습 `SPEED_IMPLAUSIBLE_RUN_MPS` |
| 경사 창 | 뒤쪽 30m, 고도 30m 평활(5m 격자) | 학습 `GRADE_WINDOW_M`·`dist30` |
| 경사 자르기 | ±30% (`LOW`) | 학습 `GRADE_CLIP_PCT` |
| 경사 창 시간 상한 | 120초 | 학습 `GRADE_MAX_WINDOW_SPAN_S` |
| 러닝 품질 | 버린 비율 5% | 학습 `LOW_QUALITY_FLAG_RATIO` |
| 폰 GPS 점 제외 | 앞뒤 15초 안에 워치 점이 있으면 제외 | 제안 (이어 쓰기 15초와 같은 값) |
| 러닝 수·길이 | 최대 50개, 25~1441행 | AI06 검증 (`ode_schemas.py`) |

## 5. 예시

합성 값이다(실데이터 아님). `*.w07.json`은 백엔드가 DB에서 읽은 모양(`metricSamples`, 기기 종류·DEM 고도를 붙인 `routePoints`), `*.ai06_request.json`은 기대 요청이다. 5개 모두 AI06 검증과 ODE 세션 전처리를 통과한다.

| 경우 | 파일 | 보여 주는 것 |
| --- | --- | --- |
| 정상 | `normal` | 0초 행 HR 실측, 0~5초 속도·경사 `MISSING`(학습과 같음), 2% 오르막 |
| 결측 | `missing` | HR 50초 공백: 15초까지 `hrIsFilled=true`, 그 뒤 `MISSING`. 거리·경로점 공백 |
| 멈춤 | `pause` | 150~240초 일시정지. `elapsedDurationSec`는 멈춤 동안 늘지 않지만 행은 실제 시간으로 이어진다. `USABLE_WITH_FLAGS` |
| 저품질 | `low_quality` | HR 튐 16번·거리 튐 1번 → 해당 행 `LOW`, 버린 비율 7.8% → `UNUSABLE` |
| GPS 섞임 | `mixed_gps` | 워치 GPS(4초 간격)와 약 3.6m 옆의 폰 GPS(3초 간격)가 함께 저장됨. 워치 GPS가 78~148초에 끊긴 동안만 폰 점을 써서 2% 경사가 이어진다 |

결측 예시 일부(공백 전 마지막 HR 측정 = 57초, 다음 측정 = 112초):

| `elapsedSec` | `hrBpm` | `hrQuality` | `hrIsFilled` | 설명 |
| ---: | ---: | --- | --- | --- |
| 55 | 129 | GOOD | false | 구간 (50, 55]에 새 측정 |
| 60 | 129 | GOOD | false | 구간 (55, 60]에 57초 측정 |
| 65 | 129 | GOOD | true | 새 측정 없음, 8초 전 값 |
| 70 | 129 | GOOD | true | 13초 전 값 |
| 75 | null | MISSING | false | 18초 전 → 15초 초과 |
| 115 | 142 | GOOD | false | 112초 측정으로 재개 |

## 6. 백엔드 구현 메모

- 변환은 AI06을 호출할 때 DB에서 바로 계산하면 된다. 변환 결과를 따로 저장할 필요는 없다.
- 50개 × 1441행이면 요청 본문이 수 MB가 될 수 있다. 내부 호출 경로의 본문 크기 제한을 확인한다.
- Java 이식 뒤 `ai/service/tests/fixtures/w07_ai06/*.w07.json`을 입력으로 넣어 `*.ai06_request.json`과 같은 결과가 나오는지 비교하면 된다. 실수는 소수 3자리(속도)·2자리(경사)에서 반올림 차이만 허용하면 된다.

## 7. 백엔드와 합의할 열린 질문

1. **GPS 경로점이 없는 러닝**: 워치·폰 모두 유효한 위치가 없어 경사가 모두 `MISSING`이면 ODE가 그 러닝을 계획 적합에 쓰지 못한다(학습은 경사가 있어야 action이 유효). 이런 러닝이 얼마나 생기는지, 없을 때 코스 `courses.elevation_profile`([100m 경사 구조](courses.md#elevationprofile-100m-경사-구조)의 `gradePercent`)을 `route_progress`(W07 `routeProgressM`) 위치로 찾아 대신 쓸지 정해야 한다. 단, 지금 워치는 `routeProgressM`을 null로 보낸다.
2. **경사에 쓸 고도 출처**: 학습은 GPS 고도를 썼다. 계산식은 두 선택지 모두 3.4절과 같다. 백엔드와 정한다.

   | 선택지 | 장점 | 단점 |
   | --- | --- | --- |
   | DEM 고도 (현재 규칙, ADR-0019) | 코스 경사와 같은 DEM·조회 코드. 기기와 무관하게 일정 | 학습과 출처가 다르다. DEM이 더 매끄러워 경사 크기가 조금 작을 수 있다 |
   | 저장된 GPS `altitude`(`running_route_points.altitude`, W07 `altitudeM`, V1부터 있음) | 학습과 같은 출처. DEM 조회가 필요 없다 | 기기별 고도 잡음이 크다. null일 수 있다 |

   어느 쪽이든 실제 기록이 쌓이면 학습 데이터와 경사 분포를 비교한다.
3. **워치·폰 시계 차이**: 워치 GPS 점만 쓰는 시간에는 심박·거리·경사가 모두 워치 시계라 문제가 없다. 폰 점으로 채운 시간에만 경사(폰 시계)와 심박·거리(워치 시계)를 `measured_at`으로 맞추므로, 두 시계가 몇 초 어긋나면 그 시간의 경사가 그만큼 밀리고, 워치↔폰이 바뀌는 곳의 15초 판정도 그만큼 어긋난다. 보정이 필요한지 확인한다.
4. **`sessionStartedAt` = 첫 HR 시각**: `running_sessions.started_at`과 몇 초 다를 수 있다. AI 계산에는 문제가 없지만, 백엔드가 이 값을 다른 곳에 쓰는지 확인한다.
5. **`measured_at` 정밀도**: 행 배정에 소수 초가 필요하다. DB `TIMESTAMPTZ`를 그대로(마이크로초) 읽는지 확인한다.
6. **2시간 넘는 러닝**: 앞 1441행만 보내는 것으로 충분한지 확인한다.
7. **종료 결과 확정 판단 값**: "모든 batch 저장 확인으로 종료 결과 확정"을 어느 DB 값으로 판단할지 정한다. 후보는 `running_sessions.analysis_status`(V3, `PENDING`·`PROCESSING`·`READY`·`FAILED`·`LEGACY`)나 END 확정 상태다. AI06 호출을 최종 분석과 같은 시점에 붙일지도 함께 정한다.

## 8. 근거 출처

| 규칙 | 근거 위치 |
| --- | --- |
| 5초 격자, 구간 (g−5, g], 15초 이어 쓰기, `hr_is_filled`, 품질 판정, 거리 차분 속도, 경사 창·자르기·120초, `workout_quality_v1` | 학습 데이터 생성 코드 `preprocessing/fitrec_v1/fitrec_v1_lib.py`(`to_canonical_grid`, `workout_quality_v1`)와 `config.py`, 기준값 `preprocessing/fitrec_poc/constants.py`, HR 버림·고도 평활·경사 창 `preprocessing/fitrec_poc/fitrec_preprocess.py`. **팀 저장소 밖 AI 담당 작업공간**에 있으며 schema `fitrec_canonical_v1.1`이다 |
| ODE v2.1이 그 canonical 데이터로 학습되었음 | ODE v2.1 학습 계약(Pre-run Validation CONTRACT 3절: 원본 = canonical `fitrec_v1/timeseries`) |
| 유효값 = `GOOD`·`LOW`, 채점 HR = `hr_is_filled=false`, 0초 실측 HR, 첫 action 60초 안, action 결측 30초까지 이어 쓰기, 2분 이상 | [`ai/service/app/models/ode/validation/pv_data.py`](../../../ai/service/app/models/ode/validation/pv_data.py) |
| 요약 통계는 `GOOD`만, 사용 러닝 = `CLEAN`·`USABLE_WITH_FLAGS` | [`odev21_legacy/summary.py`](../../../ai/service/app/models/ode/odev21_legacy/summary.py), [`history.py`](../../../ai/service/app/models/ode/odev21_legacy/history.py) |
| AI06 요청 검증·변환 | [`ai/service/app/ode_schemas.py`](../../../ai/service/app/ode_schemas.py) `PersonalizeRequest`, [`ai/service/app/personalization.py`](../../../ai/service/app/personalization.py) `_records` |
| W07 형식 | [W07 워치 운동 배치 동기화](devices-health.md#w07-워치-운동-배치-동기화), `wear/app/src/main/java/com/runway/watch/batch/BatchFormat.kt`, `.../session/HealthServicesExerciseGateway.kt`, `backend/src/main/resources/db/migration/V1__initial_schema.sql` |
| 경사를 백엔드가 DEM으로 계산 | [ADR-0019](../../adr/0019-course-generation-backend.md) |
