package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * S15P31E105-687: CMT02 regionCode 필터. 시/도 코드는 그 시/도 전체, 시/군/구 코드는 그 시/군/구와 하위 구, 지역 없는 글은 지역을 고르면 빠지고
 * 커서는 같은 지역으로만 이어진다. 지역 코드는 V2 시드(regions)를 쓴다.
 */
class PostListRegionApiIntegrationTest extends SharedContextIntegrationSupport {
    private static final String BUSAN = "26000";
    private static final String HAEUNDAE = "26350";
    private static final String SUYEONG = "26500";
    private static final String SEOUL_JUNG = "11140";
    private static final String SUWON = "41110";
    private static final String SUWON_JANGAN = "41111";
    private static final String SEONGNAM_BUNDANG = "41135";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private CommunityFixture fixture;
    private long viewerId;
    private long authorId;

    @BeforeEach
    void seed() {
        fixture = new CommunityFixture(jdbc);
        viewerId = fixture.user("rg_viewer", "지역뷰", "PUBLIC");
        authorId = fixture.user("rg_author", "지역글", "PUBLIC");
    }

    @Test
    void 시도_코드는_그_시도의_모든_시군구_글을_준다() throws Exception {
        long haeundae = fixture.postIn(authorId, "해운대", HAEUNDAE);
        fixture.postIn(authorId, "서울 중구", SEOUL_JUNG);
        long suyeong = fixture.postIn(authorId, "수영", SUYEONG);
        long busanOnly = fixture.postIn(authorId, "부산", BUSAN);
        fixture.post(authorId, "지역 없음");

        assertIds(page(BUSAN, null, null), busanOnly, suyeong, haeundae);
    }

    @Test
    void 시군구_코드는_그_시군구와_하위구_글만_준다() throws Exception {
        long haeundae = fixture.postIn(authorId, "해운대", HAEUNDAE);
        fixture.postIn(authorId, "수영", SUYEONG);
        long suwon = fixture.postIn(authorId, "수원", SUWON);
        long jangan = fixture.postIn(authorId, "장안", SUWON_JANGAN);
        fixture.postIn(authorId, "분당", SEONGNAM_BUNDANG);

        assertIds(page(HAEUNDAE, null, null), haeundae);
        assertIds(page(SUWON, null, null), jangan, suwon);
        // 하위 구를 고르면 상위 시 코드의 글은 들어오지 않는다.
        assertIds(page(SUWON_JANGAN, null, null), jangan);
    }

    @Test
    void 지역이_없거나_비어있으면_전국이고_모르는_코드는_빈목록이다() throws Exception {
        long busan = fixture.postIn(authorId, "해운대", HAEUNDAE);
        long none = fixture.post(authorId, "지역 없음");

        assertIds(page(null, null, null), none, busan);
        assertIds(page("", null, null), none, busan);
        assertIds(page("99999", null, null));
    }

    @Test
    void 지역_필터에도_커서_페이지가_이어지고_다른_지역의_커서는_거절한다() throws Exception {
        long b1 = fixture.postIn(authorId, "b1", HAEUNDAE);
        fixture.postIn(authorId, "s1", SEOUL_JUNG);
        long b2 = fixture.postIn(authorId, "b2", SUYEONG);
        fixture.postIn(authorId, "s2", SEOUL_JUNG);
        long b3 = fixture.postIn(authorId, "b3", HAEUNDAE);

        JsonNode first = page(BUSAN, null, 2);
        assertIds(first, b3, b2);
        assertThat(first.get("hasNext").asBoolean()).isTrue();
        String cursor = first.get("nextCursor").asString();

        JsonNode last = page(BUSAN, cursor, 2);
        assertIds(last, b1);
        assertThat(last.get("hasNext").asBoolean()).isFalse();

        // 지역을 바꾸거나 빼고 같은 커서를 쓰면 400, 전국 커서를 지역에 써도 400.
        String nationwide = page(null, null, 1).get("nextCursor").asString();
        for (MockHttpServletRequestBuilder request :
                List.of(
                        get("/api/v1/posts").param("cursor", cursor).param("regionCode", HAEUNDAE),
                        get("/api/v1/posts").param("cursor", cursor),
                        get("/api/v1/posts").param("cursor", nationwide).param("regionCode", BUSAN))) {
            mockMvc.perform(authorized(request, viewerId))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        }
    }

    @Test
    void 지역_필터는_FOLLOWING과_함께_쓴다() throws Exception {
        long followee = fixture.user("rg_followee", "지역팔", "PUBLIC");
        fixture.follow(viewerId, followee);
        long followedBusan = fixture.postIn(followee, "팔로우 부산", HAEUNDAE);
        fixture.postIn(followee, "팔로우 서울", SEOUL_JUNG);
        fixture.postIn(authorId, "남의 부산", HAEUNDAE);

        MockHttpServletRequestBuilder request =
                get("/api/v1/posts").param("scope", "FOLLOWING").param("regionCode", BUSAN);
        assertIds(read(request), followedBusan);
    }

    private JsonNode page(String regionCode, String cursor, Integer limit) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/posts");
        if (regionCode != null) {
            request.param("regionCode", regionCode);
        }
        if (cursor != null) {
            request.param("cursor", cursor);
        }
        if (limit != null) {
            request.param("limit", String.valueOf(limit));
        }
        return read(request);
    }

    private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
        String body =
                mockMvc.perform(authorized(request, viewerId))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return JsonMapper.builder().build().readTree(body);
    }

    private static void assertIds(JsonNode page, long... expected) {
        List<Long> actual = new ArrayList<>();
        page.get("items").forEach(item -> actual.add(item.get("id").asLong()));
        assertThat(actual).containsExactly(Arrays.stream(expected).boxed().toArray(Long[]::new));
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request, long userId) {
        return request.header("Authorization", SecurityTestSupport.bearer(userId));
    }
}
