package com.runway.backend.domain.image;

import lombok.RequiredArgsConstructor;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class ImageAccessRepository {
    private final JdbcTemplate jdbc;

    // Evaluate the resource reference and its current access policy in one DB snapshot.
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
}
