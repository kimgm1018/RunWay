package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class RegionApiIntegrationTest {

    @Container
    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(
                    DockerImageName.parse("postgis/postgis:17-3.6")
                            .asCompatibleSubstituteFor("postgres"));

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    private static final long USER_ID = 1L;

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void 지역목록조회_200_시드전체와_currentRegionCode_null() throws Exception {
        Integer seeded = jdbc.queryForObject("SELECT COUNT(*) FROM regions", Integer.class);
        assertThat(seeded).isPositive();

        mockMvc.perform(
                        get("/api/v1/regions")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(seeded)))
                .andExpect(jsonPath("$.items[0].regionCode").isString())
                .andExpect(jsonPath("$.items[0].sidoName").isString())
                .andExpect(jsonPath("$.items[0].sigunguName").isString())
                .andExpect(jsonPath("$.currentRegionCode").value(nullValue()));
    }

    @Test
    void 지역목록_sido_sigungu_regionCode_순으로_정렬() throws Exception {
        List<String> expected =
                jdbc.queryForList(
                        """
                        SELECT region_code FROM regions
                        ORDER BY sido_name, sigungu_name, region_code
                        """,
                        String.class);

        String body =
                mockMvc.perform(
                                get("/api/v1/regions")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(USER_ID)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        List<String> actual = JsonPath.read(body, "$.items[*].regionCode");
        assertThat(actual).containsExactlyElementsOf(expected);
    }

    @Test
    void 유효한_좌표를_전달해도_200_currentRegionCode_null() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("latitude", "35.1796")
                                .param("longitude", "129.0756")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.currentRegionCode").value(nullValue()));
    }

    @Test
    void 토큰없이_지역목록조회_401() throws Exception {
        mockMvc.perform(get("/api/v1/regions")).andExpect(status().isUnauthorized());
    }

    @Test
    void X_User_Id_헤더만으로는_지역목록조회_401() throws Exception {
        mockMvc.perform(get("/api/v1/regions").header("X-User-Id", USER_ID))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void latitude만_전달하면_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("latitude", "35.1796")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void longitude만_전달하면_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("longitude", "129.0756")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 위도_범위초과_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("latitude", "90.1")
                                .param("longitude", "129.0")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 경도_범위초과_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("latitude", "35.0")
                                .param("longitude", "-180.1")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 좌표가_숫자가_아니면_400_VALIDATION_ERROR() throws Exception {
        mockMvc.perform(
                        get("/api/v1/regions")
                                .param("latitude", "abc")
                                .param("longitude", "129.0")
                                .header("Authorization", SecurityTestSupport.bearer(USER_ID)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }
}
