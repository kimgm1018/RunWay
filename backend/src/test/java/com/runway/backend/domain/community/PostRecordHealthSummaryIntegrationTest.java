package com.runway.backend.domain.community;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** S15P31E105-893: 합성 기록의 심박·케이던스는 조회 시점의 작성자 건강정보 동의를 따른다. */
class PostRecordHealthSummaryIntegrationTest extends SharedContextIntegrationSupport {

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private CommunityFixture fixture;
    private long authorId;
    private long viewerId;
    private long postId;

    @BeforeEach
    void seed() {
        fixture = new CommunityFixture(jdbc);
        authorId = fixture.user("health_author", "건강작성자", "PUBLIC");
        viewerId = fixture.user("health_viewer", "건강조회자", "PUBLIC");
        postId = fixture.post(authorId, "건강 기록 공유");
        setSummary(postId);
    }

    @Test
    void detailShowsHrAndCadenceWhenAuthorConsented() throws Exception {
        assertVisible(detail(viewerId), "$.recordSummary");
    }

    @Test
    void listShowsHrAndCadenceWhenAuthorConsented() throws Exception {
        ResultActions result = list("/api/v1/posts", viewerId);
        result.andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(postId));
        assertVisible(result, "$.items[0].recordSummary");
    }

    @Test
    void hidesHrAndCadenceWhenAuthorNotConsented() throws Exception {
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", authorId);

        for (long userId : new long[] {viewerId, authorId}) {
            assertHidden(detail(userId), "$.recordSummary");
            ResultActions result = list("/api/v1/posts", userId);
            result.andExpect(jsonPath("$.items.length()").value(1))
                    .andExpect(jsonPath("$.items[0].id").value(postId));
            assertHidden(result, "$.items[0].recordSummary");
        }
    }

    @Test
    void omitsWhenSessionHasNoValues() throws Exception {
        jdbc.update(
                """
                UPDATE running_sessions SET average_heart_rate=NULL, average_cadence=NULL
                WHERE id=(SELECT session_id FROM posts WHERE id=?)
                """,
                postId);

        assertHidden(detail(viewerId), "$.recordSummary");
    }

    @Test
    void hidesAfterConsentWithdrawn() throws Exception {
        assertVisible(detail(viewerId), "$.recordSummary");

        mockMvc.perform(
                        post("/api/v1/consents")
                                .header("Authorization", SecurityTestSupport.bearer(authorId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"consentType\":\"HEALTH_DATA\",\"granted\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.granted").value(false));

        assertHidden(detail(viewerId), "$.recordSummary");
    }

    @Test
    void bookmarksAndLikesFollowSameRule() throws Exception {
        long nonConsentedAuthorId = fixture.user("health_hidden", "미동의작성자", "PUBLIC");
        jdbc.update(
                "UPDATE users SET health_data_access='DISAGREE' WHERE id=?", nonConsentedAuthorId);
        long hiddenPostId = fixture.post(nonConsentedAuthorId, "미동의 기록 공유");
        setSummary(hiddenPostId);
        Instant earlier = Instant.parse("2026-11-01T00:00:00Z");
        Instant later = earlier.plusSeconds(60);
        fixture.bookmark(viewerId, postId, later);
        fixture.bookmark(viewerId, hiddenPostId, earlier);
        fixture.like(viewerId, postId, later);
        fixture.like(viewerId, hiddenPostId, earlier);

        for (String path : new String[] {"/api/v1/users/me/bookmarks", "/api/v1/users/me/likes"}) {
            ResultActions result = list(path, viewerId);
            result.andExpect(jsonPath("$.items.length()").value(2))
                    .andExpect(jsonPath("$.items[0].id").value(postId))
                    .andExpect(jsonPath("$.items[1].id").value(hiddenPostId));
            assertVisible(result, "$.items[0].recordSummary");
            assertHidden(result, "$.items[1].recordSummary");
        }
    }

    private void setSummary(long id) {
        jdbc.update(
                """
                UPDATE running_sessions
                SET total_distance=5020.5, moving_duration=1795, average_pace=357.53,
                    average_heart_rate=152.5, average_cadence=171.4
                WHERE id=(SELECT session_id FROM posts WHERE id=?)
                """,
                id);
    }

    private ResultActions detail(long userId) throws Exception {
        return list("/api/v1/posts/" + postId, userId);
    }

    private ResultActions list(String path, long userId) throws Exception {
        return mockMvc.perform(get(path).header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk());
    }

    private static void assertVisible(ResultActions result, String path) throws Exception {
        assertBaseSummary(result, path);
        result.andExpect(jsonPath(path + ".averageHeartRateBpm").value(153))
                .andExpect(jsonPath(path + ".averageCadenceSpm").value(171));
    }

    private static void assertHidden(ResultActions result, String path) throws Exception {
        assertBaseSummary(result, path);
        result.andExpect(jsonPath(path + ".averageHeartRateBpm").doesNotHaveJsonPath())
                .andExpect(jsonPath(path + ".averageCadenceSpm").doesNotHaveJsonPath());
    }

    private static void assertBaseSummary(ResultActions result, String path) throws Exception {
        result.andExpect(jsonPath(path + ".distanceM").value(5020.5))
                .andExpect(jsonPath(path + ".movingDurationSec").value(1795))
                .andExpect(jsonPath(path + ".averagePaceSecPerKm").value(357.53));
    }
}
