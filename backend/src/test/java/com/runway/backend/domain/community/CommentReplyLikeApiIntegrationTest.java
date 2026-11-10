package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.community.dto.response.CommentReactionResponse;
import com.runway.backend.domain.community.service.CommentLikeService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import jakarta.persistence.EntityManagerFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;

/** S15P31E105-633: CMT06 대댓글 묶음·삭제 자리·댓글 좋아요 집계, CMT07 응답 형태, CMT14·CMT15 댓글 좋아요. */
class CommentReplyLikeApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CommentLikeService commentLikeService;
    @Autowired private EntityManagerFactory entityManagerFactory;
    @Autowired private PlatformTransactionManager transactionManager;

    private long authorId;
    private long viewerId;
    private long thirdId;
    private long privateAuthorId;
    private long postId;
    private long privatePostId;

    @BeforeEach
    void seed() {
        authorId = insertUser("crl_author", "답글작성자", "01063301001");
        viewerId = insertUser("crl_viewer", "답글조회자", "01063301002");
        thirdId = insertUser("crl_third", "답글제삼자", "01063301003");
        privateAuthorId = insertUser("crl_private", "답글비공개", "01063301004");
        insertSettings(authorId, "PUBLIC");
        insertSettings(viewerId, "PUBLIC");
        insertSettings(thirdId, "PUBLIC");
        insertSettings(privateAuthorId, "PRIVATE");
        postId = insertPost(authorId, "답글 게시물");
        privatePostId = insertPost(privateAuthorId, "비공개 게시물");
    }

    // AC-1: CMT07 parentCommentId로 대댓글 저장, 응답은 CMT06 항목과 같은 형태. 목록은 원댓글 바로 뒤에 대댓글.
    @Test
    void 대댓글은_저장되고_목록에서_원댓글_바로뒤에_온다() throws Exception {
        long rootA = insertComment(postId, viewerId, "원댓글A", null);
        long rootB = insertComment(postId, thirdId, "원댓글B", null);

        long replyA =
                id(
                        createComment(thirdId, "{\"body\":\"A의 답글\",\"parentCommentId\":" + rootA + "}")
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.parentCommentId").value(rootA))
                                .andExpect(jsonPath("$.authorId").value(thirdId))
                                .andExpect(jsonPath("$.deleted").value(false))
                                .andExpect(jsonPath("$.reactionCount").value(0))
                                .andExpect(jsonPath("$", hasKey("myReaction")))
                                .andExpect(jsonPath("$.myReaction").value(nullValue()))
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        long replyA2 = insertComment(postId, authorId, "A의 두번째 답글", rootA);
        long replyB = insertComment(postId, viewerId, "B의 답글", rootB);
        long rootC =
                id(
                        createComment(viewerId, "{\"body\":\"원댓글C\"}")
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$", hasKey("parentCommentId")))
                                .andExpect(jsonPath("$.parentCommentId").value(nullValue()))
                                .andExpect(jsonPath("$.deleted").value(false))
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT parent_comment_id FROM comments WHERE id=?",
                                Long.class,
                                replyA))
                .isEqualTo(rootA);

        comments(viewerId, postId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(6))
                .andExpect(jsonPath("$.items[0].id").value(rootA))
                .andExpect(jsonPath("$.items[1].id").value(replyA))
                .andExpect(jsonPath("$.items[1].parentCommentId").value(rootA))
                .andExpect(jsonPath("$.items[2].id").value(replyA2))
                .andExpect(jsonPath("$.items[3].id").value(rootB))
                .andExpect(jsonPath("$.items[4].id").value(replyB))
                .andExpect(jsonPath("$.items[4].parentCommentId").value(rootB))
                .andExpect(jsonPath("$.items[5].id").value(rootC))
                .andExpect(jsonPath("$.items[*].deleted", not(hasItem(true))));
    }

    // AC-2: 대댓글 남은 삭제 원댓글만 자리 항목. 대댓글 없거나 모두 삭제된 원댓글·삭제된 대댓글은 제외. commentCount는 자리 미포함.
    @Test
    void 삭제된원댓글은_살아있는대댓글이_있을때만_자리로_남고_댓글수에서_빠진다() throws Exception {
        long keptRoot = insertComment(postId, viewerId, "지울 원댓글", null);
        long liveReply = insertComment(postId, thirdId, "남은 답글", keptRoot);
        long deletedReply = insertComment(postId, authorId, "지운 답글", keptRoot);
        long loneRoot = insertComment(postId, thirdId, "답글 없는 원댓글", null);
        long emptiedRoot = insertComment(postId, authorId, "답글 모두 지워진 원댓글", null);
        long emptiedReply = insertComment(postId, viewerId, "지운 답글2", emptiedRoot);
        long liveRoot = insertComment(postId, authorId, "살아있는 원댓글", null);
        insertLike(keptRoot, thirdId);
        softDelete(keptRoot);
        softDelete(deletedReply);
        softDelete(loneRoot);
        softDelete(emptiedRoot);
        softDelete(emptiedReply);

        comments(viewerId, postId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].id").value(keptRoot))
                .andExpect(jsonPath("$.items[0].deleted").value(true))
                .andExpect(jsonPath("$.items[0].postId").value(postId))
                .andExpect(jsonPath("$.items[0]", hasKey("authorId")))
                .andExpect(jsonPath("$.items[0].authorId").value(nullValue()))
                .andExpect(jsonPath("$.items[0]", hasKey("body")))
                .andExpect(jsonPath("$.items[0].body").value(nullValue()))
                .andExpect(jsonPath("$.items[0]", hasKey("author")))
                .andExpect(jsonPath("$.items[0].author").value(nullValue()))
                .andExpect(jsonPath("$.items[0].parentCommentId").value(nullValue()))
                .andExpect(jsonPath("$.items[0].createdAt").isNotEmpty())
                .andExpect(jsonPath("$.items[0].reactionCount").value(0))
                .andExpect(jsonPath("$.items[0]", hasKey("myReaction")))
                .andExpect(jsonPath("$.items[0].myReaction").value(nullValue()))
                .andExpect(jsonPath("$.items[1].id").value(liveReply))
                .andExpect(jsonPath("$.items[1].parentCommentId").value(keptRoot))
                .andExpect(jsonPath("$.items[1].deleted").value(false))
                .andExpect(jsonPath("$.items[2].id").value(liveRoot))
                .andExpect(jsonPath("$.items[2].deleted").value(false));

        // 살아있는 댓글은 liveReply, liveRoot 2건. 삭제 자리는 세지 않는다.
        mockMvc.perform(
                        get("/api/v1/posts/{postId}", postId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(2));
        mockMvc.perform(get("/api/v1/posts").header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id==" + postId + ")].commentCount").value(2));

        // 남은 대댓글까지 지우면 자리도 사라진다.
        softDelete(liveReply);
        comments(viewerId, postId)
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(liveRoot));
    }

    // AC-3: PUT·DELETE 멱등, 응답 reactionCount·myReaction, 생략 body는 LIKE, 다른 값은 VALIDATION_ERROR, 자기 댓글 가능.
    @Test
    void 댓글좋아요_등록취소는_멱등이고_수와_내반응을_돌려준다() throws Exception {
        long commentId = insertComment(postId, viewerId, "좋아요 받을 댓글", null);
        insertLike(commentId, thirdId);

        like(viewerId, commentId, "{\"reactionType\":\"LIKE\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentId").value(commentId))
                .andExpect(jsonPath("$.reactionCount").value(2))
                .andExpect(jsonPath("$.myReaction").value("LIKE"));
        like(viewerId, commentId, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reactionCount").value(2))
                .andExpect(jsonPath("$.myReaction").value("LIKE"));
        assertThat(likeRows(commentId, viewerId)).isOne();

        like(authorId, commentId, "{\"reactionType\":\"LOVE\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(likeRows(commentId, authorId)).isZero();

        unlike(viewerId, commentId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentId").value(commentId))
                .andExpect(jsonPath("$.reactionCount").value(1))
                .andExpect(jsonPath("$", hasKey("myReaction")))
                .andExpect(jsonPath("$.myReaction").value(nullValue()));
        unlike(viewerId, commentId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reactionCount").value(1))
                .andExpect(jsonPath("$.myReaction").value(nullValue()));
        assertThat(likeRows(commentId, viewerId)).isZero();
        assertThat(likeRows(commentId, thirdId)).isOne();
    }

    // AC-3: 이미 좋아요한 댓글의 재요청은 INSERT(회원 행 NOWAIT 잠금 트리거)를 실행하지 않아 같은 회원의 회원 행이 잠겨도 200이다.
    // 대조로 새 좋아요는 같은 잠금에서 트리거가 실패해 503이다.
    @Test
    void 이미좋아요한댓글의_재요청은_회원행이_잠겨도_200() throws Exception {
        long likedId = insertComment(postId, authorId, "좋아요한 댓글", null);
        long freshId = insertComment(postId, authorId, "새 댓글", null);
        like(viewerId, likedId, null).andExpect(status().isOk());

        CommunityFixture.whileUserRowLocked(
                jdbc,
                transactionManager,
                viewerId,
                () -> {
                    like(viewerId, likedId, "{\"reactionType\":\"LIKE\"}")
                            .andExpect(status().isOk())
                            .andExpect(jsonPath("$.reactionCount").value(1))
                            .andExpect(jsonPath("$.myReaction").value("LIKE"));
                    like(viewerId, freshId, null)
                            .andExpect(status().isServiceUnavailable())
                            .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
                });
        assertThat(likeRows(likedId, viewerId)).isOne();
        assertThat(likeRows(freshId, viewerId)).isZero();
    }

    // AC-3: 없거나 삭제된 댓글은 COMMENT_NOT_FOUND, 삭제된 게시물은 POST_NOT_FOUND, 볼 수 없는 게시물은 ACCOUNT_ACCESS_DENIED.
    @Test
    void 삭제댓글_삭제게시물_볼수없는게시물의_댓글좋아요는_거절된다() throws Exception {
        long deletedComment = insertComment(postId, viewerId, "지운 댓글", null);
        insertLike(deletedComment, thirdId);
        softDelete(deletedComment);
        like(thirdId, deletedComment, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));
        unlike(thirdId, deletedComment)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));
        assertThat(likeRows(deletedComment, thirdId)).isOne();
        like(thirdId, 999_999_999L, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));

        long privateComment = insertComment(privatePostId, privateAuthorId, "비공개 글 댓글", null);
        like(viewerId, privateComment, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
        unlike(viewerId, privateComment)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
        assertThat(likeRows(privateComment, viewerId)).isZero();
        // 승인된 팔로워는 가능하다.
        jdbc.update(
                "INSERT INTO user_follows(follower_id, followee_id, is_approved) VALUES (?, ?, TRUE)",
                viewerId,
                privateAuthorId);
        like(viewerId, privateComment, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reactionCount").value(1));

        long onDeletedPost = insertComment(postId, viewerId, "게시물 삭제 전 댓글", null);
        jdbc.update("UPDATE posts SET deleted_at=now() WHERE id=?", postId);
        like(thirdId, onDeletedPost, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        unlike(thirdId, onDeletedPost)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        assertThat(likeRows(onDeletedPost, thirdId)).isZero();
    }

    // AC-3: 같은 회원의 동시 PUT은 모두 성공하고 행은 하나다.
    @Test
    void 같은회원의_동시_좋아요는_중복행을_만들지않는다() throws Exception {
        long commentId = insertComment(postId, authorId, "동시 좋아요 댓글", null);
        int threads = 8;
        List<Callable<CommentReactionResponse>> tasks = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            tasks.add(() -> commentLikeService.upsert(viewerId, commentId, null));
        }

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<CommentReactionResponse>> futures = new ArrayList<>();
            for (Callable<CommentReactionResponse> task : tasks) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return task.call();
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<CommentReactionResponse> future : futures) {
                CommentReactionResponse response = future.get(30, TimeUnit.SECONDS);
                assertThat(response.commentId()).isEqualTo(commentId);
                assertThat(response.reactionCount()).isOne();
                assertThat(response.myReaction()).isEqualTo("LIKE");
            }
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(likeRows(commentId, viewerId)).isOne();
    }

    // AC-4: 목록 reactionCount·myReaction이 조회자별로 맞다.
    @Test
    void 댓글목록_좋아요수와_내반응이_조회자별로_맞다() throws Exception {
        long root = insertComment(postId, authorId, "원댓글", null);
        long reply = insertComment(postId, thirdId, "답글", root);
        long plain = insertComment(postId, viewerId, "좋아요 없는 댓글", null);
        insertLike(root, viewerId);
        insertLike(root, thirdId);
        insertLike(reply, viewerId);

        comments(viewerId, postId)
                .andExpect(jsonPath("$.items[0].id").value(root))
                .andExpect(jsonPath("$.items[0].reactionCount").value(2))
                .andExpect(jsonPath("$.items[0].myReaction").value("LIKE"))
                .andExpect(jsonPath("$.items[1].id").value(reply))
                .andExpect(jsonPath("$.items[1].reactionCount").value(1))
                .andExpect(jsonPath("$.items[1].myReaction").value("LIKE"))
                .andExpect(jsonPath("$.items[2].id").value(plain))
                .andExpect(jsonPath("$.items[2].reactionCount").value(0))
                .andExpect(jsonPath("$.items[2].myReaction").value(nullValue()));
        comments(thirdId, postId)
                .andExpect(jsonPath("$.items[0].reactionCount").value(2))
                .andExpect(jsonPath("$.items[0].myReaction").value("LIKE"))
                .andExpect(jsonPath("$.items[1].reactionCount").value(1))
                .andExpect(jsonPath("$.items[1].myReaction").value(nullValue()));
        comments(authorId, postId)
                .andExpect(jsonPath("$.items[0].reactionCount").value(2))
                .andExpect(jsonPath("$.items[0].myReaction").value(nullValue()))
                .andExpect(jsonPath("$.items[1].myReaction").value(nullValue()))
                .andExpect(jsonPath("$.items[2].myReaction").value(nullValue()));
    }

    // AC-4: 댓글·좋아요·작성자가 늘어도 JPA 쿼리 수가 같다(N+1 없음).
    @Test
    void 댓글목록_조회쿼리수는_댓글수와_무관하다() throws Exception {
        long smallPost = insertPost(authorId, "작은 게시물");
        long small = insertComment(smallPost, viewerId, "하나", null);
        insertLike(small, thirdId);

        long largePost = insertPost(authorId, "큰 게시물");
        long[] commenters = {authorId, viewerId, thirdId};
        for (int i = 0; i < 6; i++) {
            long root = insertComment(largePost, commenters[i % 3], "원댓글" + i, null);
            long reply = insertComment(largePost, commenters[(i + 1) % 3], "답글" + i, root);
            insertLike(root, commenters[i % 3]);
            insertLike(reply, viewerId);
            if (i % 2 == 0) {
                softDelete(root);
            }
        }

        long smallQueries = jpaStatements(() -> comments(viewerId, smallPost).andExpect(status().isOk()));
        long largeQueries =
                jpaStatements(
                        () ->
                                comments(viewerId, largePost)
                                        .andExpect(status().isOk())
                                        .andExpect(jsonPath("$.items.length()").value(12)));
        assertThat(largeQueries).isPositive().isEqualTo(smallQueries);
    }

    private interface Action {
        void run() throws Exception;
    }

    private long jpaStatements(Action action) throws Exception {
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        boolean enabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        statistics.clear();
        try {
            action.run();
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(enabled);
        }
    }

    private ResultActions comments(long viewer, long targetPostId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/posts/{postId}/comments", targetPostId)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)));
    }

    private ResultActions createComment(long userId, String body) throws Exception {
        return mockMvc.perform(
                post("/api/v1/posts/{postId}/comments", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private ResultActions like(long userId, long commentId, String body) throws Exception {
        var request =
                put("/api/v1/comments/{commentId}/reactions/me", commentId)
                        .header("Authorization", SecurityTestSupport.bearer(userId));
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(request);
    }

    private ResultActions unlike(long userId, long commentId) throws Exception {
        return mockMvc.perform(
                delete("/api/v1/comments/{commentId}/reactions/me", commentId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private long id(String json) {
        return ((Number) com.jayway.jsonpath.JsonPath.read(json, "$.id")).longValue();
    }

    private int likeRows(long commentId, long userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM comment_likes WHERE comment_id=? AND user_id=?",
                Integer.class,
                commentId,
                userId);
    }

    private void softDelete(long commentId) {
        jdbc.update("UPDATE comments SET deleted_at=now() WHERE id=?", commentId);
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

    private void insertSettings(long userId, String visibility) {
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
                visibility);
    }

    private long insertPost(long postAuthorId, String body) {
        long sessionId =
                jdbc.queryForObject(
                        """
                        INSERT INTO running_sessions(user_id, status)
                        VALUES (?, 'COMPLETED'::running_sessions_status_enum)
                        RETURNING id
                        """,
                        Long.class,
                        postAuthorId);
        return jdbc.queryForObject(
                "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                postAuthorId,
                sessionId,
                body);
    }

    private long insertComment(long targetPostId, long commentAuthorId, String body, Long parentId) {
        return jdbc.queryForObject(
                """
                INSERT INTO comments(post_id, author_id, body, parent_comment_id)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                Long.class,
                targetPostId,
                commentAuthorId,
                body,
                parentId);
    }

    private void insertLike(long commentId, long userId) {
        jdbc.update(
                "INSERT INTO comment_likes(comment_id, user_id) VALUES (?, ?)", commentId, userId);
    }
}
