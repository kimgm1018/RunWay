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

ALTER TABLE "user_recommendation_preferences"
    ADD CONSTRAINT "FK_users_TO_user_recommendation_preferences"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
