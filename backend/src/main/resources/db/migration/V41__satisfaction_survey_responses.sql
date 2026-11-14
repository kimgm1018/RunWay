-- S15P31E105-813 (V41): 서비스 만족도 조사 응답. SV01(satisfaction-surveys.md)로 회원이 1~5점과 선택 의견을 제출한다.
-- 같은 회원의 여러 번 제출을 허용하므로 회원 기준 UNIQUE가 없다. 기간 집계(응답 수·평균 점수)는 created_at 범위로 읽는다.
-- 회원 탈퇴(U18)는 응답 행과 의견을 그대로 보존한다(사용자 결정, 2026-11-14). users 행은 탈퇴 후에도 남으므로 FK에 영향이 없다.
-- V40(running_session_basemaps) 다음 번호다.
CREATE TABLE "satisfaction_survey_responses" (
	"id"	BIGINT GENERATED ALWAYS AS IDENTITY		NOT NULL,
	"user_id"	BIGINT		NOT NULL,
	"score"	SMALLINT		NOT NULL,
	"comment"	VARCHAR(1000)		NULL,
	"source"	VARCHAR(20)		NOT NULL,
	"created_at"	TIMESTAMPTZ	DEFAULT now()	NOT NULL
);

COMMENT ON TABLE "satisfaction_survey_responses" IS '서비스 만족도 조사 응답. 회원이 여러 번 제출할 수 있고 탈퇴 후에도 보존한다';

COMMENT ON COLUMN "satisfaction_survey_responses"."id" IS '응답 ID';

COMMENT ON COLUMN "satisfaction_survey_responses"."user_id" IS '제출한 회원 ID';

COMMENT ON COLUMN "satisfaction_survey_responses"."score" IS '전체 만족도 1~5점';

COMMENT ON COLUMN "satisfaction_survey_responses"."comment" IS '선택 의견. 앞뒤 공백 제거 후 1~1000자, 없으면 NULL';

COMMENT ON COLUMN "satisfaction_survey_responses"."source" IS '제출 경로. RUN_RESULT(러닝 결과 화면 안내) 또는 SETTINGS(설정 화면 진입)';

COMMENT ON COLUMN "satisfaction_survey_responses"."created_at" IS '제출 시각. 기간 집계 기준';

ALTER TABLE "satisfaction_survey_responses" ADD CONSTRAINT "PK_SATISFACTION_SURVEY_RESPONSES" PRIMARY KEY (
	"id"
);

ALTER TABLE "satisfaction_survey_responses" ADD CONSTRAINT "FK_users_TO_satisfaction_survey_responses_1" FOREIGN KEY (
	"user_id"
)
REFERENCES "users" (
	"id"
);

ALTER TABLE "satisfaction_survey_responses" ADD CONSTRAINT "ck_satisfaction_survey_responses_score"
    CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "satisfaction_survey_responses" ADD CONSTRAINT "ck_satisfaction_survey_responses_source"
    CHECK ("source" IN ('RUN_RESULT', 'SETTINGS'));

ALTER TABLE "satisfaction_survey_responses" ADD CONSTRAINT "ck_satisfaction_survey_responses_comment"
    CHECK ("comment" IS NULL OR ("comment" = btrim("comment") AND length("comment") BETWEEN 1 AND 1000));

-- 기간별 응답 수·평균 점수 집계(created_at 반열린 구간) 조회용.
CREATE INDEX "idx_satisfaction_survey_responses_created_at" ON "satisfaction_survey_responses" ("created_at");

-- 탈퇴(V17)와 같은 쓰기 차단. 탈퇴(진행) 회원의 새 응답 저장을 거절한다.
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "satisfaction_survey_responses"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('user', 'user_id');
