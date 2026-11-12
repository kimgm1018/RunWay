package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.auth.service.RetiredLoginId;
import com.runway.backend.domain.user.dto.response.WithdrawalSummaryResponse;
import com.runway.backend.domain.user.dto.response.WithdrawalSummaryResponse.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class WithdrawalRepository {
    private final JdbcTemplate jdbc;

    public record Account(String loginId, String passwordHash, String status, Instant withdrawnAt) {
        public boolean withdrawn() { return "WITHDRAWN".equals(status); }
        @Override public String toString() { return "WithdrawalAccount[REDACTED]"; }
    }

    public Optional<Account> account(long userId, boolean lock) {
        if (lock) jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return jdbc.query("SELECT login_id,password,account_status::text,withdrawn_at FROM users WHERE id=?"
                + (lock ? " FOR UPDATE" : ""), (rs, row) -> new Account(rs.getString(1), rs.getString(2),
                rs.getString(3), rs.getTimestamp(4) == null ? null : rs.getTimestamp(4).toInstant()), userId)
                .stream().findFirst();
    }

    public void lockResources(long userId) {
        ids("""
                SELECT c.id FROM crews c WHERE c.owner_id=? OR EXISTS (
                    SELECT 1 FROM crew_memberships m WHERE m.crew_id=c.id AND m.user_id=?)
                ORDER BY c.id FOR UPDATE
                """, userId, userId);
        ids("""
                SELECT g.id FROM group_runs g WHERE g.host_id=? OR EXISTS (
                    SELECT 1 FROM group_run_participants p WHERE p.group_run_id=g.id AND p.user_id=?)
                ORDER BY g.id FOR UPDATE
                """, userId, userId);
        ids("SELECT id FROM running_sessions WHERE user_id=? ORDER BY id FOR UPDATE", userId);
        ids("SELECT id FROM user_devices WHERE user_id=? ORDER BY id FOR UPDATE", userId);
    }

    public WithdrawalSummaryResponse summary(long userId) {
        var counts = jdbc.queryForObject("""
                SELECT (SELECT count(*) FROM running_sessions WHERE user_id=?
                            AND deleted_at IS NULL AND status='COMPLETED'),
                       (SELECT count(*) FROM posts WHERE author_id=? AND deleted_at IS NULL),
                       (SELECT count(*) FROM course_bookmarks WHERE user_id=?)
                """, (rs, row) -> new long[] {rs.getLong(1),rs.getLong(2),rs.getLong(3)}, userId,userId,userId);
        var devices = jdbc.query("SELECT id,device_type::text FROM user_devices WHERE user_id=?"
                + " AND unlinked_at IS NULL ORDER BY id", (rs,row) -> new Device(rs.getLong(1),rs.getString(2)),userId);
        var crews = jdbc.query("SELECT id,name FROM crews WHERE owner_id=? AND status='ACTIVE' ORDER BY id",
                (rs,row) -> new Crew(rs.getLong(1),rs.getString(2)),userId);
        var owned = jdbc.query("SELECT id,title,status::text FROM group_runs WHERE host_id=?"
                + " AND status IN ('SCHEDULED','RUNNING') ORDER BY id",
                (rs,row) -> new Group(rs.getLong(1),rs.getString(2),rs.getString(3)),userId);
        var scheduled = jdbc.query("""
                SELECT g.id,g.title,g.status::text FROM group_runs g
                JOIN group_run_participants p ON p.group_run_id=g.id
                WHERE p.user_id=? AND g.host_id<>? AND g.status='SCHEDULED' ORDER BY g.id
                """, (rs,row) -> new Group(rs.getLong(1),rs.getString(2),rs.getString(3)),userId,userId);
        return new WithdrawalSummaryResponse(counts[0],counts[1],counts[2],devices,crews,owned,scheduled,blockers(userId));
    }

    public List<Blocker> blockers(long userId) {
        var blockers = new ArrayList<Blocker>();
        add(blockers,"CREW_OWNER","크루장 이양 후 크루 탈퇴 또는 해산을 먼저 해 주세요.",
                ids("SELECT id FROM crews WHERE owner_id=? AND status='ACTIVE' ORDER BY id",userId));
        add(blockers,"GROUP_RUN_HOST","예정 그룹런은 취소하고 진행 중 그룹런은 종료한 뒤 다시 요청해 주세요.",
                ids("SELECT id FROM group_runs WHERE host_id=? AND status IN ('SCHEDULED','RUNNING') ORDER BY id",userId));
        add(blockers,"ACTIVE_RUNNING_SESSION","운동을 종료한 뒤 탈퇴해 주세요.",
                ids("SELECT id FROM running_sessions WHERE user_id=? AND status IN ('RUNNING','PAUSED') ORDER BY id",userId));
        add(blockers,"ACTIVE_GROUP_RUN","참여 중인 그룹런이 종료된 뒤 탈퇴해 주세요.",
                ids("""
                        SELECT g.id FROM group_runs g JOIN group_run_participants p ON p.group_run_id=g.id
                        WHERE p.user_id=? AND g.status='RUNNING' ORDER BY g.id
                        """,userId));
        add(blockers,"PENDING_START","시작 명령의 결과를 확인하거나 시작 미확인 상태를 정리해 주세요.",
                ids("""
                        SELECT s.id FROM running_sessions s WHERE s.user_id=? AND s.status='READY'
                        AND EXISTS(SELECT 1 FROM session_control_events e WHERE e.session_id=s.id
                            AND e.action='START' AND e.result IN ('PENDING','UNKNOWN')) ORDER BY s.id
                        """,userId));
        add(blockers,"ANALYSIS_PENDING","운동 기록 분석이 끝난 뒤 다시 요청해 주세요.",
                ids("""
                        SELECT id FROM running_sessions WHERE user_id=? AND started_at IS NOT NULL
                        AND analysis_status IN ('PENDING','PROCESSING') ORDER BY id
                        """,userId));
        return List.copyOf(blockers);
    }

    private static void add(List<Blocker> target,String code,String message,List<Long> ids) {
        if (!ids.isEmpty()) target.add(new Blocker(code,message,ids));
    }

    public List<Long> scheduledGroups(long userId) {
        return ids("""
                SELECT g.id FROM group_runs g JOIN group_run_participants p ON p.group_run_id=g.id
                WHERE p.user_id=? AND g.host_id<>? AND g.status='SCHEDULED' ORDER BY g.id
                """,userId,userId);
    }

    public List<Long> memberCrews(long userId) {
        return ids("""
                SELECT c.id FROM crews c JOIN crew_memberships m ON m.crew_id=c.id
                WHERE m.user_id=? AND m.status='APPROVED' AND c.status='ACTIVE' ORDER BY c.id
                """,userId);
    }

    public List<Long> readySessions(long userId) {
        return ids("SELECT id FROM running_sessions WHERE user_id=? AND status='READY'"
                + " AND state_version>=1 ORDER BY id",userId);
    }

    public void closeLegacyReady(long userId) {
        jdbc.update("UPDATE running_sessions SET status='CANCELLED' WHERE user_id=?"
                + " AND status='READY' AND state_version=0",userId);
    }

    /** Keep only identifiers and group result facts; remove private originals and derived HR. */
    public void scrub(long userId, Instant now) {
        // 원본 GPS와 같은 민감한 위치 정보인 개인 생성 코스도 탈퇴 시 제거한다.
        jdbc.update("DELETE FROM course_bookmarks WHERE course_id IN (SELECT id FROM courses WHERE creator_id=? AND is_private=true)", userId);
        jdbc.update("DELETE FROM course_environment_tags WHERE course_id IN (SELECT id FROM courses WHERE creator_id=? AND is_private=true)", userId);
        jdbc.update("DELETE FROM course_basemaps WHERE course_id IN (SELECT id FROM courses WHERE creator_id=? AND is_private=true)", userId);
        jdbc.update("UPDATE group_runs SET course_id=NULL WHERE course_id IN (SELECT id FROM courses WHERE creator_id=? AND is_private=true)", userId);
        jdbc.update("UPDATE running_sessions SET course_id=NULL WHERE course_id IN (SELECT id FROM courses WHERE creator_id=? AND is_private=true)", userId);
        jdbc.update("DELETE FROM courses WHERE creator_id=? AND is_private=true", userId);
        jdbc.update("DELETE FROM user_hr_personalization WHERE user_id=?",userId);
        jdbc.update("DELETE FROM exercise_training_loads WHERE user_id=?",userId);
        jdbc.update("DELETE FROM daily_health_metrics WHERE user_id=?",userId);
        jdbc.update("DELETE FROM daily_readiness WHERE user_id=?",userId);
        for (String table : List.of("running_route_points","running_metric_samples","running_session_splits"))
            jdbc.update("DELETE FROM " + table + " WHERE running_session_id IN"
                    + " (SELECT id FROM running_sessions WHERE user_id=?)",userId);
        // H08 기록 공유 링크(S15P31E105-704). 경로를 로그인 없이 여는 token이므로 원본 GPS와 함께 지운다.
        // rw_active_owner는 INSERT/UPDATE에만 걸려 DELETE를 막지 않는다.
        jdbc.update("DELETE FROM run_share_links WHERE user_id=?",userId);
        jdbc.update("DELETE FROM pace_plan_segments WHERE pace_plan_id IN (SELECT p.id FROM pace_plans p"
                + " JOIN running_sessions s ON s.id=p.session_id WHERE s.user_id=?)",userId);
        jdbc.update("DELETE FROM pace_plans WHERE session_id IN (SELECT id FROM running_sessions WHERE user_id=?)",userId);
        jdbc.update("DELETE FROM session_control_events WHERE session_id IN"
                + " (SELECT id FROM running_sessions WHERE user_id=?) AND action IN ('COACHING','SET_BPM')",userId);
        jdbc.update("DELETE FROM coaching_decisions WHERE session_id IN (SELECT id FROM running_sessions WHERE user_id=?)",userId);
        jdbc.update("DELETE FROM sync_batches WHERE device_id IN (SELECT id FROM user_devices WHERE user_id=?)",userId);
        jdbc.update("UPDATE comments SET body='탈퇴한 회원의 댓글입니다' WHERE author_id=?",userId);
        jdbc.update("UPDATE posts SET body=CASE WHEN deleted_at IS NULL THEN '탈퇴한 회원의 게시물입니다.' ELSE NULL END,image_key=NULL,region_code=NULL,deleted_at=coalesce(deleted_at,?)"
                + " WHERE author_id=?",Timestamp.from(now),userId);
        jdbc.update("DELETE FROM notifications WHERE user_id=? OR (notification_type='POST_COMMENT'"
                + " AND target_id IN (SELECT id FROM posts WHERE author_id=?))",userId,userId);
        // Only this user's own like/bookmark rows; others' rows on this user's posts/comments stay. The deletes
        // lock only these rows (no lock on posts/comments/users), and new writes of them already fail fast on
        // rw_active_owner (users KEY SHARE NOWAIT) because account() holds users FOR UPDATE.
        for (String table : List.of("user_recommendation_preferences","user_profiles","user_settings","course_bookmarks",
                "post_likes","comment_likes","post_bookmarks"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id=?",userId);
        // Preserve request history, but do not replay an old approval as an active relationship.
        jdbc.update("UPDATE follow_request_history SET result='CANCELLED',processed_at=?"
                + " WHERE request_id IN (SELECT id FROM user_follows WHERE follower_id=? OR followee_id=?)",
                Timestamp.from(now),userId,userId);
        jdbc.update("DELETE FROM user_follows WHERE follower_id=? OR followee_id=?",userId,userId);
        jdbc.update("DELETE FROM crew_memberships WHERE user_id=? AND status='PENDING'",userId);
        jdbc.update("UPDATE crew_memberships SET status='LEFT',left_at=coalesce(left_at,?)"
                + " WHERE user_id=? AND status='APPROVED'",Timestamp.from(now),userId);
        jdbc.update("UPDATE user_devices SET unlinked_at=coalesce(unlinked_at,?) WHERE user_id=?",Timestamp.from(now),userId);
        jdbc.update("""
                UPDATE running_sessions s SET deleted_at=coalesce(deleted_at,?),
                    goal_distance=NULL,goal_duration=NULL,goal_pace=NULL,
                    average_heart_rate=NULL,average_cadence=NULL,max_heart_rate=NULL,current_bpm=NULL,
                    control_device_id=NULL,relay_device_id=NULL
                WHERE user_id=?
                """,Timestamp.from(now),userId);
        jdbc.update("""
                UPDATE running_sessions s SET total_distance=NULL,moving_duration=NULL,elapsed_duration=NULL,
                    moving_duration_to_goal=NULL,goal_achieved=NULL,average_pace=NULL,started_at=NULL,ended_at=NULL
                WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM group_run_participants p
                    JOIN group_runs g ON g.id=p.group_run_id
                    WHERE p.session_id=s.id AND g.status='COMPLETED')
                """,userId);
    }

    public Instant markWithdrawn(long userId, String loginId, Instant now) {
        return jdbc.queryForObject("""
                UPDATE users SET login_id=?,password='!WITHDRAWN!',nickname='탈퇴한 회원',
                    birth_date='1970-01-01',gender='MALE',phone_number='00000000000',
                    health_data_access='DISAGREE',profile_image_key=NULL,
                    account_status='WITHDRAWN',withdrawn_at=? WHERE id=? AND account_status='ACTIVE'
                RETURNING withdrawn_at
                """,(rs,row) -> rs.getTimestamp(1).toInstant(),RetiredLoginId.digest(loginId),Timestamp.from(now),userId);
    }

    private List<Long> ids(String sql,Object... args) {
        return jdbc.query(sql,(rs,row) -> rs.getLong(1),args);
    }
}
