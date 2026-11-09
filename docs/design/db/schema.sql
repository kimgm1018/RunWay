-- PostgreSQL 17 / PostGIS 3.6 reference schema for an empty isolated database.
-- Not a service migration or an update script for an existing database.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "sync_batches_status_enum" AS ENUM('RECEIVED', 'COMMITTED', 'REJECTED');
CREATE TYPE "daily_readiness_readiness_confidence_enum" AS ENUM('LOW','MEDIUM','HIGH');
CREATE TYPE "users_gender_enum" AS ENUM('MALE', 'FEMALE');
CREATE TYPE "users_account_status_enum" AS ENUM('ACTIVE', 'WITHDRAWN');
CREATE TYPE "users_health_data_access_enum" AS ENUM('AGREEE', 'DISAGREE');
CREATE TYPE "group_runs_status_enum" AS ENUM('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "crew_memberships_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'LEFT');
CREATE TYPE "courses_status_enum" AS ENUM('ACTIVE', 'MERGED', 'BLOCKED');
CREATE TYPE "course_environment_tags_environment_type_enum" AS ENUM('PARK', 'RIVERSIDE', 'URBAN', 'BEACH', 'TRACK');
CREATE TYPE "user_profiles_running_level_enum" AS ENUM('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "crews_status_enum" AS ENUM('ACTIVE', 'INACTIVE');
CREATE TYPE "crews_join_policy_enum" AS ENUM('APPROVAL', 'INSTANT');
CREATE TYPE "running_sessions_status_enum" AS ENUM('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'INTERRUPTED');
CREATE TYPE "running_sessions_analysis_status_enum" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED', 'LEGACY');
CREATE TYPE "session_control_events_action_enum" AS ENUM('START', 'PAUSE', 'RESUME', 'END', 'SET_BPM', 'COACHING');
CREATE TYPE "session_control_events_result_enum" AS ENUM('PENDING', 'APPLIED', 'REJECTED', 'IGNORED', 'UNKNOWN');
CREATE TYPE "user_devices_device_type_enum" AS ENUM('PHONE', 'WATCH');
CREATE TYPE "user_settings_location_collection_mode_enum" AS ENUM('ALWAYS', 'RUNNING_ONLY', 'OFF');
CREATE TYPE "user_settings_account_visibility_enum" AS ENUM('PUBLIC', 'PRIVATE');
CREATE TYPE "notifications_delivery_status_enum" AS ENUM('PENDING', 'SENT', 'FAILED');

CREATE TABLE "sync_batches" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"client_batch_id"	UUID		NOT NULL,
	"device_id"	BIGINT		NOT NULL,
	"session_id"	BIGINT		NULL,
	"payload_version"	VARCHAR(50)		NOT NULL,
	"payload_hash"	TEXT		NOT NULL,
	"status"	"sync_batches_status_enum"	DEFAULT 'RECEIVED'	NOT NULL,
	"received_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"committed_at"	TIMESTAMPTZ		NULL
);

CREATE TABLE "daily_readiness" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"readiness_date"	DATE		NOT NULL,
	"readiness_score"	NUMERIC(7,2)		NOT NULL,
	"readiness_confidence"	"daily_readiness_readiness_confidence_enum"		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "daily_readiness"."id" IS '러닝 준비도 ID';

COMMENT ON COLUMN "daily_readiness"."user_id" IS '회원 ID';

COMMENT ON COLUMN "daily_readiness"."readiness_date" IS '준비도 기준일';

COMMENT ON COLUMN "daily_readiness"."readiness_score" IS '러닝 준비도 점수';

COMMENT ON COLUMN "daily_readiness"."readiness_confidence" IS '준비도 신뢰 수준';

COMMENT ON COLUMN "daily_readiness"."created_at" IS '생성일시';

COMMENT ON COLUMN "daily_readiness"."updated_at" IS '수정일시';

CREATE TABLE "users" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"login_id"	VARCHAR(64)		NOT NULL,
	"password"	VARCHAR(255)		NOT NULL,
	"nickname"	VARCHAR(10)		NOT NULL,
	"birth_date"	DATE		NOT NULL,
	"gender"	"users_gender_enum"		NOT NULL,
	"profile_image_key"	VARCHAR(1024)		NULL,
	"account_status"	"users_account_status_enum"	DEFAULT 'ACTIVE'	NOT NULL,
	"withdrawn_at"	TIMESTAMPTZ		NULL,
	"phone_number"	VARCHAR(20)		NOT NULL,
	"health_data_access"	"users_health_data_access_enum"		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

CREATE TABLE "user_recommendation_preferences" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "user_id" BIGINT NOT NULL,
    "shape" VARCHAR(16) DEFAULT 'loop' NOT NULL,
    "river" BOOLEAN DEFAULT false NOT NULL,
    "beach" BOOLEAN DEFAULT false NOT NULL,
    "park" BOOLEAN DEFAULT false NOT NULL,
    "trail" BOOLEAN DEFAULT false NOT NULL,
    "pedestrian" BOOLEAN DEFAULT false NOT NULL,
    "flat" BOOLEAN DEFAULT false NOT NULL,
    "avoid_major_road" BOOLEAN DEFAULT false NOT NULL,
    "avoid_steps" BOOLEAN DEFAULT false NOT NULL,
    "avoid_tunnel" BOOLEAN DEFAULT false NOT NULL,
    CONSTRAINT "PK_USER_RECOMMENDATION_PREFERENCES" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_recommendation_preferences_user_id" UNIQUE ("user_id"),
    CONSTRAINT "ck_user_recommendation_preferences_shape"
        CHECK ("shape" IN ('loop', 'out_and_back', 'point_to_point'))
);

COMMENT ON TABLE "user_recommendation_preferences" IS 'U11/U12 추천 기본값. 명시적 저장 시에만 생성·전체 교체. false는 고려하지 않음. 논리 탈퇴 시 서비스에서 삭제';

CREATE TABLE "user_hr_personalization" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "user_id" BIGINT NOT NULL,
    "personalization_version" INTEGER NOT NULL,
    "schema_version" VARCHAR(80) NOT NULL,
    "model_version" VARCHAR(160) NOT NULL,
    "support_run_count" INTEGER NOT NULL,
    "summary_u_json" JSONB NOT NULL,
    "history8_json" JSONB NOT NULL,
    "p4_json" JSONB NOT NULL,
    "hr0_sub_bpm" NUMERIC(7,2) NOT NULL,
    "hr_ref_bpm" NUMERIC(7,2) NULL,
    "hr_danger_bpm" NUMERIC(7,2) NULL,
    "hr_sustain_bpm" NUMERIC(7,2) NULL,
    "hr_threshold_run_count" INTEGER NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_USER_HR_PERSONALIZATION" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_hr_personalization_user_version"
        UNIQUE ("user_id", "personalization_version"),
    CONSTRAINT "ck_user_hr_personalization_version_positive"
        CHECK ("personalization_version" > 0),
    CONSTRAINT "ck_user_hr_personalization_support_count_nonnegative"
        CHECK ("support_run_count" >= 0),
    CONSTRAINT "ck_user_hr_personalization_hr0_sub_range"
        CHECK ("hr0_sub_bpm" BETWEEN 35 AND 220),
    CONSTRAINT "ck_user_hr_personalization_hr_ref_range"
        CHECK ("hr_ref_bpm" IS NULL OR "hr_ref_bpm" BETWEEN 35 AND 220),
    CONSTRAINT "ck_user_hr_personalization_hr_danger_range"
        CHECK ("hr_danger_bpm" IS NULL OR "hr_danger_bpm" BETWEEN 35 AND 220),
    CONSTRAINT "ck_user_hr_personalization_hr_sustain_range"
        CHECK ("hr_sustain_bpm" IS NULL OR "hr_sustain_bpm" BETWEEN 35 AND 220),
    CONSTRAINT "ck_user_hr_personalization_hr_threshold_run_count_range"
        CHECK ("hr_threshold_run_count" IS NULL OR "hr_threshold_run_count" BETWEEN 0 AND 20)
);

COMMENT ON TABLE "user_hr_personalization" IS 'AI06 ODE 개인화 요약. 원본 HR/GPS 시계열은 저장하지 않는다.';
COMMENT ON COLUMN "user_hr_personalization"."user_id" IS '회원 ID';
COMMENT ON COLUMN "user_hr_personalization"."personalization_version" IS '회원별 개인화 버전. 모델 교체 시 과거 버전을 보존한다.';
COMMENT ON COLUMN "user_hr_personalization"."schema_version" IS '개인화 JSON 스키마 버전';
COMMENT ON COLUMN "user_hr_personalization"."model_version" IS '개인화 계산에 사용한 ODE 모델 버전';
COMMENT ON COLUMN "user_hr_personalization"."support_run_count" IS '계산에 사용한 support 러닝 수';
COMMENT ON COLUMN "user_hr_personalization"."summary_u_json" IS 'ODE 요약 묶음 u. 측정 원본 시계열은 포함하지 않는다.';
COMMENT ON COLUMN "user_hr_personalization"."history8_json" IS 'History8 개인 맥락 벡터';
COMMENT ON COLUMN "user_hr_personalization"."p4_json" IS 'support 기록에 맞춘 4차원 개인 적합 벡터';
COMMENT ON COLUMN "user_hr_personalization"."hr0_sub_bpm" IS 'HR0 head가 없는 모델에 쓰는 support 시작 HR 중앙값(없으면 85 bpm)';
COMMENT ON COLUMN "user_hr_personalization"."hr_ref_bpm" IS 'AI06 응답 hrRefBpm. 산출할 수 없으면 NULL';
COMMENT ON COLUMN "user_hr_personalization"."hr_danger_bpm" IS 'GOOD 심박 분포 개인 P98 원값(+3 전). AI04가 모집단 값과 섞은 뒤 +3 bpm을 더해 위험 기준으로 씀. 없으면 NULL';
COMMENT ON COLUMN "user_hr_personalization"."hr_sustain_bpm" IS 'GOOD 심박 분포 P85 학습 지속 기준. 없으면 NULL';
COMMENT ON COLUMN "user_hr_personalization"."hr_threshold_run_count" IS 'P98·P85 기준에 사용한 최근 러닝 수(최대 20)';
COMMENT ON COLUMN "user_hr_personalization"."created_at" IS '생성일시';

CREATE TABLE "pace_plans" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"session_id"	BIGINT		NOT NULL,
	"recommended_pace"	NUMERIC(10,2)		NOT NULL,
	"cue_bpm"	NUMERIC(7,2)		NULL,
	"route_progress"	NUMERIC(12,2)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "pace_plans"."recommended_pace" IS '초기 페이스 전략의 추천 페이스(초/km)';

COMMENT ON COLUMN "pace_plans"."cue_bpm" IS '추천 박자(BPM)';

COMMENT ON COLUMN "pace_plans"."route_progress" IS '코스 진행거리(m)';

CREATE TABLE "group_runs" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"crew_id"	BIGINT		NOT NULL,
	"host_id"	BIGINT		NOT NULL,
	"course_id"	BIGINT		NULL,
	"title"	VARCHAR(100)		NOT NULL,
	"description"	TEXT		NULL,
	"scheduled_at"	TIMESTAMPTZ		NOT NULL,
	"meeting_name"	VARCHAR(200)		NULL,
	"meeting_address"	VARCHAR(255)		NULL,
	"meeting_position"	geography(Point,4326)		NULL,
	"goal_distance"	INTEGER		NULL,
	"goal_duration"	INTEGER		NULL,
	"status"	"group_runs_status_enum"	DEFAULT 'SCHEDULED'	NOT NULL,
	"started_at"	TIMESTAMPTZ		NULL,
	"ended_at"	TIMESTAMPTZ		NULL,
	"cancel_reason"	VARCHAR(50)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "group_runs"."cancel_reason" IS '그룹런 취소 사유. 취소 전 NULL. 사유 코드 목록은 서비스에서 확정.';

CREATE TABLE "crew_memberships" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"crew_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"status"	"crew_memberships_status_enum"	DEFAULT 'PENDING'	NOT NULL,
	"requested_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"joined_at"	TIMESTAMPTZ		NULL,
	"left_at"	TIMESTAMPTZ		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

CREATE TABLE "pace_plan_segments" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"pace_plan_id"	BIGINT		NOT NULL,
	"segment_sequence"	INTEGER		NOT NULL,
	"start_distance"	NUMERIC(12,2)		NOT NULL,
	"end_distance"	NUMERIC(12,2)		NOT NULL,
	"recommended_pace"	NUMERIC(10,2)		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "pace_plan_segments"."id" IS '페이스 구간 ID';

COMMENT ON COLUMN "pace_plan_segments"."pace_plan_id" IS '페이스 전략 ID';

COMMENT ON COLUMN "pace_plan_segments"."segment_sequence" IS '구간 순서';

COMMENT ON COLUMN "pace_plan_segments"."start_distance" IS '구간 시작거리(m)';

COMMENT ON COLUMN "pace_plan_segments"."end_distance" IS '구간 종료거리(m)';

COMMENT ON COLUMN "pace_plan_segments"."recommended_pace" IS '구간 추천 페이스(초/km)';

COMMENT ON COLUMN "pace_plan_segments"."created_at" IS '생성일시';

CREATE TABLE "group_run_participants" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"group_run_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"session_id"	BIGINT		NULL,
	"joined_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"ready"	BOOLEAN	DEFAULT false	NOT NULL
);

COMMENT ON COLUMN "group_run_participants"."ready" IS '대기방 준비 완료 여부. true=READY, false=WAITING. S08 워치 REPORT_PREPARED와 별개.';

CREATE TABLE "running_route_points" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"running_session_id"	BIGINT		NOT NULL,
	"measured_at"	TIMESTAMPTZ		NOT NULL,
	"position"	geography(Point,4326)		NOT NULL,
	"accuracy"	NUMERIC(10,2)		NULL,
	"device_id"	BIGINT		NULL,
	"altitude"	NUMERIC(10,2)		NULL
);

CREATE TABLE "post_likes" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"post_id"	BIGINT		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

CREATE TABLE "courses" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"creator_id"	BIGINT		NULL,
	"source_session_id"	BIGINT		NULL,
	"description"	TEXT		NULL,
	"route"	geography(LineString,4326)		NOT NULL,
	"start_position"	geography(Point,4326)		NOT NULL,
	"distance"	NUMERIC(12,2)		NOT NULL,
	"elevation_gain"	NUMERIC(10,2)		NULL,
	"elevation_profile"	JSONB		NULL,
	"status"	"courses_status_enum"	DEFAULT 'ACTIVE'	NOT NULL,
	"merged_into_course_id"	BIGINT		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"region_code"	VARCHAR(40)		NULL
);

COMMENT ON COLUMN "courses"."region_code" IS '출발 좌표 기준 시·군·구 코드. regions.region_code(UNIQUE)를 외래키로 참조한다. 지역 판정 전 또는 실패 시 NULL을 허용한다. 코스 표시명은 시·도명 + 시·군·구명 + 코스로 조합한다.';

CREATE TABLE "course_environment_tags" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"course_id"	BIGINT		NOT NULL,
	"environment_type"	"course_environment_tags_environment_type_enum"		NOT NULL
);

CREATE TABLE "regions" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"region_code"	VARCHAR(40) UNIQUE		NOT NULL,
	"sido_name"	VARCHAR(100)		NOT NULL,
	"sigungu_name"	VARCHAR(100)		NOT NULL
);

COMMENT ON COLUMN "regions"."region_code" IS '시·군·구 코드. 중복 금지 UNIQUE 참조 키. courses/crews/posts의 지역 코드가 참조한다.';

CREATE TABLE "user_profiles" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"running_level"	"user_profiles_running_level_enum"		NOT NULL,
	"average_pace"	NUMERIC(10,2)		NOT NULL,
	"distance"	INTEGER		NULL,
	"duraction"	INTEGER		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

CREATE TABLE "daily_health_metrics" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"metric_date"	DATE		NOT NULL,
	"sleep_duration_min"	NUMERIC(7,2)		NULL,
	"rhr_bpm"	NUMERIC(7,2)		NULL,
	"daily_training_load"	NUMERIC(12,4)		NULL,
	"max_heart_rate"	NUMERIC(7,2)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"rhr_revision"	INTEGER		NULL
);

COMMENT ON COLUMN "daily_health_metrics"."id" IS '일별 건강 ID';

COMMENT ON COLUMN "daily_health_metrics"."user_id" IS '회원 ID';

COMMENT ON COLUMN "daily_health_metrics"."metric_date" IS '건강 정보 기준일';

COMMENT ON COLUMN "daily_health_metrics"."sleep_duration_min" IS '수면시간(분)';

COMMENT ON COLUMN "daily_health_metrics"."rhr_bpm" IS '안정시 심박수(bpm)';

COMMENT ON COLUMN "daily_health_metrics"."daily_training_load" IS '하루 운동 부하';

COMMENT ON COLUMN "daily_health_metrics"."max_heart_rate" IS '준비도 계산용 최대 심박수(bpm)';

COMMENT ON COLUMN "daily_health_metrics"."created_at" IS '생성일시';

COMMENT ON COLUMN "daily_health_metrics"."updated_at" IS '수정일시';

COMMENT ON COLUMN "daily_health_metrics"."rhr_revision" IS 'rhr_bpm 워치 추정값의 revision. 같은 날짜는 더 큰 revision만 rhr_bpm을 갱신. 미저장 시 NULL';

CREATE TABLE "posts" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"author_id"	BIGINT		NOT NULL,
	"session_id"	BIGINT		NOT NULL,
	"body"	TEXT		NULL,
	"image_key"	VARCHAR(1024)		NULL,
	"region_code"	VARCHAR(40)		NULL,
	"deleted_at"	TIMESTAMPTZ		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "posts"."region_code" IS '게시물 지역 코드. regions.region_code 참조. 시·군·구 단위. 미지정 시 NULL.';

CREATE TABLE "coaching_decisions" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"session_id"	BIGINT		NOT NULL,
	"elapsed_duration"	INTEGER		NOT NULL,
	"recommended_pace"	NUMERIC(10,2)		NOT NULL,
	"cue_bpm"	NUMERIC(7,2)		NULL,
	"predicted_hr_30_bpm"	NUMERIC(7,2)		NULL,
	"predicted_hr_60_bpm"	NUMERIC(7,2)		NULL,
	"predicted_hr_120_bpm"	NUMERIC(7,2)		NULL,
	"route_progress"	NUMERIC(12,2)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
    "based_on_state_version" BIGINT NULL,
    "expires_at" TIMESTAMPTZ NULL,
    "coaching_level" VARCHAR(16) NULL
);

COMMENT ON COLUMN "coaching_decisions"."elapsed_duration" IS '러닝 경과시간(초)';

COMMENT ON COLUMN "coaching_decisions"."recommended_pace" IS '추천 페이스(초/km)';

COMMENT ON COLUMN "coaching_decisions"."cue_bpm" IS '추천 박자(BPM)';

COMMENT ON COLUMN "coaching_decisions"."predicted_hr_30_bpm" IS '30초 뒤 예측 심박수(bpm)';

COMMENT ON COLUMN "coaching_decisions"."predicted_hr_60_bpm" IS '60초 뒤 예측 심박수(bpm)';

COMMENT ON COLUMN "coaching_decisions"."predicted_hr_120_bpm" IS '120초 뒤 예측 심박수(bpm)';

COMMENT ON COLUMN "coaching_decisions"."route_progress" IS '코스 진행거리(m)';

COMMENT ON COLUMN "coaching_decisions"."coaching_level" IS 'AI04 코칭 단계 OK/CAUTION/DANGER(S15P31E105-503). AI가 단계를 주지 않았거나 이전 행이면 null.';

COMMENT ON COLUMN "coaching_decisions"."created_at" IS '생성일시';

CREATE TABLE "crews" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"owner_id"	BIGINT		NOT NULL,
	"name"	VARCHAR(100)		NOT NULL,
	"description"	TEXT		NULL,
	"image_key"	VARCHAR(1024)		NULL,
	"capacity"	INTEGER		NOT NULL,
	"status"	"crews_status_enum"	DEFAULT 'ACTIVE'	NOT NULL,
	"region_code"	VARCHAR(40)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"join_policy"	"crews_join_policy_enum"	DEFAULT 'APPROVAL'	NOT NULL
);

COMMENT ON COLUMN "crews"."join_policy" IS '가입 방식. APPROVAL=크루장 승인 후 멤버, INSTANT=신청 즉시 멤버(정원 안). 크루장이 M12로 변경한다.';

CREATE TABLE "running_sessions" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"course_id"	BIGINT		NULL,
	"comparison_session_id"	BIGINT		NULL,
	"status"	"running_sessions_status_enum"	DEFAULT 'READY'	NOT NULL,
	"goal_distance"	INTEGER		NULL,
	"goal_duration"	INTEGER		NULL,
	"goal_pace"	NUMERIC(10,2)		NULL,
	"started_at"	TIMESTAMPTZ		NULL,
	"ended_at"	TIMESTAMPTZ		NULL,
	"total_distance"	NUMERIC(12,2)		NULL,
	"moving_duration"	INTEGER		NULL,
	"elapsed_duration"	INTEGER		NULL,
	"moving_duration_to_goal"	INTEGER		NULL,
	"goal_achieved"	BOOLEAN		NULL,
	"average_pace"	NUMERIC(10,2)		NULL,
	"average_heart_rate"	NUMERIC(7,2)		NULL,
	"average_cadence"	NUMERIC(8,2)		NULL,
	"deleted_at"	TIMESTAMPTZ		NULL,
	"max_heart_rate"	NUMERIC(7,2)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
    "control_device_id" BIGINT NULL,
    "relay_device_id" BIGINT NULL,
    "state_version" BIGINT DEFAULT 1 NOT NULL CHECK (state_version >= 0),
    "current_bpm" INTEGER NULL CHECK (current_bpm BETWEEN 60 AND 220),
    "analysis_status" "running_sessions_analysis_status_enum" DEFAULT 'PENDING' NOT NULL
);

COMMENT ON COLUMN "running_sessions"."max_heart_rate" IS '최대 심박수(bpm)';

CREATE TABLE "comments" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"post_id"	BIGINT		NOT NULL,
	"parent_comment_id"	BIGINT		NULL,
	"author_id"	BIGINT		NOT NULL,
	"body"	TEXT		NOT NULL,
	"deleted_at"	TIMESTAMPTZ		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "comments"."post_id" IS 'posts.id 참조. 대댓글은 부모와 게시물이 같아야 함: (post_id,parent_comment_id) → comments(post_id,id). 정확한 DB 제약은 제공 SQL 참조.';

COMMENT ON COLUMN "comments"."parent_comment_id" IS '일반 댓글은 NULL. 대댓글 부모는 같은 게시물이어야 함. 복합 FK (post_id,parent_comment_id) REFERENCES comments(post_id,id); UNIQUE(post_id,id); CHECK(parent_comment_id IS NULL OR parent_comment_id <> id). 한 단계 대댓글 깊이는 서비스에서 검사.';

CREATE TABLE "course_bookmarks" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"course_id"	BIGINT		NOT NULL,
	"custom_name"	VARCHAR(50)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

CREATE TABLE "user_devices" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"device_type"	"user_devices_device_type_enum"		NOT NULL,
	"linked_at"	TIMESTAMPTZ		NOT NULL,
	"unlinked_at"	TIMESTAMPTZ		NULL
);

CREATE TABLE "user_settings" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"voice_coaching_enabled"	BOOLEAN		NOT NULL,
	"bpm_guide_enabled"	BOOLEAN		NOT NULL,
	"group_notifications_enabled"	BOOLEAN		NOT NULL,
	"community_notifications_enabled"	BOOLEAN		NOT NULL,
	"location_collection_mode"	"user_settings_location_collection_mode_enum"		NOT NULL,
	"account_visibility"	"user_settings_account_visibility_enum"		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "user_settings"."location_collection_mode" IS '위치 수집 모드. ALWAYS/RUNNING_ONLY/OFF 중 하나를 설정 행 생성 시 명시한다. NULL 불가. 위치 수집 모드와 기록 공개 범위는 별개다.';

COMMENT ON COLUMN "user_settings"."account_visibility" IS '계정의 기록 공개 범위. PUBLIC 또는 PRIVATE를 설정 행 생성 시 명시하며 NULL 불가. PUBLIC은 기록 공개 및 즉시 팔로우, PRIVATE는 팔로우 승인 후 성립하며 기록은 본인 및 승인된 팔로워만 열람 가능. 승인 관계는 user_follows.follower_id=열람자, followee_id=기록 소유자, is_approved=TRUE로 판정한다.';

CREATE TABLE "user_follows" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"follower_id"	BIGINT		NOT NULL,
	"followee_id"	BIGINT		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"is_approved"	BOOLEAN	DEFAULT FALSE	NOT NULL
);

COMMENT ON COLUMN "user_follows"."is_approved" IS '팔로우 성립 여부. 공개(PUBLIC) 계정은 별도 승인 없이 요청 생성 시 TRUE로 저장한다. 비공개(PRIVATE) 계정은 FALSE로 요청을 저장하고 상대가 승인하면 TRUE로 변경한다. FALSE는 미승인 요청이며 팔로워 집계와 비공개 기록 열람에서 제외한다. 비공개 기록은 본인 또는 follower_id=열람자, followee_id=기록 소유자, is_approved=TRUE인 경우에만 열람한다.';

CREATE TABLE "notifications" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"sent_at"	TIMESTAMPTZ		NULL,
	"read_at"	TIMESTAMPTZ		NULL,
	"delivery_status"	"notifications_delivery_status_enum"	DEFAULT 'PENDING'	NOT NULL,
	"message"	VARCHAR(100)		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"notification_type"	VARCHAR(50)		NOT NULL,
	"target_id"	BIGINT		NOT NULL,
	"dedupe_key"	VARCHAR(200)		NOT NULL
);

COMMENT ON COLUMN "notifications"."notification_type" IS '알림 종류 코드. GROUP_RUN_PARTICIPATION_CANCELLED: G13 그룹런 취소(코드명 유지, 참가 취소 알림 아님), CREW_JOIN_APPROVED: 크루 가입 승인, CREW_JOIN_REJECTED: 크루 가입 거절, POST_COMMENT: 게시물 댓글, GROUP_RUN_START_REMINDER: 그룹런 시작 임박, NEW_FOLLOWER: 공개 계정 새 팔로워, FOLLOW_REQUEST: 비공개 팔로우 요청, FOLLOW_APPROVED: 수동 팔로우 승인. 알림 종류로 target_id의 대상과 이동 화면을 결정하며 별도 target_type은 두지 않는다.';

COMMENT ON COLUMN "notifications"."target_id" IS '알림 클릭 시 이동 대상 ID. GROUP_RUN_PARTICIPATION_CANCELLED/GROUP_RUN_START_REMINDER는 group_runs.id(그룹런 상세), CREW_JOIN_APPROVED/CREW_JOIN_REJECTED는 crews.id(크루 상세), POST_COMMENT는 posts.id(게시글 상세), NEW_FOLLOWER/FOLLOW_REQUEST는 행위자 users.id, FOLLOW_APPROVED는 승인자 users.id. 여러 테이블을 가리키므로 단일 FK는 두지 않고 서비스에서 종류별 대상 존재와 현재 열람 권한을 검증한다. 삭제된 대상은 이동 불가로 안내한다.';

COMMENT ON COLUMN "notifications"."dedupe_key" IS '논리 사건 중복 방지 키(S15P31E105-458). 동일 키 재삽입을 허용하지 않는다. 형식은 종류별 서비스 규칙(예: FOLLOW_REQUEST:{requestId}).';

CREATE TABLE "running_metric_samples" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"running_session_id"	BIGINT		NOT NULL,
	"device_id"	BIGINT		NULL,
	"measured_at"	TIMESTAMPTZ		NOT NULL,
	"elapsed_duration"	INTEGER		NOT NULL,
	"heart_rate"	NUMERIC(7,2)		NULL,
	"cadence"	NUMERIC(8,2)		NULL,
	"speed"	NUMERIC(10,3)		NULL,
	"grade"	NUMERIC(7,3)		NULL,
	"total_distance"	NUMERIC(12,2)		NULL,
	"route_progress"	NUMERIC(12,2)		NULL,
	"is_hr_measured"	BOOLEAN		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "running_metric_samples"."id" IS '러닝 측정값 ID';

COMMENT ON COLUMN "running_metric_samples"."running_session_id" IS '러닝 ID';

COMMENT ON COLUMN "running_metric_samples"."device_id" IS '측정 기기 ID';

COMMENT ON COLUMN "running_metric_samples"."measured_at" IS '측정 기준일시';

COMMENT ON COLUMN "running_metric_samples"."elapsed_duration" IS '러닝 경과시간(초)';

COMMENT ON COLUMN "running_metric_samples"."heart_rate" IS '심박수(bpm)';

COMMENT ON COLUMN "running_metric_samples"."cadence" IS '측정 시점의 분당 걸음 수(spm). 미측정 시 NULL. 세션 평균과 구분.';

COMMENT ON COLUMN "running_metric_samples"."speed" IS '속도(m/s)';

COMMENT ON COLUMN "running_metric_samples"."grade" IS '경사도(%)';

COMMENT ON COLUMN "running_metric_samples"."total_distance" IS '누적 이동거리(m)';

COMMENT ON COLUMN "running_metric_samples"."route_progress" IS '코스 진행거리(m)';

COMMENT ON COLUMN "running_metric_samples"."is_hr_measured" IS '심박 실제 측정 여부';

COMMENT ON COLUMN "running_metric_samples"."created_at" IS '생성일시';

CREATE TABLE "running_session_splits" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"running_session_id"	BIGINT		NOT NULL,
	"start_distance"	NUMERIC(12,2)		NOT NULL,
	"end_distance"	NUMERIC(12,2)		NOT NULL,
	"pace"	NUMERIC(10,2)		NULL,
	"average_heart_rate"	NUMERIC(7,2)		NULL,
	"average_cadence"	NUMERIC(8,2)		NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "running_session_splits"."id" IS '러닝 구간 ID';

COMMENT ON COLUMN "running_session_splits"."running_session_id" IS '러닝 ID';

COMMENT ON COLUMN "running_session_splits"."start_distance" IS '구간 시작거리(m)';

COMMENT ON COLUMN "running_session_splits"."end_distance" IS '구간 종료거리(m)';

COMMENT ON COLUMN "running_session_splits"."pace" IS '구간 페이스(초/km). 미계산·불가 시 NULL';

COMMENT ON COLUMN "running_session_splits"."average_heart_rate" IS '구간 평균 심박수(bpm). 미측정 시 NULL';

COMMENT ON COLUMN "running_session_splits"."average_cadence" IS '구간 평균 케이던스(spm). 미측정 시 NULL';

COMMENT ON COLUMN "running_session_splits"."created_at" IS '생성일시';

ALTER TABLE "sync_batches" ADD CONSTRAINT "PK_SYNC_BATCHES" PRIMARY KEY (
	"id"
);

ALTER TABLE "daily_readiness" ADD CONSTRAINT "PK_DAILY_READINESS" PRIMARY KEY (
	"id"
);

ALTER TABLE "users" ADD CONSTRAINT "PK_USERS" PRIMARY KEY (
	"id"
);

ALTER TABLE "pace_plans" ADD CONSTRAINT "PK_PACE_PLANS" PRIMARY KEY (
	"id"
);

ALTER TABLE "group_runs" ADD CONSTRAINT "PK_GROUP_RUNS" PRIMARY KEY (
	"id"
);

ALTER TABLE "crew_memberships" ADD CONSTRAINT "PK_CREW_MEMBERSHIPS" PRIMARY KEY (
	"id"
);

ALTER TABLE "pace_plan_segments" ADD CONSTRAINT "PK_PACE_PLAN_SEGMENTS" PRIMARY KEY (
	"id"
);

ALTER TABLE "group_run_participants" ADD CONSTRAINT "PK_GROUP_RUN_PARTICIPANTS" PRIMARY KEY (
	"id"
);

ALTER TABLE "running_route_points" ADD CONSTRAINT "PK_RUNNING_ROUTE_POINTS" PRIMARY KEY (
	"id"
);

ALTER TABLE "running_session_splits" ADD CONSTRAINT "PK_RUNNING_SESSION_SPLITS" PRIMARY KEY (
	"id"
);

ALTER TABLE "post_likes" ADD CONSTRAINT "PK_POST_LIKES" PRIMARY KEY (
	"id"
);

ALTER TABLE "courses" ADD CONSTRAINT "PK_COURSES" PRIMARY KEY (
	"id"
);

ALTER TABLE "course_environment_tags" ADD CONSTRAINT "PK_COURSE_ENVIRONMENT_TAGS" PRIMARY KEY (
	"id"
);

ALTER TABLE "regions" ADD CONSTRAINT "PK_REGIONS" PRIMARY KEY (
	"id"
);

ALTER TABLE "user_profiles" ADD CONSTRAINT "PK_USER_PROFILES" PRIMARY KEY (
	"id"
);

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "PK_DAILY_HEALTH_METRICS" PRIMARY KEY (
	"id"
);

ALTER TABLE "posts" ADD CONSTRAINT "PK_POSTS" PRIMARY KEY (
	"id"
);

ALTER TABLE "coaching_decisions" ADD CONSTRAINT "PK_COACHING_DECISIONS" PRIMARY KEY (
	"id"
);

ALTER TABLE "crews" ADD CONSTRAINT "PK_CREWS" PRIMARY KEY (
	"id"
);

ALTER TABLE "running_sessions" ADD CONSTRAINT "PK_RUNNING_SESSIONS" PRIMARY KEY (
	"id"
);

ALTER TABLE "comments" ADD CONSTRAINT "PK_COMMENTS" PRIMARY KEY (
	"id"
);

ALTER TABLE "course_bookmarks" ADD CONSTRAINT "PK_COURSE_BOOKMARKS" PRIMARY KEY (
	"id"
);

ALTER TABLE "user_devices" ADD CONSTRAINT "PK_USER_DEVICES" PRIMARY KEY (
	"id"
);

ALTER TABLE "user_settings" ADD CONSTRAINT "PK_USER_SETTINGS" PRIMARY KEY (
	"id"
);

ALTER TABLE "user_follows" ADD CONSTRAINT "PK_USER_FOLLOWS" PRIMARY KEY (
	"id"
);

ALTER TABLE "notifications" ADD CONSTRAINT "PK_NOTIFICATIONS" PRIMARY KEY (
	"id"
);

ALTER TABLE "notifications" ADD CONSTRAINT "UK_NOTIFICATIONS_DEDUPE_KEY" UNIQUE (
	"dedupe_key"
);

ALTER TABLE "running_metric_samples" ADD CONSTRAINT "PK_RUNNING_METRIC_SAMPLES" PRIMARY KEY (
	"id"
);

ALTER TABLE "sync_batches" ADD CONSTRAINT "FK_user_devices_TO_sync_batches_1" FOREIGN KEY (
	"device_id"
)
REFERENCES "user_devices" (
	"id"
);

ALTER TABLE "sync_batches" ADD CONSTRAINT "FK_running_sessions_TO_sync_batches_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "daily_readiness" ADD CONSTRAINT "FK_users_TO_daily_readiness_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "pace_plans" ADD CONSTRAINT "FK_running_sessions_TO_pace_plans_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "group_runs" ADD CONSTRAINT "FK_crews_TO_group_runs_1" FOREIGN KEY (
	"crew_id"
)
REFERENCES "crews" (
	"id"
);

ALTER TABLE "group_runs" ADD CONSTRAINT "FK_users_TO_group_runs_1" FOREIGN KEY (
	"host_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "group_runs" ADD CONSTRAINT "FK_courses_TO_group_runs_1" FOREIGN KEY (
	"course_id"
)
REFERENCES "courses" (
	"id"
);

ALTER TABLE "crew_memberships" ADD CONSTRAINT "FK_crews_TO_crew_memberships_1" FOREIGN KEY (
	"crew_id"
)
REFERENCES "crews" (
	"id"
);

ALTER TABLE "crew_memberships" ADD CONSTRAINT "FK_users_TO_crew_memberships_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "pace_plan_segments" ADD CONSTRAINT "FK_pace_plans_TO_pace_plan_segments_1" FOREIGN KEY (
	"pace_plan_id"
)
REFERENCES "pace_plans" (
	"id"
);

ALTER TABLE "group_run_participants" ADD CONSTRAINT "FK_group_runs_TO_group_run_participants_1" FOREIGN KEY (
	"group_run_id"
)
REFERENCES "group_runs" (
	"id"
);

ALTER TABLE "group_run_participants" ADD CONSTRAINT "FK_users_TO_group_run_participants_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "group_run_participants" ADD CONSTRAINT "FK_running_sessions_TO_group_run_participants_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "running_route_points" ADD CONSTRAINT "FK_running_sessions_TO_running_route_points_1" FOREIGN KEY (
	"running_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "running_route_points" ADD CONSTRAINT "FK_user_devices_TO_running_route_points_1" FOREIGN KEY (
	"device_id"
)
REFERENCES "user_devices" (
	"id"
);

ALTER TABLE "post_likes" ADD CONSTRAINT "FK_posts_TO_post_likes_1" FOREIGN KEY (
	"post_id"
)
REFERENCES "posts" (
	"id"
);

ALTER TABLE "post_likes" ADD CONSTRAINT "FK_users_TO_post_likes_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "courses" ADD CONSTRAINT "FK_users_TO_courses_1" FOREIGN KEY (
	"creator_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "courses" ADD CONSTRAINT "FK_running_sessions_TO_courses_1" FOREIGN KEY (
	"source_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "courses" ADD CONSTRAINT "FK_courses_TO_courses_1" FOREIGN KEY (
	"merged_into_course_id"
)
REFERENCES "courses" (
	"id"
);

ALTER TABLE "course_environment_tags" ADD CONSTRAINT "FK_courses_TO_course_environment_tags_1" FOREIGN KEY (
	"course_id"
)
REFERENCES "courses" (
	"id"
);

ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_users_TO_user_profiles_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "FK_users_TO_daily_health_metrics_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "posts" ADD CONSTRAINT "FK_users_TO_posts_1" FOREIGN KEY (
	"author_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "posts" ADD CONSTRAINT "FK_running_sessions_TO_posts_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "posts" ADD CONSTRAINT "FK_regions_TO_posts_1" FOREIGN KEY (
	"region_code"
)
REFERENCES "regions" (
	"region_code"
);

ALTER TABLE "coaching_decisions" ADD CONSTRAINT "FK_running_sessions_TO_coaching_decisions_1" FOREIGN KEY (
	"session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "crews" ADD CONSTRAINT "FK_users_TO_crews_1" FOREIGN KEY (
	"owner_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "crews" ADD CONSTRAINT "FK_regions_TO_crews_1" FOREIGN KEY (
	"region_code"
)
REFERENCES "regions" (
	"region_code"
);

ALTER TABLE "running_sessions" ADD CONSTRAINT "FK_users_TO_running_sessions_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "running_sessions" ADD CONSTRAINT "FK_courses_TO_running_sessions_1" FOREIGN KEY (
	"course_id"
)
REFERENCES "courses" (
	"id"
);

ALTER TABLE "running_sessions" ADD CONSTRAINT "FK_running_sessions_TO_running_sessions_1" FOREIGN KEY (
	"comparison_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "comments" ADD CONSTRAINT "FK_posts_TO_comments_1" FOREIGN KEY (
	"post_id"
)
REFERENCES "posts" (
	"id"
);

ALTER TABLE "comments" ADD CONSTRAINT "FK_users_TO_comments_1" FOREIGN KEY (
	"author_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "course_bookmarks" ADD CONSTRAINT "FK_users_TO_course_bookmarks_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "course_bookmarks" ADD CONSTRAINT "FK_courses_TO_course_bookmarks_1" FOREIGN KEY (
	"course_id"
)
REFERENCES "courses" (
	"id"
);

ALTER TABLE "user_devices" ADD CONSTRAINT "FK_users_TO_user_devices_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "user_settings" ADD CONSTRAINT "FK_users_TO_user_settings_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "user_follows" ADD CONSTRAINT "FK_users_TO_user_follows_1" FOREIGN KEY (
	"follower_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "user_follows" ADD CONSTRAINT "FK_users_TO_user_follows_2" FOREIGN KEY (
	"followee_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "notifications" ADD CONSTRAINT "FK_users_TO_notifications_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "running_metric_samples" ADD CONSTRAINT "FK_running_sessions_TO_running_metric_samples_1" FOREIGN KEY (
	"running_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "running_metric_samples" ADD CONSTRAINT "FK_user_devices_TO_running_metric_samples_1" FOREIGN KEY (
	"device_id"
)
REFERENCES "user_devices" (
	"id"
);

ALTER TABLE "running_session_splits" ADD CONSTRAINT "FK_running_sessions_TO_running_session_splits_1" FOREIGN KEY (
	"running_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "courses" ADD CONSTRAINT "FK_regions_TO_courses_1" FOREIGN KEY (
	"region_code"
)
REFERENCES "regions" (
	"region_code"
);

-- Logical uniqueness, including the reference key for comment parents.

ALTER TABLE "users" ADD CONSTRAINT "uq_users_login_id" UNIQUE ("login_id");

ALTER TABLE "user_profiles" ADD CONSTRAINT "uq_user_profiles_user_id" UNIQUE ("user_id");

ALTER TABLE "user_settings" ADD CONSTRAINT "uq_user_settings_user_id" UNIQUE ("user_id");

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "uq_daily_health_metrics_user_id_metric_date" UNIQUE ("user_id", "metric_date");

ALTER TABLE "daily_readiness" ADD CONSTRAINT "uq_daily_readiness_user_id_readiness_date" UNIQUE ("user_id", "readiness_date");

ALTER TABLE "course_bookmarks" ADD CONSTRAINT "uq_course_bookmarks_user_id_course_id" UNIQUE ("user_id", "course_id");

ALTER TABLE "post_likes" ADD CONSTRAINT "uq_post_likes_post_id_user_id" UNIQUE ("post_id", "user_id");

ALTER TABLE "user_follows" ADD CONSTRAINT "uq_user_follows_follower_id_followee_id" UNIQUE ("follower_id", "followee_id");

ALTER TABLE "course_environment_tags" ADD CONSTRAINT "uq_course_environment_tags_course_id_environment_type" UNIQUE ("course_id", "environment_type");

ALTER TABLE "group_run_participants" ADD CONSTRAINT "uq_group_run_participants_group_run_id_user_id" UNIQUE ("group_run_id", "user_id");

ALTER TABLE "pace_plan_segments" ADD CONSTRAINT "uq_pace_plan_segments_pace_plan_id_segment_sequence" UNIQUE ("pace_plan_id", "segment_sequence");

ALTER TABLE "running_session_splits" ADD CONSTRAINT "uq_running_session_splits_running_session_id_start_distance" UNIQUE ("running_session_id", "start_distance");

ALTER TABLE "crew_memberships" ADD CONSTRAINT "uq_crew_memberships_crew_id_user_id" UNIQUE ("crew_id", "user_id");

ALTER TABLE "sync_batches" ADD CONSTRAINT "uq_sync_batches_device_id_client_batch_id" UNIQUE ("device_id", "client_batch_id");

ALTER TABLE "comments" ADD CONSTRAINT "uq_comments_post_id_id" UNIQUE ("post_id", "id");

ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_parent_same_post"
    FOREIGN KEY ("post_id", "parent_comment_id") REFERENCES "comments" ("post_id", "id");

-- NULL remains valid where a value is optional or not yet measured.

ALTER TABLE "user_profiles" ADD CONSTRAINT "ck_user_profiles_values"
    CHECK (
        "average_pace" > 0
        AND "distance" > 0
        AND "duraction" > 0
        AND "average_pace" <> 'NaN'::numeric
    );

ALTER TABLE "crews" ADD CONSTRAINT "ck_crews_capacity"
    CHECK ("capacity" BETWEEN 1 AND 200);

ALTER TABLE "group_runs" ADD CONSTRAINT "ck_group_runs_values"
    CHECK (
        "goal_distance" > 0
        AND "goal_duration" > 0
    );

ALTER TABLE "running_sessions" ADD CONSTRAINT "ck_running_sessions_values"
    CHECK (
        "goal_distance" > 0
        AND "goal_duration" > 0
        AND "goal_pace" > 0
        AND "total_distance" >= 0
        AND "moving_duration" >= 0
        AND "elapsed_duration" >= 0
        AND "moving_duration_to_goal" >= 0
        AND "average_pace" > 0
        AND "goal_pace" <> 'NaN'::numeric
        AND "total_distance" <> 'NaN'::numeric
        AND "average_pace" <> 'NaN'::numeric
    );

ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_values"
    CHECK (
        "distance" >= 0
        AND "distance" <> 'NaN'::numeric
    );

ALTER TABLE "pace_plans" ADD CONSTRAINT "ck_pace_plans_values"
    CHECK (
        "recommended_pace" > 0
        AND "route_progress" >= 0
        AND "recommended_pace" <> 'NaN'::numeric
        AND "route_progress" <> 'NaN'::numeric
    );

ALTER TABLE "pace_plan_segments" ADD CONSTRAINT "ck_pace_plan_segments_values"
    CHECK (
        "segment_sequence" > 0
        AND "start_distance" >= 0
        AND "end_distance" > "start_distance"
        AND "recommended_pace" > 0
        AND "start_distance" <> 'NaN'::numeric
        AND "end_distance" <> 'NaN'::numeric
        AND "recommended_pace" <> 'NaN'::numeric
    );

ALTER TABLE "running_session_splits" ADD CONSTRAINT "ck_running_session_splits_values"
    CHECK (
        "start_distance" >= 0
        AND "end_distance" > "start_distance"
        AND "start_distance" <> 'NaN'::numeric
        AND "end_distance" <> 'NaN'::numeric
        AND ("pace" IS NULL OR ("pace" > 0 AND "pace" <> 'NaN'::numeric))
        AND ("average_heart_rate" IS NULL OR ("average_heart_rate" > 0 AND "average_heart_rate" <> 'NaN'::numeric))
        AND ("average_cadence" IS NULL OR ("average_cadence" >= 0 AND "average_cadence" <> 'NaN'::numeric))
    );

ALTER TABLE "running_route_points" ADD CONSTRAINT "ck_running_route_points_values"
    CHECK (
        "accuracy" >= 0
        AND "accuracy" <> 'NaN'::numeric
    );

ALTER TABLE "running_metric_samples" ADD CONSTRAINT "ck_running_metric_samples_values"
    CHECK (
        "elapsed_duration" >= 0
        AND "total_distance" >= 0
        AND "route_progress" >= 0
        AND "total_distance" <> 'NaN'::numeric
        AND "route_progress" <> 'NaN'::numeric
    );

ALTER TABLE "coaching_decisions" ADD CONSTRAINT "ck_coaching_decisions_values"
    CHECK (
        "elapsed_duration" >= 0
        AND "recommended_pace" > 0
        AND "route_progress" >= 0
        AND "recommended_pace" <> 'NaN'::numeric
        AND "route_progress" <> 'NaN'::numeric
    );

ALTER TABLE "coaching_decisions" ADD CONSTRAINT "ck_coaching_decisions_coaching_level"
    CHECK ("coaching_level" IS NULL OR "coaching_level" IN ('OK', 'CAUTION', 'DANGER'));

ALTER TABLE "daily_health_metrics" ADD CONSTRAINT "ck_daily_health_metrics_rhr_revision"
    CHECK ("rhr_revision" IS NULL OR "rhr_revision" >= 1);

ALTER TABLE "user_follows" ADD CONSTRAINT "ck_user_follows_values"
    CHECK (
        "follower_id" <> "followee_id"
    );

ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_values"
    CHECK (
        "parent_comment_id" IS NULL OR "parent_comment_id" <> "id"
    );

-- The database is the only writer of updated_at during updates.

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $updated_at$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$updated_at$;

CREATE TRIGGER "trg_daily_readiness_updated_at"
    BEFORE UPDATE ON "daily_readiness"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_users_updated_at"
    BEFORE UPDATE ON "users"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_group_runs_updated_at"
    BEFORE UPDATE ON "group_runs"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_crew_memberships_updated_at"
    BEFORE UPDATE ON "crew_memberships"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_courses_updated_at"
    BEFORE UPDATE ON "courses"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_user_profiles_updated_at"
    BEFORE UPDATE ON "user_profiles"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_daily_health_metrics_updated_at"
    BEFORE UPDATE ON "daily_health_metrics"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_posts_updated_at"
    BEFORE UPDATE ON "posts"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_crews_updated_at"
    BEFORE UPDATE ON "crews"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_running_sessions_updated_at"
    BEFORE UPDATE ON "running_sessions"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_comments_updated_at"
    BEFORE UPDATE ON "comments"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_course_bookmarks_updated_at"
    BEFORE UPDATE ON "course_bookmarks"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER "trg_user_settings_updated_at"
    BEFORE UPDATE ON "user_settings"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 173 온라인 MVP: 현재 상태 저장, 최소한의 명령 결과 기록, 오래된 코칭 적용 방지.
ALTER TABLE running_sessions ADD CONSTRAINT fk_session_control_device
    FOREIGN KEY (control_device_id) REFERENCES user_devices(id);
ALTER TABLE running_sessions ADD CONSTRAINT fk_session_relay_device
    FOREIGN KEY (relay_device_id) REFERENCES user_devices(id);
ALTER TABLE running_sessions ADD CONSTRAINT ck_session_protocol_active
    CHECK (state_version > 0 OR status NOT IN ('RUNNING','PAUSED'));
ALTER TABLE coaching_decisions ADD CONSTRAINT ck_coaching_context CHECK (
    (based_on_state_version IS NULL AND expires_at IS NULL)
    OR (based_on_state_version IS NOT NULL AND based_on_state_version >= 1
        AND expires_at IS NOT NULL AND created_at < expires_at
        AND expires_at <= created_at + INTERVAL '20 seconds'));
ALTER TABLE coaching_decisions ADD CONSTRAINT uq_coaching_session_id UNIQUE (session_id,id);

CREATE TABLE session_control_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES running_sessions(id),
    device_id BIGINT NOT NULL REFERENCES user_devices(id),
    action "session_control_events_action_enum" NOT NULL,
    target_bpm INTEGER NULL CHECK (target_bpm BETWEEN 60 AND 220),
    expected_version BIGINT NOT NULL CHECK (expected_version >= 1),
    coaching_id BIGINT NULL,
    result "session_control_events_result_enum" DEFAULT 'PENDING' NOT NULL,
    applied_at TIMESTAMPTZ NULL,
    reason_code VARCHAR(64) NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_control_version UNIQUE (session_id,expected_version),
    CONSTRAINT uq_control_coaching UNIQUE (session_id,coaching_id),
    CONSTRAINT fk_control_coaching FOREIGN KEY (session_id,coaching_id) REFERENCES coaching_decisions(session_id,id),
    CONSTRAINT ck_control_coaching CHECK ((action = 'COACHING') = (coaching_id IS NOT NULL)),
    CONSTRAINT ck_control_target CHECK ((action IN ('SET_BPM','COACHING')) = (target_bpm IS NOT NULL)),
    CONSTRAINT ck_control_result CHECK ((result = 'APPLIED') = (applied_at IS NOT NULL)),
    CONSTRAINT ck_control_ignored CHECK (result <> 'IGNORED' OR action = 'COACHING')
);
CREATE UNIQUE INDEX uq_control_pending ON session_control_events(session_id,device_id)
    WHERE result IN ('PENDING','UNKNOWN');
CREATE INDEX ix_control_session_time ON session_control_events(session_id,created_at);

-- S15P31E105-222 nickname uniqueness (V4).
CREATE UNIQUE INDEX "uq_users_nickname" ON "users" ("nickname") WHERE account_status='ACTIVE';

-- S15P31E105-251 (V5): 회원별·유형별 연결 중(unlinked_at IS NULL) 기기는 하나만 허용한다.
CREATE UNIQUE INDEX uq_user_devices_active ON user_devices(user_id,device_type)
    WHERE unlinked_at IS NULL;

-- S15P31E105-255 (V8): 회원별 활성 세션(READY/RUNNING/PAUSED, state_version>=1, 미삭제)은 하나만 허용한다.
-- 기존 기록(state_version=0)은 제외한다. S01의 회원별 생성 잠금을 DB에서 한 번 더 보장한다.
CREATE UNIQUE INDEX uq_running_sessions_active ON running_sessions(user_id)
    WHERE status IN ('READY','RUNNING','PAUSED') AND state_version >= 1 AND deleted_at IS NULL;

-- S15P31E105-409 (V11): FK는 인덱스를 자동 생성하지 않는다. 사용자별 완료 러닝의 종료 시각 최근순 조회(AI09·AI04 등)용.
CREATE INDEX idx_running_sessions_user_ended ON running_sessions (user_id, ended_at DESC);

-- S15P31E105-421 (V13): 세션별 경과시간 순 측정값 조회(AI04 실시간 코칭 history, 세션당 15초마다)용. FK 인덱스가 없어 전체 스캔하던 조회다.
CREATE INDEX idx_running_metric_samples_session_elapsed ON running_metric_samples (running_session_id, elapsed_duration);

-- S15P31E105-534 (V20): 팔로우받는 회원 기준 승인 여부별 관계 최신순 조회(U26 팔로워 목록·U24 받은 요청·팔로워 수)용. FK 인덱스가 없어 전체 스캔하던 조회다.
CREATE INDEX idx_user_follows_followee_created ON user_follows (followee_id, is_approved, created_at DESC, id DESC);

-- S15P31E105-386 (implementation S15P31E105-245): users PK 정의 이후 FK 추가. 논리 탈퇴는 서비스에서 삭제한다.
ALTER TABLE "user_recommendation_preferences"
    ADD CONSTRAINT "FK_users_TO_user_recommendation_preferences"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

-- S15P31E105-410 (V12): AI06 개인화 결과. users PK 정의 이후 FK.
ALTER TABLE "user_hr_personalization"
    ADD CONSTRAINT "FK_users_TO_user_hr_personalization_1"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
CREATE TABLE follow_request_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id BIGINT NOT NULL UNIQUE,
    requester_id BIGINT NOT NULL REFERENCES users(id),
    target_id BIGINT NOT NULL REFERENCES users(id),
    result VARCHAR(16) NOT NULL CHECK (result IN ('APPROVED','REJECTED','CANCELLED')),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (requester_id <> target_id)
);

COMMENT ON TABLE follow_request_history IS 'U25 재전송 판별용 처리 이력. 자동 삭제하지 않으며 현재 관계의 집계·인가에는 사용하지 않는다. request_id는 삭제될 수 있는 user_follows.id이므로 해당 행 FK를 두지 않는다.';

-- S15P31E105-297 (V15): 코스 지형 기준 1km 구간 난이도 비율(AI05 segmentDifficultyRatios). 코스당 1행. courses PK 정의 이후 FK.
CREATE TABLE "course_segment_difficulties" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "course_id" BIGINT NOT NULL,
    "distance_m" NUMERIC(12,2) NOT NULL,
    "ratios" JSONB NOT NULL,
    "planner_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_COURSE_SEGMENT_DIFFICULTIES" PRIMARY KEY ("id"),
    CONSTRAINT "uq_course_segment_difficulties_course" UNIQUE ("course_id"),
    CONSTRAINT "FK_courses_TO_course_segment_difficulties_1"
        FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE,
    CONSTRAINT "ck_course_segment_difficulties_distance_positive"
        CHECK ("distance_m" > 0),
    CONSTRAINT "ck_course_segment_difficulties_ratios_array"
        CHECK (jsonb_typeof("ratios") = 'array' AND jsonb_array_length("ratios") BETWEEN 1 AND 45)
);

COMMENT ON TABLE "course_segment_difficulties" IS '코스 지형 기준 1km 구간 난이도 비율(AI05 segmentDifficultyRatios). 코스당 1행이며 사용자와 무관하다.';
COMMENT ON COLUMN "course_segment_difficulties"."course_id" IS '코스 ID. 코스당 1행(UNIQUE)';
COMMENT ON COLUMN "course_segment_difficulties"."distance_m" IS '비율 계산 기준 코스 거리(m). 구간 수는 이 거리를 1km로 나눈 올림이다.';
COMMENT ON COLUMN "course_segment_difficulties"."ratios" IS '0m부터 1km 구간 순서의 양수 상대 비율 배열(마지막은 남은 거리). 클수록 힘든 구간이며 절대 크기는 의미가 없다.';
COMMENT ON COLUMN "course_segment_difficulties"."planner_version" IS '계산한 AI05 plannerVersion. 계산 방식이 바뀐 뒤 재계산 대상을 찾는 데 쓴다.';
COMMENT ON COLUMN "course_segment_difficulties"."created_at" IS '저장일시';


-- S15P31E105-248: serialize resource writes with withdrawal, without new tables.
CREATE FUNCTION runway_guard_active_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner_id bigint;
    second_owner bigint;
    related_id bigint;
    account record;
    parent_deleted timestamptz;
    session_owned boolean;
BEGIN
    related_id := (to_jsonb(NEW)->>TG_ARGV[1])::bigint;
    IF TG_ARGV[0] = 'user' THEN owner_id := related_id;
    ELSIF TG_ARGV[0] = 'session' THEN
        SELECT user_id INTO owner_id FROM running_sessions WHERE id=related_id FOR SHARE;
    ELSIF TG_ARGV[0] = 'device' THEN
        SELECT user_id INTO owner_id FROM user_devices WHERE id=related_id;
    ELSIF TG_ARGV[0] = 'plan' THEN
        SELECT s.user_id INTO owner_id FROM pace_plans p
            JOIN running_sessions s ON s.id=p.session_id WHERE p.id=related_id FOR SHARE OF s;
    END IF;
    IF TG_TABLE_NAME = 'user_follows' THEN
        second_owner := (to_jsonb(NEW)->>'followee_id')::bigint;
    ELSIF TG_TABLE_NAME = 'follow_request_history' THEN
        second_owner := (to_jsonb(NEW)->>'target_id')::bigint;
    END IF;
    -- Session writers serialize on their parent session, which withdrawal locks before scrubbing.
    -- They must not lock users after sessions: W04 and existing W07 have a different lock order.
    session_owned := TG_ARGV[0] IN ('session','plan')
        OR (TG_TABLE_NAME='running_sessions' AND TG_OP='UPDATE');
    IF TG_TABLE_NAME='sync_batches' AND related_id IS NULL THEN
        SELECT user_id INTO owner_id FROM user_devices
            WHERE id=(to_jsonb(NEW)->>'device_id')::bigint;
        session_owned := false;
    END IF;
    IF session_owned THEN
        FOR account IN SELECT account_status::text AS state,withdrawn_at FROM users
            WHERE id=owner_id
        LOOP
            IF account.state <> 'ACTIVE' OR account.withdrawn_at IS NOT NULL THEN
                RAISE EXCEPTION 'Resource owner is not active'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_owner';
            END IF;
        END LOOP;
    ELSE
        -- A missing owner remains the original FK violation. Never wait in reverse lock order.
        FOR account IN SELECT account_status::text AS state,withdrawn_at FROM users
            WHERE id=ANY(ARRAY[owner_id,second_owner]) ORDER BY id FOR KEY SHARE NOWAIT
        LOOP
            IF account.state <> 'ACTIVE' OR account.withdrawn_at IS NOT NULL THEN
                RAISE EXCEPTION 'Resource owner is not active'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_owner';
            END IF;
        END LOOP;
    END IF;
    IF TG_OP = 'INSERT' THEN
        related_id := NULL;
        IF TG_TABLE_NAME IN ('comments','post_likes') THEN related_id := (to_jsonb(NEW)->>'post_id')::bigint;
        ELSIF TG_TABLE_NAME = 'notifications' AND to_jsonb(NEW)->>'notification_type'='POST_COMMENT' THEN
            related_id := (to_jsonb(NEW)->>'target_id')::bigint;
        END IF;
        IF related_id IS NOT NULL THEN
            SELECT deleted_at INTO parent_deleted FROM posts WHERE id=related_id FOR SHARE;
            IF FOUND AND parent_deleted IS NOT NULL THEN
                RAISE EXCEPTION 'Parent post is unavailable'
                    USING ERRCODE='23514',CONSTRAINT='rw_active_post';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE spec record;
BEGIN
    FOR spec IN SELECT * FROM (VALUES
        ('user_profiles','user','user_id'),
        ('user_settings','user','user_id'),
        ('user_recommendation_preferences','user','user_id'),
        ('user_hr_personalization','user','user_id'),
        ('daily_health_metrics','user','user_id'),
        ('daily_readiness','user','user_id'),
        ('course_bookmarks','user','user_id'),
        ('post_likes','user','user_id'),
        ('user_follows','user','follower_id'),
        ('follow_request_history','user','requester_id'),
        ('notifications','user','user_id'),
        ('user_devices','user','user_id'),
        ('crew_memberships','user','user_id'),
        ('crews','user','owner_id'),
        ('group_runs','user','host_id'),
        ('group_run_participants','user','user_id'),
        ('posts','user','author_id'),
        ('comments','user','author_id'),
        ('running_sessions','user','user_id'),
        ('running_metric_samples','session','running_session_id'),
        ('running_route_points','session','running_session_id'),
        ('running_session_splits','session','running_session_id'),
        ('session_control_events','session','session_id'),
        ('coaching_decisions','session','session_id'),
        ('pace_plans','session','session_id'),
        ('pace_plan_segments','plan','pace_plan_id'),
        ('sync_batches','session','session_id')
    ) AS guards(table_name,owner_kind,owner_column)
    LOOP
        EXECUTE format('CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON %I '
            || 'FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner(%L,%L)',
            spec.table_name,spec.owner_kind,spec.owner_column);
    END LOOP;
END;
$$;
