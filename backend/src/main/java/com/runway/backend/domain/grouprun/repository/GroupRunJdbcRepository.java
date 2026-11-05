package com.runway.backend.domain.grouprun.repository;

import com.runway.backend.global.geo.GeoJsonGeographyMapper;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class GroupRunJdbcRepository {

    private final JdbcTemplate jdbcTemplate;

    public GroupRunJdbcRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public long insert(
            long crewId,
            long hostId,
            Long courseId,
            String title,
            String description,
            Instant scheduledAt,
            String meetingName,
            String meetingAddress,
            GeoJsonPoint meetingPosition,
            Integer goalDistance,
            Integer goalDuration,
            String status) {
        String meetingEwkt =
                meetingPosition == null ? null : GeoJsonGeographyMapper.toEwkt(meetingPosition);
        return jdbcTemplate.queryForObject(
                """
                INSERT INTO group_runs(
                    crew_id, host_id, course_id, title, description, scheduled_at,
                    meeting_name, meeting_address, meeting_position,
                    goal_distance, goal_duration, status)
                VALUES (
                    ?, ?, ?, ?, ?, ?,
                    ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE ST_GeogFromText(?) END,
                    ?, ?, ?::group_runs_status_enum)
                RETURNING id
                """,
                Long.class,
                crewId,
                hostId,
                courseId,
                title,
                description,
                Timestamp.from(scheduledAt),
                meetingName,
                meetingAddress,
                meetingEwkt,
                meetingEwkt,
                goalDistance,
                goalDuration,
                status);
    }

    public Optional<GroupRunRow> findById(long groupRunId) {
        List<GroupRunRow> rows =
                jdbcTemplate.query(
                        """
                        SELECT id, crew_id, host_id, course_id, title, description, scheduled_at,
                               meeting_name, meeting_address,
                               ST_AsGeoJSON(meeting_position::geometry) AS meeting_geojson,
                               goal_distance, goal_duration, status::text AS status,
                               cancel_reason, created_at, updated_at
                        FROM group_runs
                        WHERE id = ?
                        """,
                        (rs, rowNum) -> mapRow(rs),
                        groupRunId);
        return rows.stream().findFirst();
    }

    public void update(
            long groupRunId,
            String title,
            String description,
            Instant scheduledAt,
            String meetingName,
            String meetingAddress,
            GeoJsonPoint meetingPosition,
            Long courseId,
            Integer goalDistance,
            Integer goalDuration) {
        String meetingEwkt =
                meetingPosition == null ? null : GeoJsonGeographyMapper.toEwkt(meetingPosition);
        jdbcTemplate.update(
                """
                UPDATE group_runs SET
                    title = ?,
                    description = ?,
                    scheduled_at = ?,
                    meeting_name = ?,
                    meeting_address = ?,
                    meeting_position = CASE WHEN ? IS NULL THEN NULL ELSE ST_GeogFromText(?) END,
                    course_id = ?,
                    goal_distance = ?,
                    goal_duration = ?
                WHERE id = ?
                """,
                title,
                description,
                Timestamp.from(scheduledAt),
                meetingName,
                meetingAddress,
                meetingEwkt,
                meetingEwkt,
                courseId,
                goalDistance,
                goalDuration,
                groupRunId);
    }

    /** G13. SCHEDULED 그룹만 CANCELLED로 바꾸고 사유를 저장한다. 호출 전에 그룹 행을 잠근다. */
    public int markCancelled(long groupRunId, String cancelReason) {
        return jdbcTemplate.update(
                """
                UPDATE group_runs
                SET status = 'CANCELLED'::group_runs_status_enum, cancel_reason = ?
                WHERE id = ? AND status = 'SCHEDULED'::group_runs_status_enum
                """,
                cancelReason,
                groupRunId);
    }

    /** G09. SCHEDULED 그룹만 RUNNING으로 바꾼다. 호출 전에 그룹 행을 잠근다. */
    public int markRunning(long groupRunId) {
        return jdbcTemplate.update(
                """
                UPDATE group_runs
                SET status = 'RUNNING'::group_runs_status_enum
                WHERE id = ? AND status = 'SCHEDULED'::group_runs_status_enum
                """,
                groupRunId);
    }

    /** G12. RUNNING 그룹만 COMPLETED로 바꾸고 종료 기준시각을 한 번 저장한다. 호출 전에 그룹 행을 잠근다. */
    public int markCompleted(long groupRunId, Instant endedAt) {
        return jdbcTemplate.update(
                """
                UPDATE group_runs
                SET status = 'COMPLETED'::group_runs_status_enum, ended_at = ?
                WHERE id = ? AND status = 'RUNNING'::group_runs_status_enum
                """,
                Timestamp.from(endedAt),
                groupRunId);
    }

    public List<GroupRunRow> search(
            long userId,
            Long crewId,
            String status,
            String participation,
            boolean myCrewsOnly,
            Double latitude,
            Double longitude,
            Double radiusM,
            Long cursorExclusive,
            int limit) {
        StringBuilder sql =
                new StringBuilder(
                        """
                        SELECT gr.id, gr.crew_id, gr.host_id, gr.course_id, gr.title, gr.description,
                               gr.scheduled_at, gr.meeting_name, gr.meeting_address,
                               ST_AsGeoJSON(gr.meeting_position::geometry) AS meeting_geojson,
                               gr.goal_distance, gr.goal_duration, gr.status::text AS status,
                               gr.cancel_reason, gr.created_at, gr.updated_at
                        FROM group_runs gr
                        INNER JOIN crew_memberships cm
                          ON cm.crew_id = gr.crew_id
                         AND cm.user_id = ?
                         AND cm.status = 'APPROVED'::crew_memberships_status_enum
                        INNER JOIN crews c
                          ON c.id = gr.crew_id
                         AND c.status = 'ACTIVE'::crews_status_enum
                        WHERE 1 = 1
                        """);
        List<Object> args = new ArrayList<>();
        args.add(userId);

        if (crewId != null) {
            sql.append(" AND gr.crew_id = ?");
            args.add(crewId);
        }
        if (status != null) {
            sql.append(" AND gr.status = ?::group_runs_status_enum");
            args.add(status);
        }
        if ("ME".equals(participation)) {
            sql.append(
                    """
                     AND EXISTS (
                       SELECT 1 FROM group_run_participants p
                       WHERE p.group_run_id = gr.id AND p.user_id = ?
                     )
                    """);
            args.add(userId);
        } else if ("NONE".equals(participation)) {
            sql.append(
                    """
                     AND NOT EXISTS (
                       SELECT 1 FROM group_run_participants p
                       WHERE p.group_run_id = gr.id AND p.user_id = ?
                     )
                    """);
            args.add(userId);
        }
        // myCrewsOnly: crew-only 모델에서는 APPROVED 멤버십 조인으로 이미 동일 범위다.
        if (latitude != null && longitude != null && radiusM != null) {
            String centerEwkt = GeoJsonGeographyMapper.toEwkt(GeoJsonPoint.of(longitude, latitude));
            sql.append(
                    """
                     AND gr.meeting_position IS NOT NULL
                     AND ST_DWithin(gr.meeting_position, ST_GeogFromText(?), ?)
                    """);
            args.add(centerEwkt);
            args.add(radiusM);
        }
        if (cursorExclusive != null) {
            sql.append(" AND gr.id < ?");
            args.add(cursorExclusive);
        }
        sql.append(" ORDER BY gr.id DESC LIMIT ?");
        args.add(limit);

        return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapRow(rs), args.toArray());
    }

    private static GroupRunRow mapRow(ResultSet rs) throws SQLException {
        return new GroupRunRow(
                rs.getLong("id"),
                rs.getLong("crew_id"),
                rs.getLong("host_id"),
                rs.getObject("course_id", Long.class),
                rs.getString("title"),
                rs.getString("description"),
                toInstant(rs.getTimestamp("scheduled_at")),
                rs.getString("meeting_name"),
                rs.getString("meeting_address"),
                rs.getString("meeting_geojson"),
                rs.getObject("goal_distance", Integer.class),
                rs.getObject("goal_duration", Integer.class),
                rs.getString("status"),
                rs.getString("cancel_reason"),
                toInstant(rs.getTimestamp("created_at")),
                toInstant(rs.getTimestamp("updated_at")));
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
