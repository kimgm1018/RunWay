# AI 개인화 ERD 반영 요청

관련 업무: S15P31E105-337
작성 기준일: 2026-11-03
대상: 백엔드·DB 담당
상태: 반영 범위 합의(MR !142 리뷰). `user_hr_personalization` migration은 아직 없습니다. dev의 V10은 `V10__user_recommendation_preferences.sql`이므로 번호(V11 이상)와 배포 일정은 팀이 정합니다.

## 요청 요약

AI 서비스는 개인화 계산 결과를 저장하지 않습니다. 백엔드가 AI06 응답을 받아 필요한 결과를 새 버전으로 저장해 주세요. AI 서비스는 `users.birth_date`와 `daily_health_metrics.rhr_bpm`을 읽지 않습니다. AI04와 AI09 개인 계획은 일반화 심박 기준과 `user_hr_personalization`에 저장된 학습 기준을 사용합니다.

## 개인화 migration 범위와 건강정보 동의 규칙

MR !142 리뷰 합의에 따라 개인화 migration에는 `user_hr_personalization`만 반영합니다. `user_gru_personalization`, 코스 난이도 테이블, `coaching_decisions` 컬럼 제안은 이 migration에 포함하지 않으며 필요 시 별도 진행합니다. 백엔드는 호출 직전 건강정보 동의 API(S15P31E105-250)에서 상태가 '동의'인 사용자만 AI 요청에 `userId`를 넣고, 철회·미동의 사용자는 생략합니다.

`docs/design/db/proposals/ai_personalization.sql`의 이름과 컬럼을 그대로 반영해 주세요. 팀 dev에 V10(`V10__user_recommendation_preferences.sql`)까지 있으므로 migration은 V11 이상이며, 번호는 팀이 정합니다. 현재 `schema.sql`과 Flyway 원본에는 변경을 요청하지 않습니다.

## AI가 읽는 테이블과 컬럼

아래 표에는 AI SQL에서 직접 조회하거나 행을 찾는 데 쓰는 컬럼을 모두 적었습니다. 개인화 표의 쓰기 주체는 AI06 계산 결과를 저장하는 백엔드입니다.

`user_gru_personalization` 행은 개인화 migration 반영 대상이 아니며 필요 시 별도 진행합니다. 현재 `GRU_PERSONALIZATION_ENABLED=false`가 기본이며, 꺼져 있을 때 AI06은 GRU 출력층 계산을 건너뛴다.

| 테이블 | 컬럼 | 타입 | NULL | 설명 | 누가 쓰나 | AI가 언제 읽나 |
| --- | --- | --- | :---: | --- | --- | --- |
| `user_hr_personalization` | `id` | BIGINT identity | 아니요 | ODE 개인화 행 ID | 백엔드 | 직접 읽지 않음 |
| `user_hr_personalization` | `user_id` | BIGINT FK → `users.id` | 아니요 | 회원 ID | 백엔드 | AI04 학습 기준과 AI09 개인 계획 행을 찾을 때 |
| `user_hr_personalization` | `personalization_version` | INTEGER | 아니요 | 회원별 개인화 버전, 1 이상 | 백엔드 | 회원의 최신 행을 고를 때 |
| `user_hr_personalization` | `schema_version` | VARCHAR(80) | 아니요 | ODE 개인화 JSON 형식 버전 | 백엔드 | AI가 ODE 입력 형식을 확인할 때 |
| `user_hr_personalization` | `model_version` | VARCHAR(160) | 아니요 | 계산에 쓴 ODE 모델 버전 | 백엔드 | ODE 모델과 저장 결과의 호환성을 확인할 때 |
| `user_hr_personalization` | `support_run_count` | INTEGER | 아니요 | 계산에 쓴 Support 러닝 수 | 백엔드 | AI가 계획 응답을 만들 때 |
| `user_hr_personalization` | `summary_u_json` | JSONB | 아니요 | ODE 개인 요약 벡터 | 백엔드 | AI09 개인 계획을 계산할 때 |
| `user_hr_personalization` | `history8_json` | JSONB | 아니요 | ODE 개인 이력 입력 | 백엔드 | AI09 개인 계획을 계산할 때 |
| `user_hr_personalization` | `p4_json` | JSONB | 아니요 | Support에 맞춘 ODE 개인 적합 값 | 백엔드 | AI09 개인 계획을 계산할 때 |
| `user_hr_personalization` | `hr0_sub_bpm` | NUMERIC(7,2) | 아니요 | Support 시작 심박 중앙값 | 백엔드 | AI09 ODE 계획 입력을 만들 때 |
| `user_hr_personalization` | `hr_ref_bpm` | NUMERIC(7,2) | 예 | 기존 ODE 입력용 HR reference. 학습 위험·지속 기준과 별도 | 백엔드 | 기존 ODE 계획 입력을 만들 때 |
| `user_hr_personalization` | `hr_danger_bpm` | NUMERIC(7,2) | 예 | GOOD 심박 분포의 개인 P98 원값(35~220). AI04가 모집단 값과 섞은 뒤 +3 bpm을 더해 위험 기준으로 쓰므로, 저장 값에는 더하지 않는다 | 백엔드 | AI04와 AI09에서 최신 학습 기준을 만들 때 |
| `user_hr_personalization` | `hr_sustain_bpm` | NUMERIC(7,2) | 예 | GOOD 심박 분포의 P85 지속 기준(35~220) | 백엔드 | AI04와 AI09에서 최신 학습 기준을 만들 때 |
| `user_hr_personalization` | `hr_threshold_run_count` | INTEGER | 예 | 기준 계산에 사용한 최근 러닝 수(0~20, DB CHECK `BETWEEN 0 AND 20`, AI 코드 검증과 같음) | 백엔드 | AI04와 AI09의 혼합 비중을 정할 때 |
| `user_hr_personalization` | `created_at` | TIMESTAMPTZ | 아니요 | 생성 시각 | DB 기본값 | 최신 행 확인·운영 감사 때 |
| `user_gru_personalization` | `id` | BIGINT identity | 아니요 | GRU 개인화 행 ID | 백엔드 | MVP 이후 선택 기능. 현재 기본 OFF |
| `user_gru_personalization` | `user_id` | BIGINT FK → `users.id` | 아니요 | 회원 ID | 백엔드 | MVP 이후 AI03·AI04 개인화에서 행을 찾을 때 |
| `user_gru_personalization` | `personalization_version` | INTEGER | 아니요 | 회원별 GRU 개인화 버전, 1 이상 | 백엔드 | MVP 이후 AI03·AI04가 최신 GRU 행을 고를 때 |
| `user_gru_personalization` | `schema_version` | VARCHAR(80) | 아니요 | 현재 `runway.gru.head.v1` | 백엔드 | MVP 이후 AI03·AI04가 head 형식을 확인할 때 |
| `user_gru_personalization` | `model_version` | VARCHAR(160) | 아니요 | 계산에 쓴 GRU 모델 버전 | 백엔드 | 감사와 운영 확인 때 |
| `user_gru_personalization` | `model_sha256` | CHAR(64) | 아니요 | 계산에 쓴 체크포인트 SHA-256 | 백엔드 | MVP 이후 AI03·AI04가 현재 모델과 같은 파일인지 확인할 때 |
| `user_gru_personalization` | `support_run_count` | INTEGER | 아니요 | 출력층 계산에 쓴 Support 러닝 수 | 백엔드 | 운영 확인 때 |
| `user_gru_personalization` | `support_window_count` | INTEGER | 아니요 | 채점 가능한 Support window 수 | 백엔드 | 운영 확인 때 |
| `user_gru_personalization` | `head_json` | JSONB | 아니요 | `main`, `nograde` 각각의 `weight` `[3,256]`와 `bias` `[3]` | 백엔드 | MVP 이후 GRU 개인화가 켜졌을 때 읽음 |
| `user_gru_personalization` | `created_at` | TIMESTAMPTZ | 아니요 | 생성 시각 | DB 기본값 | 최신 행 확인·운영 감사 때 |
| `users` | `id` | BIGINT identity | 아니요 | 회원 ID | 백엔드 | AI가 직접 읽지 않음 |
| `users` | `birth_date` | DATE | 아니요 | 회원 생년월일 | 백엔드 | AI가 읽지 않음. 나이 공식은 기준 계산에서 제거 |
| `daily_health_metrics` | `user_id` | BIGINT FK | 아니요 | 회원 ID | 워치 동기화 백엔드 | AI가 읽지 않음 |
| `daily_health_metrics` | `metric_date` | DATE | 아니요 | 건강 지표 기준일 | 워치 동기화 백엔드 | AI가 읽지 않음 |
| `daily_health_metrics` | `rhr_bpm` | NUMERIC(7,2) | 예 | 워치가 저장한 심박 추정값 | 워치 동기화 백엔드 | AI가 읽지 않음. RHR·Karvonen 기준에서 제거 |
| `courses` | `id` | BIGINT identity | 아니요 | 코스 ID | 백엔드 | AI09 개인 계획이 코스를 찾을 때 |
| `courses` | `distance` | NUMERIC(12,2) | 아니요 | 코스 거리(m) | 백엔드 | AI가 계획 구간을 만들 때 |
| `courses` | `elevation_profile` | JSONB | 예 | 고도 프로파일 | 백엔드 | AI가 저장된 경사 구간이 없을 때 경사를 계산할 때 |
| `courses` | `status` | `courses_status_enum` | 아니요 | 코스 상태 | 백엔드 | AI가 ACTIVE 코스만 사용할 때 |
| `courses` | `updated_at` | TIMESTAMPTZ | 아니요 | 코스 갱신 시각 | DB 기본값·백엔드 | 계획 입력 버전을 만들 때 |
| `running_sessions` | `user_id`, `status`, `deleted_at`, `ended_at`, `id` | 기존 컬럼 | — | 회원·완료 여부·삭제·종료 시각 | 백엔드 | AI09 속도 보정 v_ref용 러닝을 고를 때(완료·미삭제·계획 시각 이전 종료, 최근 20회). S15P31E105-402 |
| `running_sessions` | `total_distance`, `moving_duration`, `elapsed_duration` | 기존 컬럼 | 예 | 러닝 거리(m)·이동 시간(초)·경과 시간(초) | 백엔드 | v_ref = `total_distance / moving_duration` 중앙값. 0·NULL·0.5~8.0 m/s 밖·2시간 초과는 제외 |

### `running_sessions` 읽기 권한 (S15P31E105-402)

AI09 속도 보정은 새 컬럼 없이 기존 `running_sessions`를 읽기만 한다. AI CD(`Jenkinsfile.ai-cd`)가 실행하는 `infra/ai/grant-readonly.sh`가 개인화 테이블 대기 루프에 들어가기 전에 아래 권한을 바로 주고, SELECT 가능·INSERT/UPDATE/DELETE/TRUNCATE 불가를 확인한다. `running_sessions`는 V1부터 있으므로 기다리지 않는다. 백엔드·DB 변경은 필요 없습니다.

```sql
GRANT SELECT ON public.running_sessions TO runway_ai;
```

권한이 없는 환경(예: 이 스크립트를 실행하기 전)에서는 AI09가 조회 실패를 계획 오류로 만들지 않고 Train 기본 v_ref(3.4704 m/s)와 경고 `SPEED_REF_LOOKUP_UNAVAILABLE`로 계속 응답한다. 조회는 `userId`가 있는 동의 사용자만, 바인딩 파라미터로 한다.

## 저장 규칙 제안

- AI06은 기존 ODE `personalization`과 학습 심박 필드(`hrDangerBpm`, `hrSustainBpm`, `hrThresholdRunCount`)를 반환합니다. 백엔드는 세 기준 필드를 `user_hr_personalization`의 새 컬럼에 받은 그대로 저장해 주세요. `hrDangerBpm`은 +3 전 개인 P98 원값입니다(위험 기준 = 섞은 P98 + 3은 AI04가 계산).
- GRU 개인화(`gruPersonalization`)는 MVP에서 기본 OFF입니다. `null`과 `GRU_PERSONALIZATION_DISABLED`가 오면 저장하지 않습니다. `user_gru_personalization`과 C11·C12는 개인화 migration 범위 밖이며 필요 시 별도 진행합니다.
- 개인화 버전은 테이블별·회원별로 독립 증가시킵니다. 새 계산 결과를 저장할 때 이전 행을 덮어쓰지 말고, 트랜잭션 안에서 다음 버전을 배정해 행을 추가해 주세요. `(user_id, personalization_version)` 유일 제약으로 중복 저장을 막습니다.
- 최신 행 조회 인덱스는 따로 만들지 않습니다. AI는 두 테이블 모두 `WHERE user_id = ? ORDER BY personalization_version DESC LIMIT 1`로 읽고, 이 조회는 위 유일 제약의 인덱스를 PostgreSQL이 역방향으로 읽어 처리합니다. `(user_id, personalization_version DESC)` 인덱스를 따로 두면 중복이고, 이전 초안의 `(user_id, created_at DESC)` 인덱스는 조회 순서와 달라 쓰이지 않아 뺐습니다.
- `gruPersonalization`이 `null`이면 GRU 행을 만들지 않습니다. 나중에 기능을 켠 경우에도 `GRU_PERSONALIZATION_NO_SUPPORT_WINDOWS` 경고를 저장 여부 판단에 확인해 주세요.
- AI03·AI04는 개인화 조회가 실패해도 기본 GRU 예측으로 계속 진행합니다. 개인 계획은 기존 오류 계약을 유지하며 DB 오류가 나면 503을 반환합니다.
- AI04 `context.hrReference`는 선택 입력이며, 보내도 학습 기준에 쓰지 않고 `HR_REFERENCE_INPUT_IGNORED`를 반환합니다. 응답 `pacing`에는 `hrDangerBpm`(섞은 P98 + 3, 일반화만이면 178), `hrSustainBpm`, `hrThresholdSource`, `hrThresholdWeight`가 옵니다. 이 입력·응답 계약을 C13으로 합의해 주세요.

## 경사 저장 형식은 별도 결정 필요

`courses.elevation_profile`의 현재 타입은 JSONB지만, AI가 코스 경사를 구간별로 읽는 저장 구조와 구간 길이는 아직 정하지 않았습니다. 내일 백엔드·DB 담당과 JSON 모양, 구간 경계·단위, 코스 변경 시 재계산 규칙을 결정해 주세요. AI 쪽 연결 위치는 `ai/service/app/db_lookup.py`의 `COURSE_SQL`, `DbCourseLookup` 및 경사 변환 함수입니다.

개인화 테이블 이름이나 컬럼을 바꾸면 AI 쪽 `ai/service/app/db_lookup.py`의 `PERSONALIZATION_TABLE`, `PERSONALIZATION_COLUMNS`, `PERSONALIZATION_SQL`, `GRU_PERSONALIZATION_TABLE`, `GRU_PERSONALIZATION_COLUMNS`, `GRU_PERSONALIZATION_SQL` 상수와 `ai/service/app/gru_personalization.py`의 행 변환 검사를 함께 바꿔야 합니다. SQL 이름을 바꿀 때는 관련 조회 테스트와 AI 서비스 문서도 갱신해 주세요.

## 개인정보 처리

원본 HR·속도·경사 시계열은 개인화 테이블에 저장하지 않습니다. GRU 테이블에는 모델 출력층의 작은 수치 묶음과 계산 메타데이터만 저장합니다. AI 서비스는 원본 Support 샘플을 로그에 남기지 않습니다.
