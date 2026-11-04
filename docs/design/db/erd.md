# RunWay ERD 설명서

기준: 2026-11-03 · ERD ver.3 · **29개 테이블 / 270개 컬럼 / 52개 FK**

회원이 러닝을 준비하고 기록한 결과를 코스·크루·게시글로 연결하는 데이터 구조다. 이 문서는 팀원이 구조와 정책을 빠르게 파악하기 위한 요약이다. 전체 컬럼·타입·NULL 정의는 SQL을 기준으로 확인한다.

## 1. 기준 파일

| 파일 | 용도 |
| --- | --- |
| [schema.sql](schema.sql) | 전체 테이블·컬럼·PK·FK 정의 |
| [erd.png](erd.png) | 전체 테이블과 관계 이미지 |

전체 테이블과 관계는 [온라인 ERD](https://www.erdcloud.com/d/PMb4s6pJDYReQLMMd)에서도 확인할 수 있다. ID 자동 생성·UNIQUE·CHECK·복합 FK·트리거의 정확한 정의는 SQL과 본문을 따른다. 코스 지역 FK는 후행 ALTER 제약으로 정의한다. SQL은 PostgreSQL 17·PostGIS 3.6의 빈 격리 DB에서 검증하는 기준 스키마다. 서비스용 Flyway 마이그레이션과 구분하며 기존·공유·운영 DB에 직접 적용하지 않는다. 마이그레이션 적용·롤백 조건은 [백엔드 실행 안내](../../../backend/README.md#세션-제어-스키마-v3)를 따른다.

## 2. 테이블별 역할

### 인증 저장소 경계

[ADR-0015](../../adr/0015-redis-refresh-token-store.md)에 따라 사용자·비밀번호 해시·러닝 프로필은 아래 PostgreSQL 모델에 저장하고, Refresh Token 해시·로그인 계열·사용 및 폐기 상태·교체 이력은 Redis에 저장한다. 갱신 권한용 PostgreSQL 테이블을 추가하지 않으며 이 결정 자체로는 SQL·테이블 수를 늘리지 않는다. 승인된 계열 Hash·사용자 ZSET 인덱스의 키·필드·절대 만료·원자적 처리 및 복구 모델은 [인증 API의 갱신 권한 저장소](../api/users.md#갱신-권한-저장소)를 따른다. 실제 Redis 실행·권한·영속 볼륨 설정은 [백엔드 실행 안내](../../../backend/README.md#8-로그인과-redis)를 따른다.

[ADR-0017](../../adr/0017-redis-login-attempt-store.md)에 따라 193번의 아이디별 로그인 실패 횟수·잠금 상태도 기존 인증용 Redis에 저장한다. 미가입 아이디도 동일하게 집계하며 users 외래키나 실패 제한용 PostgreSQL 테이블·컬럼을 추가하지 않는다. 1~4회 기록의 24시간 만료, 5번째 실패 후 10분 잠금, 성공 초기화 시점과 데이터 유실 복구 예외는 [로그인 연속 실패 제한](../api/users.md#로그인-연속-실패-제한)을 따른다. 이번 결정으로 schema.sql과 기존 마이그레이션을 변경하지 않으며 Redis 실행·검증 방법은 [백엔드 실행 안내](../../../backend/README.md#8-로그인과-redis)를 따른다.

### 회원·기기·건강

| 테이블 | 역할과 주요 연결 |
| --- | --- |
| `users` | 회원·로그인 정보. 개인 활동의 기준 ID |
| `user_profiles` | 회원의 러닝 수준·평소 페이스·기준 거리/시간. 이번 러닝 목표와 구분 |
| `user_recommendation_preferences` | U11/U12 추천 기본값. 회원당 최대 1행, 명시적 저장 시 생성·전체 교체 |
| `user_settings` | 코칭·알림 사용 여부, 위치 수집 모드, 계정의 기록 공개 범위 |
| `user_devices` | 회원의 PHONE/WATCH 연결 관계와 연결·해제 시각 |
| `daily_health_metrics` | 회원·날짜별 수면, 안정시 심박, 운동 부하 등의 건강 요약 |
| `daily_readiness` | 회원·날짜별 준비도 점수와 분석 신뢰도 |

#### user_recommendation_preferences — 추천 기본값 (설계 S15P31E105-386 / 구현 S15P31E105-245, 2026-11-03 확정)

| 컬럼 | 타입·제약 | 용도 |
| --- | --- | --- |
| id | BIGINT GENERATED ALWAYS AS IDENTITY PK | 설정 행 자체의 자동 생성 식별자 |
| user_id | BIGINT NOT NULL, UNIQUE, FK users.id | 사용자당 최대 1행. 물리 삭제 시 ON DELETE CASCADE |
| shape | VARCHAR(16) NOT NULL DEFAULT 'loop', CHECK | loop / out_and_back / point_to_point |
| river / beach / park / trail / pedestrian / flat | BOOLEAN NOT NULL DEFAULT false | 강변 / 해변·바다 / 공원·녹지 / 산책로·트레일 / 보행로 / 평지 위주 선호 |
| avoid_major_road / avoid_steps / avoid_tunnel | BOOLEAN NOT NULL DEFAULT false | 큰길 / 계단 / 터널 회피 |

- API의 filters 객체는 위 9개 컬럼에 일대일 대응한다. false는 모두 ‘고려하지 않음’이다.
- 가입·조회에서는 행을 만들지 않는다. 미설정 조회는 loop와 모든 조건 false를 반환한다. ‘이 조건을 기본값으로 저장’ 선택 시에만 최초 생성하거나 전체 교체한다.
- user_profiles와 독립적이다. 위치·거리·seed·추가 추천 횟수·버전 컬럼을 저장하지 않는다.
- 최초 생성부터 사용자별 저장을 직렬화하고 마지막으로 커밋된 요청의 전체 값을 유지한다. 동일 값 재요청은 성공 처리하며 부분 반영하지 않는다.
- 회원탈퇴 시 삭제한다. users의 WITHDRAWN 전환만으로 FK 삭제가 발생하지 않으므로 논리 탈퇴 서비스가 명시적으로 삭제해야 한다. 탈퇴와 저장의 직렬화·계정 상태 확인으로 재생성을 방지한다.
- 조회·입력·오류·재요청 계약은 [U11·U12](../api/users.md#u11-추천-기본값-조회)를 따른다.
- 기준 SQL만 반영한 상태다. 서비스용 Flyway 마이그레이션과 API 구현은 후속 구현 단계에서 추가한다. erd.png는 2026-11-04 기준 SQL의 29개 테이블·270개 컬럼·52개 FK를 반영했다. 온라인 ERD에는 이 테이블이 아직 반영되지 않았다.

#### daily_health_metrics — 날짜별 건강 요약

`(user_id, metric_date)`로 회원·날짜당 한 행이다. 현재 W06이 채우는 값은 `rhr_bpm`뿐이다.

| 컬럼 | 타입·NULL | 용도 |
| --- | --- | --- |
| rhr_bpm | NUMERIC(7,2) NULL | 안정시 심박(bpm). W06은 삼성 헬스 공식 안정 시 심박이 아니라 RunWay 워치 일상 측정 최근 24시간 추정치(`ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2`)를 저장한다 |
| rhr_revision | INTEGER NULL | `rhr_bpm` 추정값의 revision. 1 이상(CHECK). 같은 날짜는 저장된 값보다 큰 revision만 갱신하며 미저장이면 NULL(S15P31E105-252, V9) |

수면·운동 부하·최대 심박은 아직 받는 API가 없어 NULL이다. 저장·순서 역전 처리는 [기기·건강 API W06](../api/devices-health.md#w06-samsung-health-데이터-동기화)을 따른다.

### 러닝·페이스 코칭

| 테이블 | 역할과 주요 연결 |
| --- | --- |
| `running_sessions` | 한 회원의 한 번의 러닝. 초기 목표·상태·실제 결과. course_id가 없으면 자유러닝 |
| `running_metric_samples` | 세션별 측정 시점의 심박·케이던스·속도·누적 거리 등 |
| `running_route_points` | 세션별 측정 시각과 GPS 위치·정확도·고도 |
| `running_session_splits` | 종료 후 1km 단위 실측 구간 집계(H03). 원본 샘플에서 한 번 계산해 덮어써 저장 |
| `sync_batches` | 기기에서 받은 배치의 식별·해시·수신/반영 상태 |
| `session_control_events` | 시작·일시정지·재개·종료·수동/AI BPM 명령과 실제 결과, 명령 중복 판정 |
| `pace_plans` | 세션의 초기 권장 페이스·BPM |
| `pace_plan_segments` | 초기 페이스 계획의 거리 구간별 권장 페이스 |
| `coaching_decisions` | 러닝 도중의 권장 페이스·BPM·미래 심박 예측 |

#### running_session_splits — 종료 후 구간 집계

| 컬럼 | 타입·NULL | 용도 |
| --- | --- | --- |
| id | BIGINT IDENTITY PK | 러닝 구간 ID. 세션 내 조회는 `running_session_id`와 함께 사용 |
| running_session_id | BIGINT NOT NULL FK | `running_sessions.id` |
| start_distance | NUMERIC(12,2) NOT NULL | 구간 시작거리(m). 세션마다 `(running_session_id, start_distance)` UNIQUE |
| end_distance | NUMERIC(12,2) NOT NULL | 구간 종료거리(m). 시작보다 커야 함 |
| pace | NUMERIC(10,2) NULL | 구간 페이스(초/km). H03 `paceSecPerKm`. 불가 시 NULL |
| average_heart_rate | NUMERIC(7,2) NULL | 구간 평균 심박(bpm). 미측정 NULL |
| average_cadence | NUMERIC(8,2) NULL | 구간 평균 케이던스(spm). 미측정 NULL |

계획 구간(`pace_plan_segments`)과 분리한다. 조회(H03)는 이 테이블만 읽고, 원본 재계산은 하지 않는다. 분석 완료 시 해당 세션 행을 삭제한 뒤 다시 넣는 방식으로 덮어쓴다.

#### running_sessions — 현재 상태와 제어기기

| 컬럼 | 타입·기본값 | 용도 |
| --- | --- | --- |
| control_device_id | BIGINT/null | 현재 제어기기. 시작은 워치, 인계 후 기존 중계 폰. user_devices 참조 |
| relay_device_id | BIGINT/null | 중계 폰, user_devices 참조 |
| state_version | BIGINT NOT NULL, 기본값 1 | 목표·운동 상태·BPM에 공통으로 쓰는 단일 버전 |
| current_bpm | INTEGER/null, 60~220 | 실제 현재 BPM. READY/PAUSED에서는 값을 보존하되 소리를 재생하지 않음 |
| analysis_status | running_sessions_analysis_status_enum NOT NULL, PENDING | 현재 결과 준비 상태만 표시. PENDING/PROCESSING/READY/FAILED/LEGACY |

목표·상태·BPM은 하나의 `state_version`을 공유한다. 초기 페이스 계획은 `pace_plans`에 저장한다. 폰으로 기록을 인계하면 `control_device_id`를 `relay_device_id`로 바꾸며, API의 `recordingMode`는 두 ID의 일치 여부로 계산한다. 별도 모드·인계 컬럼은 두지 않는다. 회원별 활성 세션(READY/RUNNING/PAUSED, `state_version`≥1, 미삭제)은 하나만 허용하며 부분 UNIQUE `uq_running_sessions_active`(V8)로 보장한다. 기존 기록(`state_version`=0)은 제외한다.

#### session_control_events — 제어 명령과 실행 결과

| 컬럼 | 타입·NULL | 용도 |
| --- | --- | --- |
| id | BIGINT IDENTITY PK | 서버 발급 commandId. 클라이언트 UUID 불필요 |
| session_id | BIGINT NOT NULL FK | 대상 세션 |
| device_id | BIGINT NOT NULL FK | 실제 실행기기. 워치 기록은 WATCH, 폰 인계 후는 PHONE. 둘 다 REQUEST/RESULT 사용 |
| action | session_control_events_action_enum NOT NULL | START/PAUSE/RESUME/END/SET_BPM/COACHING |
| target_bpm | INTEGER/null | BPM/코칭 명령의 절대 목표값, 60~220 |
| expected_version | BIGINT NOT NULL, ≥1 | 요청이 기준으로 삼은 단일 세션 버전 |
| coaching_id | BIGINT/null | COACHING일 때만 해당 세션 추천 참조 |
| result | session_control_events_result_enum NOT NULL, PENDING | PENDING/APPLIED/REJECTED/IGNORED/UNKNOWN |
| applied_at | TIMESTAMPTZ/null | APPLIED일 때만 실제 적용 시각 |
| reason_code | VARCHAR(64)/null | 미적용·거절·미확인 사유. 사유 없으면 null |
| created_at | TIMESTAMPTZ NOT NULL, now() | 서버 명령 생성 시각 |

워치 준비 결과는 이 테이블에 저장하지 않는다. 워치와 인계받은 폰 모두 승인 요청(REQUEST) 후 실행 결과(RESULT)를 확정한다. 명령 중복·미확인 결과 처리는 7장의 제약과 [세션 제어 공통 계약](../api/sessions.md#세션-제어-공통-계약)을 따른다.

#### coaching_decisions — 코칭의 기준 버전과 유효기간

| 컬럼 | 타입·NULL | 용도 |
| --- | --- | --- |
| based_on_state_version | BIGINT/null, 값이 있으면 ≥1 | 계산 기준 세션 버전 |
| expires_at | TIMESTAMPTZ/null | 적용 만료 시각 |

`created_at`은 생성 시각이고, `expires_at`은 적용 가능한 마지막 시각이다. 신규 코칭은 기준 버전과 만료 시각을 함께 채운다. 자동 적용 조건은 [페이스 코칭 API](../api/pace-coaching.md)를 따른다.

#### sync_batches — 배치 식별자와 해시

`client_batch_id`는 UUID이며, 서버 행 ID·세션 ID·명령 ID는 BIGINT다. W07 요청의 `id`와 응답의 `batchId`는 같은 배치 식별자를 JSON UUID 문자열로 전달한다.

기존 `payload_hash`를 유지한다. 재전송 본문과 ACK는 원래 요청의 UUID 문자열 표기를 유지하며, DB의 UUID 표준 출력으로 본문이나 해시 입력을 다시 작성하지 않는다. 저장·중복·ACK 계약은 [기기·건강 API](../api/devices-health.md)를 따른다.

### 코스·크루·그룹런

| 테이블 | 역할과 주요 연결 |
| --- | --- |
| `courses` | 여러 러닝에서 재사용하는 공용 경로·출발점·거리·지역·상태 |
| `course_environment_tags` | 코스의 환경 코드. PARK/RIVERSIDE/URBAN/BEACH/TRACK |
| `course_bookmarks` | 회원의 코스 저장 관계와 개인 별칭 custom_name |
| `crews` | 지속적인 모임. 크루장·정원·지역·활성 상태 |
| `crew_memberships` | 크루 가입 요청·승인·거절·탈퇴 관계 |
| `group_runs` | 크루에서 여는 개별 러닝 일정·호스트·공동 목표. 코스는 선택 |
| `group_run_participants` | 그룹런 참가 회원과 개인 러닝 세션 연결. 대기방 준비 여부(`ready`) 포함 |

### 지역·커뮤니티·알림

| 테이블 | 역할과 주요 연결 |
| --- | --- |
| `regions` | 지역 코드와 시·도/시·군·구 이름 |
| `posts` | 회원의 러닝 기록 공유 게시글. session_id는 필수 |
| `comments` | 게시글 댓글. parent_comment_id가 없으면 일반 댓글, 있으면 대댓글 |
| `post_likes` | 회원과 게시글의 좋아요 관계 |
| `user_follows` | 팔로우 요청/성립 관계와 승인 여부 |
| `notifications` | 수신 회원·메시지·발송/읽음 상태·알림 종류·클릭 이동 대상 |

## 3. 핵심 관계와 데이터 흐름

- **개인 러닝:** 회원 → 러닝 세션 → 측정값·GPS 경로·초기 계획·코칭 판단·종료 후 구간 집계(`running_session_splits`). 최초 목표와 AI가 조정하는 안내 페이스를 구분한다.
- **세션 제어:** 세션의 현재 제어기기와 중계 폰은 각각 `user_devices`를 참조한다. 제어 기록은 세션·실행기기에 연결되며, 코칭 명령은 `(session_id, coaching_id)` 복합 FK로 같은 세션의 코칭만 참조한다.
- **코스 등록:** 완료된 본인 세션의 경로를 코스로 등록하고, 이후 여러 세션과 북마크가 같은 코스를 참조한다. 코스 원본과 회원별 북마크는 별개다.
- **그룹런:** 크루 → 그룹런 → 참가 관계 → 각 참가자의 개인 세션. 그룹 전체 종료와 개인 러닝 종료는 별개다. 참가 시점에는 개인 세션이 없어도 된다.
- **기록 공유:** 회원 → 게시글 → 연결 러닝 세션. 댓글·좋아요가 게시글에 연결된다. 현재 posts에는 독립 post_type·title·course_id 컬럼이 없다.
- **지역:** 코스·크루·게시글의 region_code는 regions.region_code를 FK로 참조한다. regions.region_code는 UNIQUE이며, 존재하지 않는 지역 코드 저장을 막는다. 코스 지역 미판정 상태의 NULL은 허용한다.

모든 테이블의 PK는 `BIGINT GENERATED ALWAYS AS IDENTITY`다. DB가 값을 생성하며 PK 직접 지정은 기본 거부한다. FK 타입은 BIGINT를 유지한다. ID의 빈 번호는 정상이며 시각·원본 순서를 ID만으로 판단하지 않는다. 아래 UNIQUE로 회원별 단일 행과 관계 중복을 방지한다.

## 4. 확정된 표시·접근 정책

### 코스 이름

`courses.region_code`로 `regions`를 조회해 **시·도명 + 시·군·구명 + 코스**로 표시한다. 예: `부산광역시 해운대구 코스`.

공통 courses.name은 추가하지 않는다. 개인 별칭은 course_bookmarks.custom_name이다. 지역 코드는 출발 좌표로 판정하며 판정 전/실패 시 NULL을 허용한다. 좌표를 행정구역으로 바꾸는 로직/자료와 지역 미지정 시 대체 표시명은 별도 구현·정책 사항이다.

### 팔로우와 비공개 기록

`user_follows.follower_id`는 팔로우하는 회원, `followee_id`는 팔로우받는 회원이다. `is_approved BOOLEAN NOT NULL DEFAULT FALSE`를 사용한다.

| 팔로우받는 회원의 account_visibility | 요청 처리 |
| --- | --- |
| PUBLIC | 별도 승인 없이 is_approved=TRUE로 생성하여 즉시 성립 |
| PRIVATE | FALSE로 요청 저장. 상대가 승인하면 TRUE로 변경 |

TRUE인 관계만 팔로워·팔로잉 목록과 인원 집계에 포함한다. 비공개 기록은 **본인 또는 follower_id=열람자, followee_id=기록 소유자, is_approved=TRUE인 회원**만 열람한다. 미승인 요청과 반대 방향 관계는 열람 근거가 아니다. 승인/즉시 성립과 조회 권한 검사는 서비스에서 수행한다.

account_visibility와 location_collection_mode는 **NOT NULL**이다. 설정 행 생성 시 각각 PUBLIC/PRIVATE 및 ALWAYS/RUNNING_ONLY/OFF 중 값을 명시한다. 2026-10-28 가입 U15 기본 설정은 PRIVATE·OFF이며 음성/BPM/알림은 false로 확정했다. DB 컬럼 기본값을 추가한 것은 아니다. 설정 행이 없는 회원을 PUBLIC으로 자동 간주하지 않는다. 공개 범위 변경 시 기존 관계·대기 요청 처리 정책은 미정이다. 계정 기준 정책이며 기록별 공개 범위 컬럼은 추가하지 않았다. 위치 수집 모드와 기록 공개 범위는 별개다.

### 크루 정원

**크루 최대 정원은 200명이다.** 각 크루의 `capacity`는 1~200명 범위에서 명시하며, DB의 `CHECK (capacity BETWEEN 1 AND 200)`과 기존 NOT NULL로 보장한다. 모든 크루의 정원을 자동 200명으로 설정하거나 기본값을 추가하지 않는다. 실제 승인 인원이 해당 크루 정원을 넘지 않도록 하는 검증과 동시성 처리는 서비스 책임이다. 그룹런 참가 정원과는 별개이며 현재 group_runs에는 capacity가 없다.

## 5. 알림 종류와 화면 이동

`notification_type VARCHAR(50) NOT NULL`과 `target_id BIGINT NOT NULL`를 함께 저장한다. 종류마다 대상이 정해져 있으므로 target_type과 화면 URL은 추가하지 않는다.

| 알림 종류 | notification_type | target_id | 클릭 시 이동 |
| --- | --- | --- | --- |
| 그룹런 참여 취소 | GROUP_RUN_PARTICIPATION_CANCELLED | group_runs.id | 그룹런 상세 |
| 크루 가입 승인 | CREW_JOIN_APPROVED | crews.id | 크루 상세 |
| 크루 가입 거절 | CREW_JOIN_REJECTED | crews.id | 크루 상세 |
| 게시물 댓글 | POST_COMMENT | posts.id | 게시글 상세 |
| 그룹런 시작 임박 | GROUP_RUN_START_REMINDER | group_runs.id | 그룹런 상세 |

앱은 푸시의 종류·대상 ID로 화면을 선택한다. target_id는 여러 테이블을 가리키므로 단일 FK를 두지 않는다. 서비스가 허용 코드와 종류별 대상 조합을 검증하고, 클릭 시 삭제 여부와 현재 열람 권한을 확인한다. 삭제된 대상은 이동 불가로 안내하며 알림 수신이 비공개 기록의 접근 권한을 부여하지는 않는다. 가입 거절 후 크루 상세 조회와 가입자 전용 기능 권한도 구분한다.

참여 취소 알림의 수신자, 시작 임박 알림의 발송 시점·수신 대상은 아직 미정이다. 실제 푸시 전송·화면 이동과 푸시 토큰 저장은 이 두 컬럼 추가만으로 구현되지 않는다.

## 6. 상태·NULL을 읽는 기준

**목표 거리나 시간이 없는 자유러닝을 허용한다.** 개인·그룹런의 goal_distance/goal_duration은 NULL을 유지하며 목표 미설정과 목표값 0을 구분한다. 목표가 없으면 목표 페이스·달성 평가를 임의로 생성하지 않는다. 러닝 목표 명칭은 goal로 통일했으며 목표 도달 운동시간은 moving_duration_to_goal이다. 알림의 target_id는 이동 대상을 뜻하므로 유지한다.

| 대상 | 상태 |
| --- | --- |
| 회원 | ACTIVE / WITHDRAWN |
| 개인 세션 | READY / RUNNING / PAUSED / COMPLETED / CANCELLED / INTERRUPTED |
| 세션 분석 | PENDING / PROCESSING / READY / FAILED / LEGACY |
| 제어 명령 | START / PAUSE / RESUME / END / SET_BPM / COACHING |
| 제어 결과 | PENDING / APPLIED / REJECTED / IGNORED / UNKNOWN |
| 코스 | ACTIVE / MERGED / BLOCKED. 추천·일반 검색은 ACTIVE |
| 크루 | ACTIVE / INACTIVE |
| 크루 가입 | PENDING / APPROVED / REJECTED / LEFT |
| 그룹런 | SCHEDULED / RUNNING / COMPLETED / CANCELLED |
| 동기화 | RECEIVED / COMMITTED / REJECTED |
| 알림 발송 | PENDING / SENT / FAILED. 읽음은 read_at으로 구분 |

NULL은 미측정·아직 발생하지 않음·선택하지 않음을 표현할 수 있다. 센서 결측을 0으로 채우거나, 아직 평가하지 않은 goal_achieved를 FALSE로 바꾸지 않는다. 상태 ENUM만으로 전이와 상태별 필수값은 보장되지 않는다.

### 기존 세션과 코칭의 보존

V3 이전 세션은 `state_version=0`, `analysis_status=LEGACY`로 구분한다. `LEGACY`는 분석 실패가 아니라 이전 방식으로 저장된 기록을 뜻한다. 기존 통계·추천값을 유지하고 새 종료 확인을 요구하지 않는다. 신규 세션은 `state_version=1`부터 시작한다.

과거 코칭의 `based_on_state_version`과 `expires_at`은 모두 NULL로 보존하고 자동 적용하지 않는다. `current_bpm`의 NULL은 현재 확정된 BPM이 없음을 뜻하며, READY/PAUSED의 무음 여부와 구분한다.

## 7. DB가 보장하는 제약과 서비스 책임

### 유일성

| 테이블 | UNIQUE 조합 |
| --- | --- |
| users | login_id, nickname 각각 UNIQUE |
| user_profiles / user_settings | 각각 user_id |
| daily_health_metrics | user_id, metric_date |
| daily_readiness | user_id, readiness_date |
| course_bookmarks | user_id, course_id |
| post_likes | post_id, user_id |
| user_follows | follower_id, followee_id |
| course_environment_tags | course_id, environment_type |
| group_run_participants | group_run_id, user_id |
| pace_plan_segments | pace_plan_id, segment_sequence |
| running_session_splits | running_session_id, start_distance |
| crew_memberships | crew_id, user_id |
| sync_batches | device_id, client_batch_id |
| coaching_decisions | session_id, id (코칭 복합 FK의 참조 키) |
| session_control_events | session_id, expected_version / session_id, coaching_id |
| session_control_events | session_id, device_id — result가 PENDING 또는 UNKNOWN일 때만 |
| user_devices | user_id, device_type — unlinked_at이 NULL(연결 중)일 때만 |
| regions | region_code |
| comments | post_id, id (부모 복합 FK의 참조 키) |

기기는 회원별·유형별로 연결 중인 행을 하나만 둔다. 해제 후 재등록은 새 행을 만들어 연결·해제 이력을 보존하며, 설치 식별자는 저장하지 않는다(기기 API W01~W03). 크루 재가입은 같은 `(crew_id,user_id)` 행을 갱신한다. 상태 전이 시 요청·가입·탈퇴 시각을 새 상태에 맞게 정리하는 책임은 서비스에 있다. 가입 이력 전체를 별도 행으로 누적하는 모델은 이번 범위가 아니다. 로그인 아이디의 대소문자 정규화·탈퇴 후 재사용 정책은 이 UNIQUE만으로 결정되지 않는다.

### 세션 제어·코칭 제약

- 같은 세션의 같은 `expected_version`에는 명령 한 행만 허용한다. 서비스가 action·device·targetBpm·coachingId를 비교해 같은 요청은 기존 행을 반환하고, 다른 요청은 409로 처리한다.
- 같은 세션·기기의 `PENDING`/`UNKNOWN` 명령은 하나만 허용한다. 현재 실행기기 확인과 승인 차단은 서비스가 세션 잠금 아래 수행한다. 이전 워치의 `UNKNOWN`은 현재 폰 명령을 막지 않는다. `UNKNOWN`을 실행 성공으로 추정하지 않는다.
- 동일 세션·코칭의 명령 중복을 막고 복합 FK로 다른 세션의 코칭 참조를 차단한다. 제어 기록의 시간순 조회에는 `(session_id, created_at)` 인덱스를 사용한다.
- DB CHECK는 BPM 60~220, 명령별 필수값, 코칭 참조 여부와 적용 시각을 검사한다. 코칭의 기준 버전·만료 시각은 모두 NULL이거나 함께 유효해야 하며, 값이 있으면 기준 버전은 1 이상이고 `created_at < expires_at <= created_at + 20초`여야 한다.
- 서비스는 입력 신선도를 검사하고 `expires_at = min(입력 기준시각 + 20초, created_at + 20초)`로 정한다. 입력 기준시각을 저장하는 별도 컬럼은 없다. 워치 적용 시 상태·버전·중복·시각 오차를 포함한 만료 검사는 [코칭 API](../api/pace-coaching.md)를 따른다.
- 현재 상태와 제어 결과는 한 트랜잭션으로 저장한다. 확정 결과에서 `state_version`을 한 번 증가시키고 재전송에서는 증가시키지 않는다. 소유권·허용 상태·현재 버전 일치는 ENUM이나 CHECK가 아닌 서비스 잠금·검증으로 보장한다.
- `state_version=0`인 기존 세션을 `RUNNING`/`PAUSED`로 재활성화하는 것은 DB CHECK로 거절한다.

### 제어 기록 보관

시작 미확인 중단은 기존 `status=INTERRUPTED`, `analysis_status=FAILED`로 표시하고 실제 시작·종료시각은 NULL로 유지한다. 미확정 START는 UNKNOWN으로 보존하며 새 장부·컬럼은 추가하지 않는다. 서버는 중단 뒤 늦은 결과나 새 batch로 상태를 되돌리지 않도록 검사한다.

세션을 보관하는 동안 제어 기록도 보관하고, 세션 영구삭제 시 함께 삭제한다. 기존 soft delete·접근권한을 따른다. 재전송은 새 행을 만들지 않으며 센서 데이터·전체 메시지·heartbeat는 제어 기록에 복사하지 않는다. 자동 코칭의 발행·반복 방지는 [코칭 발행 조건](../api/pace-coaching.md#코칭을-보내는-시점)을 따른다.

### 범위·댓글·자동 갱신

- 목표 거리·시간·페이스와 평소 러닝 거리·시간·페이스는 입력된 경우 양수다. 목표 NULL과 미측정 NULL을 유지한다. 누적 거리·경과/운동시간·목표 도달 운동시간·진행거리·GPS 정확도는 0 이상이다. 고도·경사는 음수를 허용한다.
- 페이스 구간 순서는 양수, 시작거리는 0 이상, 종료거리는 시작거리보다 크고 추천 페이스는 양수다. 구간 사이의 겹침·빈 구간은 이 행 단위 CHECK만으로 보장하지 않는다.
- 위 범위 검사를 적용한 NUMERIC 컬럼은 `NaN`도 거부한다. PostgreSQL에서 NaN은 일반 수보다 크게 비교되므로 하한 검사만으로는 차단되지 않는다. NULL 허용은 유지한다.
- 자기 팔로우와 댓글의 자기 부모 참조를 CHECK로 금지한다. 댓글 부모는 `(post_id,parent_comment_id)` 복합 FK로 같은 게시물에 제한한다. 일반 댓글은 부모 NULL을 허용하고, 한 단계 대댓글 깊이는 서비스에서 검사한다.
- 기존 `updated_at` 보유 테이블은 BEFORE UPDATE 트리거가 `clock_timestamp()`로 갱신한다. INSERT는 기존 기본값을 사용한다. JPA가 같은 컬럼의 수정 시각을 중복 관리하지 않는다.
- Enum 허용 값은 보존하고 PostgreSQL 명명 타입으로 선언한다. PostGIS 확장 준비를 SQL에 명시한다. 운영 확장 설치 권한과 실행 책임은 배포 업무에서 결정한다.

### 후속 결정·검증

- 지역 마스터 데이터는 별도 준비한다. 지역 FK가 존재해도 올바른 코드·행정구역 판정 자료가 자동으로 채워지지는 않는다.
- 배치 UNIQUE는 같은 기기의 같은 배치 ID 재저장을 거부한다. 서비스는 기존 해시가 같으면 기존 결과, 다르면 충돌로 처리해야 한다. 서로 다른 배치에 겹친 원본 측정·GPS, 스트림 sequence·누락 구간·재설치 경계는 W07의 저장 보장 범위를 넘는 후속 저장 설계에서 검토한다. 이 작업에서 원본 식별 컬럼을 임의 추가하지 않았다.
- 게시글 작성자와 세션 소유자 일치, 그룹 참가자와 연결 세션 회원 일치, 기기·세션 소유권, 호스트/참가 자격, 정원 동시 승인과 상태 전이는 서비스 검증이 필요하다. 단순 FK와 범위 CHECK가 대신하지 않는다.
- 크루 정원 1~200명은 사용자 확정에 따라 DB CHECK로 보장한다. 생리 지표의 허용 범위, 상태별 필수값, 삭제·탈퇴 후 보존 정책은 이번 제약 보완에서 새로 확정하지 않았다.
- 원본 오타 `users.health_data_access`의 `AGREEE`, `user_profiles.duraction`은 유지했다.
- 기준 SQL의 실행·정상/거부 동작은 `backend`의 `SchemaIntegrityTest`로 검증한다. 실제 실행 결과와 미실행 여부는 해당 업무 검증 기록에 남긴다. 서비스 Entity 매핑·첫 Flyway 이력 검증과 구분한다.


### 가입과 동의 처리 (S15P31E105-222, 2026-10-29 사용자 확정)

- users.nickname은 uq_users_nickname UNIQUE, 대소문자 구분·정규화 없음. 탈퇴 계정 포함 중복 불가. 기존 중복 데이터가 있으면 V4는 실패하며 임의 삭제·개명하지 않는다.
- 가입 때 users와 user_settings 1행을 같은 트랜잭션에 생성한다. user_profiles는 추가 러닝 설정 전 생성하지 않는다.
- 이용약관·개인정보·위치·건강정보 동의 네 항목을 모두 받는다. 필수3종 중 하나라도 미동의이면 가입을 거절하며 이3종은 검증만 하고 DB 필드·이력을 추가하지 않는다.
- 건강정보는 미동의 가입도 허용하며 기존 users.health_data_access에 AGREEE 또는 DISAGREE로만 저장한다. 약관 버전·동의 시각·별도 동의 이력 테이블은 만들지 않는다.
- V4는 닉네임 UNIQUE만 추가한다. 최신 dev의 세션 제어 테이블은 유지하며 별도 동의 테이블·컬럼·FK는 추가하지 않는다. erd.png의 PK·FK·타입·NULL 표시는 기준 SQL을 반영하며 UNIQUE·CHECK·트리거의 정확한 정의와 온라인 ERD의 미갱신 제약은 schema.sql을 따른다.
