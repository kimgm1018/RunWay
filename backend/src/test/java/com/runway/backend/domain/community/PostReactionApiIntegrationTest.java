package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

class PostReactionApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long viewerId;
    private long publicAuthorId;
    private long privateAuthorId;
    private long outsiderId;
    private long publicPostId;
    private long privatePostId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM post_likes");
        jdbc.update("DELETE FROM comments");
        jdbc.update("DELETE FROM posts");
        jdbc.update("DELETE FROM user_follows");
        jdbc.update("DELETE FROM user_settings");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM users");

        viewerId = insertUser("rx_viewer", "뷰어", "01030001001");
        publicAuthorId = insertUser("rx_public", "공개작성", "01030001002");
        privateAuthorId = insertUser("rx_private", "비공개작", "01030001003");
        outsiderId = insertUser("rx_outsider", "외부인", "01030001004");

        insertSettings(viewerId, "PUBLIC");
        insertSettings(publicAuthorId, "PUBLIC");
        insertSettings(privateAuthorId, "PRIVATE");
        insertSettings(outsiderId, "PUBLIC");

        jdbc.update(
                """
                INSERT INTO user_follows(follower_id, followee_id, is_approved)
                VALUES (?, ?, TRUE)
                """,
                viewerId,
                privateAuthorId);

        publicPostId = insertPost(publicAuthorId, insertSession(publicAuthorId), "공개 글");
        privatePostId = insertPost(privateAuthorId, insertSession(privateAuthorId), "비공개 글");
    }

    @Test
    void upsert_likeOnPublicPost_200_andIdempotent() throws Exception {
        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postId").value((int) publicPostId))
                .andExpect(jsonPath("$.userId").value((int) viewerId));

        assertThat(countLikes(publicPostId, viewerId)).isOne();

        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postId").value((int) publicPostId))
                .andExpect(jsonPath("$.userId").value((int) viewerId));

        assertThat(countLikes(publicPostId, viewerId)).isOne();
    }

    @Test
    void upsert_bodyOmittedDefaultsToLike() throws Exception {
        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postId").value((int) publicPostId))
                .andExpect(jsonPath("$.userId").value((int) viewerId));
        assertThat(countLikes(publicPostId, viewerId)).isOne();
    }

    @Test
    void upsert_invalidReactionType_400() throws Exception {
        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LOVE"}
                                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(countLikes(publicPostId, viewerId)).isZero();
    }

    @Test
    void delete_like_idempotentEvenWhenMissing() throws Exception {
        mockMvc.perform(
                        delete("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());

        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isOk());
        assertThat(countLikes(publicPostId, viewerId)).isOne();

        mockMvc.perform(
                        delete("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk());
        assertThat(countLikes(publicPostId, viewerId)).isZero();
    }

    @Test
    void privatePost_followerCanReact_outsiderForbidden() throws Exception {
        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));

        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postId").value((int) privatePostId));
    }

    @Test
    void deletedPost_404_POST_NOT_FOUND() throws Exception {
        jdbc.update("UPDATE posts SET deleted_at = now() WHERE id = ?", publicPostId);

        mockMvc.perform(
                        put("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"reactionType":"LIKE"}
                                        """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));

        mockMvc.perform(
                        delete("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
    }

    @Test
    void unauthorizedWithoutBearer() throws Exception {
        mockMvc.perform(put("/api/v1/posts/{postId}/reactions/me", publicPostId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/v1/posts/{postId}/reactions/me", publicPostId))
                .andExpect(status().isUnauthorized());
    }

    private int countLikes(long postId, long userId) {
        Integer count =
                jdbc.queryForObject(
                        """
                        SELECT count(*) FROM post_likes WHERE post_id=? AND user_id=?
                        """,
                        Integer.class,
                        postId,
                        userId);
        return count == null ? 0 : count;
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREEE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    private void insertSettings(long userId, String accountVisibility) {
        jdbc.update(
                """
                INSERT INTO user_settings(
                  user_id,
                  voice_coaching_enabled,
                  bpm_guide_enabled,
                  group_notifications_enabled,
                  community_notifications_enabled,
                  location_collection_mode,
                  account_visibility)
                VALUES (?, false, false, false, false, 'OFF', ?::user_settings_account_visibility_enum)
                """,
                userId,
                accountVisibility);
    }

    private long insertSession(long userId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status)
                VALUES (?, 'COMPLETED'::running_sessions_status_enum)
                RETURNING id
                """,
                Long.class,
                userId);
    }

    private long insertPost(long authorId, long sessionId, String body) {
        return jdbc.queryForObject(
                """
                INSERT INTO posts(author_id, session_id, body)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                Long.class,
                authorId,
                sessionId,
                body);
    }
}
