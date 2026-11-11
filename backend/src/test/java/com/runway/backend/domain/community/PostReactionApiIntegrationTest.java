package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;

class PostReactionApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;

    private long viewerId;
    private long publicAuthorId;
    private long privateAuthorId;
    private long outsiderId;
    private long publicPostId;
    private long privatePostId;

    @BeforeEach
    void seed() {
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

    /**
     * 이미 좋아요한 글의 재요청은 INSERT(회원 행 NOWAIT 잠금 트리거)를 실행하지 않아, 같은 회원의 로그인·프로필 저장이 회원 행을 잠근 중에도
     * 200이다. 대조로 새 좋아요는 같은 잠금에서 트리거가 실패해 503이다.
     */
    @Test
    void upsert_repeatLike_succeedsWhileUserRowLocked() throws Exception {
        long otherPostId = insertPost(publicAuthorId, insertSession(publicAuthorId), "다른 글");
        putLike(viewerId, publicPostId).andExpect(status().isOk());

        CommunityFixture.whileUserRowLocked(
                jdbc,
                transactionManager,
                viewerId,
                () -> {
                    putLike(viewerId, publicPostId).andExpect(status().isOk());
                    putLike(viewerId, otherPostId)
                            .andExpect(status().isServiceUnavailable())
                            .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
                });
        assertThat(countLikes(publicPostId, viewerId)).isOne();
        assertThat(countLikes(otherPostId, viewerId)).isZero();
    }

    private ResultActions putLike(long userId, long postId) throws Exception {
        return mockMvc.perform(
                put("/api/v1/posts/{postId}/reactions/me", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reactionType\":\"LIKE\"}"));
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

    // 같은 회원의 동시 PUT은 롤백 전용 트랜잭션(500) 없이 모두 200이고 행은 하나다. 취소 후 다시 반복해도 같다.
    @Test
    void upsert_concurrentSameUser_all200_andSingleRow() throws Exception {
        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            for (int round = 0; round < 3; round++) {
                CountDownLatch ready = new CountDownLatch(threads);
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Integer>> futures = new ArrayList<>();
                for (int i = 0; i < threads; i++) {
                    futures.add(
                            pool.submit(
                                    () -> {
                                        ready.countDown();
                                        start.await();
                                        return mockMvc.perform(
                                                        put(
                                                                        "/api/v1/posts/{postId}/reactions/me",
                                                                        publicPostId)
                                                                .header(
                                                                        "Authorization",
                                                                        SecurityTestSupport.bearer(
                                                                                viewerId))
                                                                .contentType(
                                                                        MediaType.APPLICATION_JSON)
                                                                .content(
                                                                        """
                                                                        {"reactionType":"LIKE"}
                                                                        """))
                                                .andExpect(jsonPath("$.postId").value((int) publicPostId))
                                                .andExpect(jsonPath("$.userId").value((int) viewerId))
                                                .andReturn()
                                                .getResponse()
                                                .getStatus();
                                    }));
                }
                assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                start.countDown();
                for (Future<Integer> future : futures) {
                    assertThat(future.get(30, TimeUnit.SECONDS)).isEqualTo(200);
                }
                assertThat(countLikes(publicPostId, viewerId)).isOne();

                mockMvc.perform(
                                delete("/api/v1/posts/{postId}/reactions/me", publicPostId)
                                        .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                        .andExpect(status().isOk());
                assertThat(countLikes(publicPostId, viewerId)).isZero();
            }
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
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
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
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
