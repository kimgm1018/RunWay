package com.runway.backend.domain.course.basemap;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code course_basemaps} 저장·조회와 썸네일을 그리는 데 필요한 코스 값 조회(S15P31E105-612). */
@Repository
public class CourseBasemapRepository {

    private final JdbcTemplate jdbcTemplate;

    public CourseBasemapRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 이 그리기 버전의 행이 이미 있는지. 행이 없거나 버전이 다르면 false(다시 그릴 대상). */
    public boolean isRendered(long courseId, String renderVersion) {
        Boolean exists =
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM course_basemaps WHERE course_id = ? AND render_version = ?)",
                        Boolean.class,
                        courseId,
                        renderVersion);
        return Boolean.TRUE.equals(exists);
    }

    /** C03 응답용 저장값. 행이 없으면 빈 값. */
    public Optional<StoredBasemap> find(long courseId) {
        return jdbcTemplate
                .query(
                        "SELECT image_key, osm_data_timestamp FROM course_basemaps WHERE course_id = ?",
                        (rs, n) ->
                                new StoredBasemap(
                                        rs.getString("image_key"),
                                        instant(rs.getObject("osm_data_timestamp", OffsetDateTime.class))),
                        courseId)
                .stream()
                .findFirst();
    }

    /** 코스 상태. 코스가 없으면 빈 값. */
    public Optional<String> findCourseStatus(long courseId) {
        return jdbcTemplate
                .queryForList("SELECT status::text FROM courses WHERE id = ? AND is_private=false", String.class, courseId)
                .stream()
                .findFirst();
    }

    /** 코스 경로 좌표({@code [lon, lat]}) 순서대로. 코스가 없으면 빈 목록. */
    public List<double[]> findCourseRoute(long courseId) {
        return jdbcTemplate.query(
                """
                SELECT ST_X(d.geom) AS lon, ST_Y(d.geom) AS lat
                FROM courses c, ST_DumpPoints(c.route::geometry) d
                WHERE c.id = ?
                ORDER BY d.path
                """,
                (rs, n) -> new double[] {rs.getDouble("lon"), rs.getDouble("lat")},
                courseId);
    }

    /**
     * 이 그리기 버전의 바탕 지도가 없는 ACTIVE 코스 ID(오름차순, 최대 limit개). 행이 없거나 이전 버전으로 그린 코스다. 기동 시 일괄
     * 채우기 대상이다.
     */
    public List<Long> findActiveCourseIdsNeedingRender(String renderVersion, int limit) {
        return jdbcTemplate.queryForList(
                """
                SELECT c.id FROM courses c
                WHERE c.status = 'ACTIVE'
                  AND c.is_private = false
                  AND NOT EXISTS (SELECT 1 FROM course_basemaps b
                                  WHERE b.course_id = c.id AND b.render_version = ?)
                ORDER BY c.id
                LIMIT ?
                """,
                Long.class,
                renderVersion,
                limit);
    }

    /**
     * 썸네일 행을 저장한다. 행이 없으면 넣고, 다른 그리기 버전의 행이면 바꾼다. 같은 버전 행이 이미 있으면 바꾸지 않는다(동시 실행·여러
     * 서버에서 먼저 저장한 쪽 유지).
     *
     * @param imageKey 이미지 볼륨 키. 범위 밖이라 이미지가 없으면 null
     * @return 넣거나 바꿨으면 true
     */
    public boolean upsert(
            long courseId,
            String imageKey,
            Instant osmDataTimestamp,
            Instant buildingsOsmDataTimestamp,
            String renderVersion) {
        int rows =
                jdbcTemplate.update(
                        """
                        INSERT INTO course_basemaps(
                            course_id, image_key, osm_data_timestamp, buildings_osm_data_timestamp, render_version)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (course_id) DO UPDATE SET
                            image_key = EXCLUDED.image_key,
                            osm_data_timestamp = EXCLUDED.osm_data_timestamp,
                            buildings_osm_data_timestamp = EXCLUDED.buildings_osm_data_timestamp,
                            render_version = EXCLUDED.render_version
                        WHERE course_basemaps.render_version <> EXCLUDED.render_version
                        """,
                        courseId,
                        imageKey,
                        offset(osmDataTimestamp),
                        offset(buildingsOsmDataTimestamp),
                        renderVersion);
        return rows == 1;
    }

    private static OffsetDateTime offset(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    /**
     * @param imageKey 썸네일 이미지 볼륨 키. 범위 밖이라 이미지가 없으면 null
     * @param osmDataTimestamp OSM 데이터 기준 시각. 없으면 null
     */
    public record StoredBasemap(String imageKey, Instant osmDataTimestamp) {}
}
