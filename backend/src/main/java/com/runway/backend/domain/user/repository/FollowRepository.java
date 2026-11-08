package com.runway.backend.domain.user.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class FollowRepository {
    private final JdbcTemplate jdbc;

    public record Relation(long id, boolean approved) {}
    public record Request(long requesterId, long requestId, String nickname, Instant requestedAt,
                          String status) {}
    public record History(long requesterId, long targetId, String result) {}
    // U26 · U27 row; relationId and followedAt stay internal and only build the cursor.
    public record Member(long userId, String nickname, String profileImageKey, long relationId,
                         Instant followedAt) {}

    public boolean isActive(long id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND account_status='ACTIVE'
                    AND withdrawn_at IS NULL)
                """, Boolean.class, id));
    }

    public boolean lockTarget(long target) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        // Compatible with FK KEY SHARE locks for reciprocal requests, but conflicts
        // with U14's FOR UPDATE lock. No user key is changed by this use case.
        return !jdbc.query("""
                SELECT id FROM users WHERE id=? AND account_status='ACTIVE'
                    AND withdrawn_at IS NULL FOR NO KEY UPDATE
                """, (rs,n) -> rs.getLong(1), target).isEmpty();
    }

    public Optional<Relation> find(long requester, long target) {
        return jdbc.query("SELECT id,is_approved FROM user_follows WHERE follower_id=? AND followee_id=?",
                (rs, n) -> new Relation(rs.getLong(1), rs.getBoolean(2)), requester, target)
                .stream().findFirst();
    }

    public Relation create(long requester, long target, boolean approved) {
        return jdbc.query("""
                INSERT INTO user_follows(follower_id,followee_id,is_approved) VALUES (?,?,?)
                RETURNING id,is_approved
                """, (rs, n) -> new Relation(rs.getLong(1), rs.getBoolean(2)),
                requester, target, approved).getFirst();
    }

    public void approve(long id) {
        jdbc.update("UPDATE user_follows SET is_approved=TRUE WHERE id=?", id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM user_follows WHERE id=?", id);
    }

    public long followerCount(long target) {
        return jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE followee_id=? AND is_approved=TRUE",
                Long.class, target);
    }

    public long followingCount(long requester) {
        return jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE follower_id=? AND is_approved=TRUE",
                Long.class, requester);
    }

    public void remember(long id, long requester, long target, String result) {
        jdbc.update("""
                INSERT INTO follow_request_history(request_id,requester_id,target_id,result)
                VALUES (?,?,?,?) ON CONFLICT(request_id) DO UPDATE
                SET result=EXCLUDED.result,processed_at=now()
                """, id, requester, target, result);
    }

    public Optional<History> history(long id) {
        return jdbc.query("SELECT requester_id,target_id,result FROM follow_request_history WHERE request_id=?",
                (rs, n) -> new History(rs.getLong(1), rs.getLong(2), rs.getString(3)), id)
                .stream().findFirst();
    }

    public List<Request> pending(long owner, Instant before, long beforeId) {
        return jdbc.query("""
                SELECT f.follower_id,f.id,u.nickname,f.created_at
                FROM user_follows f JOIN users u ON u.id=f.follower_id
                WHERE f.followee_id=? AND f.is_approved=FALSE
                  AND u.account_status='ACTIVE' AND u.withdrawn_at IS NULL
                """ + (before == null ? "" : " AND (f.created_at,f.id)<(?,?)")
                        + " ORDER BY f.created_at DESC,f.id DESC LIMIT 11",
                (rs, n) -> new Request(rs.getLong(1), rs.getLong(2), rs.getString(3),
                        rs.getTimestamp(4).toInstant(), "PENDING"),
                before == null ? new Object[]{owner}
                        : new Object[]{owner, java.sql.Timestamp.from(before), beforeId});
    }

    // Approved relations of target, newest relation first; followers=true lists who follows target.
    public List<Member> approved(long target, boolean followers, Instant before, long beforeId,
                                 int size) {
        String self = followers ? "f.followee_id" : "f.follower_id";
        String other = followers ? "f.follower_id" : "f.followee_id";
        return jdbc.query("""
                SELECT u.id,u.nickname,u.profile_image_key,f.id,f.created_at
                FROM user_follows f JOIN users u ON u.id=%s
                WHERE %s=? AND f.is_approved=TRUE
                  AND u.account_status='ACTIVE' AND u.withdrawn_at IS NULL
                """.formatted(other, self)
                        + (before == null ? "" : " AND (f.created_at,f.id)<(?,?)")
                        + " ORDER BY f.created_at DESC,f.id DESC LIMIT ?",
                (rs, n) -> new Member(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getLong(4), rs.getTimestamp(5).toInstant()),
                before == null ? new Object[]{target, size}
                        : new Object[]{target, java.sql.Timestamp.from(before), beforeId, size});
    }
}
