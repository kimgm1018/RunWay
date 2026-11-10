-- S15P31E105-612. 코스 썸네일 PNG 저장 위치.
-- 생성 코스 저장 커밋 후(또는 기동 시 일괄 채우기) 백엔드가 Route 내부 API(POST /internal/v1/basemaps)로 지형지물·건물을 받아 PNG를 그리고,
-- 이미지 볼륨(ADR-0016)에 저장한 키를 코스당 1행으로 기록한다. C03 코스 상세는 이 키로 이미지 URL을 만든다. 기존 테이블과 데이터는 바뀌지 않는다.
-- 모든 테이블의 PK를 IDENTITY id로 두는 스키마 규칙(SchemaIntegrityTest)에 따라 id PK와 course_id UNIQUE로 둔다(V15와 같은 구성).
CREATE TABLE "course_basemaps" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "course_id" BIGINT NOT NULL,
    "image_key" VARCHAR(1024) NULL,
    "osm_data_timestamp" TIMESTAMPTZ NULL,
    "buildings_osm_data_timestamp" TIMESTAMPTZ NULL,
    "render_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_COURSE_BASEMAPS" PRIMARY KEY ("id"),
    CONSTRAINT "uq_course_basemaps_course" UNIQUE ("course_id"),
    CONSTRAINT "FK_courses_TO_course_basemaps_1"
        FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE
);

-- 이미지 조회(F02)는 이미지 ID로 썸네일 행을 찾는다. 키의 파일 이름({uuid}.png) 식 색인으로 테이블 전체를 읽지 않는다.
CREATE INDEX "idx_course_basemaps_image_file" ON "course_basemaps" (split_part("image_key", '/', 4));

CREATE TRIGGER "trg_course_basemaps_updated_at"
    BEFORE UPDATE ON "course_basemaps"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE "course_basemaps" IS '코스 썸네일 PNG(서버가 OSM 지형지물·건물로 그린 그림). 코스당 1행이며 사용자와 무관하다.';
COMMENT ON COLUMN "course_basemaps"."course_id" IS '코스 ID. 코스당 1행(UNIQUE)';
COMMENT ON COLUMN "course_basemaps"."image_key" IS '썸네일 PNG의 이미지 볼륨 키(images/course-basemap/{course_id}/{uuid}.png). Route가 범위 밖(OUT_OF_AREA)이라고 답하면 NULL로 저장해 다시 시도하지 않는다.';
COMMENT ON COLUMN "course_basemaps"."osm_data_timestamp" IS 'Route 전국 자료의 OSM 데이터 기준 시각. 알 수 없으면 NULL';
COMMENT ON COLUMN "course_basemaps"."buildings_osm_data_timestamp" IS 'Route 건물 자료의 OSM 데이터 기준 시각. 건물 자료가 없거나 알 수 없으면 NULL';
COMMENT ON COLUMN "course_basemaps"."render_version" IS '썸네일 그리기 방식 버전. 현재 버전과 다르면 기동 시 일괄 채우기가 다시 그린다';
COMMENT ON COLUMN "course_basemaps"."created_at" IS '저장일시';
COMMENT ON COLUMN "course_basemaps"."updated_at" IS '수정일시';
