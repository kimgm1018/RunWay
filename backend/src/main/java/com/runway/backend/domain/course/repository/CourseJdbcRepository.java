package com.runway.backend.domain.course.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CourseJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public CourseJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean existsById(long courseId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM courses WHERE id = ?", Integer.class, courseId);
        return count != null && count > 0;
    }

    public boolean existsUserById(long userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM users WHERE id = ?", Integer.class, userId);
        return count != null && count > 0;
    }

    public Optional<CourseRow> findById(long courseId) {
        List<CourseRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id,
                               description,
                               ST_AsGeoJSON(route::geometry) AS route_geojson,
                               ST_AsGeoJSON(start_position::geometry) AS start_geojson,
                               distance,
                               elevation_gain,
                               elevation_profile::text AS elevation_profile_json,
                               status::text AS status,
                               merged_into_course_id,
                               region_code
                        FROM courses
                        WHERE id = ?
                        """,
                        (rs, rowNum) -> mapCourseRow(rs),
                        courseId);
        return rows.stream().findFirst();
    }

    /**
     * 북마크 멱등 저장. {@code aliasPresent=false}이면 충돌 시 기존 custom_name 유지, 신규면 null. {@code
     * aliasPresent=true}이면 EXCLUDED 값(null 포함)으로 설정.
     */
    public BookmarkUpsertRow upsertBookmark(
            long userId, long courseId, boolean aliasPresent, String alias) {
        String insertAlias = aliasPresent ? alias : null;
        return jdbcTemplate.queryForObject(
                """
                INSERT INTO course_bookmarks(user_id, course_id, custom_name)
                VALUES (?, ?, ?)
                ON CONFLICT (user_id, course_id) DO UPDATE SET
                  custom_name = CASE
                    WHEN ? THEN EXCLUDED.custom_name
                    ELSE course_bookmarks.custom_name
                  END
                RETURNING custom_name, created_at
                """,
                (rs, rowNum) ->
                        new BookmarkUpsertRow(
                                rs.getString("custom_name"),
                                toInstant(rs.getTimestamp("created_at"))),
                userId,
                courseId,
                insertAlias,
                aliasPresent);
    }

    public List<String> findEnvironmentTags(long courseId) {
        return jdbcTemplate.query(
                """
                SELECT environment_type::text AS environment_type
                FROM course_environment_tags
                WHERE course_id = ?
                ORDER BY environment_type
                """,
                (rs, rowNum) -> rs.getString("environment_type"),
                courseId);
    }

    public List<BookmarkedCourseRow> findBookmarkedCourses(
            long userId, Long cursorExclusive, int limit) {
        if (cursorExclusive == null) {
            return jdbcTemplate.query(
                    """
                    SELECT b.id AS bookmark_id,
                           c.id AS course_id,
                           c.region_code,
                           c.status::text AS status,
                           c.merged_into_course_id,
                           b.custom_name,
                           c.distance
                    FROM course_bookmarks b
                    INNER JOIN courses c ON c.id = b.course_id
                    WHERE b.user_id = ?
                    ORDER BY b.id DESC
                    LIMIT ?
                    """,
                    (rs, rowNum) -> mapBookmarkedCourseRow(rs),
                    userId,
                    limit);
        }
        return jdbcTemplate.query(
                """
                SELECT b.id AS bookmark_id,
                       c.id AS course_id,
                       c.region_code,
                       c.status::text AS status,
                       c.merged_into_course_id,
                       b.custom_name,
                       c.distance
                FROM course_bookmarks b
                INNER JOIN courses c ON c.id = b.course_id
                WHERE b.user_id = ?
                  AND b.id < ?
                ORDER BY b.id DESC
                LIMIT ?
                """,
                (rs, rowNum) -> mapBookmarkedCourseRow(rs),
                userId,
                cursorExclusive,
                limit);
    }

    private static CourseRow mapCourseRow(ResultSet rs) throws SQLException {
        Long mergedInto = rs.getObject("merged_into_course_id", Long.class);
        return new CourseRow(
                rs.getLong("id"),
                rs.getString("description"),
                rs.getString("route_geojson"),
                rs.getString("start_geojson"),
                rs.getBigDecimal("distance"),
                rs.getBigDecimal("elevation_gain"),
                rs.getString("elevation_profile_json"),
                rs.getString("status"),
                mergedInto,
                rs.getString("region_code"));
    }

    private static BookmarkedCourseRow mapBookmarkedCourseRow(ResultSet rs) throws SQLException {
        Long mergedInto = rs.getObject("merged_into_course_id", Long.class);
        return new BookmarkedCourseRow(
                rs.getLong("bookmark_id"),
                rs.getLong("course_id"),
                rs.getString("region_code"),
                rs.getString("status"),
                mergedInto,
                rs.getString("custom_name"),
                rs.getBigDecimal("distance"));
    }

    public record CourseRow(
            long id,
            String description,
            String routeGeoJson,
            String startGeoJson,
            BigDecimal distanceM,
            BigDecimal elevationGainM,
            String elevationProfileJson,
            String status,
            Long mergedIntoCourseId,
            String regionCode) {}

    public record BookmarkedCourseRow(
            long bookmarkId,
            long courseId,
            String regionCode,
            String status,
            Long mergedIntoCourseId,
            String customName,
            BigDecimal distanceM) {}

    public record BookmarkUpsertRow(String customName, Instant createdAt) {}

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
