package com.runway.backend.domain.session.difficulty;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** {@code course_segment_difficulties} 저장·조회와 비율 계산에 필요한 코스 값 조회(S15P31E105-297). */
@Repository
public class CourseDifficultyRepository {

    private static final Logger log = LoggerFactory.getLogger(CourseDifficultyRepository.class);

    private final JdbcTemplate jdbcTemplate;
    private final JsonMapper jsonMapper;

    public CourseDifficultyRepository(JdbcTemplate jdbcTemplate, JsonMapper jsonMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.jsonMapper = jsonMapper;
    }

    /** 저장된 비율. 행이 없거나 저장값을 해석할 수 없으면 빈 값이며, 해석 실패는 세션 요청을 실패시키지 않도록 로그만 남긴다. */
    public Optional<StoredDifficulty> find(long courseId) {
        List<StoredDifficulty> rows =
                jdbcTemplate.query(
                        "SELECT distance_m, ratios::text AS ratios FROM course_segment_difficulties"
                                + " WHERE course_id = ?",
                        (rs, n) -> {
                            List<BigDecimal> ratios = parseRatios(rs.getString("ratios"));
                            return ratios == null
                                    ? null
                                    : new StoredDifficulty(rs.getBigDecimal("distance_m"), ratios);
                        },
                        courseId);
        if (rows.isEmpty()) return Optional.empty();
        if (rows.get(0) == null) {
            log.warn("저장된 구간 난이도 비율을 해석하지 못해 쓰지 않음 (courseId={})", courseId);
            return Optional.empty();
        }
        return Optional.of(rows.get(0));
    }

    public boolean exists(long courseId) {
        Boolean exists =
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM course_segment_difficulties WHERE course_id = ?)",
                        Boolean.class,
                        courseId);
        return Boolean.TRUE.equals(exists);
    }

    /** 비율 계산에 쓰는 코스 상태·거리·경사 원문. */
    public Optional<CourseSource> findCourse(long courseId) {
        return jdbcTemplate
                .query(
                        """
                        SELECT status::text AS status, distance, elevation_profile::text AS profile,
                               CASE WHEN jsonb_typeof(elevation_profile) = 'array'
                                         AND jsonb_typeof(elevation_profile -> -1 -> 'endDistanceM') = 'number'
                                    THEN (elevation_profile -> -1 ->> 'endDistanceM')::numeric END AS profile_end
                        FROM courses WHERE id = ?
                        """,
                        (rs, n) ->
                                new CourseSource(
                                        rs.getString("status"),
                                        rs.getBigDecimal("distance"),
                                        rs.getString("profile"),
                                        rs.getBigDecimal("profile_end")),
                        courseId)
                .stream()
                .findFirst();
    }

    /**
     * 비율을 저장한다. 같은 코스 행이 이미 있으면 바꾸지 않는다(동시 실행·여러 서버).
     *
     * @return 새로 저장했으면 true
     */
    public boolean insertIfAbsent(
            long courseId, BigDecimal distanceM, List<BigDecimal> ratios, String plannerVersion) {
        int rows =
                jdbcTemplate.update(
                        """
                        INSERT INTO course_segment_difficulties(course_id, distance_m, ratios, planner_version)
                        VALUES (?, ?, ?::jsonb, ?)
                        ON CONFLICT (course_id) DO NOTHING
                        """,
                        courseId,
                        distanceM,
                        jsonMapper.writeValueAsString(ratios),
                        plannerVersion);
        return rows == 1;
    }

    private List<BigDecimal> parseRatios(String json) {
        try {
            JsonNode root = jsonMapper.readTree(json);
            if (root == null || !root.isArray()) return null;
            List<BigDecimal> ratios = new ArrayList<>(root.size());
            for (JsonNode node : root) {
                if (!node.isNumber()) return null;
                ratios.add(node.decimalValue());
            }
            return ratios;
        } catch (JacksonException ex) {
            return null;
        }
    }

    /**
     * @param distanceM 계산 기준 코스 거리(m)
     * @param ratios 0m부터 1km 구간 순서의 비율
     */
    public record StoredDifficulty(BigDecimal distanceM, List<BigDecimal> ratios) {

        public StoredDifficulty {
            ratios = List.copyOf(ratios);
        }
    }

    /**
     * @param status {@code courses_status_enum} 이름
     * @param profileJson {@code elevation_profile} 원문. 경사가 없으면 null
     * @param profileEndM 경사 목록 마지막 조각의 {@code endDistanceM}. AI05는 이 거리로 비율 개수를 정한다. 없거나 숫자가 아니면 null
     */
    public record CourseSource(
            String status, BigDecimal distanceM, String profileJson, BigDecimal profileEndM) {}
}
