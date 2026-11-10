package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-634 AC-3: CMT02 cursor·limit 페이지(순서·경계·필터 후 hasNext·잘못된 입력·무파라미터 전체 반환). */
class PostListPagingApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private CommunityFixture fixture;
    private long viewerId;
    private long publicAuthorId;
    private long hiddenAuthorId;

    @BeforeEach
    void seed() {
        fixture = new CommunityFixture(jdbc);
        viewerId = fixture.user("pg_viewer", "페이지뷰", "PUBLIC");
        publicAuthorId = fixture.user("pg_public", "페이지공", "PUBLIC");
        hiddenAuthorId = fixture.user("pg_hidden", "페이지숨", "PRIVATE");
    }

    @Test
    void 파라미터가_없으면_전체를_주고_nextCursor는null_hasNext는false() throws Exception {
        List<Long> ids = posts(publicAuthorId, 25);

        list(viewerId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(25))
                .andExpect(jsonPath("$.items[0].id").value(ids.getLast()))
                .andExpect(jsonPath("$.items[24].id").value(ids.getFirst()))
                .andExpect(jsonPath("$", hasKey("nextCursor")))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    @Test
    void limit로_최신순으로_잘라_이어받고_마지막페이지는_hasNext_false() throws Exception {
        List<Long> ids = posts(publicAuthorId, 5);

        JsonNode first = page(viewerId, null, 2, null, null);
        assertIds(first, ids.get(4), ids.get(3));
        assertThat(first.get("hasNext").asBoolean()).isTrue();

        JsonNode second = page(viewerId, first.get("nextCursor").asString(), 2, null, null);
        assertIds(second, ids.get(2), ids.get(1));
        assertThat(second.get("hasNext").asBoolean()).isTrue();

        JsonNode last = page(viewerId, second.get("nextCursor").asString(), 2, null, null);
        assertIds(last, ids.get(0));
        assertThat(last.get("hasNext").asBoolean()).isFalse();
        assertThat(last.get("nextCursor").isNull()).isTrue();
    }

    @Test
    void 개수가_limit의_배수이면_마지막_꽉찬페이지에서_hasNext_false() throws Exception {
        List<Long> ids = posts(publicAuthorId, 4);

        JsonNode first = page(viewerId, null, 2, null, null);
        assertIds(first, ids.get(3), ids.get(2));
        assertThat(first.get("hasNext").asBoolean()).isTrue();

        JsonNode last = page(viewerId, first.get("nextCursor").asString(), 2, null, null);
        assertIds(last, ids.get(1), ids.get(0));
        assertThat(last.get("hasNext").asBoolean()).isFalse();
        assertThat(last.get("nextCursor").isNull()).isTrue();
    }

    /** 볼 수 없는 글(비공개 작성자·삭제·탈퇴 작성자)이 섞여도 각 페이지는 limit개를 채우고 hasNext가 정확하다. */
    @Test
    void 필터로_빠지는_글이_섞여도_페이지크기와_hasNext가_정확하다() throws Exception {
        long withdrawnAuthorId = fixture.user("pg_gone", "페이지탈", "PUBLIC");
        long v1 = fixture.post(publicAuthorId, "v1");
        fixture.post(hiddenAuthorId, "h1");
        long v2 = fixture.post(publicAuthorId, "v2");
        fixture.deletePost(fixture.post(publicAuthorId, "deleted"));
        fixture.post(withdrawnAuthorId, "gone");
        long v3 = fixture.post(publicAuthorId, "v3");
        fixture.post(hiddenAuthorId, "h2");
        fixture.post(hiddenAuthorId, "h3");
        fixture.withdraw(withdrawnAuthorId);

        JsonNode first = page(viewerId, null, 2, null, null);
        assertIds(first, v3, v2);
        assertThat(first.get("hasNext").asBoolean()).isTrue();

        JsonNode last = page(viewerId, first.get("nextCursor").asString(), 2, null, null);
        assertIds(last, v1);
        assertThat(last.get("hasNext").asBoolean()).isFalse();

        // 남은 글이 모두 가려지면 limit을 다 채운 페이지에서 hasNext=false다.
        JsonNode exact = page(viewerId, null, 3, null, null);
        assertIds(exact, v3, v2, v1);
        assertThat(exact.get("hasNext").asBoolean()).isFalse();
        assertThat(exact.get("nextCursor").isNull()).isTrue();
    }

    @Test
    void cursor만_있으면_기본20개씩_자른다() throws Exception {
        List<Long> ids = posts(publicAuthorId, 22);
        JsonNode first = page(viewerId, null, 1, null, null);

        JsonNode next = page(viewerId, first.get("nextCursor").asString(), null, null, null);
        assertThat(next.get("items").size()).isEqualTo(20);
        assertThat(next.get("items").get(0).get("id").asLong()).isEqualTo(ids.get(20));
        assertThat(next.get("hasNext").asBoolean()).isTrue();
    }

    @Test
    void limit_50은_허용한다() throws Exception {
        posts(publicAuthorId, 3);
        JsonNode result = page(viewerId, null, 50, null, null);
        assertThat(result.get("items").size()).isEqualTo(3);
        assertThat(result.get("hasNext").asBoolean()).isFalse();
    }

    @Test
    void FOLLOWING과_authorId에도_같은_페이지를_적용한다() throws Exception {
        fixture.follow(viewerId, hiddenAuthorId);
        long h1 = fixture.post(hiddenAuthorId, "h1");
        fixture.post(publicAuthorId, "not followed");
        long own = fixture.post(viewerId, "own");
        long h2 = fixture.post(hiddenAuthorId, "h2");

        JsonNode first = page(viewerId, null, 2, "FOLLOWING", null);
        assertIds(first, h2, own);
        JsonNode last = page(viewerId, first.get("nextCursor").asString(), 2, "FOLLOWING", null);
        assertIds(last, h1);
        assertThat(last.get("hasNext").asBoolean()).isFalse();

        JsonNode byAuthor = page(viewerId, null, 1, null, hiddenAuthorId);
        assertIds(byAuthor, h2);
        JsonNode byAuthorLast =
                page(viewerId, byAuthor.get("nextCursor").asString(), 1, null, hiddenAuthorId);
        assertIds(byAuthorLast, h1);
        assertThat(byAuthorLast.get("hasNext").asBoolean()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "51"})
    void 범위밖_limit은_400_INVALID_FILTER(String limit) throws Exception {
        mockMvc.perform(authorized(get("/api/v1/posts").param("limit", limit), viewerId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
    }

    @Test
    void 숫자가_아닌_limit은_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(authorized(get("/api/v1/posts").param("limit", "abc"), viewerId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 잘못되거나_다른조건의_cursor는_400_INVALID_FILTER() throws Exception {
        posts(publicAuthorId, 3);
        String allCursor = page(viewerId, null, 1, null, null).get("nextCursor").asString();
        long otherViewer = fixture.user("pg_other", "페이지타", "PUBLIC");

        for (MockHttpServletRequestBuilder request :
                List.of(
                        authorized(get("/api/v1/posts").param("cursor", "not-a-cursor!"), viewerId),
                        authorized(get("/api/v1/posts").param("cursor", ""), viewerId),
                        authorized(
                                get("/api/v1/posts")
                                        .param("cursor", allCursor)
                                        .param("scope", "FOLLOWING"),
                                viewerId),
                        authorized(
                                get("/api/v1/posts")
                                        .param("cursor", allCursor)
                                        .param("authorId", String.valueOf(publicAuthorId)),
                                viewerId),
                        authorized(get("/api/v1/posts").param("cursor", allCursor), otherViewer))) {
            mockMvc.perform(request)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        }
    }

    private List<Long> posts(long authorId, int count) {
        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            ids.add(fixture.post(authorId, "글 " + i));
        }
        return ids;
    }

    private static void assertIds(JsonNode page, long... expected) {
        List<Long> actual = new ArrayList<>();
        page.get("items").forEach(item -> actual.add(item.get("id").asLong()));
        assertThat(actual).containsExactly(java.util.Arrays.stream(expected).boxed().toArray(Long[]::new));
    }

    private JsonNode page(long userId, String cursor, Integer limit, String scope, Long authorId)
            throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/posts");
        if (cursor != null) {
            request.param("cursor", cursor);
        }
        if (limit != null) {
            request.param("limit", String.valueOf(limit));
        }
        if (scope != null) {
            request.param("scope", scope);
        }
        if (authorId != null) {
            request.param("authorId", String.valueOf(authorId));
        }
        String body =
                mockMvc.perform(authorized(request, userId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return JsonMapper.builder().build().readTree(body);
    }

    private ResultActions list(long userId) throws Exception {
        return mockMvc.perform(authorized(get("/api/v1/posts"), userId));
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request, long userId) {
        return request.header("Authorization", SecurityTestSupport.bearer(userId));
    }
}
