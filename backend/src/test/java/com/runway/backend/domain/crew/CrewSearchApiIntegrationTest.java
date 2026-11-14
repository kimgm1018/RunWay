package com.runway.backend.domain.crew;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** S15P31E105-820: 크루 검색(M01)의 검색어 와일드카드 이스케이프와 길이 상한. */
class CrewSearchApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private String seoul;
    private String busan;

    @BeforeEach
    void seed() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('crew_search_user','hash','검색러너','2000-01-01','MALE','01011113333','AGREE')
                        RETURNING id
                        """,
                        Long.class);
        List<String> regions =
                jdbc.queryForList(
                        "SELECT region_code FROM regions ORDER BY region_code LIMIT 2",
                        String.class);
        seoul = regions.get(0);
        busan = regions.get(1);
        // 이름에 특수문자가 들어가므로 JSON 요청 대신 직접 넣는다. 지역은 이름+지역 조합 검증용이다.
        insertCrew("100% 러닝", seoul);
        insertCrew("a_b", seoul);
        insertCrew("aXb", busan);
        insertCrew("a!b", seoul);
        insertCrew("Back\\Slash", busan);
        insertCrew("일반 러닝", seoul);
    }

    @Test
    void 와일드카드와_백슬래시와_느낌표는_글자_그대로_찾는다() throws Exception {
        assertNames("%", "100% 러닝");
        assertNames("_", "a_b");
        assertNames("100%", "100% 러닝");
        assertNames("a_b", "a_b");
        assertNames("!", "a!b");
        assertNames("a!b", "a!b");
        assertNames("\\", "Back\\Slash");
        assertNames("%%"); // 연속된 %가 든 이름은 없다
    }

    @Test
    void 이름과_지역을_함께_써도_와일드카드는_글자_그대로다() throws Exception {
        assertNamesInRegion("%", seoul, "100% 러닝");
        assertNamesInRegion("%", busan);
        assertNamesInRegion("_", seoul, "a_b");
        assertNamesInRegion("a_b", busan);
    }

    @Test
    void 기존_검색_조건은_유지된다() throws Exception {
        assertNames("러닝", "100% 러닝", "일반 러닝");
        assertNames("BACK", "Back\\Slash"); // 대소문자 무시
        assertNamesInRegion("러닝", seoul, "100% 러닝", "일반 러닝");
        mockMvc.perform(
                        get("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(6));
    }

    @Test
    void q는_50자까지_허용되고_51자는_400이다() throws Exception {
        String fifty = "가".repeat(50);
        mockMvc.perform(search(fifty)).andExpect(status().isOk());
        mockMvc.perform(search("  " + fifty + "  ")).andExpect(status().isOk());
        // 이모지 50개는 UTF-16으로 100이지만 코드 포인트 50이라 허용한다.
        mockMvc.perform(search("🏃".repeat(50))).andExpect(status().isOk());

        for (String tooLong : new String[] {"가".repeat(51), "🏃".repeat(51)}) {
            mockMvc.perform(search(tooLong))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.message").value("검색어는 50자 이하여야 합니다."))
                    .andExpect(jsonPath("$.details").isEmpty());
        }
        mockMvc.perform(search("가".repeat(51)).param("regionCode", seoul))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 공백만_있거나_없는_q는_상한과_무관하게_전체_목록이다() throws Exception {
        mockMvc.perform(search(" ".repeat(60)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(6));
        mockMvc.perform(
                        get("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(6));
    }

    private void assertNames(String q, String... names) throws Exception {
        assertResult(search(q), names);
    }

    private void assertNamesInRegion(String q, String regionCode, String... names)
            throws Exception {
        assertResult(search(q).param("regionCode", regionCode), names);
    }

    private void assertResult(MockHttpServletRequestBuilder request, String... names)
            throws Exception {
        String body =
                mockMvc.perform(request)
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        List<String> actual = JsonPath.read(body, "$.items[*].name");
        assertThat(actual).containsExactlyInAnyOrder(names);
    }

    private MockHttpServletRequestBuilder search(String q) {
        return get("/api/v1/crews")
                .param("q", q)
                .header("Authorization", SecurityTestSupport.bearer(userId));
    }

    private void insertCrew(String name, String regionCode) {
        jdbc.update(
                """
                INSERT INTO crews(owner_id, name, capacity, status, region_code)
                VALUES (?, ?, 10, 'ACTIVE'::crews_status_enum, ?)
                """,
                userId,
                name,
                regionCode);
    }
}
