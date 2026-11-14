package com.runway.backend.domain.crew;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * S15P31E105-829. 활동 중인 크루끼리 이름(대소문자·앞뒤 공백 무시) 중복을 금지한다. M03은 저장 직전에 같은 식으로 먼저 조회하고, 동시 생성은 DB 부분
 * UNIQUE 인덱스 {@code uq_crews_active_name}이 최종 판정한다.
 */
class CrewNameUniquenessIntegrationTest extends SharedContextIntegrationSupport {
    private static final String NAME = "Run Crew";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long ownerId;
    private long otherId;
    private int userSeq;

    @BeforeEach
    void seedUsers() {
        ownerId = insertUser();
        otherId = insertUser();
    }

    @Test
    void 활동중인_같은이름_크루는_409이고_저장하지_않는다() throws Exception {
        assertThat(create(ownerId, NAME, 10).getStatus()).isEqualTo(201);

        MockHttpServletResponse response = create(otherId, NAME, 10);

        assertConflict(response);
        assertThat(crewCount()).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(1);
        // 같은 사용자가 자기 크루와 같은 이름을 또 만들어도 같다.
        assertConflict(create(ownerId, NAME, 10));
        assertThat(crewCount()).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(1);
    }

    @ParameterizedTest
    @MethodSource("sameNameVariants")
    void 대소문자와_앞뒤공백만_다르면_중복이다(String variant) throws Exception {
        assertThat(create(ownerId, NAME, 10).getStatus()).isEqualTo(201);

        assertConflict(create(otherId, variant, 10));

        assertThat(crewCount()).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(1);
    }

    static Stream<Arguments> sameNameVariants() {
        return Stream.of(
                Arguments.of("run crew"),
                Arguments.of("RUN CREW"),
                Arguments.of("  Run Crew  "),
                Arguments.of("\tRun Crew\n"));
    }

    @ParameterizedTest
    @MethodSource("differentNames")
    void 내부공백이나_글자가_다르면_만들수있다(String requested, String stored) throws Exception {
        assertThat(create(ownerId, NAME, 10).getStatus()).isEqualTo(201);

        MockHttpServletResponse response = create(otherId, requested, 10);

        assertThat(response.getStatus()).isEqualTo(201);
        assertThat(mapper.readTree(response.getContentAsString()).get("name").asString())
                .isEqualTo(stored);
        assertThat(crewCount()).isEqualTo(2);
    }

    static Stream<Arguments> differentNames() {
        String thirty = "가".repeat(30);
        return Stream.of(
                Arguments.of("Run Crew2", "Run Crew2"),
                Arguments.of("RunCrew", "RunCrew"),
                Arguments.of("Run  Crew", "Run  Crew"),
                Arguments.of("  Run Crew3  ", "Run Crew3"),
                Arguments.of("러닝 크루", "러닝 크루"),
                Arguments.of(thirty, thirty));
    }

    @Test
    void 한글_이름은_공백이_다르면_다른_이름이다() throws Exception {
        assertThat(create(ownerId, "러닝크루", 10).getStatus()).isEqualTo(201);

        assertThat(create(otherId, "러닝 크루", 10).getStatus()).isEqualTo(201);
        assertConflict(create(otherId, " 러닝크루 ", 10));
        assertThat(crewCount()).isEqualTo(2);
    }

    @Test
    void 해산한_크루_이름은_다시_쓸수_있다() throws Exception {
        long crewId = createdId(create(ownerId, NAME, 10));
        MockHttpServletResponse dissolved =
                mockMvc.perform(
                                delete("/api/v1/crews/{crewId}", crewId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(ownerId)))
                        .andReturn()
                        .getResponse();
        assertThat(dissolved.getStatus()).isEqualTo(200);

        assertThat(create(otherId, "run crew", 10).getStatus()).isEqualTo(201);

        assertThat(count("SELECT count(*) FROM crews WHERE status='ACTIVE'")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM crews WHERE status='INACTIVE'")).isEqualTo(1);
        // 이제 새 활동 크루가 이름을 점유한다.
        assertConflict(create(ownerId, NAME, 10));
    }

    @Test
    void 중복이름이어도_기존_입력오류가_먼저다() throws Exception {
        assertThat(create(ownerId, NAME, 10).getStatus()).isEqualTo(201);

        // (a) 이름 31자: 이름이 같을 수 없으므로 길이 오류만 확인한다(형식 검사가 먼저).
        assertThat(create(otherId, "가".repeat(31), 10).getStatus()).isEqualTo(400);
        // (b)(c)(d) 중복 이름과 다른 입력 오류가 함께 있으면 그 오류가 먼저다.
        MockHttpServletResponse region =
                postBody(otherId, Map.of("name", NAME, "capacity", 10, "regionCode", "NO_SUCH_REGION"));
        assertThat(region.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(region.getContentAsString()).get("code").asString())
                .isEqualTo("INVALID_CREW");
        MockHttpServletResponse policy =
                postBody(otherId, Map.of("name", NAME, "capacity", 10, "joinPolicy", "NOPE"));
        assertThat(policy.getStatus()).isEqualTo(422);
        MockHttpServletResponse image =
                postBody(otherId, Map.of("name", NAME, "capacity", 10, "imageKey", "not-mine/x.jpg"));
        assertThat(image.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(image.getContentAsString()).get("code").asString())
                .isEqualTo("RESOURCE_NOT_OWNED");
        // (e) 토큰이 없으면 401.
        MockHttpServletResponse anonymous =
                mockMvc.perform(
                                post("/api/v1/crews")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                mapper.writeValueAsString(
                                                        Map.of("name", NAME, "capacity", 10))))
                        .andReturn()
                        .getResponse();
        assertThat(anonymous.getStatus()).isEqualTo(401);

        assertThat(crewCount()).isEqualTo(1);
        // 다른 오류가 없으면 같은 이름은 409다.
        assertConflict(create(otherId, NAME, 10));
    }

    @Test
    void 같은이름_동시생성은_하나만_성공한다() throws Exception {
        int n = 10;
        List<Long> users = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            users.add(insertUser());
        }
        String[] variants = {"Race Crew", "race crew", "RACE CREW", " Race Crew "};
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch ready = new CountDownLatch(n);
        CountDownLatch start = new CountDownLatch(1);
        List<MockHttpServletResponse> responses = new ArrayList<>();
        try {
            List<Future<MockHttpServletResponse>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                long userId = users.get(i);
                String name = variants[i % variants.length];
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await(10, TimeUnit.SECONDS);
                                    return create(userId, name, 10);
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<MockHttpServletResponse> future : futures) {
                responses.add(future.get(30, TimeUnit.SECONDS));
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(responses.stream().filter(r -> r.getStatus() == 201)).hasSize(1);
        List<MockHttpServletResponse> losers =
                responses.stream().filter(r -> r.getStatus() != 201).toList();
        assertThat(losers).hasSize(n - 1);
        for (MockHttpServletResponse loser : losers) {
            assertConflict(loser);
        }
        assertThat(count("SELECT count(*) FROM crews WHERE status='ACTIVE'")).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(1);
    }

    /**
     * 사전 조회는 다른 트랜잭션의 미커밋 행을 보지 못해 통과한다. INSERT가 인덱스에서 대기하다가 먼저 것이 커밋되면 23505가 나고, 그 위반이 409로
     * 바뀌어야 한다(500이 아님). DB 최종 판정 → 409 변환 경로를 결정적으로 지난다.
     */
    @Test
    void 미커밋_같은이름이_커밋되면_409이다() throws Exception {
        try (Connection first = jdbc.getDataSource().getConnection()) {
            first.setAutoCommit(false);
            insertCrewOn(first, otherId, "Held Crew");

            MockHttpServletResponse response = createWhileBlocked(ownerId, "held crew", first, true);

            assertConflict(response);
        }
        assertThat(crewCount()).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(0);
    }

    /** 먼저 들어간 트랜잭션이 롤백되면 기다리던 요청은 성공한다. */
    @Test
    void 미커밋_같은이름이_롤백되면_201이다() throws Exception {
        try (Connection first = jdbc.getDataSource().getConnection()) {
            first.setAutoCommit(false);
            insertCrewOn(first, otherId, "Held Crew");

            MockHttpServletResponse response = createWhileBlocked(ownerId, "held crew", first, false);

            assertThat(response.getStatus()).isEqualTo(201);
        }
        assertThat(crewCount()).isEqualTo(1);
        assertThat(membershipCount()).isEqualTo(1);
    }

    private MockHttpServletResponse createWhileBlocked(
            long userId, String name, Connection first, boolean commit) throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<MockHttpServletResponse> request = pool.submit(() -> create(userId, name, 10));
            waitUntilBlockedBy(first);
            if (commit) {
                first.commit();
            } else {
                first.rollback();
            }
            return request.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * 열어 둔 트랜잭션({@code holder})이 쥔 인덱스 항목을 기다리는 세션이 생길 때까지 기다린다(lock_timeout 5초 안에 끝낸다). Hibernate가 만드는 SQL
     * 문자열 모양에 기대지 않고 PostgreSQL의 {@code pg_blocking_pids}로 "holder에게 막힌 세션"만 찾는다.
     */
    private void waitUntilBlockedBy(Connection holder) throws Exception {
        int holderPid;
        try (var statement = holder.createStatement();
                var result = statement.executeQuery("SELECT pg_backend_pid()")) {
            result.next();
            holderPid = result.getInt(1);
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (System.nanoTime() < deadline) {
            Integer blocked =
                    jdbc.queryForObject(
                            "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))",
                            Integer.class,
                            holderPid);
            if (blocked != null && blocked > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("크루 INSERT가 열어 둔 트랜잭션의 인덱스 항목을 기다리는 상태가 되지 않았습니다.");
    }

    private void insertCrewOn(Connection connection, long owner, String name) throws Exception {
        try (var statement =
                connection.prepareStatement(
                        "INSERT INTO crews(owner_id,name,capacity) VALUES (?,?,10)")) {
            statement.setLong(1, owner);
            statement.setString(2, name);
            statement.executeUpdate();
        }
    }

    private void assertConflict(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(409);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.get("code").asString()).isEqualTo("CREW_NAME_DUPLICATED");
        assertThat(body.get("message").asString()).isEqualTo("이미 사용 중인 크루 이름입니다.");
        assertThat(body.get("details").isObject()).isTrue();
        assertThat(body.get("details").size()).isZero();
    }

    private MockHttpServletResponse create(long userId, String name, int capacity)
            throws Exception {
        return postBody(userId, Map.of("name", name, "capacity", capacity));
    }

    private MockHttpServletResponse postBody(long userId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(
                        post("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(mapper.writeValueAsString(body)))
                .andReturn()
                .getResponse();
    }

    private long createdId(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(201);
        return mapper.readTree(response.getContentAsString()).get("id").asLong();
    }

    private long insertUser() {
        int seq = ++userSeq;
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                "cn_user_" + seq,
                "크루" + seq,
                String.format("010%08d", 70000000 + seq));
    }

    private int crewCount() {
        return count("SELECT count(*) FROM crews");
    }

    private int membershipCount() {
        return count("SELECT count(*) FROM crew_memberships");
    }

    private int count(String sql) {
        Integer value = jdbc.queryForObject(sql, Integer.class);
        return value == null ? 0 : value;
    }
}
