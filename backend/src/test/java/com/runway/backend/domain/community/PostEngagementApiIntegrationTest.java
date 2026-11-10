package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.test.web.servlet.ResultActions;

/**
 * S15P31E105-632: 게시물 목록·상세의 댓글 수·좋아요 수·내 반응·작성자 사진, 댓글 작성자 정보, 코스 공유 여부, 검색 사진.
 */
class PostEngagementApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long authorId;
    private long viewerId;
    private long thirdId;
    private long courseId;
    private long courseSessionId;
    private long freeSessionId;

    @BeforeEach
    void seed() {
        authorId = insertUser("eng_author", "참여작성자", "01060001001");
        viewerId = insertUser("eng_viewer", "참여조회자", "01060001002");
        thirdId = insertUser("eng_third", "참여제삼자", "01060001003");
        insertSettings(authorId);
        insertSettings(viewerId);
        insertSettings(thirdId);
        setProfileImage(authorId, "author-photo");
        setProfileImage(thirdId, "third-photo");

        courseId =
                jdbc.queryForObject(
                        """
                        INSERT INTO courses(route, start_position, distance)
                        VALUES (ST_GeogFromText('LINESTRING(127 37,127.1 37.1)'),
                                ST_GeogFromText('POINT(127 37)'), 5000)
                        RETURNING id
                        """,
                        Long.class);
        courseSessionId = insertSession(authorId, courseId);
        freeSessionId = insertSession(authorId, null);
    }

    // AC-1: 삭제 댓글 제외 commentCount(대댓글 포함), 좋아요 행 수, 조회자별 myReaction.
    @Test
    void 목록과상세_댓글수는_삭제제외_좋아요수와_조회자별_내반응() throws Exception {
        long postId = insertPost(authorId, courseSessionId, "참여 게시물");
        long emptyPostId = insertPost(authorId, freeSessionId, "반응 없는 게시물");
        long root = insertComment(postId, viewerId, "첫 댓글", null);
        insertComment(postId, thirdId, "대댓글", root);
        long removed = insertComment(postId, thirdId, "지운 댓글", null);
        jdbc.update("UPDATE comments SET deleted_at=now() WHERE id=?", removed);
        insertLike(postId, viewerId);
        insertLike(postId, thirdId);

        list(viewerId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(emptyPostId))
                .andExpect(jsonPath("$.items[0].commentCount").value(0))
                .andExpect(jsonPath("$.items[0].reactionCount").value(0))
                .andExpect(jsonPath("$.items[0]", hasKey("myReaction")))
                .andExpect(jsonPath("$.items[0].myReaction").value(nullValue()))
                .andExpect(jsonPath("$.items[1].id").value(postId))
                .andExpect(jsonPath("$.items[1].commentCount").value(2))
                .andExpect(jsonPath("$.items[1].reactionCount").value(2))
                .andExpect(jsonPath("$.items[1].myReaction").value("LIKE"));

        detail(viewerId, postId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(2))
                .andExpect(jsonPath("$.reactionCount").value(2))
                .andExpect(jsonPath("$.myReaction").value("LIKE"));

        // 좋아요하지 않은 작성자에게는 같은 수와 null 반응.
        detail(authorId, postId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commentCount").value(2))
                .andExpect(jsonPath("$.reactionCount").value(2))
                .andExpect(jsonPath("$", hasKey("myReaction")))
                .andExpect(jsonPath("$.myReaction").value(nullValue()));
        list(authorId)
                .andExpect(jsonPath("$.items[1].myReaction").value(nullValue()))
                .andExpect(jsonPath("$.items[1].reactionCount").value(2));
    }

    // AC-1/AC-5: 여러 게시물의 집계가 게시물별로 섞이지 않는다(IN 조회 결과 매핑).
    @Test
    void 여러게시물_집계가_게시물별로_분리된다() throws Exception {
        long first = insertPost(authorId, courseSessionId, "첫째");
        long second = insertPost(thirdId, insertSession(thirdId, null), "둘째");
        insertComment(first, viewerId, "a", null);
        insertComment(second, viewerId, "b", null);
        insertComment(second, authorId, "c", null);
        insertComment(second, thirdId, "d", null);
        insertLike(second, viewerId);

        list(viewerId)
                .andExpect(jsonPath("$.items[0].id").value(second))
                .andExpect(jsonPath("$.items[0].commentCount").value(3))
                .andExpect(jsonPath("$.items[0].reactionCount").value(1))
                .andExpect(jsonPath("$.items[0].myReaction").value("LIKE"))
                .andExpect(jsonPath("$.items[1].id").value(first))
                .andExpect(jsonPath("$.items[1].commentCount").value(1))
                .andExpect(jsonPath("$.items[1].reactionCount").value(0))
                .andExpect(jsonPath("$.items[1].myReaction").value(nullValue()));
    }

    // AC-2: 작성자 사진은 등록자에게 주소, 미등록자에게 null(키 포함).
    @Test
    void 목록과상세_작성자사진_등록자는주소_미등록자는null() throws Exception {
        long withPhoto = insertPost(authorId, courseSessionId, "사진 작성자");
        long withoutPhoto = insertPost(viewerId, insertSession(viewerId, null), "사진 없는 작성자");

        list(viewerId)
                .andExpect(jsonPath("$.items[0].id").value(withoutPhoto))
                .andExpect(jsonPath("$.items[0].author.userId").value(viewerId))
                .andExpect(jsonPath("$.items[0].author.nickname").value("참여조회자"))
                .andExpect(jsonPath("$.items[0].author", hasKey("profileImageUrl")))
                .andExpect(jsonPath("$.items[0].author.profileImageUrl").value(nullValue()))
                .andExpect(jsonPath("$.items[1].id").value(withPhoto))
                .andExpect(
                        jsonPath("$.items[1].author.profileImageUrl")
                                .value("/api/v1/images/author-photo"));

        detail(viewerId, withPhoto)
                .andExpect(jsonPath("$.author.userId").value(authorId))
                .andExpect(jsonPath("$.author.nickname").value("참여작성자"))
                .andExpect(jsonPath("$.author.profileImageUrl").value("/api/v1/images/author-photo"));
        detail(viewerId, withoutPhoto)
                .andExpect(jsonPath("$.author", hasKey("profileImageUrl")))
                .andExpect(jsonPath("$.author.profileImageUrl").value(nullValue()));
    }

    // AC-2/AC-3: 게시물 작성자가 아닌 제3자 댓글의 작성자 닉네임·사진.
    @Test
    void 댓글목록과작성_제3자작성자의_닉네임과사진() throws Exception {
        long postId = insertPost(authorId, courseSessionId, "댓글 게시물");
        insertComment(postId, thirdId, "제3자 댓글", null);
        insertComment(postId, viewerId, "사진 없는 댓글", null);

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", postId)
                                .header("Authorization", SecurityTestSupport.bearer(authorId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].authorId").value(thirdId))
                .andExpect(jsonPath("$.items[0].author.userId").value(thirdId))
                .andExpect(jsonPath("$.items[0].author.nickname").value("참여제삼자"))
                .andExpect(
                        jsonPath("$.items[0].author.profileImageUrl")
                                .value("/api/v1/images/third-photo"))
                .andExpect(jsonPath("$.items[1].author.userId").value(viewerId))
                .andExpect(jsonPath("$.items[1].author.nickname").value("참여조회자"))
                .andExpect(jsonPath("$.items[1].author", hasKey("profileImageUrl")))
                .andExpect(jsonPath("$.items[1].author.profileImageUrl").value(nullValue()));

        mockMvc.perform(
                        post("/api/v1/posts/{postId}/comments", postId)
                                .header("Authorization", SecurityTestSupport.bearer(thirdId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"body\":\"새 댓글\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorId").value(thirdId))
                .andExpect(jsonPath("$.author.userId").value(thirdId))
                .andExpect(jsonPath("$.author.nickname").value("참여제삼자"))
                .andExpect(
                        jsonPath("$.author.profileImageUrl").value("/api/v1/images/third-photo"));

        detail(viewerId, postId).andExpect(jsonPath("$.commentCount").value(3));
    }

    // AC-4: 작성 시 courseShared 생략=true, 타인에게 courseId 유지.
    @Test
    void 코스러닝_courseShared생략시_true이고_타인에게_courseId노출() throws Exception {
        long postId =
                createPost(courseSessionId, "{\"sessionId\":%d,\"body\":\"생략\"}")
                        .andExpect(jsonPath("$.courseId").value(courseId))
                        .andExpect(jsonPath("$.courseShared").value(true))
                        .andReturn()
                        .getResponse()
                        .getContentAsString()
                        .transform(this::id);
        assertThat(storedCourseShared(postId)).isTrue();

        detail(viewerId, postId)
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseShared").value(true));
        list(viewerId)
                .andExpect(jsonPath("$.items[0].courseId").value(courseId))
                .andExpect(jsonPath("$.items[0].courseShared").value(true));
    }

    // AC-4: false 지정 시 타인에게 courseId null, 작성자에게 유지. PATCH로 변경·생략.
    @Test
    void 코스러닝_courseShared_false는_타인에게_courseId숨김_작성자는유지_PATCH변경과생략() throws Exception {
        long postId =
                createPost(courseSessionId, "{\"sessionId\":%d,\"body\":\"비공유\",\"courseShared\":false}")
                        .andExpect(jsonPath("$.courseId").value(courseId))
                        .andExpect(jsonPath("$.courseShared").value(false))
                        .andReturn()
                        .getResponse()
                        .getContentAsString()
                        .transform(this::id);
        assertThat(storedCourseShared(postId)).isFalse();

        detail(viewerId, postId)
                .andExpect(jsonPath("$", hasKey("courseId")))
                .andExpect(jsonPath("$.courseId").value(nullValue()))
                .andExpect(jsonPath("$.courseShared").value(false));
        list(viewerId)
                .andExpect(jsonPath("$.items[0]", hasKey("courseId")))
                .andExpect(jsonPath("$.items[0].courseId").value(nullValue()))
                .andExpect(jsonPath("$.items[0].courseShared").value(false));
        detail(authorId, postId)
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseShared").value(false));
        list(authorId)
                .andExpect(jsonPath("$.items[0].courseId").value(courseId))
                .andExpect(jsonPath("$.items[0].courseShared").value(false));

        // PATCH courseShared=true로 변경. body는 그대로 바뀐다.
        patchPost(authorId, postId, "{\"body\":\"공유로 변경\",\"courseShared\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("공유로 변경"))
                .andExpect(jsonPath("$.courseShared").value(true));
        detail(viewerId, postId)
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseShared").value(true));

        // courseShared 생략은 기존 값(true) 유지.
        patchPost(authorId, postId, "{\"body\":\"본문만 수정\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseShared").value(true));
        assertThat(storedCourseShared(postId)).isTrue();

        // courseShared만 보내면 body는 유지된다.
        patchPost(authorId, postId, "{\"courseShared\":false}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("본문만 수정"))
                .andExpect(jsonPath("$.courseShared").value(false));
        assertThat(storedCourseShared(postId)).isFalse();
        detail(viewerId, postId).andExpect(jsonPath("$.courseId").value(nullValue()));
    }

    // AC-4: 자유 러닝은 요청 값과 무관하게 courseShared=false.
    @Test
    void 자유러닝은_courseShared_true요청도_false로저장되고_PATCH도_false유지() throws Exception {
        long postId =
                createPost(freeSessionId, "{\"sessionId\":%d,\"body\":\"자유\",\"courseShared\":true}")
                        .andExpect(jsonPath("$", hasKey("courseId")))
                        .andExpect(jsonPath("$.courseId").value(nullValue()))
                        .andExpect(jsonPath("$.courseShared").value(false))
                        .andReturn()
                        .getResponse()
                        .getContentAsString()
                        .transform(this::id);
        assertThat(storedCourseShared(postId)).isFalse();

        patchPost(authorId, postId, "{\"courseShared\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseShared").value(false));
        assertThat(storedCourseShared(postId)).isFalse();
        detail(authorId, postId)
                .andExpect(jsonPath("$.courseId").value(nullValue()))
                .andExpect(jsonPath("$.courseShared").value(false));
    }

    // AC-4/AC-6: V27 기본값 TRUE로 남은 자유 러닝 게시물도 응답은 false, 코스 러닝 기존 게시물은 true.
    @Test
    void 기본값true인_기존게시물_자유러닝은_응답false_코스러닝은_true() throws Exception {
        long legacyFree = insertPost(authorId, freeSessionId, "기존 자유");
        long legacyCourse = insertPost(authorId, courseSessionId, "기존 코스");
        assertThat(storedCourseShared(legacyFree)).isTrue();
        assertThat(storedCourseShared(legacyCourse)).isTrue();

        detail(viewerId, legacyFree)
                .andExpect(jsonPath("$.courseId").value(nullValue()))
                .andExpect(jsonPath("$.courseShared").value(false));
        detail(viewerId, legacyCourse)
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseShared").value(true));
    }

    // AC-4(리뷰 A-2): CMT04 생략과 null 구분. body null·공백은 비움, body 생략은 유지, courseShared null은 유지.
    @Test
    void PATCH_body_null과공백은_비우고_생략은_유지_courseShared_null은_기존값유지() throws Exception {
        long postId = insertPost(authorId, courseSessionId, "원래 본문");
        jdbc.update("UPDATE posts SET course_shared=false WHERE id=?", postId);

        patchPost(authorId, postId, "{\"courseShared\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("원래 본문"))
                .andExpect(jsonPath("$.courseShared").value(false));
        assertThat(storedCourseShared(postId)).isFalse();
        assertThat(storedBody(postId)).isEqualTo("원래 본문");

        patchPost(authorId, postId, "{\"body\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasKey("body")))
                .andExpect(jsonPath("$.body").value(nullValue()))
                .andExpect(jsonPath("$.courseShared").value(false));
        assertThat(storedBody(postId)).isNull();
        assertThat(storedCourseShared(postId)).isFalse();

        patchPost(authorId, postId, "{\"body\":\"다시 쓴 본문\",\"courseShared\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("다시 쓴 본문"));
        patchPost(authorId, postId, "{\"body\":\"   \"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value(nullValue()))
                .andExpect(jsonPath("$.courseShared").value(true));
        assertThat(storedBody(postId)).isNull();

        patchPost(authorId, postId, "{\"body\":\"마지막 본문\"}").andExpect(status().isOk());
        patchPost(authorId, postId, "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("마지막 본문"))
                .andExpect(jsonPath("$.courseShared").value(true));
        assertThat(storedBody(postId)).isEqualTo("마지막 본문");
        assertThat(storedCourseShared(postId)).isTrue();
    }

    // AC-4(리뷰 A-2): U21 러너 프로필 게시물도 목록 규칙을 재사용해 courseShared=false면 타인에게 courseId를 숨긴다.
    @Test
    void 러너프로필_게시물도_courseShared_false면_타인에게_courseId숨김() throws Exception {
        long hidden = insertPost(authorId, courseSessionId, "비공유 코스");
        jdbc.update("UPDATE posts SET course_shared=false WHERE id=?", hidden);
        long shared = insertPost(authorId, insertSession(authorId, courseId), "공유 코스");

        profile(viewerId, authorId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.posts.length()").value(2))
                .andExpect(jsonPath("$.posts[0].id").value(shared))
                .andExpect(jsonPath("$.posts[0].courseId").value(courseId))
                .andExpect(jsonPath("$.posts[0].courseShared").value(true))
                .andExpect(jsonPath("$.posts[1].id").value(hidden))
                .andExpect(jsonPath("$.posts[1]", hasKey("courseId")))
                .andExpect(jsonPath("$.posts[1].courseId").value(nullValue()))
                .andExpect(jsonPath("$.posts[1].courseShared").value(false));

        profile(authorId, authorId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.posts[1].id").value(hidden))
                .andExpect(jsonPath("$.posts[1].courseId").value(courseId))
                .andExpect(jsonPath("$.posts[1].courseShared").value(false));
    }

    // AC-3(리뷰 A-3): 탈퇴 회원 댓글 작성자는 nickname "탈퇴한 회원", 사진 null.
    @Test
    void 탈퇴회원_댓글작성자는_탈퇴한회원_닉네임과_사진null() throws Exception {
        long postId = insertPost(authorId, courseSessionId, "탈퇴 댓글 게시물");
        long leaverId = insertUser("eng_leaver", "참여탈퇴자", "01060001004");
        setProfileImage(leaverId, "leaver-photo");
        insertComment(postId, leaverId, "탈퇴한 회원의 댓글입니다", null);
        jdbc.update(
                """
                UPDATE users SET nickname='탈퇴한 회원', profile_image_key=NULL,
                    account_status='WITHDRAWN', withdrawn_at=now()
                WHERE id=?
                """,
                leaverId);

        mockMvc.perform(
                        get("/api/v1/posts/{postId}/comments", postId)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].author.userId").value(leaverId))
                .andExpect(jsonPath("$.items[0].author.nickname").value("탈퇴한 회원"))
                .andExpect(jsonPath("$.items[0].author", hasKey("profileImageUrl")))
                .andExpect(jsonPath("$.items[0].author.profileImageUrl").value(nullValue()));
    }

    // AC-2: 통합 검색 users[].profileImageUrl.
    @Test
    void 검색_회원항목에_사진주소_미등록자는null() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "참여")
                                .param("type", "USER")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(3))
                .andExpect(jsonPath("$.users[0].userId").value(authorId))
                .andExpect(jsonPath("$.users[0].profileImageUrl").value("/api/v1/images/author-photo"))
                .andExpect(jsonPath("$.users[1].userId").value(viewerId))
                .andExpect(jsonPath("$.users[1]", hasKey("profileImageUrl")))
                .andExpect(jsonPath("$.users[1].profileImageUrl").value(nullValue()))
                .andExpect(jsonPath("$.users[2].userId").value(thirdId))
                .andExpect(jsonPath("$.users[2].profileImageUrl").value("/api/v1/images/third-photo"));
    }

    private ResultActions list(long viewer) throws Exception {
        return mockMvc.perform(
                get("/api/v1/posts").header("Authorization", SecurityTestSupport.bearer(viewer)));
    }

    private ResultActions detail(long viewer, long postId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/posts/{postId}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)));
    }

    private ResultActions createPost(long sessionId, String bodyTemplate) throws Exception {
        return mockMvc.perform(
                        post("/api/v1/posts")
                                .header("Authorization", SecurityTestSupport.bearer(authorId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(bodyTemplate.formatted(sessionId)))
                .andExpect(status().isCreated());
    }

    private ResultActions patchPost(long userId, long postId, String body) throws Exception {
        return mockMvc.perform(
                patch("/api/v1/posts/{postId}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private ResultActions profile(long viewer, long target) throws Exception {
        return mockMvc.perform(
                get("/api/v1/users/{userId}/profile", target)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)));
    }

    private String storedBody(long postId) {
        return jdbc.queryForObject("SELECT body FROM posts WHERE id=?", String.class, postId);
    }

    private long id(String json) {
        return ((Number) com.jayway.jsonpath.JsonPath.read(json, "$.id")).longValue();
    }

    private boolean storedCourseShared(long postId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT course_shared FROM posts WHERE id=?", Boolean.class, postId));
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

    private void insertSettings(long userId) {
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
                VALUES (?, false, false, false, false, 'OFF', 'PUBLIC'::user_settings_account_visibility_enum)
                """,
                userId);
    }

    private void setProfileImage(long userId, String imageId) {
        jdbc.update(
                "UPDATE users SET profile_image_key=? WHERE id=?",
                "images/profile/" + userId + "/" + imageId + ".jpg",
                userId);
    }

    private long insertSession(long userId, Long sessionCourseId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status, course_id)
                VALUES (?, 'COMPLETED'::running_sessions_status_enum, ?)
                RETURNING id
                """,
                Long.class,
                userId,
                sessionCourseId);
    }

    private long insertPost(long postAuthorId, long sessionId, String body) {
        return jdbc.queryForObject(
                "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                postAuthorId,
                sessionId,
                body);
    }

    private long insertComment(long postId, long commentAuthorId, String body, Long parentId) {
        return jdbc.queryForObject(
                """
                INSERT INTO comments(post_id, author_id, body, parent_comment_id)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                Long.class,
                postId,
                commentAuthorId,
                body,
                parentId);
    }

    private void insertLike(long postId, long userId) {
        jdbc.update("INSERT INTO post_likes(post_id, user_id) VALUES (?, ?)", postId, userId);
    }
}
