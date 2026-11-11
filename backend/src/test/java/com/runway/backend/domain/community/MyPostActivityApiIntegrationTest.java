package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-634 AC-4: CMT18 내 스크랩·CMT19 내 좋아요 목록의 정렬·페이지·볼 수 없는 글 제외·타인 데이터 미노출. */
class MyPostActivityApiIntegrationTest extends SharedContextIntegrationSupport {
    private static final String BOOKMARKS = "/api/v1/users/me/bookmarks";
    private static final String LIKES = "/api/v1/users/me/likes";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private CommunityFixture fixture;
    private long meId;
    private long otherId;
    private long authorId;

    @BeforeEach
    void seed() {
        fixture = new CommunityFixture(jdbc);
        meId = fixture.user("act_me", "활동나", "PUBLIC");
        otherId = fixture.user("act_other", "활동남", "PUBLIC");
        authorId = fixture.user("act_author", "활동작가", "PUBLIC");
    }

    /** 게시물 최신 순이 아니라 저장한 시각 최신 순이며, 같은 시각이면 저장 행 id가 큰 쪽이 먼저다. */
    @Test
    void 내스크랩은_저장시각_최신순으로_페이지를_나눈다() throws Exception {
        long p1 = fixture.post(authorId, "p1");
        long p2 = fixture.post(authorId, "p2");
        long p3 = fixture.post(authorId, "p3");
        long p4 = fixture.post(authorId, "p4");
        fixture.bookmark(meId, p3, at(1));
        fixture.bookmark(meId, p1, at(3));
        fixture.bookmark(meId, p4, at(2));
        fixture.bookmark(meId, p2, at(2));

        JsonNode first = page(BOOKMARKS, meId, null, 2);
        assertIds(first, p1, p2);
        assertThat(first.get("hasNext").asBoolean()).isTrue();

        JsonNode last = page(BOOKMARKS, meId, first.get("nextCursor").asString(), 2);
        assertIds(last, p4, p3);
        assertThat(last.get("hasNext").asBoolean()).isFalse();
        assertThat(last.get("nextCursor").isNull()).isTrue();

        // limit 생략은 기본 20.
        JsonNode all = page(BOOKMARKS, meId, null, null);
        assertIds(all, p1, p2, p4, p3);
        assertThat(all.get("hasNext").asBoolean()).isFalse();
    }

    @Test
    void 내좋아요는_좋아요시각_최신순이고_CMT02와_같은항목형태다() throws Exception {
        long older = fixture.post(authorId, "older");
        long newer = fixture.post(authorId, "newer");
        jdbc.update("UPDATE posts SET course_shared=false WHERE id=?", newer);
        fixture.like(meId, newer, at(1));
        fixture.like(meId, older, at(2));
        fixture.like(otherId, older, at(3));
        fixture.bookmark(meId, older, at(1));

        JsonNode result = page(LIKES, meId, null, 1);
        assertIds(result, older);
        JsonNode item = result.get("items").get(0);
        assertThat(item.get("myReaction").asString()).isEqualTo("LIKE");
        assertThat(item.get("reactionCount").asLong()).isEqualTo(2);
        assertThat(item.get("bookmarked").asBoolean()).isTrue();
        assertThat(item.get("author").get("userId").asLong()).isEqualTo(authorId);
        assertThat(item.get("author").get("nickname").asString()).isEqualTo("활동작가");
        for (String field :
                List.of(
                        "id", "authorId", "sessionId", "courseId", "courseShared", "body",
                        "createdAt", "commentCount", "recordSummary")) {
            assertThat(item.has(field)).as(field).isTrue();
        }
        assertThat(result.get("hasNext").asBoolean()).isTrue();

        JsonNode last = page(LIKES, meId, result.get("nextCursor").asString(), 1);
        assertIds(last, newer);
        assertThat(last.get("items").get(0).get("bookmarked").asBoolean()).isFalse();
        assertThat(last.get("items").get(0).get("courseShared").asBoolean()).isFalse();
        assertThat(last.get("items").get(0).get("courseId").isNull()).isTrue();
        assertThat(last.get("hasNext").asBoolean()).isFalse();
    }

    /**
     * 코스 있는 세션의 글에서 courseId는 CMT02와 같은 조회자 기준을 따른다. 공유 글은 값이 보이고, 공유하지 않은 글은 작성자가 아닌 조회자에게
     * null이며, 작성자 본인이 저장·좋아요한 자기 글은 공유하지 않아도 값이 보인다.
     */
    @ParameterizedTest
    @ValueSource(strings = {BOOKMARKS, LIKES})
    void courseId는_조회자기준으로_숨긴다(String path) throws Exception {
        long courseId = fixture.course();
        long shared = fixture.postWithCourse(authorId, "shared", courseId, true);
        long hidden = fixture.postWithCourse(authorId, "hidden", courseId, false);
        boolean bookmarks = BOOKMARKS.equals(path);
        for (long userId : List.of(meId, authorId)) {
            if (bookmarks) {
                fixture.bookmark(userId, shared, at(1));
                fixture.bookmark(userId, hidden, at(2));
            } else {
                fixture.like(userId, shared, at(1));
                fixture.like(userId, hidden, at(2));
            }
        }

        JsonNode viewer = page(path, meId, null, null);
        assertIds(viewer, hidden, shared);
        JsonNode viewerHidden = viewer.get("items").get(0);
        assertThat(viewerHidden.get("courseShared").asBoolean()).isFalse();
        assertThat(viewerHidden.has("courseId")).isTrue();
        assertThat(viewerHidden.get("courseId").isNull()).isTrue();
        JsonNode viewerShared = viewer.get("items").get(1);
        assertThat(viewerShared.get("courseShared").asBoolean()).isTrue();
        assertThat(viewerShared.get("courseId").asLong()).isEqualTo(courseId);

        JsonNode own = page(path, authorId, null, null);
        assertIds(own, hidden, shared);
        JsonNode ownHidden = own.get("items").get(0);
        assertThat(ownHidden.get("courseShared").asBoolean()).isFalse();
        assertThat(ownHidden.get("courseId").asLong()).isEqualTo(courseId);
        assertThat(own.get("items").get(1).get("courseId").asLong()).isEqualTo(courseId);
    }

    /** 삭제·비공개 전환(팔로우 없음)·팔로우 해제·탈퇴 작성자의 글은 빠지고, 빠져도 페이지 크기와 hasNext가 정확하다. */
    @Test
    void 지금볼수없는_글은_빠지고_hasNext가_정확하다() throws Exception {
        long privateAuthorId = fixture.user("act_priv", "활동비공", "PUBLIC");
        long unfollowedAuthorId = fixture.user("act_unf", "활동해제", "PRIVATE");
        long withdrawnAuthorId = fixture.user("act_gone", "활동탈퇴", "PUBLIC");
        fixture.follow(meId, unfollowedAuthorId);

        long visibleOld = fixture.post(authorId, "visible old");
        long deleted = fixture.post(authorId, "deleted");
        long turnedPrivate = fixture.post(privateAuthorId, "turned private");
        long unfollowed = fixture.post(unfollowedAuthorId, "unfollowed");
        long gone = fixture.post(withdrawnAuthorId, "gone");
        long visibleNew = fixture.post(authorId, "visible new");
        long mine = fixture.post(meId, "mine");

        fixture.bookmark(meId, visibleOld, at(1));
        fixture.bookmark(meId, deleted, at(2));
        fixture.bookmark(meId, turnedPrivate, at(3));
        fixture.bookmark(meId, unfollowed, at(4));
        fixture.bookmark(meId, gone, at(5));
        fixture.bookmark(meId, visibleNew, at(6));
        fixture.bookmark(meId, mine, at(7));
        for (long postId : List.of(visibleOld, deleted, turnedPrivate, unfollowed, gone)) {
            fixture.like(meId, postId, at(1));
        }

        fixture.deletePost(deleted);
        fixture.makePrivate(privateAuthorId);
        fixture.unfollow(meId, unfollowedAuthorId);
        fixture.withdraw(withdrawnAuthorId);

        JsonNode first = page(BOOKMARKS, meId, null, 2);
        assertIds(first, mine, visibleNew);
        assertThat(first.get("hasNext").asBoolean()).isTrue();
        JsonNode last = page(BOOKMARKS, meId, first.get("nextCursor").asString(), 2);
        assertIds(last, visibleOld);
        assertThat(last.get("hasNext").asBoolean()).isFalse();

        JsonNode exact = page(BOOKMARKS, meId, null, 3);
        assertIds(exact, mine, visibleNew, visibleOld);
        assertThat(exact.get("hasNext").asBoolean()).isFalse();

        JsonNode likes = page(LIKES, meId, null, 1);
        assertIds(likes, visibleOld);
        assertThat(likes.get("hasNext").asBoolean()).isFalse();
    }

    @Test
    void 다른회원의_스크랩과_좋아요는_보이지않는다() throws Exception {
        long mineSaved = fixture.post(authorId, "mine saved");
        long othersSaved = fixture.post(authorId, "others saved");
        fixture.bookmark(meId, mineSaved, at(1));
        fixture.bookmark(otherId, othersSaved, at(2));
        fixture.like(otherId, othersSaved, at(2));

        assertIds(page(BOOKMARKS, meId, null, null), mineSaved);
        assertIds(page(LIKES, meId, null, null));
        assertIds(page(BOOKMARKS, otherId, null, null), othersSaved);
        assertIds(page(LIKES, otherId, null, null), othersSaved);
    }

    @ParameterizedTest
    @ValueSource(strings = {BOOKMARKS, LIKES})
    void 잘못된_limit과_cursor는_400(String path) throws Exception {
        for (String limit : List.of("0", "51")) {
            mockMvc.perform(authorized(get(path).param("limit", limit), meId))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        }
        mockMvc.perform(authorized(get(path).param("limit", "x"), meId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mockMvc.perform(authorized(get(path).param("cursor", "%%%"), meId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
    }

    @Test
    void 다른목록이나_다른회원의_cursor는_400() throws Exception {
        long p1 = fixture.post(authorId, "p1");
        long p2 = fixture.post(authorId, "p2");
        fixture.bookmark(meId, p1, at(1));
        fixture.bookmark(meId, p2, at(2));
        String bookmarkCursor = page(BOOKMARKS, meId, null, 1).get("nextCursor").asString();

        mockMvc.perform(authorized(get(LIKES).param("cursor", bookmarkCursor), meId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        mockMvc.perform(authorized(get(BOOKMARKS).param("cursor", bookmarkCursor), otherId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
    }

    @Test
    void 인증없으면_401() throws Exception {
        mockMvc.perform(get(BOOKMARKS)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(LIKES)).andExpect(status().isUnauthorized());
    }

    private static Instant at(int minute) {
        return Instant.parse("2026-11-10T00:00:00.123456Z").plusSeconds(60L * minute);
    }

    private static void assertIds(JsonNode page, long... expected) {
        List<Long> actual = new ArrayList<>();
        page.get("items").forEach(item -> actual.add(item.get("id").asLong()));
        assertThat(actual).containsExactly(Arrays.stream(expected).boxed().toArray(Long[]::new));
    }

    private JsonNode page(String path, long userId, String cursor, Integer limit) throws Exception {
        MockHttpServletRequestBuilder request = get(path);
        if (cursor != null) {
            request.param("cursor", cursor);
        }
        if (limit != null) {
            request.param("limit", String.valueOf(limit));
        }
        String body =
                mockMvc.perform(authorized(request, userId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return JsonMapper.builder().build().readTree(body);
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request, long userId) {
        return request.header("Authorization", SecurityTestSupport.bearer(userId));
    }
}
