package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * S15P31E105-294 — DB에 연결할 수 없거나 DB가 응답하지 않으면 무한 대기 없이 정해진 상한 안에 503으로 응답한다.
 *
 * <p>DB를 멈추거나 중지하므로 다른 테스트와 공유하지 않는 전용 컨테이너와 컨텍스트를 쓰고, 끝나면 컨텍스트를 닫는다. 무응답(일시정지)을 먼저
 * 확인하고 복구를 본 뒤, 되돌릴 수 없는 중지(연결 거부)를 마지막에 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class DatabaseUnavailableIntegrationTest {

    static final long CONNECTION_TIMEOUT_MS = 5_000;
    static final long VALIDATION_TIMEOUT_MS = 2_000;
    static final long SOCKET_TIMEOUT_MS = 15_000;
    /** 예외 변환·응답 작성과 CI 지연을 고려한 여유. */
    static final long MARGIN_MS = 3_000;

    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(
                    DockerImageName.parse("postgis/postgis:17-3.6")
                            .asCompatibleSubstituteFor("postgres"));

    static {
        DATABASE.start();
    }

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;

    static long userId;

    @BeforeAll
    static void seedOnce(@Autowired JdbcTemplate jdbc) {
        jdbc.update("DELETE FROM users");
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('db_outage_294','hash','러너','2000-01-01','MALE','01011112222','AGREEE')
                        RETURNING id
                        """,
                        Long.class);
    }

    /** 존재하지 않는 세션 조회. DB가 정상이면 404, DB 장애면 503이다. */
    private ResultActions readMissingSession() throws Exception {
        return mockMvc.perform(
                get("/api/v1/running-sessions/999999")
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private long timedUnavailable() throws Exception {
        long started = System.nanoTime();
        ResultActions result = readMissingSession();
        long elapsed = (System.nanoTime() - started) / 1_000_000;
        result.andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.details").isEmpty());
        return elapsed;
    }

    /**
     * 방금 반환된 연결은 Hikari가 생존 검사 없이 다시 빌려준다(500ms 이내). 이 연결의 쿼리는 서버가 응답하지 않으므로 소켓 읽기 상한(기본
     * 15초)에서 끊긴다.
     */
    @Test
    @Order(1)
    void DB가_멈추면_방금_쓴_연결도_소켓_상한_안에_503이고_복구되면_정상_처리한다() throws Exception {
        readMissingSession().andExpect(status().isNotFound());
        pausedDatabase(
                () ->
                        assertThat(timedUnavailable())
                                .isLessThanOrEqualTo(SOCKET_TIMEOUT_MS + MARGIN_MS));
        readMissingSession().andExpect(status().isNotFound());
    }

    /**
     * 잠시 쉰 유휴 연결은 생존 검사(2초)에서 걸러지고, 새 연결도 얻지 못해 연결 획득 상한(기본 5초)에서 끝난다. 마지막 검사가 상한 직전에
     * 시작되면 검사 시간만큼 늦어질 수 있어 상한에 검사 시간을 더한다.
     */
    @Test
    @Order(2)
    void DB가_멈추면_유휴_연결은_연결_상한_안에_503이다() throws Exception {
        readMissingSession().andExpect(status().isNotFound());
        pausedDatabase(
                () -> {
                    Thread.sleep(1_000);
                    assertThat(timedUnavailable())
                            .isLessThanOrEqualTo(
                                    CONNECTION_TIMEOUT_MS + VALIDATION_TIMEOUT_MS + MARGIN_MS);
                });
        readMissingSession().andExpect(status().isNotFound());
    }

    /**
     * 이미 빌린 연결에서 DB가 멈추면 서버의 statement_timeout은 전달되지 않는다. 소켓 읽기 상한이 그 쿼리를 끊는 장치임을 하한·상한으로 확인한다.
     * 503 경로(T-2a)는 생존 검사 생략 여부가 실행 속도에 따라 달라질 수 있어, 이 테스트가 소켓 상한 자체를 결정적으로 증명한다.
     */
    @Test
    @Order(3)
    void 빌린_연결의_쿼리는_DB가_멈추면_소켓_상한에서_끊긴다() throws Exception {
        try (Connection borrowed = dataSource.getConnection()) {
            borrowed.createStatement().execute("SELECT 1");
            pausedDatabase(
                    () -> {
                        long started = System.nanoTime();
                        assertThatThrownBy(() -> borrowed.createStatement().execute("SELECT 1"))
                                .isInstanceOf(SQLException.class);
                        long elapsed = (System.nanoTime() - started) / 1_000_000;
                        assertThat(elapsed)
                                .isBetween(SOCKET_TIMEOUT_MS - 1_000, SOCKET_TIMEOUT_MS + MARGIN_MS);
                    });
        }
        readMissingSession().andExpect(status().isNotFound());
    }

    interface Check {
        void run() throws Exception;
    }

    private void pausedDatabase(Check check) throws Exception {
        var docker = DATABASE.getDockerClient();
        docker.pauseContainerCmd(DATABASE.getContainerId()).exec();
        try {
            check.run();
        } finally {
            docker.unpauseContainerCmd(DATABASE.getContainerId()).exec();
        }
    }

    @Test
    @Order(4)
    void DB가_중지되면_연결_상한_안에_503이다() throws Exception {
        readMissingSession().andExpect(status().isNotFound());
        DATABASE.stop();
        assertThat(timedUnavailable()).isLessThanOrEqualTo(CONNECTION_TIMEOUT_MS + MARGIN_MS);
    }
}
