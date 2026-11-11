package com.runway.backend.domain.image;

import lombok.RequiredArgsConstructor;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@RequiredArgsConstructor
public class ImageAccessRepository {
    private final JdbcTemplate jdbc;

    public boolean activeUserExists(long userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id=?
                    AND account_status='ACTIVE' AND withdrawn_at IS NULL)
                """, Boolean.class, userId));
    }

    @Transactional
    public boolean lockActiveUser(long userId) {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
        return !jdbc.query("""
                SELECT id FROM users WHERE id=? AND account_status='ACTIVE'
                    AND withdrawn_at IS NULL FOR UPDATE
                """, (rs, row) -> rs.getLong(1), userId).isEmpty();
    }

    // Evaluate the resource reference and its current access policy in one DB snapshot.
    // Course thumbnails are looked up separately (findCourseBasemapKeys).
    public List<String> findReadableKeys(Long viewerId, String fileName) {
        return jdbc.query("""
                    SELECT u.profile_image_key FROM users u
                    WHERE u.account_status='ACTIVE' AND u.withdrawn_at IS NULL
                      AND u.profile_image_key='images/profile/' || u.id || '/' || ?
                    UNION ALL
                    SELECT c.image_key FROM crews c
                    WHERE c.status='ACTIVE'
                      AND c.image_key LIKE 'images/crew/%/' || ?
                    UNION ALL
                    SELECT p.image_key FROM posts p JOIN users u ON u.id=p.author_id
                    LEFT JOIN user_settings s ON s.user_id=p.author_id
                    WHERE p.deleted_at IS NULL AND u.account_status='ACTIVE'
                      AND u.withdrawn_at IS NULL
                      AND p.image_key='images/post/' || p.author_id || '/' || ?
                      AND (p.author_id=? OR s.account_visibility='PUBLIC'
                        OR EXISTS (SELECT 1 FROM user_follows f
                            WHERE f.follower_id=? AND f.followee_id=p.author_id
                              AND f.is_approved=TRUE))
                """, (rs, row) -> rs.getString(1), fileName, fileName, fileName, viewerId, viewerId);
    }

    // Course thumbnails (S15P31E105-612, F02): public without a token, like crew and public profile images, because
    // they picture shared courses. Unlike C03 (signed-in users only), any key a course_basemaps row references is
    // readable whatever the course's status or the viewer; unreferenced keys stay 404.
    // The file-name match uses idx_course_basemaps_image_file (V32) instead of scanning the table;
    // the full-key match keeps only canonical keys of the row's own course.
    public List<String> findCourseBasemapKeys(String fileName) {
        return jdbc.query("""
                    SELECT b.image_key FROM course_basemaps b
                    JOIN courses c ON c.id=b.course_id AND c.is_private=false
                    WHERE split_part(b.image_key, '/', 4) = ?
                      AND b.image_key = 'images/course-basemap/' || b.course_id || '/' || ?
                """, (rs, row) -> rs.getString(1), fileName, fileName);
    }
}
