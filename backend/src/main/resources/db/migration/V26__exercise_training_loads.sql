-- S15P31E105-599 (V26): 운동 1건의 심박 Zone 부하(Edwards TRIMP). RunWay 러닝은 종료 후 분석이 끝나면 서버가 저장한 심박 샘플로,
-- 삼성 헬스 과거 운동은 W06 EXERCISE_HR_SUMMARY(폰이 보낸 bpm별 머문 시간)로 계산해 넣는다.
-- daily_health_metrics.daily_training_load는 날짜별로 이 테이블의 합을 다시 계산한 값이다(RunWay 러닝과 시간이 겹치는 삼성 헬스 운동 제외).
CREATE TABLE "exercise_training_loads" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"source"	VARCHAR(20)		NOT NULL,
	"running_session_id"	BIGINT		NULL,
	"external_id"	VARCHAR(128)		NULL,
	"started_at"	TIMESTAMPTZ		NOT NULL,
	"ended_at"	TIMESTAMPTZ		NOT NULL,
	"metric_date"	DATE		NOT NULL,
	"zone1_seconds"	INTEGER		NOT NULL,
	"zone2_seconds"	INTEGER		NOT NULL,
	"zone3_seconds"	INTEGER		NOT NULL,
	"zone4_seconds"	INTEGER		NOT NULL,
	"zone5_seconds"	INTEGER		NOT NULL,
	"training_load"	NUMERIC(12,4)		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL,
	"updated_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON COLUMN "exercise_training_loads"."id" IS '운동 부하 ID';

COMMENT ON COLUMN "exercise_training_loads"."user_id" IS '회원 ID';

COMMENT ON COLUMN "exercise_training_loads"."source" IS '출처. RUNWAY_SESSION(RunWay 러닝 심박 샘플) 또는 SAMSUNG_HEALTH(W06 삼성 헬스 운동 요약)';

COMMENT ON COLUMN "exercise_training_loads"."running_session_id" IS 'RunWay 러닝 ID. RUNWAY_SESSION만';

COMMENT ON COLUMN "exercise_training_loads"."external_id" IS '폰이 만든 삼성 헬스 운동 식별자. SAMSUNG_HEALTH만';

COMMENT ON COLUMN "exercise_training_loads"."started_at" IS '운동 시작 시각. RunWay 러닝과 겹침 판정에 쓴다';

COMMENT ON COLUMN "exercise_training_loads"."ended_at" IS '운동 종료 시각';

COMMENT ON COLUMN "exercise_training_loads"."metric_date" IS '일별 부하를 넣을 날짜. RunWay 러닝은 시작 시각의 Asia/Seoul 날짜, 삼성 헬스는 폰 시간대 시작 날짜';

COMMENT ON COLUMN "exercise_training_loads"."zone1_seconds" IS '심박 Zone1 머문 시간(초)';

COMMENT ON COLUMN "exercise_training_loads"."zone2_seconds" IS '심박 Zone2 머문 시간(초)';

COMMENT ON COLUMN "exercise_training_loads"."zone3_seconds" IS '심박 Zone3 머문 시간(초)';

COMMENT ON COLUMN "exercise_training_loads"."zone4_seconds" IS '심박 Zone4 머문 시간(초)';

COMMENT ON COLUMN "exercise_training_loads"."zone5_seconds" IS '심박 Zone5 머문 시간(초)';

COMMENT ON COLUMN "exercise_training_loads"."training_load" IS '운동 부하(Edwards TRIMP, Zone 분 × Zone 번호 합)';

COMMENT ON COLUMN "exercise_training_loads"."created_at" IS '생성일시';

COMMENT ON COLUMN "exercise_training_loads"."updated_at" IS '수정일시';

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "PK_EXERCISE_TRAINING_LOADS" PRIMARY KEY (
	"id"
);

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "FK_users_TO_exercise_training_loads_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "FK_running_sessions_TO_exercise_training_loads_1" FOREIGN KEY (
	"running_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "uq_exercise_training_loads_running_session_id" UNIQUE ("running_session_id");

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "uq_exercise_training_loads_user_id_source_external_id" UNIQUE ("user_id", "source", "external_id");

ALTER TABLE "exercise_training_loads" ADD CONSTRAINT "ck_exercise_training_loads_values"
    CHECK (
        (("source" = 'RUNWAY_SESSION' AND "running_session_id" IS NOT NULL AND "external_id" IS NULL)
         OR ("source" = 'SAMSUNG_HEALTH' AND "running_session_id" IS NULL AND "external_id" IS NOT NULL))
        AND "ended_at" >= "started_at"
        AND "zone1_seconds" >= 0 AND "zone2_seconds" >= 0 AND "zone3_seconds" >= 0
        AND "zone4_seconds" >= 0 AND "zone5_seconds" >= 0
        AND "training_load" >= 0 AND "training_load" <> 'NaN'::numeric
    );

CREATE INDEX "idx_exercise_training_loads_user_id_metric_date" ON "exercise_training_loads" ("user_id", "metric_date");

CREATE INDEX "idx_exercise_training_loads_user_id_started_at" ON "exercise_training_loads" ("user_id", "started_at");

CREATE TRIGGER "trg_exercise_training_loads_updated_at"
    BEFORE UPDATE ON "exercise_training_loads"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 탈퇴(V17)와 같은 쓰기 차단. 탈퇴 회원 행에 부하를 새로 넣거나 바꾸지 않는다. 탈퇴 정리(WithdrawalRepository.scrub)가 이 테이블 행을 지운다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "exercise_training_loads"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');
