package com.runway.backend.domain.course.basemap;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * {@code running_session_basemaps} 저장·조회와 기록 경로 썸네일을 그리는 데 필요한 세션 값 조회(S15P31E105-756, ADR-0024).
 *
 * <p>대상은 활성 사용자의 삭제되지 않은 완료(COMPLETED) 세션이다. 좌표는 여기서 읽지 않고 S11 표시용 경로 규칙({@code
 * SessionRouteService.displaySegments})으로 얻는다.
 */
@Repository
public class RunRouteBasemapRepository {

    private static final String ELIGIBLE =
            """
            s.status = 'COMPLETED' AND s.deleted_at IS NULL AND s.started_at IS NOT NULL
              AND u.account_status = 'ACTIVE' AND u.withdrawn_at IS NULL
            """;

    private final JdbcTemplate jdbcTemplate;

    public RunRouteBasemapRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 이 그리기 버전의 행이 이미 있는지. 행이 없거나 버전이 다르면 false(다시 그릴 대상). */
    public boolean isRendered(long sessionId, String renderVersion) {
        Boolean exists =
                jdbcTemplate.queryForObject(
                        "SELECT EXISTS (SELECT 1 FROM running_session_basemaps WHERE running_session_id = ? AND render_version = ?)",
                        Boolean.class,
                        sessionId,
                        renderVersion);
        return Boolean.TRUE.equals(exists);
    }

    /** 썸네일을 그릴 수 있는 세션이면 주인·시작·종료 시각. 완료 전·삭제·비활성 사용자면 빈 값. */
    public Optional<EligibleSession> findEligibleSession(long sessionId) {
        return jdbcTemplate
                .query(
                        "SELECT s.user_id, s.started_at, s.ended_at FROM running_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND "
                                + ELIGIBLE,
                        (rs, n) ->
                                new EligibleSession(
                                        rs.getLong("user_id"),
                                        instant(rs.getObject("started_at", OffsetDateTime.class)),
                                        instant(rs.getObject("ended_at", OffsetDateTime.class))),
                        sessionId)
                .stream()
                .findFirst();
    }

    /**
     * 이 그리기 버전의 썸네일 행이 없는 완료 세션 ID(최신 종료 먼저, 최대 limit개). 기동 시 일괄 채우기 대상이다.
     */
    public List<Long> findSessionIdsNeedingRender(String renderVersion, int limit) {
        return jdbcTemplate.queryForList(
                "SELECT s.id FROM running_sessions s JOIN users u ON u.id = s.user_id WHERE "
                        + ELIGIBLE
                        + """
                  AND NOT EXISTS (SELECT 1 FROM running_session_basemaps b
                                  WHERE b.running_session_id = s.id AND b.render_version = ?)
                ORDER BY s.ended_at DESC NULLS LAST, s.id DESC
                LIMIT ?
                """,
                Long.class,
                renderVersion,
                limit);
    }

    /**
     * H01·H02 응답용 이미지 키(이미지가 있는 행만). 한 번의 조회로 여러 세션을 읽는다.
     *
     * @return 세션 ID → 이미지 볼륨 키
     */
    public Map<Long, String> findImageKeys(Collection<Long> sessionIds) {
        Map<Long, String> keys = new HashMap<>();
        if (sessionIds.isEmpty()) {
            return keys;
        }
        String placeholders = String.join(",", Collections.nCopies(sessionIds.size(), "?"));
        jdbcTemplate.query(
                "SELECT running_session_id, image_key FROM running_session_basemaps WHERE image_key IS NOT NULL AND running_session_id IN ("
                        + placeholders
                        + ")",
                rs -> {
                    keys.put(rs.getLong("running_session_id"), rs.getString("image_key"));
                },
                sessionIds.toArray());
        return keys;
    }

    /**
     * 썸네일 행을 저장한다. 행이 없으면 넣고, 다른 그리기 버전의 행이면 바꾼다. 같은 버전 행이 이미 있으면 바꾸지 않는다(종료 이벤트와 일괄
     * 채우기·여러 서버 중 먼저 저장한 쪽 유지).
     *
     * @param imageKey 이미지 볼륨 키. 그릴 경로가 없거나 범위 밖이라 이미지가 없으면 null
     * @return 넣거나 바꿨으면 true
     */
    public boolean upsert(
            long sessionId,
            String imageKey,
            Instant osmDataTimestamp,
            Instant buildingsOsmDataTimestamp,
            String renderVersion) {
        int rows =
                jdbcTemplate.update(
                        """
                        INSERT INTO running_session_basemaps(
                            running_session_id, image_key, osm_data_timestamp, buildings_osm_data_timestamp, render_version)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (running_session_id) DO UPDATE SET
                            image_key = EXCLUDED.image_key,
                            osm_data_timestamp = EXCLUDED.osm_data_timestamp,
                            buildings_osm_data_timestamp = EXCLUDED.buildings_osm_data_timestamp,
                            render_version = EXCLUDED.render_version
                        WHERE running_session_basemaps.render_version <> EXCLUDED.render_version
                        """,
                        sessionId,
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
     * @param userId 세션 주인. 이미지 키의 디렉터리다
     * @param startedAt 시작 시각
     * @param endedAt 종료 시각. 없으면 null
     */
    public record EligibleSession(long userId, Instant startedAt, Instant endedAt) {}
}
