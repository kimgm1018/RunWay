# 워치 실험 기록 업로드 계약 v2

담당자: 강현(Jira: E105강현) · 업무: S15P31E105-53

워치가 사용하는 요청·응답 형식이다. 수신 서버는 별도 구현하며 아래 경로는 제안값이다. 앱 설정에는 실제 전체 업로드 URL을 입력한다.

## 요청

`POST /api/v1/watch-experiments`

- `Content-Type: application/json; charset=utf-8`
- `Idempotency-Key: <sessionId>`

```json
{
  "schemaVersion": 2,
  "sessionId": "7d75ec55-5043-4caf-9a03-76db2c96f501",
  "participantId": "runner01",
  "startedAtEpochMs": 1792378800000,
  "startedElapsedMs": 100000,
  "startedAt": "2026-10-19T03:00:00Z",
  "endedElapsedMs": 110000,
  "endedAt": "2026-10-19T03:00:10Z",
  "state": "COMPLETED",
  "endReason": "user",
  "uploadState": "UPLOADING",
  "device": {"model": "Galaxy Watch7", "api": 34, "appVersion": "1.0", "bootCount": 4, "synthetic": false},
  "capabilities": {"gps": "enabled_fallback_possible"},
  "bpmEvents": [
    {"requestedElapsedMs": 100100, "appliedElapsedMs": 100120, "targetBpm": 140, "soundEnabled": true, "vibrationEnabled": true}
  ],
  "samples": [
    {"metric": "HEART_RATE", "startElapsedMs": 102000, "endElapsedMs": 102000, "value": 150,
     "unit": "bpm", "source": "health_services", "quality": "unknown",
     "measuredAt": "2026-10-19T03:00:02Z", "sessionElapsedMs": 2000, "targetBpmAtEnd": 140}
  ]
}
```

예시의 기기·API 값은 식별 형식 예시이며 실제 워치 OS 버전을 고정하는 값이 아니다.

## 필드와 단위

### 최상위 필드

| 필드 | JSON 타입 | 의미 |
| --- | --- | --- |
| schemaVersion | number(정수) | 데이터 구조 버전. 새 출력은 2. 앱은 기존 1도 읽음 |
| sessionId | string | UUID. 같은 실험을 재전송해도 변경하지 않음 |
| participantId | string | 실명·이메일이 아닌 가명. 영문·숫자·`_`·`-` 1~40자 |
| startedAtEpochMs | number(정수) | 시작 시 고정한 Unix 시간(ms). Java Long 권장 |
| startedElapsedMs | number(정수) | 같은 기기의 부팅 후 운동 시작까지 경과시간(ms) |
| startedAt | string | 시작 시각. ISO 8601 UTC 문자열, Z는 UTC를 의미 |
| endedElapsedMs | number(정수) 또는 null | 부팅 후 운동 종료까지 경과시간(ms). 종료 미확정이면 null |
| endedAt | string 또는 null | 종료 UTC 시각. 시작 기준 시각과 경과시간으로 계산 |
| state | string | 운동 상태. 아래 상태 표 참고 |
| endReason | string | 종료 사유. user는 사용자 종료. 오류·복구 등 다른 사유도 존재 |
| uploadState | string | 클라이언트의 로컬 전송 상태. 서버 저장 상태와 구분 |
| device | object | 필드별 타입을 갖는 기기 정보. 아래 표 참고 |
| capabilities | object | 지원 여부·권한·최신 가용성 상태를 보존하는 동적 문자열 맵 |
| bpmEvents | array<object> | 목표 BPM, 소프트웨어 적용 시각, 소리·진동 설정 변경 이력 |
| samples | array<object> | 지표별 원본 측정 구간·값·단위·출처·품질 |

### device

| 필드 | JSON 타입 | 의미 |
| --- | --- | --- |
| model | string | 기기 모델 코드 |
| api | number(정수) 또는 null | 설치된 Android API 레벨. 프로젝트 minSdk와 다름. 정보 없는 과거 기록은 null |
| appVersion | string | 앱에서 기록하는 버전 문자열 |
| bootCount | number(정수) 또는 null | 0 이상의 부팅 횟수. 조회 불가 시 null |
| synthetic | boolean 또는 null | 가상 기기 판정 보조값. 신규 측정은 true / false, 정보 없는 과거 기록은 null |

앱 내부에서는 `DeviceInfo` 모델을 사용한다. `model`·`appVersion`은 문자열이며 과거 기록에 해당 정보가 없으면 빈 문자열로 보존한다. 가상 기기 여부는 모델·빌드 식별자 기반의 보조 판정이므로 false라도 실측 센서 데이터를 보증하지 않는다.

#### v1 → v2 변경 및 호환

- v2에서는 `device`의 `api`·`bootCount`·`synthetic` 타입을 변경했다. `capabilities`의 JSON 구조와 문자열 값은 v1과 동일하다.
- 앱은 schemaVersion 1과 2를 읽고, 새 저장·추출·전송 JSON은 항상 2로 출력한다. API 경로의 `/api/v1/`과 JSON의 `schemaVersion`은 별개다. 이번 변경으로 업로드 경로는 바꾸지 않는다.
- v1 `device`의 `api`·`bootCount` 숫자 문자열과 `synthetic`의 문자열 `"true"` / `"false"`를 타입에 맞게 변환한다. 과거 `bootCount: "-1"`은 null로 변환한다. 누락된 숫자·판정값도 null이며, 0이나 false로 임의 보충하지 않는다.
- 워치의 기존 SQLite 기록은 삭제하지 않는다. 읽은 뒤 수정·재추출·재전송할 때 v2를 사용하며 sessionId와 측정값·시각을 유지한다. 이미 추출한 파일은 자동 변경하지 않는다.
- 수신 서버·분석 도구는 schemaVersion에 따라 v1 문자열과 v2 정수·Boolean·null을 구분해서 읽어야 한다. v2에서 숫자·Boolean을 문자열로 보내는 형식은 허용하지 않는다. 구버전 앱으로 되돌릴 때 v2 저장 기록을 읽는 호환성은 제공하지 않는다.

### capabilities

값은 모두 문자열이다. 지표별 지원 여부는 `<metric>.support`, 측정 가용성은 `<metric>.availability`로 구분한다. metric은 samples의 지표 이름과 같다. 지원 여부는 시작 시 기록하고 가용성은 콜백을 받은 지표에만 추가한다. 따라서 availability 키가 없는 것은 미지원의 증거가 아니다.

```json
{
  "STEPS.support": "supported",
  "STEPS_TOTAL.support": "unsupported",
  "DISTANCE.support": "supported",
  "DISTANCE.availability": "AVAILABLE",
  "HEART_RATE.support": "permission_denied",
  "STEP_LENGTH.support": "unsupported",
  "gps": "enabled_fallback_possible"
}
```

`.support` 값은 supported / unsupported / permission_denied이며 `.availability`는 SDK 문자열을 보존한다. gps는 enabled_fallback_possible 또는 disabled_steps_based다. GPS 사용 설정만으로 독립 실측이나 수신 성공을 보장하지 않는다.

앱 내부에서는 지원 상태를 `SupportStatus` enum(SUPPORTED / UNSUPPORTED / PERMISSION_DENIED)으로 생성·해석·비교하고, JSON에는 위 소문자 문자열로 기록한다. 알 수 없는 `.support` 값은 미확인 상태로 처리하며 미지원이나 권한 거부로 간주하지 않는다. SDK의 `.availability`·`quality` 원본 문자열은 enum으로 제한하지 않는다.

이전 schemaVersion 1 파일에는 아래 기존 키만 있을 수 있다. 현재 출력도 호환 목적으로 유지하지만, 구간·누적 지표가 같은 이름을 쓰므로 새 고유 키를 우선한다. 기존 키 값은 지원 초기값 또는 이후 SDK 가용성 문자열이며 기기·권한에 따라 달라진다.

| 기존 키 | 대응 지표 |
| --- | --- |
| Steps | STEPS / STEPS_TOTAL |
| Step per minute | CADENCE |
| Distance | DISTANCE / DISTANCE_TOTAL |
| Speed | SPEED |
| Stride Length | STEP_LENGTH |
| HeartRate | HEART_RATE |

### bpmEvents[]

| 필드 | JSON 타입 | 의미 |
| --- | --- | --- |
| requestedElapsedMs | number(정수) | 설정 변경 요청 시점. 부팅 후 ms |
| appliedElapsedMs | number(정수) | 재생 코드의 설정 적용 시점. 부팅 후 ms |
| targetBpm | number(정수) | 목표 박자(분당 박자 수). 앱 설정 범위 60~220 |
| soundEnabled | boolean | 소리 사용 여부 |
| vibrationEnabled | boolean | 진동 사용 여부 |

적용 시각은 소프트웨어 기준이며 실제 소리·진동의 물리적 출력 시각을 측정한 값이 아니다. 현재 진동 세기와 지속 시간은 저장하지 않는다.

### samples[]

| 필드 | JSON 타입 | 의미 |
| --- | --- | --- |
| metric | string | 측정 지표 종류. 아래 지표 표 참고 |
| startElapsedMs | number(정수) | 측정 구간 시작. 부팅 후 ms |
| endElapsedMs | number(정수) | 측정 구간 끝. 부팅 후 ms. 순간 측정은 시작과 같을 수 있음 |
| value | number 또는 null | 측정값. 결측·유효하지 않은 값은 null |
| unit | string | 값의 단위 |
| source | string | 데이터 출처 또는 추정 방식 |
| quality | string | 측정 품질·정확도 정보 또는 추정 여부 |
| measuredAt | string | 측정 구간 끝에 대응하는 ISO 8601 UTC 시각 |
| sessionElapsedMs | number(정수) | 운동 시작부터 측정 구간 끝까지 경과시간(ms) |
| targetBpmAtEnd | number(정수) 또는 null | 구간 끝 시각에 유효했던 목표 BPM. 적용 이력 없으면 null. 구간 전체가 같은 BPM이었다는 뜻은 아님 |

| metric | 의미 | unit |
| --- | --- | --- |
| STEPS | 구간 걸음 수 | steps |
| STEPS_TOTAL | 누적 걸음 수 | steps |
| CADENCE | 실제 분당 걸음 수(SPM). 목표 BPM과 구분 | steps/min |
| DISTANCE | 구간 이동 거리 | m |
| DISTANCE_TOTAL | 누적 이동 거리 | m |
| SPEED | 속도 | m/s |
| HEART_RATE | 심박수. 목표 박자와 다른 지표 | bpm |
| STEP_LENGTH | 한 걸음당 이동 거리 | m/step |

### 상태 값

| 필드 | 값 | 의미 |
| --- | --- | --- |
| state | STARTING / RUNNING / STOPPING | 시작 준비 / 기록 중 / 종료 처리 중 |
| state | COMPLETED / INTERRUPTED / FAILED | 정상 종료 / 중간 중단 / 오류 종료 |
| uploadState | PENDING / UPLOADING | 전송 대기 / 전송 중 |
| uploadState | UPLOADED / FAILED | 전송 성공 / 전송 실패 |

추출 파일의 uploadState는 추출 당시 상태다. 이후 앱에서 전송해도 기존 파일을 자동 갱신하지 않는다.

### 시간 계산 및 데이터 연결

```text
운동 시간(ms) = endedElapsedMs - startedElapsedMs
sessionElapsedMs = sample.endElapsedMs - startedElapsedMs
measuredAt의 Unix 시간(ms) = startedAtEpochMs + sessionElapsedMs
endedAt의 Unix 시간(ms) = startedAtEpochMs + endedElapsedMs - startedElapsedMs
```

각 지표의 측정 주기와 구간은 다를 수 있다. 배열의 인덱스나 수신 순서로 지표를 묶지 않고 측정 시각·구간을 기준으로 연결한다. 누적 지표와 구간 지표를 중복 합산하지 않는다. 페이스는 별도 JSON 필드로 저장하지 않는다.

### 데이터 품질

페이스는 유효한 양수 속도에 대해 1000÷m/s로 초/km를 계산한다. 설치·추출 방법은 [워치 앱 안내](../../../wear/README.md)를 따른다.

결측·유효하지 않은 수치는 null이며 0으로 채우지 않는다. `source`가 `estimated_distance_div_steps:`로 시작하는 보폭은 같은 구간의 거리÷걸음 수 추정값이다. `health_services_steps_based`는 GPS 미사용 추정 계열이며 `health_services_gps_enabled_fallback_possible`도 GPS의 독립 실측을 보장하지 않는다. 거리 자체가 걸음 수에 의존하면 그 거리로 계산한 보폭을 독립적인 정답으로 학습·검증하지 않는다.

`quality`는 `good`·`unknown`·`unreliable`·`estimated` 또는 Health Services가 제공한 정확도 정보를 보존한다. 거리·걸음 구간이 accuracy를 제공하면 해당 문자열을 보존한다. 파생 보폭은 `estimated;distance=<원본 거리 quality>;steps=<원본 걸음 quality>` 형식으로 추정 여부와 원본 품질을 함께 기록한다. 예를 들어 `estimated;distance=unknown;steps=good`이다. 이전 파일의 단순 `estimated`도 유효하며, quality를 고정 enum으로 역직렬화하지 않는다. UNRELIABLE 또는 NO_CONTACT 표기가 있는 원본은 보폭 추정에서 제외한다. device.synthetic는 가상 기기 판정 보조값이며 false라도 실측을 보증하지 않는다.

부팅 후 경과시간은 서로 다른 기기·재부팅 사이에 직접 비교하지 않는다. UTC는 고정된 시작 기준으로 계산하므로 측정 중 시스템 시계 변경으로 구간 길이를 바꾸지 않는다. BPM 변경을 걸치는 구간은 원본 시작·끝 시각과 이벤트를 함께 분석한다.

## 응답과 중복 방지

서버는 sessionId로 중복을 방지하고 기록을 영속 저장한 뒤 HTTP 200 또는 201을 반환한다. 같은 세션이 다시 들어오면 새로 생성하지 않고 기존 저장을 확인하여 같은 성공 응답을 반환한다.

```json
{"sessionId":"7d75ec55-5043-4caf-9a03-76db2c96f501","accepted":true}
```

202·리다이렉트·4xx/5xx·잘못된 JSON·ID 불일치·타임아웃은 전송 완료로 처리하지 않는다. 클라이언트는 리다이렉트를 따라가지 않는다. 응답 크기는 64KiB 이하이다. 연결·읽기·쓰기 제한과 전체 요청 제한은 각각 15초이며, 개별 제한 시간을 더해 60초를 기다리는 방식이 아니다. 결과가 불확실해도 같은 sessionId로 재전송한다.

완료·중단·실패 중 종료 시각이 확정된 기록만 보낼 수 있다. 중단·실패 세션은 endReason과 함께 정상 완료 데이터와 구분한다. 프로세스 종료 후 복구한 세션의 끝 시각은 마지막 저장 이벤트의 시각이며 실제 정지 시각을 보증하지 않는다.

## 연결과 인증

release는 HTTPS만 허용하고 debug는 로컬 테스트용 HTTP를 허용한다. URL 안의 사용자명·비밀번호·프래그먼트는 거부한다. 기본 외부 전송 주소나 고정 토큰은 없다. 인증 방식은 실제 서버가 정해진 후 별도 조정하며, 실제 실험 데이터를 받는 운영 API를 인증 없이 공개하지 않는다.
