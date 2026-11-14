# 서비스 만족도 조사 API

> **상태:** S15P31E105-813 사용자 확정(2026-11-14). 앱 사용 중 만족도(1~5점)와 선택 의견을 받는다. 관리자 화면·외부 설문 도구 연동·보상 지급은 범위 밖이다.
>
> 저장 테이블은 [ERD 서비스 만족도](../db/erd.md#서비스-만족도)를 따른다.

## API 목록

| ID | 제목 | Method | Path | 단계 | 인증 |
|---|---|---|---|---|---|
| [SV01](#sv01-만족도-응답-제출) | 만족도 응답 제출 | POST | `/satisfaction-surveys` | 1차 MVP | 회원 |

총 **1개** 공개 API. 기간 집계는 공개 API가 아니며 운영자가 아래 [응답 집계](#응답-집계) SQL로 조회한다.

## 공통 규칙

### 안내 시점과 주기 (앱)

- 앱은 개인 러닝을 마치고 기록 저장이 성공해 결과 화면이 열릴 때 만족도 조사 안내를 띄운다. 그룹런 결과 화면에서는 띄우지 않는다.
- 안내를 띄운 뒤 **제출하거나 닫으면 30일**, **나중에**를 고르면 **3일** 동안 다시 띄우지 않는다. 설정 화면에서 제출해도 30일 주기를 다시 시작한다.
- 주기는 기기에 회원별로 저장하며 서버는 노출 여부를 판단하지 않는다. 앱을 다시 설치하거나 다른 기기에서는 다시 안내될 수 있다.
- 설정 화면의 "만족도 조사"에서는 주기와 관계없이 언제든 제출할 수 있다.

### 제출 횟수와 재시도

- 같은 회원의 여러 번 제출을 허용한다. 중복 판정·멱등 키는 없다.
- 응답을 받지 못한 제출(네트워크 단절·시간초과)을 앱이 자동으로 다시 보내지 않는다. 사용자가 다시 제출하면 새 응답으로 저장된다.

### 탈퇴

회원 탈퇴(U18)는 응답 행과 의견을 그대로 보존한다(2026-11-14 사용자 결정). 앱의 만족도 조사 화면은 제출 전에 "회원 탈퇴 후에도 삭제되지 않고 보관"된다는 안내를 보여 준다(2026-11-14 사용자 결정). 탈퇴(진행) 회원의 남은 Access Token으로 들어온 제출은 저장하지 않고 `401 UNAUTHORIZED`다([회원탈퇴와 쓰기 경합](../db/erd.md#회원탈퇴와-쓰기-경합-s15p31e105-248)의 쓰기 차단 트리거).

---

## SV01 만족도 응답 제출

### 설명

로그인한 회원의 만족도 응답 한 건을 저장한다. 회원은 Access Token의 사용자로 정하며 요청 본문으로 받지 않는다.

### 인증 및 권한

`Authorization: Bearer <accessToken>` 필수.

### Request

```http
POST /api/v1/satisfaction-surveys
Content-Type: application/json
```

```json
{
  "score": 4,
  "comment": "코스 추천이 마음에 들어요.",
  "source": "RUN_RESULT"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `score` | integer | O | 전체 만족도. 1~5. JSON 정수만 받는다. 소수(`4.5`, `5.0`)·숫자 문자열(`"5"`)·불리언은 잘라 저장하지 않고 400 |
| `comment` | string \| null | X | 선택 의견. 앞뒤 공백(유니코드 공백·NBSP·폭 없는 공백 포함)을 제거하고 빈 문자열이면 `null`로 저장한다. 제거 후 최대 1000자이며 글자 수는 [H08](running-records.md#h08-기록-공유-링크-발급)·닉네임과 같이 **코드 포인트**로 센다(이모지 1개 = 1자, DB `VARCHAR(1000)`과 같은 기준). 줄바꿈·탭은 허용하고 그 밖의 제어 문자(C0·DEL·C1, NUL 포함)·짝이 맞지 않는 서로게이트는 400(`reason`: "1000자 이하로, 쓸 수 없는 문자 없이 입력해 주세요."). 문자열이 아닌 값은 400 |
| `source` | string | O | 제출 경로. `RUN_RESULT`(러닝 결과 화면 안내) 또는 `SETTINGS`(설정 화면 진입). 대소문자 구분 |

### Response

`201 Created`

```json
{
  "surveyId": 1,
  "score": 4,
  "comment": "코스 추천이 마음에 들어요.",
  "source": "RUN_RESULT",
  "submittedAt": "2026-11-14T01:23:45.123456Z"
}
```

| 필드 | 타입 | 설명 | SQL 대응 |
|---|---|---|---|
| `surveyId` | integer (int64) | 응답 ID | `satisfaction_survey_responses.id` |
| `score` | integer | 저장한 점수 | `score` |
| `comment` | string \| null | 공백 제거 후 저장한 의견. 없으면 `null` | `comment` |
| `source` | string | 제출 경로 | `source` |
| `submittedAt` | string (ISO 8601 UTC) | 서버가 기록한 제출 시각 | `created_at` |

### 오류

| HTTP | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `score` 누락·1~5 밖, `source` 누락·허용 외 값, `comment` 1000자 초과·허용하지 않는 문자. `details.fields[].name`에 필드 이름. 정수가 아닌 `score`(소수·숫자 문자열 포함)·문자열이 아닌 `comment`·깨진 JSON은 같은 코드이며 `details`가 비어 있다 |
| 401 | `UNAUTHORIZED` | 토큰 누락·만료·변조, 탈퇴(진행) 회원의 남은 토큰 |
| 503 | `SERVICE_UNAVAILABLE` | 같은 회원 행이 탈퇴·로그인·프로필 저장 등으로 잠긴 순간과 겹침(공통 처리). 저장되지 않았으므로 잠시 후 다시 제출 |

---

## 응답 집계

공개 API 없이 운영자가 DB에서 직접 조회한다. 아래 SQL이 정본이며 백엔드 `SatisfactionSurveyRepository.summarize`가 같은 쿼리를 실행해 통합 테스트로 검증한다.

기간 `[from, to)`(UTC, `to`는 포함하지 않음)의 응답 수와 평균 점수:

```sql
SELECT count(*) AS response_count, round(avg(score), 2) AS average_score
FROM satisfaction_survey_responses
WHERE created_at >= :from AND created_at < :to;
```

- 응답이 없으면 `response_count = 0`, `average_score = NULL`이다.
- 평균은 소수 둘째 자리 반올림이다.
- 응답 수 기준이다. 한 회원이 여러 번 제출하면 각각 한 건으로 센다. 회원 단위로 보려면 아래 응답자 기준을 쓴다.

응답자 기준(2026-11-14 사용자 결정). 기간 안에서 회원별 평균 점수를 먼저 구하고, 그 평균을 다시 평균 낸다. 여러 번 제출한 회원도 한 번만 반영된다. 백엔드 `SatisfactionSurveyRepository.summarizeByRespondent`가 같은 쿼리다.

```sql
SELECT count(*) AS respondent_count, round(avg(member_score), 2) AS average_score
FROM (
    SELECT user_id, avg(score) AS member_score
    FROM satisfaction_survey_responses
    WHERE created_at >= :from AND created_at < :to
    GROUP BY user_id
) members;
```

- 응답이 없으면 `respondent_count = 0`, `average_score = NULL`이다. 탈퇴한 회원의 응답도 같은 `user_id`로 묶인다.

일·주·월 단위로 나누어 볼 때(한국 시간 기준 월별 예). 이때 `:from`·`:to`도 **한국 시간 자정**으로 넣는다(예: 2026년 11월 = `'2026-11-01 00:00+09'` 이상 `'2026-12-01 00:00+09'` 미만). UTC 자정을 넣으면 첫 달 앞 9시간이 빠지고 다음 달 첫 9시간이 따로 한 줄로 나온다.

```sql
SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Seoul') AS period,
       count(*) AS response_count,
       round(avg(score), 2) AS average_score
FROM satisfaction_survey_responses
WHERE created_at >= :from AND created_at < :to
GROUP BY period
ORDER BY period;
```

`'month'`를 `'day'`·`'week'`로 바꾸면 일·주 단위다. 제출 경로별로 보려면 `GROUP BY period, source`를 쓴다.
