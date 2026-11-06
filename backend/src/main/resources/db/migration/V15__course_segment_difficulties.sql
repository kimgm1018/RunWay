-- S15P31E105-297. 코스 지형 기준 1km 구간 난이도 비율(AI05 segmentDifficultyRatios) 저장.
-- 생성 코스 저장 커밋 후 백엔드가 AI05를 미리 호출해 코스당 한 번 저장하고, 세션 생성·목표 변경은 이 값만 읽는다.
-- 비율은 항상 통째로 읽고 쓰므로 구간 행 대신 JSONB 배열 하나로 둔다. 기존 테이블과 데이터는 바뀌지 않는다.
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
