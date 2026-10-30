-- S15P31E105-258: H03 1km 실측 구간 집계 저장. V1~V3는 수정하지 않는다.
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

ALTER TABLE "running_session_splits" ADD CONSTRAINT "PK_RUNNING_SESSION_SPLITS" PRIMARY KEY (
	"id"
);

ALTER TABLE "running_session_splits" ADD CONSTRAINT "FK_running_sessions_TO_running_session_splits_1" FOREIGN KEY (
	"running_session_id"
)
REFERENCES "running_sessions" (
	"id"
);

ALTER TABLE "running_session_splits" ADD CONSTRAINT "uq_running_session_splits_running_session_id_start_distance" UNIQUE ("running_session_id", "start_distance");

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
