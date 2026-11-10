# API 명세 — 운동 준비도

[API 명세 색인](README.md)으로 돌아가기. 공통 규약은 [API 명세](README.md#공통-규약)를 따른다.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
|---|---|---|---|---|---|
| [R02](#r02-최신-준비도-조회) | 최신 준비도 조회 | GET | `/readiness-assessments/latest` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

**응답 해석:** R02는 S15P31E105-254에서 확정한 계약이다. 아래 Response 표의 필드만 구현 계약이며, "후속 필드" 표의 항목은 아직 계약이 아니다. `O`는 응답 객체가 있을 때 키를 항상 포함함을 뜻하며, 값의 NULL 허용은 타입의 ` / null`로 구분한다. 결과가 없는 경우는 오류 응답 절을 따른다.

daily_readiness는 readiness_score와 readiness_confidence(LOW/MEDIUM/HIGH, NULL 가능), 계산에 쓴 항목 점수(sleep_score·recovery_score·load_score)와 R 변화율(rhr_change_pct, 모두 NULL 가능, S15P31E105-639)을 저장한다. readinessLevel은 신뢰도와 다른 표시 값이며 등급 경계는 미정이다(후속). daily_health_metrics는 user_id와 기준 날짜로 대응하며 FK로 일일 건강 행을 직접 참조하지 않는다.

자료형·NULL의 정본은 [schema.sql](../db/schema.sql), 표시·관계 설명은 [ERD](../db/erd.md)를 따른다. ERD 정합성 단계에서는 API 종류·개수·역할·오류 응답을 유지했다. 후속 오류 검토 내용은 각 오류 응답 절을 따른다.

## 자동 평가 — 내부 필수 처리

**상태: S15P31E105-254 확정(2026-11-02).** 산식은 [러닝 준비도 1차 산식](../readiness-formula.md)을 따른다.

- 건강·활동 데이터가 수신·갱신되면 준비도를 자동 평가한다. 별도 공개 평가 요청 API는 두지 않는다.
- 오늘의 컨디션은 결과 표시이며 선택·입력 기능이 아니다. 건강 데이터가 부족해도 컨디션 입력으로 대체하지 않는다.
- R01은 공개 API에서 제외했으며 ID를 재사용하지 않는다. [자동 처리 요구사항](../requirements.md)를 따른다.

처리 순서:

1. W06이 `daily_health_metrics`를 저장·갱신한 날짜 목록을 `DailyHealthMetricsChangedEvent`로 알린다([W06 6항](devices-health.md)). 준비도 평가는 W06 트랜잭션 **커밋 후** 리스너가 받는다. 전부 duplicate·거절·롤백된 요청은 평가하지 않는다.
   - 러닝 부하 저장(S15P31E105-599)도 같은 이벤트를 발행한다. RunWay 러닝의 종료 후 분석이 READY로 커밋되거나 러닝이 삭제(S09)되면, 커밋 후 리스너가 부하 저장 전용 실행기(스레드 1개, 대기열 1,000건, 넘치면 건너뛰고 세션 ID 로그)에 넘기고, 실행기가 별도 트랜잭션에서 그 러닝의 부하를 저장·삭제하고 바뀐 일별 부하 날짜를 알린다. 세션은 부하 잠금 뒤 다시 읽는다. 삭제됐거나 심박이 없거나 건강정보 동의가 없으면 새로 저장하지 않고 기존 부하 행만 지운다(동의 철회 뒤 삭제한 러닝 포함). 탈퇴 회원은 처리하지 않는다(탈퇴 정리가 행을 지움). 잠금 순서는 회원 행 FOR SHARE → 회원별 부하 advisory lock(`599001`) → 일별 건강 행이며, 운동 요약이 든 W06도 같은 순서다. 실패는 세션 ID·예외 종류만 로그로 남기고 다시 시도하지 않는다. 산식은 [산식 5-1](../readiness-formula.md#5-1-zone-기준과-운동-부하-수집-s15p31e105-599-2026-11-10-사용자-결정)을 따른다.
2. 리스너는 DB를 쓰지 않고 평가를 준비도 전용 실행기(스레드 2개, 대기열 1,000건)에 넘긴 뒤 바로 돌아온다. W06 응답은 평가를 기다리지 않고, W06 요청은 자기 커넥션만 쓴다. 대기열이 차면 그 이벤트의 평가를 건너뛴다.
3. 평가 대상 날짜는 바뀐 날짜 D 전부와, D+1~D+7 중 건강 행이 있는 날짜다. D가 이후 날짜의 평소 RHR(이전 7일)에 들어가므로, 과거 값이 늦게 도착해도 이후 날짜 결과에 반영된다. 일별 부하(`daily_training_load`)가 바뀐 날짜는 이벤트의 `loadChangedDates`로 구분하며 D+1~D+27(부하 28일 창) 중 건강 행이 있는 날짜까지 평가한다(S15P31E105-599).
4. 날짜마다 별도 트랜잭션에서 평가한다. 평가 날짜는 W06 `metricDate`다(워치 심박은 워치 시간대 날짜, 삼성 헬스 안정 심박은 폰 시간대 날짜(S15P31E105-600), 수면은 폰 시간대 기상일(S15P31E105-572)).
   1. 같은 회원 평가를 회원별 advisory lock으로 한 줄로 세운다. 겹친 평가 중 나중 평가는 앞 평가 커밋 뒤의 최신 건강값을 읽으므로 오래된 값으로 계산한 결과가 최신 결과를 덮어쓰지 않는다.
   2. 회원 행을 FOR SHARE로 읽어 활성 회원·건강정보 동의(`health_data_access = AGREE`)를 확인한다. 아니면 평가하지 않는다. 진행 중인 동의 철회는 평가가 끝날 때까지 기다린다.
   3. D-27~D의 일별 건강값으로 [산식](../readiness-formula.md)을 계산한다. 계산 가능한 항목이 없으면 저장하지 않고 기존 결과를 그대로 둔다.
   4. `(user_id, readiness_date)`로 넣거나 갱신한다. 같은 날짜가 다시 바뀌면 같은 행의 점수·신뢰도를 갱신한다. 계산에 쓴 S·R·L 항목 점수와 R 변화율(`sleep_score`·`recovery_score`·`load_score`·`rhr_change_pct`, S15P31E105-639)도 같은 문장으로 넣거나 갱신하며, 제외된 항목은 NULL로 덮어쓴다.
5. 한 날짜의 평가 실패는 다른 날짜 평가와 W06 응답·저장에 영향을 주지 않는다. 실패·대기열 초과 로그에는 회원 ID·날짜·예외 종류만 남기고 건강값과 예외 메시지는 남기지 않는다. 이벤트가 재전달되지 않으므로 이 로그가 누락 평가를 찾는 근거다.

잠금 순서: 준비도 평가 advisory lock → 회원 행 FOR SHARE. W06은 회원 행 FOR SHARE만 잡는다. 회원 행을 갱신하는 기능(동의 철회·탈퇴 등)이 준비도 평가 advisory lock을 함께 잡게 되면 회원 행보다 먼저 잡아야 교착이 생기지 않는다.

정하지 않은 것(후속):

- 평가가 실패하거나, 대기열이 넘치거나, 서버가 종료 대기(10초)를 넘겨 중단되면 이벤트가 재전달되지 않는다. 같은 데이터 재전송은 duplicate라 다시 평가하지 않는다. 정기 재평가 등 누락 복구는 후속 업무에서 정한다.
- W06은 서버 UTC 기준 내일 날짜까지 받는다. `readinessDate`는 워치 시간대 날짜라, UTC보다 앞선 시간대(KST 등)에서는 UTC 날짜보다 하루 늦은 날짜가 최신 결과가 될 수 있다. 이는 정상 동작이며 R02는 날짜를 그대로 반환한다.

## R02 최신 준비도 조회

`GET` `/api/v1/readiness-assessments/latest`

| 항목 | 값 |
|---|---|
| 단계 | 1차 MVP |
| 인증 | 회원 |
| 관련 요구사항 | RDY-001~003 |
| 상태 | S15P31E105-254 확정(2026-11-02). 기준일 건강 지표는 S15P31E105-550 확정(2026-11-08). 주간 부하는 S15P31E105-599 확정(2026-11-10). 날짜별 부하·항목 점수는 S15P31E105-639 확정(2026-11-10). 등급은 후속 |

### 설명

자동 평가된 본인의 최신 준비도를 조회한다. 조회가 평가를 실행시키지는 않는다.

### 인증 및 권한

- 로그인한 활성 회원 본인의 결과만 조회한다. 다른 회원의 결과를 지정하는 입력은 없다.
- 건강정보 동의(`health_data_access = AGREE`)가 없으면 저장된 결과가 있어도 반환하지 않는다(403 `CONSENT_REQUIRED`).

### Path Parameters

없음

### Query Parameters

없음. 이전 초안의 `sessionId`는 의미가 정의되지 않아 254에서 제거했다.

### Request Body

없음

### Response

`200 OK`

```json
{
  "id": 101,
  "readinessScore": 94.38,
  "readinessDate": "2026-10-24",
  "readinessConfidence": "MEDIUM",
  "restingHrBpm": 58.40,
  "restingHrSource": "RUNWAY_WATCH",
  "sleepDurationMin": null,
  "healthUpdatedAt": "2026-10-24T21:05:12.345Z",
  "weeklyTrainingLoad": 410.00,
  "usualWeeklyTrainingLoad": 400.00,
  "dailyTrainingLoads": [
    { "date": "2026-10-18", "load": 120.00 },
    { "date": "2026-10-19", "load": null },
    { "date": "2026-10-20", "load": 95.50 },
    { "date": "2026-10-21", "load": null },
    { "date": "2026-10-22", "load": 104.25 },
    { "date": "2026-10-23", "load": null },
    { "date": "2026-10-24", "load": 90.25 }
  ],
  "sleepScore": null,
  "recoveryScore": 90.00,
  "loadScore": 98.75,
  "restingHrChangePct": 4.2
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|:---:|---|
| `id` | integer (int64) | O | `daily_readiness.id` |
| `readinessScore` | number | O | `daily_readiness.readiness_score` (0~100, 소수 둘째 자리) |
| `readinessDate` | string (YYYY-MM-DD) | O | `daily_readiness.readiness_date`. 워치 시간대 날짜다. 서버는 회원 시간대를 모르므로 오늘 결과인지는 클라이언트가 이 값으로 판단한다. |
| `readinessConfidence` | string / null | O | `daily_readiness.readiness_confidence`. 계산에 쓴 항목 수: HIGH 3 / MEDIUM 2 / LOW 1. 미산출은 null이며 키는 항상 포함한다. 준비도 등급이 아니다. |
| `restingHrBpm` | number / null | O | `readinessDate`와 같은 날짜의 본인 `daily_health_metrics.rhr_bpm`(bpm, 소수 둘째 자리). 행이나 값이 없으면 null |
| `restingHrSource` | string / null | O | 같은 행의 `rhr_source`. `RUNWAY_WATCH`(RunWay 워치 추정) 또는 `SAMSUNG_HEALTH`(삼성 헬스 심박으로 폰 계산, S15P31E105-600). `restingHrBpm`이 null이거나 출처 없이 저장된 값(W06 밖에서 넣은 값)이면 null |
| `sleepDurationMin` | number / null | O | 같은 행의 `sleep_duration_min`(분, 소수 둘째 자리). 행이나 값이 없으면 null. W06 `SAMSUNG_HEALTH` 수면(폰 시간대 기상일, S15P31E105-572)이 저장한 값이다 |
| `healthUpdatedAt` | string (ISO 8601 UTC) / null | O | 같은 행의 `updated_at`. 그 날짜 건강 행이 마지막으로 바뀐 시각이며 준비도 평가 시각(`assessedAt`, 후속)이 아니다. 행이 없으면 null |
| `weeklyTrainingLoad` | number / null | O | `readinessDate`를 D로 한 D-6~D 일별 부하 합(소수 둘째 자리, S15P31E105-599). D-27~D에 부하 값이 하루도 없으면 null. 값 없는 날은 0으로 더한다 |
| `usualWeeklyTrainingLoad` | number / null | O | 평소 주간 부하 = D-27~D 합 × 7 ÷ 이력 일수(7~28, [산식 7.2](../readiness-formula.md#72-경계와-보간)), 소수 둘째 자리(HALF_UP). `weeklyTrainingLoad`가 null이면 null. 창 안 부하가 모두 0이면(Zone1 미만 운동만) 두 값 모두 0이며, 이때 준비도 L 항목은 계산하지 않는다. 앱은 평소 값이 0이면 "평소 기록 없음"을 표시한다 |
| `dailyTrainingLoads` | array | O | `readinessDate`를 D로 한 D-6~D 7개 `{date, load}`, 날짜 오름차순(S15P31E105-639). 항상 7개다. `date`는 YYYY-MM-DD, `load`(number / null)는 그날 `daily_training_load`를 소수 둘째 자리로 줄인 값이며 행이나 값이 없는 날은 null이다(0으로 채우지 않는다). D-27~D에 부하가 없어 `weeklyTrainingLoad`가 null이면 7개 모두 null. 저장값은 소수 넷째 자리라, 각 날을 둘째 자리로 내린 뒤 남는 0.01을 버린 소수부가 큰 날부터(같으면 이른 날짜) 더하는 합 보존 반올림을 쓴다. 각 날의 오차는 0.01 미만이고 null이 아닌 `load` 합은 `weeklyTrainingLoad`와 같다. 앱은 null이면서 그날 러닝 기록이 있으면 "심박 없음", 없으면 "휴식"으로 구분한다 |
| `sleepScore` | number / null | O | 이 `readinessScore` 계산에 쓴 수면 항목 점수 S(0~100, 소수 둘째 자리, [산식 3절](../readiness-formula.md#3-수면-점수-s)). 계산에서 제외됐으면([산식 7.3](../readiness-formula.md#73-결측과-신뢰도)) null |
| `recoveryScore` | number / null | O | 회복 항목 점수 R(0~100, 소수 둘째 자리, [산식 4절](../readiness-formula.md#4-회복-점수-r)). 제외됐으면 null |
| `loadScore` | number / null | O | 훈련 부하 항목 점수 L(0~100, 소수 둘째 자리, [산식 5절](../readiness-formula.md#5-훈련-부하-점수-l)). 제외됐으면 null |
| `restingHrChangePct` | number / null | O | R 계산에 쓴 평소(D-7~D-1 측정일 평균) 대비 기준일 안정시 심박 변화율(%) = (오늘 × 일수 − 합) × 100 ÷ 합, 소수 첫째 자리 올림(+∞ 방향). R 구간 경계(3·5·8·12·15%, [산식 4절](../readiness-formula.md#4-회복-점수-r))를 표시값으로 판단해도 `recoveryScore`와 같도록 올림한다(예: +5.04%는 5.1이고 R은 80). 음수면 평소보다 낮다. R이 제외되면 null |

- "최신"은 본인 결과 중 `readinessDate`가 가장 늦은 1건이다. 오늘 날짜 필터를 두지 않는다.
- 점수만으로 날짜·신뢰도를 추측하지 않는다. 미산출 점수를 0으로 채우지 않는다.
- 주간 부하 두 값은 조회 시점의 일별 부하로 같은 SQL에서 계산한다. 점수(L 항목)와 같은 정의지만 평가가 끝나기 전이면 점수보다 최신일 수 있다. 앱은 비율(`weeklyTrainingLoad ÷ usualWeeklyTrainingLoad`)로 "평소 대비" 상태를 표시하며 값이 null이면 "최근 4주 심박 기록 운동 없음"을 표시한다.
- 항목 점수 3개와 `restingHrChangePct`는 자동 평가가 `readinessScore`와 같은 문장으로 저장한 값이다(S15P31E105-639, V30). 그래서 null이 아닌 항목 점수의 평균에 [산식 6-1절](../readiness-formula.md#6-1-최저-항목-기반-상한) 상한을 적용한 값(소수 둘째 자리)이 항상 `readinessScore`이고, null이 아닌 항목 수가 `readinessConfidence`(3 HIGH·2 MEDIUM·1 LOW)다. V30 이전에 저장된 결과는 네 값이 모두 null이며 그 날짜가 다시 평가되면 채워진다(소급 계산하지 않는다). 앱은 값이 없으면 해당 부분을 숨긴다.
- `dailyTrainingLoads`는 주간 부하 두 값과 같은 SQL에서 조회 시점 값으로 만든다. `loadScore`는 마지막 평가 시점 값이라 평가가 끝나기 전이면 막대가 점수보다 최신일 수 있다.
- 건강 지표 3개는 점수와 같은 기준일(`readinessDate`) 값만 반환한다. 다른 날짜 값으로 대체하지 않고, 미측정 값을 0으로 채우지 않는다(S15P31E105-550). 앱은 결과가 오늘 날짜가 아니면(오래된 평가) 이 지표를 오늘 값으로 표시하지 않는다.

후속 필드(이번 계약에 없음):

| 필드 | 보류 이유 |
|---|---|
| `readinessLevel` | 점수 구간별 표시 등급을 산식 설계에서 정리 중이다. `readinessConfidence`로 대체하지 않는다. |
| `reasonDetails` | 항목 점수는 S15P31E105-639에서 평면 필드(`sleepScore` 등)로 제공한다. 그 밖의 판단 요인 문구·구조는 정하지 않았다. |
| `assessedAt` | 독립 평가 시각 컬럼이 없다. `updated_at`을 평가 시각으로 치환할지 정하지 않았다. |
| `dataAvailability` | 데이터 부족 표시 구조가 정해지지 않았다. |

### 오류 응답

| HTTP·코드 | 오류 종류 | 발생 조건·주의사항 |
|---|---|---|
| `404 ASSESSMENT_NOT_FOUND` | 데이터 없음 | 본인 준비도 결과가 하나도 없음. 건강 데이터 부족·계산 전·계산 실패를 구분하지 않는다. |
| `401 UNAUTHORIZED` | 인증 | 토큰이 없거나 만료·위변조, 또는 활성 회원이 아님(탈퇴) |
| `403 CONSENT_REQUIRED` | 동의 | 건강정보 수집 동의가 없음(W06과 같은 코드) |

- 공통 서버 장애와 재시도 판단은 [오류 분류와 재시도 기준](README.md#오류-분류와-재시도-기준)을 따른다.
- 아직 없는 결과나 미측정 값을 0/false로 채우거나 클라이언트에 재평가 요청을 요구하지 않는다.

### 처리 규칙

- 활성 회원 동의 확인과 결과 조회를 한 읽기 트랜잭션에서 한다.
- 결과와 기준일 건강 행, 주간 부하·날짜별 부하는 한 SQL(`daily_readiness`에 같은 회원·같은 날짜 `daily_health_metrics`를 LEFT JOIN, 같은 회원의 D-27~D·D-6~D 부하를 하위 조회)로 읽는다. 동의가 없으면 결과·건강 행을 읽지 않는다.
- 동의 확인과 결과 조회는 잠그지 않는 별도 문장(READ COMMITTED)이라 그 사이에 동의 철회·탈퇴가 커밋될 수 있다. 결과 조회 문장에도 활성 회원·동의 조건을 두어 그 경우 행을 반환하지 않고, 결과가 없으면 동의를 다시 확인해 401·403을 404보다 먼저 응답한다(S15P31E105-550). 결과 조회 문장 이후에 커밋된 철회는 그 응답에 반영되지 않는다.
- 건강 지표는 조회 시점의 기준일 건강 행 값이고, 점수는 마지막 자동 평가 시점의 값이다. W06이 같은 날짜 값을 갱신한 뒤 평가가 끝나기 전이거나 평가가 누락되면(위 "정하지 않은 것") 지표가 점수 계산에 쓴 값보다 최신일 수 있다. 평가 시각(`assessedAt`)과 누락 재평가는 후속이다.
- 조회는 평가를 실행하지 않는다. 결과는 위 자동 평가가 만든다.

### 상태값

- `readinessConfidence`: HIGH / MEDIUM / LOW / null
