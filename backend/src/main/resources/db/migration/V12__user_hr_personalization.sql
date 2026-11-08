-- S15P31E105-410. AI06 ODE 개인화 결과 저장.
-- 합의: docs/design/db/proposals/AI_PERSONALIZATION_ERD_REQUEST.md · ai_personalization.sql
-- user_hr_personalization만 반영. GRU·코스 난이도·coaching 컬럼은 제외.
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

-- 최신 행 인덱스: UNIQUE (user_id, personalization_version)의 역방향 스캔으로
-- WHERE user_id = ? ORDER BY personalization_version DESC LIMIT 1 을 처리한다.
