package com.runway.backend.domain.community.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 게시물 목록(CMT02)과 내 스크랩·좋아요 목록(CMT18·CMT19)의 페이지 ID 조회.
 *
 * <p>삭제·접근 불가 게시물을 SQL에서 먼저 제외한 뒤 LIMIT을 적용한다. 그래야 필터로 빠진 글 때문에 한 페이지가 비거나 {@code hasNext}가
 * 틀리지 않는다. 접근 조건은 {@link AccountVisibilityRepository#accessibleAmong}과 같다(작성자 ACTIVE·미탈퇴이고 본인,
 * PUBLIC, 또는 승인된 정방향 팔로워). 회원·설정·팔로우 테이블 조인이 필요해 직접 SQL을 쓴다.
 */
@Repository
public class PostPageQueryRepository {

    /** 내 목록의 원천 관계. SQL에 이어 붙이는 테이블 이름은 이 허용 목록에서만 온다. */
    public enum Activity {
        BOOKMARK("post_bookmarks"),
        LIKE("post_likes");

        private final String table;

        Activity(String table) {
            this.table = table;
        }
    }

    /** 내 목록 한 행. {@code createdAt}은 저장·좋아요 시각, {@code id}는 관계 행 ID다. */
    public record ActivityRow(long id, Instant createdAt, long postId) {}

    private static final String ACCESSIBLE_AUTHOR =
            """
            u.account_status = 'ACTIVE' AND u.withdrawn_at IS NULL
            AND (u.id = ? OR s.account_visibility = 'PUBLIC'
                 OR EXISTS (SELECT 1 FROM user_follows f WHERE f.followee_id = u.id
                            AND f.follower_id = ? AND f.is_approved = TRUE))
            """;

    private final JdbcTemplate jdbc;

    public PostPageQueryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 조회자가 볼 수 있는 미삭제 게시물 ID를 최신(id 내림차순) 순으로 반환한다.
     *
     * @param following true이면 본인 글과 승인된 팔로우 대상 글만
     * @param authorId null이 아니면 해당 작성자 글만
     * @param beforeId null이 아니면 이 ID보다 작은 글만(커서)
     * @param limit null이면 전체
     */
    public List<Long> findVisiblePostIds(
            long viewerId, boolean following, Long authorId, Long beforeId, Integer limit) {
        return findVisiblePostIds(viewerId, following, authorId, null, beforeId, limit);
    }

    /**
     * {@link #findVisiblePostIds(long, boolean, Long, Long, Integer)}에 지역 필터를 더한다(S15P31E105-687).
     *
     * @param regionCode null이 아니면 그 지역 안의 글만. 시/도 코드(시군구 이름이 빈 행)는 그 시/도 전체, 시/군/구 코드는 그 시/군/구와
     *     하위 구(예: 수원시 → 수원시 장안구)다. {@code regions}에 없는 코드나 지역이 비어 있는 글은 걸리지 않는다.
     */
    public List<Long> findVisiblePostIds(
            long viewerId,
            boolean following,
            Long authorId,
            String regionCode,
            Long beforeId,
            Integer limit) {
        StringBuilder sql =
                new StringBuilder(
                        """
                        SELECT p.id FROM posts p
                        JOIN users u ON u.id = p.author_id
                        LEFT JOIN user_settings s ON s.user_id = u.id
                        WHERE p.deleted_at IS NULL AND
                        """)
                        .append(ACCESSIBLE_AUTHOR);
        List<Object> args = new ArrayList<>(List.of(viewerId, viewerId));
        if (following) {
            sql.append(
                    """
                     AND (p.author_id = ? OR EXISTS (SELECT 1 FROM user_follows g
                          WHERE g.followee_id = p.author_id AND g.follower_id = ? AND g.is_approved = TRUE))
                    """);
            args.add(viewerId);
            args.add(viewerId);
        }
        if (authorId != null) {
            sql.append(" AND p.author_id = ?");
            args.add(authorId);
        }
        if (regionCode != null) {
            sql.append(
                    """
                     AND EXISTS (SELECT 1 FROM regions pr JOIN regions sel ON sel.region_code = ?
                          WHERE pr.region_code = p.region_code AND pr.sido_name = sel.sido_name
                            AND (sel.sigungu_name = '' OR pr.sigungu_name = sel.sigungu_name
                                 OR pr.sigungu_name LIKE sel.sigungu_name || ' %'))
                    """);
            args.add(regionCode);
        }
        if (beforeId != null) {
            sql.append(" AND p.id < ?");
            args.add(beforeId);
        }
        sql.append(" ORDER BY p.id DESC");
        if (limit != null) {
            sql.append(" LIMIT ?");
            args.add(limit);
        }
        return jdbc.query(sql.toString(), (rs, row) -> rs.getLong(1), args.toArray());
    }

    /**
     * 회원이 저장·좋아요한 게시물 중 지금 볼 수 있는 미삭제 게시물을 관계 생성 시각·관계 ID 내림차순으로 반환한다.
     *
     * @param before null이 아니면 (before, beforeId)보다 앞선 행만(커서)
     */
    public List<ActivityRow> findActivity(
            long userId, Activity activity, Instant before, long beforeId, int limit) {
        StringBuilder sql =
                new StringBuilder(
                                """
                                SELECT a.id, a.created_at, a.post_id FROM %s a
                                JOIN posts p ON p.id = a.post_id
                                JOIN users u ON u.id = p.author_id
                                LEFT JOIN user_settings s ON s.user_id = u.id
                                WHERE a.user_id = ? AND p.deleted_at IS NULL AND
                                """
                                        .formatted(activity.table))
                        .append(ACCESSIBLE_AUTHOR);
        List<Object> args = new ArrayList<>(List.of(userId, userId, userId));
        if (before != null) {
            sql.append(" AND (a.created_at, a.id) < (?, ?)");
            args.add(Timestamp.from(before));
            args.add(beforeId);
        }
        sql.append(" ORDER BY a.created_at DESC, a.id DESC LIMIT ?");
        args.add(limit);
        return jdbc.query(
                sql.toString(),
                (rs, row) ->
                        new ActivityRow(
                                rs.getLong(1), rs.getTimestamp(2).toInstant(), rs.getLong(3)),
                args.toArray());
    }
}
