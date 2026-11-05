package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * G05 참가 동시성. SignupConcurrencyIntegrationTest와 같이 insert 직전에 CyclicBarrier로 겹친다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class GroupRunConcurrencyIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(GroupRunConcurrencyIntegrationTest.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @MockitoSpyBean GroupRunParticipantJdbcRepository participantRepository;
    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper mapper;

    private long hostId;
    private long memberAId;
    private long memberBId;
    private long crewId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM group_run_participants");
        jdbc.update("DELETE FROM group_runs");
        jdbc.update("DELETE FROM crew_memberships");
        jdbc.update("DELETE FROM crews");
        jdbc.update("DELETE FROM users");

        hostId = insertUser("gr_host", "호스트", "01011110001");
        memberAId = insertUser("gr_member_a", "멤버에이", "01011110002");
        memberBId = insertUser("gr_member_b", "멤버비", "01011110003");
        crewId = insertCrew(hostId, "동시성 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberAId);
        approveMember(crewId, memberBId);
    }

    @Test
    void sameUserConcurrentJoin_oneSuccessOneConflict_uniqueRow() throws Exception {
        long groupRunId = createGroupRun(hostId);
        int before =
                jdbc.queryForObject(
                        "SELECT count(*) FROM group_run_participants WHERE group_run_id=?",
                        Integer.class,
                        groupRunId);

        var barrier = new CyclicBarrier(2);
        doAnswer(
                        call -> {
                            barrier.await(10, TimeUnit.SECONDS);
                            return call.callRealMethod();
                        })
                .when(participantRepository)
                .insert(anyLong(), anyLong(), anyBoolean());

        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> join(memberAId, groupRunId));
            var second = executor.submit(() -> join(memberAId, groupRunId));
            List<MockHttpServletResponse> responses =
                    List.of(
                            first.get(20, TimeUnit.SECONDS),
                            second.get(20, TimeUnit.SECONDS));

            assertThat(responses.stream().map(MockHttpServletResponse::getStatus))
                    .containsExactlyInAnyOrder(200, 409);
            MockHttpServletResponse loser =
                    responses.stream()
                            .filter(r -> r.getStatus() == 409)
                            .findFirst()
                            .orElseThrow();
            assertThat(mapper.readTree(loser.getContentAsString()).get("code").asString())
                    .isEqualTo("FULL_OR_ALREADY_JOINED");
        }

        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*) FROM group_run_participants
                                WHERE group_run_id=? AND user_id=?
                                """,
                                Integer.class,
                                groupRunId,
                                memberAId))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM group_run_participants WHERE group_run_id=?",
                                Integer.class,
                                groupRunId))
                .isEqualTo(before + 1);
    }

    @Test
    void twoUsersConcurrentJoin_bothSucceed_participantCountPlusTwo() throws Exception {
        long groupRunId = createGroupRun(hostId);
        int before =
                jdbc.queryForObject(
                        "SELECT count(*) FROM group_run_participants WHERE group_run_id=?",
                        Integer.class,
                        groupRunId);

        var barrier = new CyclicBarrier(2);
        doAnswer(
                        call -> {
                            barrier.await(10, TimeUnit.SECONDS);
                            return call.callRealMethod();
                        })
                .when(participantRepository)
                .insert(anyLong(), anyLong(), anyBoolean());

        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> join(memberAId, groupRunId));
            var second = executor.submit(() -> join(memberBId, groupRunId));
            List<MockHttpServletResponse> responses =
                    List.of(
                            first.get(20, TimeUnit.SECONDS),
                            second.get(20, TimeUnit.SECONDS));

            assertThat(responses.stream().map(MockHttpServletResponse::getStatus))
                    .containsOnly(200);
        }

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM group_run_participants WHERE group_run_id=?",
                                Integer.class,
                                groupRunId))
                .isEqualTo(before + 2);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*) FROM group_run_participants
                                WHERE group_run_id=? AND user_id IN (?, ?)
                                """,
                                Integer.class,
                                groupRunId,
                                memberAId,
                                memberBId))
                .isEqualTo(2);
    }

    private MockHttpServletResponse join(long userId, long groupRunId) throws Exception {
        return mockMvc.perform(
                        post("/api/v1/group-runs/{groupRunId}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andReturn()
                .getResponse();
    }

    private long createGroupRun(long hostUserId) throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/group-runs")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(hostUserId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(createBody(crewId)))
                        .andReturn();
        assertThat(created.getResponse().getStatus()).isEqualTo(201);
        JsonNode root = mapper.readTree(created.getResponse().getContentAsString());
        return root.get("id").asLong();
    }

    private static String createBody(long crewId) {
        return """
                {
                  "title":"동시성 그룹런",
                  "crewId":%d,
                  "scheduledAt":"2030-01-15T01:00:00Z",
                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                  "meetingPlaceName":"집결지",
                  "targetDistanceM":5000,
                  "goalInputType":"TIME",
                  "targetDurationSec":1800
                }
                """
                .formatted(crewId);
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

    private long insertCrew(long ownerId, String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status)
                VALUES (?, ?, 20, 'ACTIVE'::crews_status_enum)
                RETURNING id
                """,
                Long.class,
                ownerId,
                name);
    }

    private void approveMember(long crewId, long userId) {
        jdbc.update(
                """
                INSERT INTO crew_memberships(crew_id, user_id, status, joined_at)
                VALUES (?, ?, 'APPROVED'::crew_memberships_status_enum, now())
                """,
                crewId,
                userId);
    }
}
