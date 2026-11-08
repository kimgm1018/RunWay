package com.runway.backend.domain.community;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

class SearchApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long viewerId;
    private long runnerA;
    private long runnerB;
    private long runnerC;
    private long privateRunner;
    private long withdrawnRunner;
    private long crewA;
    private long crewB;
    private long crewC;
    private long inactiveCrew;

    @BeforeEach
    void seed() {
        viewerId = insertUser("srch_viewer", "조회자", "01030001000");
        runnerA = insertUser("srch_a", "달리기A", "01030001001");
        runnerB = insertUser("srch_b", "달리기B", "01030001002");
        runnerC = insertUser("srch_c", "달리기C", "01030001003");
        privateRunner = insertUser("srch_priv", "달리기비공개", "01030001004");
        withdrawnRunner = insertUser("srch_wd", "달리기탈퇴", "01030001005");
        insertSettings(privateRunner, "PRIVATE");
        jdbc.update(
                """
                UPDATE users
                SET account_status = 'WITHDRAWN'::users_account_status_enum, withdrawn_at = now()
                WHERE id = ?
                """,
                withdrawnRunner);

        crewA = insertCrew(viewerId, "새벽 러닝A", "ACTIVE");
        crewB = insertCrew(viewerId, "새벽 러닝B", "ACTIVE");
        crewC = insertCrew(viewerId, "새벽 러닝C", "ACTIVE");
        inactiveCrew = insertCrew(viewerId, "새벽 러닝폐쇄", "INACTIVE");
    }

    @Test
    void 토큰없으면_401() throws Exception {
        mockMvc.perform(get("/api/v1/search").param("q", "달리기"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void q가_없거나_공백이면_400_QUERY_TOO_SHORT() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("QUERY_TOO_SHORT"));
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "   ")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("QUERY_TOO_SHORT"));
    }

    @Test
    void type생략시_users와_crews를_함께_반환하고_비활성크루와_탈퇴회원은_제외() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "  달리기  ")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(4))
                .andExpect(jsonPath("$.users[0].userId").value(runnerA))
                .andExpect(jsonPath("$.users[0].nickname").value("달리기A"))
                .andExpect(jsonPath("$.users[*].userId", not(hasItem((int) withdrawnRunner))))
                .andExpect(jsonPath("$.crews.length()").value(0))
                .andExpect(jsonPath("$.page").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "새벽")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(0))
                .andExpect(jsonPath("$.crews.length()").value(3))
                .andExpect(jsonPath("$.crews[0].id").value(crewA))
                .andExpect(jsonPath("$.crews[0].name").value("새벽 러닝A"))
                .andExpect(jsonPath("$.crews[*].id", not(hasItem((int) inactiveCrew))))
                .andExpect(jsonPath("$.crews[0].status").doesNotExist())
                .andExpect(jsonPath("$.page").doesNotExist());
    }

    @Test
    void 비공개계정도_userId와_nickname만_검색된다() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "비공개")
                                .param("type", "USER")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(1))
                .andExpect(jsonPath("$.users[0].userId").value(privateRunner))
                .andExpect(jsonPath("$.users[0].nickname").value("달리기비공개"))
                .andExpect(jsonPath("$.users[0].accountVisibility").doesNotExist())
                .andExpect(jsonPath("$.users[0].length()").value(2));
    }

    @Test
    void type_USER는_crews키가_없고_CREW는_users키가_없다() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "러닝")
                                .param("type", "USER")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users").isArray())
                .andExpect(jsonPath("$.crews").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "러닝")
                                .param("type", "CREW")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users").doesNotExist())
                .andExpect(jsonPath("$.crews.length()").value(3));
    }

    @Test
    void type이_잘못되면_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "달리기")
                                .param("type", "COURSE")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void limit이_범위를_벗어나면_400_VALIDATION_ERROR() throws Exception {
        for (String limit : new String[] {"0", "51", "-1"}) {
            mockMvc.perform(
                            get("/api/v1/search")
                                    .param("q", "달리기")
                                    .param("limit", limit)
                                    .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "달리기")
                                .param("limit", "50")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk());
    }

    @Test
    void 커서로_러너와_크루를_각각_이어서_조회한다() throws Exception {
        MvcResult first =
                mockMvc.perform(
                                get("/api/v1/search")
                                        .param("q", "러닝")
                                        .param("limit", "2")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.users.length()").value(0))
                        .andExpect(jsonPath("$.crews.length()").value(2))
                        .andExpect(jsonPath("$.crews[0].id").value(crewA))
                        .andExpect(jsonPath("$.crews[1].id").value(crewB))
                        .andExpect(jsonPath("$.page").isNotEmpty())
                        .andReturn();
        String cursor = readPage(first);
        org.assertj.core.api.Assertions.assertThat(decode(cursor)).isEqualTo("u:0|c:" + crewB);

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "러닝")
                                .param("limit", "2")
                                .param("cursor", cursor)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(0))
                .andExpect(jsonPath("$.crews.length()").value(1))
                .andExpect(jsonPath("$.crews[0].id").value(crewC))
                .andExpect(jsonPath("$.page").doesNotExist());
    }

    @Test
    void 러너_페이징은_id오름차순이며_소진된_목록은_빈배열() throws Exception {
        MvcResult first =
                mockMvc.perform(
                                get("/api/v1/search")
                                        .param("q", "달리기")
                                        .param("limit", "3")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.users.length()").value(3))
                        .andExpect(jsonPath("$.users[0].userId").value(runnerA))
                        .andExpect(jsonPath("$.users[1].userId").value(runnerB))
                        .andExpect(jsonPath("$.users[2].userId").value(runnerC))
                        .andExpect(jsonPath("$.crews.length()").value(0))
                        .andReturn();
        String cursor = readPage(first);
        org.assertj.core.api.Assertions.assertThat(decode(cursor))
                .isEqualTo("u:" + runnerC + "|c:0");

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "달리기")
                                .param("limit", "3")
                                .param("type", "USER")
                                .param("cursor", cursor)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(1))
                .andExpect(jsonPath("$.users[0].userId").value(privateRunner))
                .andExpect(jsonPath("$.crews").doesNotExist())
                .andExpect(jsonPath("$.page").doesNotExist());
    }

    @Test
    void type_USER_발급_커서의_미조회_크루축은_ALL에서_처음부터_조회된다() throws Exception {
        long matchingCrew = insertCrew(viewerId, "달리기크루", "ACTIVE");

        MvcResult first =
                mockMvc.perform(
                                get("/api/v1/search")
                                        .param("q", "달리기")
                                        .param("type", "USER")
                                        .param("limit", "2")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.users.length()").value(2))
                        .andExpect(jsonPath("$.crews").doesNotExist())
                        .andExpect(jsonPath("$.page").isNotEmpty())
                        .andReturn();
        String cursor = readPage(first);
        org.assertj.core.api.Assertions.assertThat(decode(cursor))
                .isEqualTo("u:" + runnerB + "|c:-");

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "달리기")
                                .param("limit", "2")
                                .param("cursor", cursor)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(2))
                .andExpect(jsonPath("$.users[0].userId").value(runnerC))
                .andExpect(jsonPath("$.crews.length()").value(1))
                .andExpect(jsonPath("$.crews[0].id").value(matchingCrew));
    }

    @Test
    void type_CREW_발급_커서의_미조회_러너축은_ALL에서_처음부터_조회된다() throws Exception {
        MvcResult first =
                mockMvc.perform(
                                get("/api/v1/search")
                                        .param("q", "러닝")
                                        .param("type", "CREW")
                                        .param("limit", "2")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(viewerId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.users").doesNotExist())
                        .andExpect(jsonPath("$.crews.length()").value(2))
                        .andExpect(jsonPath("$.page").isNotEmpty())
                        .andReturn();
        String cursor = readPage(first);
        org.assertj.core.api.Assertions.assertThat(decode(cursor)).isEqualTo("u:-|c:" + crewB);

        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "러닝")
                                .param("limit", "2")
                                .param("cursor", cursor)
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(0))
                .andExpect(jsonPath("$.crews.length()").value(1))
                .andExpect(jsonPath("$.crews[0].id").value(crewC));
    }

    @Test
    void 잘못된_커서는_400_VALIDATION_ERROR() throws Exception {
        for (String cursor :
                new String[] {
                    "not-base64!!", encode("x:1|c:2"), encode("u:-1|c:0"), encode("u:--|c:1")
                }) {
            mockMvc.perform(
                            get("/api/v1/search")
                                    .param("q", "달리기")
                                    .param("cursor", cursor)
                                    .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
    }

    @Test
    void 검색어의_와일드카드문자는_리터럴로_처리된다() throws Exception {
        mockMvc.perform(
                        get("/api/v1/search")
                                .param("q", "%")
                                .header("Authorization", SecurityTestSupport.bearer(viewerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users.length()").value(0))
                .andExpect(jsonPath("$.crews.length()").value(0));
    }

    private static String readPage(MvcResult result) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        return com.jayway.jsonpath.JsonPath.read(body, "$.page");
    }

    private static String decode(String cursor) {
        return new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
    }

    private static String encode(String raw) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
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

    private long insertCrew(long ownerId, String name, String status) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status)
                VALUES (?, ?, 10, ?::crews_status_enum)
                RETURNING id
                """,
                Long.class,
                ownerId,
                name,
                status);
    }
}
