package com.runway.backend.domain.community;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

class CommentApiIntegrationTest extends SharedContextIntegrationSupport {
    @Test
    void 헤더단독과_상충헤더로_댓글작성자를_가장할수없다() throws Exception {
        long comment = insertComment(publicPostId, viewerId, "keep-body", null);
        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", comment)
                                .header("X-User-Id", viewerId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"body\":\"forged\"}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", comment)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .header("X-User-Id", viewerId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"body\":\"forged\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_AUTHOR"));
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.queryForObject(
                                "SELECT body FROM comments WHERE id=?", String.class, comment))
                .isEqualTo("keep-body");
        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .header("X-User-Id", viewerId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
    }

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
        viewerId = insertUser("cmt_viewer", "뷰어", "01020001001");
        publicAuthorId = insertUser("cmt_public", "공개작성", "01020001002");
        privateAuthorId = insertUser("cmt_private", "비공개작", "01020001003");
        outsiderId = insertUser("cmt_outsider", "외부인", "01020001004");

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

        long publicAuthorCompletedSessionId = insertSession(publicAuthorId, "COMPLETED");
        long privateAuthorCompletedSessionId = insertSession(privateAuthorId, "COMPLETED");

        publicPostId = insertPost(publicAuthorId, publicAuthorCompletedSessionId, "공개 작성자 글");
        privatePostId = insertPost(privateAuthorId, privateAuthorCompletedSessionId, "비공개 작성자 글");
    }

    @Test
    void 공개글_댓글목록_200_소프트삭제제외_대댓글parentCommentId포함() throws Exception {
        long rootId = insertComment(publicPostId, viewerId, "루트 댓글", null);
        long replyId = insertComment(publicPostId, publicAuthorId, "대댓글", rootId);
        long deletedId = insertComment(publicPostId, outsiderId, "삭제된 댓글", null);
        jdbc.update("UPDATE comments SET deleted_at = now() WHERE id = ?", deletedId);

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(rootId))
                .andExpect(jsonPath("$.items[0].postId").value(publicPostId))
                .andExpect(jsonPath("$.items[0].authorId").value(viewerId))
                .andExpect(jsonPath("$.items[0].parentCommentId").value(nullValue()))
                .andExpect(jsonPath("$.items[0].body").value("루트 댓글"))
                .andExpect(jsonPath("$.items[0].createdAt").isNotEmpty())
                .andExpect(jsonPath("$.items[1].id").value(replyId))
                .andExpect(jsonPath("$.items[1].parentCommentId").value((int) rootId))
                .andExpect(jsonPath("$.items[1].body").value("대댓글"))
                .andExpect(jsonPath("$.items[*].id", not(hasItem((int) deletedId))));
    }

    @Test
    void 비공개글_댓글목록_비팔로워403_팔로워200() throws Exception {
        insertComment(privatePostId, privateAuthorId, "비공개 댓글", null);

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].body").value("비공개 댓글"));
    }

    @Test
    void 루트댓글작성_201_대댓글작성_201_공백본문_422_EMPTY_COMMENT() throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/posts/{postId}/comments", publicPostId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"body":"루트 댓글입니다."}
                                                """))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.id").isNumber())
                        .andExpect(jsonPath("$.postId").value(publicPostId))
                        .andExpect(jsonPath("$.authorId").value(viewerId))
                        .andExpect(jsonPath("$.parentCommentId").value(nullValue()))
                        .andExpect(jsonPath("$.body").value("루트 댓글입니다."))
                        .andExpect(jsonPath("$.createdAt").isNotEmpty())
                        .andReturn();

        String createRoot = created.getResponse().getContentAsString();
        long rootId = Long.parseLong(createRoot.replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(publicAuthorId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"대댓글입니다.","parentCommentId":%d}
                                        """
                                                .formatted(rootId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.postId").value(publicPostId))
                .andExpect(jsonPath("$.authorId").value(publicAuthorId))
                .andExpect(jsonPath("$.parentCommentId").value((int) rootId))
                .andExpect(jsonPath("$.body").value("대댓글입니다."))
                .andExpect(jsonPath("$.createdAt").isNotEmpty());

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"   "}
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("EMPTY_COMMENT"));
    }

    @Test
    void 삭제된부모_또는_2단대댓글_422_INVALID_PARENT_COMMENT_없는게시물_404() throws Exception {
        long rootId = insertComment(publicPostId, viewerId, "루트", null);
        long replyId = insertComment(publicPostId, publicAuthorId, "1단 대댓글", rootId);
        long deletedRootId = insertComment(publicPostId, outsiderId, "삭제될 부모", null);
        jdbc.update("UPDATE comments SET deleted_at = now() WHERE id = ?", deletedRootId);

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"삭제된 부모에 대댓글","parentCommentId":%d}
                                        """
                                                .formatted(deletedRootId)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_PARENT_COMMENT"));

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"2단 대댓글 시도","parentCommentId":%d}
                                        """
                                                .formatted(replyId)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_PARENT_COMMENT"));

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", 9_999_999L)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"없는 게시물"}
                                        """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
    }

    @Test
    void 비공개글_댓글작성_비팔로워403_ACCOUNT_ACCESS_DENIED() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"접근 불가 댓글"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
    }

    @Test
    void 본인댓글수정_200_타인수정_403_NOT_AUTHOR_공백_422_EMPTY_COMMENT() throws Exception {
        long commentId = insertComment(publicPostId, viewerId, "원본 본문", null);

        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", commentId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"수정된 본문"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(commentId))
                .andExpect(jsonPath("$.body").value("수정된 본문"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", commentId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"타인 수정 시도"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_AUTHOR"));

        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", commentId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"  "}
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("EMPTY_COMMENT"));
    }

    @Test
    void 소프트삭제_200_이후_수정삭제_404_COMMENT_NOT_FOUND_타인삭제_403() throws Exception {
        long ownCommentId = insertComment(publicPostId, viewerId, "삭제할 댓글", null);
        long otherCommentId = insertComment(publicPostId, publicAuthorId, "타인 댓글", null);

        mockMvc.perform(
                        delete("/api/v1/comments/{commentId}", otherCommentId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_AUTHOR"));

        mockMvc.perform(
                        delete("/api/v1/comments/{commentId}", ownCommentId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedAt").isNotEmpty());

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", not(hasItem((int) ownCommentId))))
                .andExpect(jsonPath("$.items[*].id", hasItem((int) otherCommentId)));

        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", ownCommentId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"삭제 후 수정"}
                                        """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));

        mockMvc.perform(
                        delete("/api/v1/comments/{commentId}", ownCommentId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"));
    }

    @Test
    void 타인댓글은_게시물작성자_알림행_본인댓글은_알림없음() throws Exception {
        jdbc.update(
                "UPDATE user_settings SET community_notifications_enabled=TRUE WHERE user_id=?",
                publicAuthorId);

        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/posts/{postId}/comments", publicPostId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"body":"알림용 타인 댓글"}
                                                """))
                        .andExpect(status().isCreated())
                        .andReturn();
        long commentId =
                Long.parseLong(
                        created
                                .getResponse()
                                .getContentAsString()
                                .replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));

        var row =
                jdbc.queryForMap(
                        """
                        SELECT notification_type, target_id, dedupe_key, message
                        FROM notifications
                        WHERE user_id=?
                        """,
                        publicAuthorId);
        assertThat(row.get("notification_type")).isEqualTo("POST_COMMENT");
        assertThat(((Number) row.get("target_id")).longValue()).isEqualTo(publicPostId);
        assertThat(row.get("dedupe_key")).isEqualTo("POST_COMMENT:" + commentId);
        assertThat((String) row.get("message")).isNotBlank().hasSizeLessThanOrEqualTo(100);
        assertThat(countNotifications(publicAuthorId)).isEqualTo(1);
        assertThat(countNotifications(viewerId)).isZero();

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .header("Authorization", SecurityTestSupport.bearer(publicAuthorId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"작성자 본인 댓글"}
                                        """))
                .andExpect(status().isCreated());

        assertThat(countNotifications(publicAuthorId)).isEqualTo(1);
    }

    @Test
    void 헤더없으면_401_UNAUTHORIZED() throws Exception {
        mockMvc.perform(get("/api/v1/posts/{postId}/comments", publicPostId))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", publicPostId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"인증 없음"}
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(
                        patch("/api/v1/comments/{commentId}", 1L)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"인증 없음"}
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(delete("/api/v1/comments/{commentId}", 1L))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    private long countNotifications(long userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM notifications WHERE user_id=?", Long.class, userId);
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

    private long insertSession(long userId, String status) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status)
                VALUES (?, ?::running_sessions_status_enum)
                RETURNING id
                """,
                Long.class,
                userId,
                status);
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

    private long insertComment(long postId, long authorId, String body, Long parentCommentId) {
        return jdbc.queryForObject(
                """
                INSERT INTO comments(post_id, author_id, body, parent_comment_id)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                Long.class,
                postId,
                authorId,
                body,
                parentCommentId);
    }
}
