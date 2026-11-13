-- S15P31E105-756 (ADR-0024). 본인 러닝 기록 경로 썸네일 PNG 저장 위치.
-- 개인 세션 완료 커밋 후(또는 기동 시 일괄 채우기) 백엔드가 Route 내부 API(POST /internal/v1/basemaps)로 지형지물·건물을 받아
-- S11과 같은 표시용 경로로 PNG를 그리고, 이미지 볼륨(ADR-0016)에 저장한 키를 세션당 1행으로 기록한다. 기존 테이블과 데이터는 바뀌지 않는다.
-- 모든 테이블의 PK를 IDENTITY id로 두는 스키마 규칙(SchemaIntegrityTest)에 따라 id PK와 running_session_id UNIQUE로 둔다(V32와 같은 구성).
CREATE TABLE "running_session_basemaps" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "running_session_id" BIGINT NOT NULL,
    "image_key" VARCHAR(1024) NULL,
    "osm_data_timestamp" TIMESTAMPTZ NULL,
    "buildings_osm_data_timestamp" TIMESTAMPTZ NULL,
    "render_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT "PK_RUNNING_SESSION_BASEMAPS" PRIMARY KEY ("id"),
    CONSTRAINT "uq_running_session_basemaps_session" UNIQUE ("running_session_id"),
    CONSTRAINT "FK_running_sessions_TO_running_session_basemaps_1"
        FOREIGN KEY ("running_session_id") REFERENCES "running_sessions" ("id") ON DELETE CASCADE
);

-- 이미지 조회(F02)는 이미지 ID로 썸네일 행을 찾는다. 키의 파일 이름({uuid}.png, 4번째 조각) 식 색인으로 테이블 전체를 읽지 않는다.
CREATE INDEX "idx_running_session_basemaps_image_file" ON "running_session_basemaps" (split_part("image_key", '/', 4));

CREATE TRIGGER "trg_running_session_basemaps_updated_at"
    BEFORE UPDATE ON "running_session_basemaps"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 탈퇴와 쓰기 직렬화(V17 runway_guard_active_owner): 생성 중 탈퇴가 확정되면 행 저장을 거부한다(세션 하위 테이블과 같은 규칙).
CREATE TRIGGER rw_active_owner BEFORE INSERT OR UPDATE ON "running_session_basemaps"
    FOR EACH ROW EXECUTE FUNCTION runway_guard_active_owner('session', 'running_session_id');

COMMENT ON TABLE "running_session_basemaps" IS '본인 러닝 기록 경로 썸네일 PNG(서버가 OSM 지형지물·건물과 표시용 경로로 그린 그림). 세션당 1행이며 기록 주인만 조회한다(ADR-0024).';
COMMENT ON COLUMN "running_session_basemaps"."running_session_id" IS '러닝 세션(기록) ID. 세션당 1행(UNIQUE)';
COMMENT ON COLUMN "running_session_basemaps"."image_key" IS '썸네일 PNG의 이미지 볼륨 키(images/run-route/{user_id}/{uuid}.png). 표시용 경로가 50 m 미만·없음이거나 Route가 범위 밖(OUT_OF_AREA)이면 NULL로 저장해 다시 시도하지 않는다.';
COMMENT ON COLUMN "running_session_basemaps"."osm_data_timestamp" IS 'Route 전국 자료의 OSM 데이터 기준 시각. 알 수 없거나 그림이 없으면 NULL';
COMMENT ON COLUMN "running_session_basemaps"."buildings_osm_data_timestamp" IS 'Route 건물 자료의 OSM 데이터 기준 시각. 건물 자료가 없거나 알 수 없으면 NULL';
COMMENT ON COLUMN "running_session_basemaps"."render_version" IS '썸네일 그리기 방식 버전(코스 썸네일과 같은 값). 현재 버전과 다르면 기동 시 일괄 채우기가 다시 그린다';
COMMENT ON COLUMN "running_session_basemaps"."created_at" IS '저장일시';
COMMENT ON COLUMN "running_session_basemaps"."updated_at" IS '수정일시';
