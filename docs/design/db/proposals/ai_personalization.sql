-- 제안 전용 migration 초안. 팀 합의 전에는 실행하지 않는다.
-- 승인 후 backend/src/main/resources/db/migration/V<번호>__ai_personalization.sql 형태로 옮긴다.
-- 팀 dev에 이미 V9(`V9__daily_health_metrics_rhr_revision.sql`)가 있으므로 V10 이상, 번호는 팀이 정함.
-- 현재 schema.sql / Flyway migration 원본은 이 패키지에서 변경하지 않는다.

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
    CONSTRAINT "FK_users_TO_user_hr_personalization_1"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
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
    -- AI 코드 검증(ai/service/app/hr_threshold_lookup.py: 0 <= count <= 20)과 같은 범위. 최근 20러닝까지만 쓴다.
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

-- 최신 행 인덱스: 별도로 만들지 않는다.
-- AI 조회(db_lookup.py PERSONALIZATION_SQL·HR_THRESHOLD_SQL)는
--   WHERE user_id = ? ORDER BY personalization_version DESC LIMIT 1
-- 이다. 위 UNIQUE ("user_id", "personalization_version") 제약이 만드는 B-tree 인덱스를 PostgreSQL이
-- 역방향(Index Scan Backward)으로 읽어 이 조회를 그대로 처리한다. 그래서 ("user_id", "personalization_version" DESC)
-- 인덱스를 따로 만들면 같은 열의 중복 인덱스가 되어 쓰기·저장 비용만 늘어난다.
-- 예전 초안의 ("user_id", "created_at" DESC) 인덱스는 코드 조회 순서와 달라 쓰이지 않으므로 뺐다.

CREATE TABLE "user_gru_personalization" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "user_id" BIGINT NOT NULL,
    "personalization_version" INTEGER NOT NULL,
    "schema_version" VARCHAR(80) NOT NULL,
    "model_version" VARCHAR(160) NOT NULL,
    "model_sha256" CHAR(64) NOT NULL,
    "support_run_count" INTEGER NOT NULL,
    "support_window_count" INTEGER NOT NULL,
    "head_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_USER_GRU_PERSONALIZATION" PRIMARY KEY ("id"),
    CONSTRAINT "FK_users_TO_user_gru_personalization_1"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
    CONSTRAINT "uq_user_gru_personalization_user_version"
        UNIQUE ("user_id", "personalization_version"),
    CONSTRAINT "ck_user_gru_personalization_version_positive"
        CHECK ("personalization_version" > 0),
    CONSTRAINT "ck_user_gru_personalization_support_run_count_nonnegative"
        CHECK ("support_run_count" >= 0),
    CONSTRAINT "ck_user_gru_personalization_support_window_count_nonnegative"
        CHECK ("support_window_count" >= 0),
    CONSTRAINT "ck_user_gru_personalization_head_object"
        CHECK (jsonb_typeof("head_json") = 'object')
);

COMMENT ON TABLE "user_gru_personalization" IS 'AI06 GRU 개인 출력층. 원본 HR/GPS 시계열은 저장하지 않는다.';
COMMENT ON COLUMN "user_gru_personalization"."id" IS '개인화 행 ID';
COMMENT ON COLUMN "user_gru_personalization"."user_id" IS '회원 ID';
COMMENT ON COLUMN "user_gru_personalization"."personalization_version" IS '회원별 GRU 개인화 버전. 새 계산 결과를 저장할 때 증가한다.';
COMMENT ON COLUMN "user_gru_personalization"."schema_version" IS '개인 출력층 JSON 형식 버전. 현재 runway.gru.head.v1';
COMMENT ON COLUMN "user_gru_personalization"."model_version" IS '개인화 계산에 사용한 GRU 모델 버전';
COMMENT ON COLUMN "user_gru_personalization"."model_sha256" IS '개인화 계산에 사용한 GRU 체크포인트 SHA-256';
COMMENT ON COLUMN "user_gru_personalization"."support_run_count" IS '출력층 계산에 사용한 Support 러닝 수';
COMMENT ON COLUMN "user_gru_personalization"."support_window_count" IS '출력층 계산에서 채점 가능한 Support window 수';
COMMENT ON COLUMN "user_gru_personalization"."head_json" IS 'main·nograde 모델의 [3,256] weight와 [3] bias. 원본 시계열은 포함하지 않는다.';
COMMENT ON COLUMN "user_gru_personalization"."created_at" IS '생성일시';

-- 최신 행 인덱스: 별도로 만들지 않는다(user_hr_personalization과 같은 이유).
-- AI 조회(db_lookup.py GRU_PERSONALIZATION_SQL)는 WHERE user_id = ? ORDER BY personalization_version DESC LIMIT 1이고,
-- UNIQUE ("user_id", "personalization_version") 인덱스의 역방향 읽기로 처리된다. DESC 인덱스를 따로 두면 중복이다.

-- 제안: AI05의 terrain-only segmentDifficultyRatios를 코스별 사전 저장 값으로 제공한다.
-- 코스 route가 바뀌면 해당 코스의 행을 무효화하고 다시 계산한다.
CREATE TABLE "course_segment_difficulty_ratios" (
    "course_id" BIGINT NOT NULL,
    "total_distance_m" NUMERIC(12,2) NOT NULL,
    "segment_count" SMALLINT NOT NULL,
    "segment_sequence" SMALLINT NOT NULL,
    "difficulty_ratio" NUMERIC(10,6) NOT NULL,
    "planner_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_COURSE_SEGMENT_DIFFICULTY_RATIOS" PRIMARY KEY
        ("course_id", "total_distance_m", "segment_count", "segment_sequence"),
    CONSTRAINT "FK_courses_TO_course_segment_difficulty_ratios_1"
        FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE,
    CONSTRAINT "ck_course_segment_difficulty_ratios_distance"
        CHECK ("total_distance_m" > 0 AND "total_distance_m" <> 'NaN'::numeric),
    CONSTRAINT "ck_course_segment_difficulty_ratios_count"
        CHECK ("segment_count" BETWEEN 1 AND 45),
    CONSTRAINT "ck_course_segment_difficulty_ratios_sequence"
        CHECK ("segment_sequence" BETWEEN 1 AND 45),
    CONSTRAINT "ck_course_segment_difficulty_ratios_positive"
        CHECK ("difficulty_ratio" > 0 AND "difficulty_ratio" <> 'NaN'::numeric)
);

COMMENT ON TABLE "course_segment_difficulty_ratios" IS 'AI05가 산출한 코스별 1km terrain-only 난이도 비율. Route 변경 시 재계산한다.';
COMMENT ON COLUMN "course_segment_difficulty_ratios"."segment_sequence" IS '1부터 시작하는 1km 구간 순서. 마지막 구간은 남은 거리';
COMMENT ON COLUMN "course_segment_difficulty_ratios"."difficulty_ratio" IS 'AI05 segmentDifficultyRatios 원소. 양수이며 백엔드가 거리 가중 평균으로 정규화한다.';

-- 선택 제안(O6): 모델/정책 버전을 coaching_decisions에 보존한다.
ALTER TABLE "coaching_decisions"
    ADD COLUMN IF NOT EXISTS "model_version" VARCHAR(160) NULL;
ALTER TABLE "coaching_decisions"
    ADD COLUMN IF NOT EXISTS "policy_version" VARCHAR(80) NULL;

COMMENT ON COLUMN "coaching_decisions"."model_version" IS 'AI04 결정에 사용한 모델 버전';
COMMENT ON COLUMN "coaching_decisions"."policy_version" IS 'AI04 결정에 사용한 정책 버전';
