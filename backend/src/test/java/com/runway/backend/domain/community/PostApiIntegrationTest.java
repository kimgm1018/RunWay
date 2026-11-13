package com.runway.backend.domain.community;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.image.ImageStorage;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import org.junit.jupiter.api.BeforeEach;
import java.io.ByteArrayInputStream;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

class PostApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ImageStorage imageStorage;

    private long viewerId;
    private long publicAuthorId;
    private long privateAuthorId;
    private long outsiderId;

    private long viewerCompletedSessionId;
    private long publicAuthorCompletedSessionId;
    private long privateAuthorCompletedSessionId;
    private long outsiderCompletedSessionId;
    private long viewerNonCompletedSessionId;

    private long publicPostId;
    private long privatePostId;
    private long viewerPostId;

    @BeforeEach
    void seed() {
        viewerId = insertUser("post_viewer", "뷰어", "01010001001");
        publicAuthorId = insertUser("post_public", "공개작성", "01010001002");
        privateAuthorId = insertUser("post_private", "비공개작", "01010001003");
        outsiderId = insertUser("post_outsider", "외부인", "01010001004");

        insertSettings(viewerId, "PUBLIC");
        insertSettings(publicAuthorId, "PUBLIC");
        insertSettings(privateAuthorId, "PRIVATE");
        insertSettings(outsiderId, "PUBLIC");

        // viewer는 privateAuthor의 승인된 팔로워
        jdbc.update(
                """
                INSERT INTO user_follows(follower_id, followee_id, is_approved)
                VALUES (?, ?, TRUE)
                """,
                viewerId,
                privateAuthorId);

        viewerCompletedSessionId = insertSession(viewerId, "COMPLETED");
        publicAuthorCompletedSessionId = insertSession(publicAuthorId, "COMPLETED");
        privateAuthorCompletedSessionId = insertSession(privateAuthorId, "COMPLETED");
        outsiderCompletedSessionId = insertSession(outsiderId, "COMPLETED");
        viewerNonCompletedSessionId = insertSession(viewerId, "RUNNING");

        publicPostId = insertPost(publicAuthorId, publicAuthorCompletedSessionId, "공개 작성자 글");
        privatePostId = insertPost(privateAuthorId, privateAuthorCompletedSessionId, "비공개 작성자 글");
        viewerPostId = insertPost(viewerId, viewerCompletedSessionId, "뷰어 본인 글");
    }

    @Test
    void 헤더단독과_상충헤더로_게시물작성자를_가장할수없다() throws Exception {
        mockMvc.perform(
                        delete("/api/v1/posts/{postId}", viewerPostId)
                                .header("X-User-Id", viewerId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        delete("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .header("X-User-Id", viewerId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_AUTHOR"));
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.queryForObject(
                                "SELECT deleted_at IS NULL FROM posts WHERE id=?",
                                Boolean.class,
                                viewerPostId))
                .isTrue();
        mockMvc.perform(
                        get("/api/v1/posts/{postId}", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .header("X-User-Id", viewerId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
    }

    @Test
    void 완료된본인세션_게시물작성_201() throws Exception {
        long freshSessionId = insertSession(viewerId, "COMPLETED");

        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":%d,"body":"오늘 5km를 달렸어요."}
                                        """
                                                .formatted(freshSessionId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.authorId").value(viewerId))
                .andExpect(jsonPath("$.sessionId").value(freshSessionId))
                .andExpect(jsonPath("$.body").value("오늘 5km를 달렸어요."))
                .andExpect(jsonPath("$.createdAt").isNotEmpty());
    }

    @Test
    void 타인세션_게시물작성_403_RESOURCE_NOT_OWNED() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":%d,"body":"타인 세션 공유"}
                                        """
                                                .formatted(outsiderCompletedSessionId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_OWNED"));
    }

    // S15P31E105-778: 글 이미지 키는 크루 사진처럼 본인 POST 폴더에 실제로 올린 파일만 받는다.
    @Test
    void 글이미지키_외부URL과_남의경로와_없는파일은_403_본인업로드는_저장() throws Exception {
        String otherUsersKey = "images/post/" + outsiderId + "/" + UUID.randomUUID() + ".jpg";
        String missingOwnKey = "images/post/" + viewerId + "/" + UUID.randomUUID() + ".png";
        for (String key :
                new String[] {
                    "https://evil.example/a.jpg",
                    otherUsersKey,
                    missingOwnKey,
                    "images/crew/" + viewerId + "/" + UUID.randomUUID() + ".png",
                    "images/post/" + viewerId + "/../" + outsiderId + "/x.png"
                }) {
            mockMvc.perform(
                            post("/api/v1/posts")
                                    .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {"sessionId":%d,"imageKey":"%s"}
                                            """
                                                    .formatted(
                                                            insertSession(viewerId, "COMPLETED"),
                                                            key)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("RESOURCE_NOT_OWNED"));
        }
        org.assertj.core.api.Assertions.assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM posts WHERE image_key IS NOT NULL",
                                Long.class))
                .isZero();

        String ownKey = "images/post/" + viewerId + "/" + UUID.randomUUID() + ".png";
        byte[] png = new byte[] {(byte) 0x89, 0x50, 0x4E, 0x47};
        imageStorage.store(ownKey, new ByteArrayInputStream(png), png.length);
        try {
            mockMvc.perform(
                            post("/api/v1/posts")
                                    .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            """
                                            {"sessionId":%d,"imageKey":"%s"}
                                            """
                                                    .formatted(
                                                            insertSession(viewerId, "COMPLETED"),
                                                            ownKey)))
                    .andExpect(status().isCreated());
            org.assertj.core.api.Assertions.assertThat(
                            jdbc.queryForObject(
                                    "SELECT image_key FROM posts WHERE image_key IS NOT NULL",
                                    String.class))
                    .isEqualTo(ownKey);
        } finally {
            imageStorage.deletePersonalImages(viewerId);
        }
    }

    // S15P31E105-778: 없는 지역 코드는 DB 외래키 오류(500) 전에 400 INVALID_REGION으로 거절한다.
    @Test
    void 없는지역코드_게시물작성_400_INVALID_REGION_있는코드는_저장() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":%d,"regionCode":"ZZZ"}
                                        """
                                                .formatted(insertSession(viewerId, "COMPLETED"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REGION"));

        String regionCode =
                jdbc.queryForObject(
                        "SELECT region_code FROM regions ORDER BY region_code LIMIT 1",
                        String.class);
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":%d,"regionCode":"%s"}
                                        """
                                                .formatted(
                                                        insertSession(viewerId, "COMPLETED"),
                                                        regionCode)))
                .andExpect(status().isCreated());
    }

    @Test
    void 미완료세션_게시물작성_422_INVALID_POST() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":%d,"body":"미완료 세션"}
                                        """
                                                .formatted(viewerNonCompletedSessionId)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_POST"));
    }

    @Test
    void 공개글목록노출_비공개상세_비팔로워403_팔로워OK() throws Exception {
        mockMvc.perform(
                        get("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id", hasItem((int) publicPostId)))
                .andExpect(jsonPath("$.items[*].id", not(hasItem((int) privatePostId))));

        mockMvc.perform(
                        get("/api/v1/posts/{postId}", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));

        mockMvc.perform(
                        get("/api/v1/posts/{postId}", privatePostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(privatePostId))
                .andExpect(jsonPath("$.authorId").value(privateAuthorId))
                .andExpect(jsonPath("$.body").value("비공개 작성자 글"));
    }

    @Test
    void FOLLOWING스코프_팔로위와본인포함() throws Exception {
        mockMvc.perform(
                        get("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .param("scope", "FOLLOWING"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                "$.items[*].id",
                                containsInAnyOrder((int) privatePostId, (int) viewerPostId)))
                .andExpect(jsonPath("$.items[*].id", not(hasItem((int) publicPostId))));
    }

    @Test
    void authorId필터_해당작성자만() throws Exception {
        mockMvc.perform(
                        get("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .param("authorId", String.valueOf(publicAuthorId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(publicPostId))
                .andExpect(jsonPath("$.items[0].authorId").value(publicAuthorId));
    }

    @Test
    void 본인본문수정_OK_타인수정_403_NOT_AUTHOR() throws Exception {
        mockMvc.perform(
                        patch("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"수정된 본문"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(viewerPostId))
                .andExpect(jsonPath("$.body").value("수정된 본문"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        mockMvc.perform(
                        patch("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"body":"타인 수정 시도"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_AUTHOR"));
    }

    // S15P31E105-779: 글 본문은 앱 작성 화면과 같은 500자까지(작성·수정).
    @Test
    void 글본문_500자까지_501자는_400() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"sessionId\":%d,\"body\":\"%s\"}"
                                                .formatted(
                                                        insertSession(viewerId, "COMPLETED"),
                                                        "가".repeat(501))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"sessionId\":%d,\"body\":\"%s\"}"
                                                .formatted(
                                                        insertSession(viewerId, "COMPLETED"),
                                                        "가".repeat(500))))
                .andExpect(status().isCreated());
        mockMvc.perform(
                        patch("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"body\":\"%s\"}".formatted("가".repeat(501))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 소프트삭제후_상세_404_POST_NOT_FOUND() throws Exception {
        mockMvc.perform(
                        delete("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedAt").isNotEmpty());

        mockMvc.perform(
                        get("/api/v1/posts/{postId}", viewerPostId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
    }

    @Test
    void 헤더없으면_401() throws Exception {
        mockMvc.perform(
                        post("/api/v1/posts")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"sessionId":1,"body":"인증 없음"}
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
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
}
