package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.persistence.EntityManagerFactory;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.env.Environment;
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
class BackendApplicationIntegrationTest {

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

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EntityManagerFactory entityManagerFactory;
    @Autowired private Flyway flyway;
    @Autowired private Environment environment;
    @Autowired private MockMvc mockMvc;

    @Test
    void 빈DB_기동_연결구성과확장을확인한다() {
        assertThat(jdbc.queryForObject("SELECT 1", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT postgis_version()", String.class)).startsWith("3.6");
        assertThat(entityManagerFactory.isOpen()).isTrue();
        assertThat(entityManagerFactory.getMetamodel().getEntities()).isNotEmpty();
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().applied()).hasSize(10);
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("10");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND"
                                        + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version = '2' AND"
                                        + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version = '3' AND"
                                        + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='4' AND"
                                    + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='5' AND"
                                    + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='6' AND"
                                    + " success",
                                Integer.class))
                .isEqualTo(1);
        assertThat(environment.getProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
        assertThat(environment.getProperty("spring.jpa.open-in-view", Boolean.class)).isFalse();
        assertThat(
                        jdbc.queryForList(
                                """
                                SELECT tablename FROM pg_tables
                                WHERE schemaname = 'public'
                                  AND tablename NOT IN ('spatial_ref_sys', 'flyway_schema_history')
                                """,
                                String.class))
                .containsExactlyInAnyOrder(
                        "sync_batches",
                        "session_control_events",
                        "daily_readiness",
                        "users",
                        "user_recommendation_preferences",
                        "pace_plans",
                        "group_runs",
                        "crew_memberships",
                        "pace_plan_segments",
                        "group_run_participants",
                        "running_route_points",
                        "post_likes",
                        "courses",
                        "course_environment_tags",
                        "regions",
                        "user_profiles",
                        "daily_health_metrics",
                        "posts",
                        "coaching_decisions",
                        "crews",
                        "running_sessions",
                        "comments",
                        "course_bookmarks",
                        "user_devices",
                        "user_settings",
                        "user_follows",
                        "notifications",
                        "running_metric_samples",
                        "running_session_splits");
    }

    @Test
    void OpenAPI문서와_Swagger_UI경로를_제공한다() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("RunWay API"));

        mockMvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
    }
}
