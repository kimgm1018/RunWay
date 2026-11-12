package com.runway.backend.domain.course.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
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

    /** 공유 철회·게시글 삭제와 북마크 생성의 순서를 세션 잠금으로 직렬화한다. */
    public void lockPrivateSourceSession(long courseId) {
        jdbcTemplate.query(
                """
                SELECT s.id FROM courses c JOIN running_sessions s ON s.id=c.source_session_id
                WHERE c.id=? AND c.is_private=true FOR UPDATE OF s
                """,
                rs -> {},
                courseId);
    }

    /** 소유자, 저장한 사용자, 현재 공유 게시글의 독자에게만 개인 코스를 공개한다. */
    public boolean canRead(long userId, long courseId) {
        Boolean allowed = jdbcTemplate.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM courses c WHERE c.id=? AND (
                  c.is_private=false OR c.creator_id=?
                  OR EXISTS (SELECT 1 FROM course_bookmarks b WHERE b.course_id=c.id AND b.user_id=?)
                  OR EXISTS (SELECT 1 FROM posts p
                    JOIN running_sessions s ON s.id=p.session_id
                    JOIN users u ON u.id=p.author_id
                    LEFT JOIN user_settings us ON us.user_id=u.id
                    WHERE s.course_id=c.id AND p.deleted_at IS NULL AND p.course_shared=true
                      AND u.account_status='ACTIVE' AND u.withdrawn_at IS NULL
                      AND (us.account_visibility='PUBLIC' OR EXISTS (
                        SELECT 1 FROM user_follows f WHERE f.followee_id=u.id
                          AND f.follower_id=? AND f.is_approved=true)))))
                """, Boolean.class, courseId, userId, userId, userId);
        return Boolean.TRUE.equals(allowed);
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
                               region_code,
                               unmeasured_edges::text AS unmeasured_edges_json,
                               is_private
                        FROM courses
                        WHERE id = ?
                        """,
                        (rs, rowNum) -> mapCourseRow(rs),
                        courseId);
        return rows.stream().findFirst();
    }

    /**
     * 같은 경로의 생성 코스 저장을 트랜잭션 끝까지 직렬화한다. 호출부 트랜잭션 안에서만 의미가 있다. 해시 충돌은 서로 다른 경로를 함께
     * 기다리게 할 뿐 결과를 바꾸지 않는다.
     */
    public void lockGeneratedRoute(String routeEwkt) {
        jdbcTemplate.query(
                "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                rs -> null,
                routeEwkt);
    }

    /**
     * 좌표 값·순서·방향이 완전히 같은 코스(EWKB 바이트 일치, courses.md 정확히 동일한 경로 기준). ACTIVE가 있으면 그 중 가장
     * 작은 ID, 없으면 다른 상태 중 가장 작은 ID. 거리 등 다른 컬럼은 비교하지 않는다.
     */
    public Optional<ExactRouteRow> findExactRoute(String routeEwkt) {
        List<ExactRouteRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, status::text AS status
                        FROM courses
                        WHERE ST_AsEWKB(route::geometry) = ST_AsEWKB(ST_GeogFromText(?)::geometry)
                          AND is_private = false
                        ORDER BY (status = 'ACTIVE') DESC, id
                        LIMIT 1
                        """,
                        (rs, rowNum) -> new ExactRouteRow(rs.getLong("id"), rs.getString("status")),
                        routeEwkt);
        return rows.stream().findFirst();
    }

    public record ExactRouteRow(long id, String status) {}

    /**
     * AI 생성 코스 저장. creator_id·source_session_id·region_code·description은 NULL, status는 기본값
     * ACTIVE.
     *
     * @return 생성된 courses.id
     */
    public long insertGeneratedCourse(
            String routeEwkt,
            String startEwkt,
            BigDecimal distanceM,
            BigDecimal elevationGainM,
            String elevationProfileJson) {
        Long id =
                jdbcTemplate.queryForObject(
                        """
                        INSERT INTO courses(
                          route, start_position, distance, elevation_gain, elevation_profile)
                        VALUES (ST_GeogFromText(?), ST_GeogFromText(?), ?, ?, CAST(? AS jsonb))
                        RETURNING id
                        """,
                        Long.class,
                        routeEwkt,
                        startEwkt,
                        distanceM,
                        elevationGainM,
                        elevationProfileJson);
        if (id == null) {
            throw new IllegalStateException("courses INSERT did not return id");
        }
        return id;
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

    /**
     * ACTIVE 코스만. 출발점 반경·거리 ±오차·환경 태그 AND 필터. 출발점 거리·id 오름차순.
     *
     * @param environmentTypes 비어 있으면 환경 필터 없음. 있으면 나열된 태그를 모두 보유해야 함.
     */
    public List<RecommendCourseRow> findRecommendations(
            String startEwkt,
            double radiusM,
            BigDecimal minDistanceM,
            BigDecimal maxDistanceM,
            List<String> environmentTypes,
            int limit) {
        StringBuilder sql = new StringBuilder(
                """
                SELECT c.id,
                       c.region_code,
                       c.status::text AS status,
                       c.distance,
                       COALESCE((
                         SELECT string_agg(t.environment_type::text, ',' ORDER BY t.environment_type)
                         FROM course_environment_tags t
                         WHERE t.course_id = c.id
                       ), '') AS environment_tags,
                       ST_Distance(c.start_position, ST_GeogFromText(?)) AS start_distance_m
                FROM courses c
                WHERE c.status = 'ACTIVE'::courses_status_enum
                  AND c.is_private = false
                  AND ST_DWithin(c.start_position, ST_GeogFromText(?), ?)
                  AND c.distance BETWEEN ? AND ?
                """);
        List<Object> args = new ArrayList<>();
        args.add(startEwkt);
        args.add(startEwkt);
        args.add(radiusM);
        args.add(minDistanceM);
        args.add(maxDistanceM);

        for (String environmentType : environmentTypes) {
            sql.append(
                    """
                      AND EXISTS (
                        SELECT 1 FROM course_environment_tags t
                        WHERE t.course_id = c.id
                          AND t.environment_type = ?::course_environment_tags_environment_type_enum
                      )
                    """);
            args.add(environmentType);
        }

        sql.append(" ORDER BY start_distance_m ASC, c.id ASC LIMIT ?");
        args.add(limit);

        return jdbcTemplate.query(
                sql.toString(), (rs, rowNum) -> mapRecommendCourseRow(rs), args.toArray());
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
                           c.distance,
                           c.is_private
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
                       c.distance,
                       c.is_private
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
                rs.getString("region_code"),
                rs.getString("unmeasured_edges_json"),
                rs.getBoolean("is_private"));
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
                rs.getBigDecimal("distance"),
                rs.getBoolean("is_private"));
    }

    private static RecommendCourseRow mapRecommendCourseRow(ResultSet rs) throws SQLException {
        String tags = rs.getString("environment_tags");
        List<String> environmentTags =
                tags == null || tags.isBlank()
                        ? List.of()
                        : Arrays.asList(tags.split(","));
        return new RecommendCourseRow(
                rs.getLong("id"),
                rs.getString("region_code"),
                rs.getString("status"),
                rs.getBigDecimal("distance"),
                environmentTags);
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
            String regionCode,
            String unmeasuredEdgesJson,
            boolean isPrivate) {}

    public record BookmarkedCourseRow(
            long bookmarkId,
            long courseId,
            String regionCode,
            String status,
            Long mergedIntoCourseId,
            String customName,
            BigDecimal distanceM,
            boolean isPrivate) {}

    public record RecommendCourseRow(
            long id,
            String regionCode,
            String status,
            BigDecimal distanceM,
            List<String> environmentTags) {}

    public record BookmarkUpsertRow(String customName, Instant createdAt) {}

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
