package com.runway.backend.domain.crew;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/** S15P31E105-570 M12 크루 설정 변경, M03·M04의 가입 방식, 정원 동시성. */
class CrewSettingsIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long ownerId;
    private int userSeq;

    @BeforeEach
    void seedOwner() {
        userSeq = 0;
        ownerId = insertUser();
    }

    // AC-1
    @Test
    void 정원_변경은_저장되고_상세와_검색에_반영된다() throws Exception {
        long crewId = createCrew(ownerId, "정원 크루", 10, null);
        approveMember(crewId, insertUser());

        updateSettings(ownerId, crewId, "{\"capacity\":21}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(crewId))
                .andExpect(jsonPath("$.capacity").value(21))
                .andExpect(jsonPath("$.memberCount").value(2))
                .andExpect(jsonPath("$.joinPolicy").value("APPROVAL"))
                .andExpect(jsonPath("$.myMembershipStatus").value("APPROVED"));

        mockMvc.perform(get("/api/v1/crews/{crewId}", crewId).header("Authorization", bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capacity").value(21))
                .andExpect(jsonPath("$.joinPolicy").value("APPROVAL"));
        mockMvc.perform(
                        get("/api/v1/crews")
                                .header("Authorization", bearer(insertUser()))
                                .param("q", "정원"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].capacity").value(21))
                .andExpect(jsonPath("$.items[0].joinPolicy").value("APPROVAL"));
        assertEquals(21, capacityOf(crewId));
    }

    // S15P31E105-636 AC-1: M12 응답(M02와 같은 본문)에도 크루 대표 사진 주소가 남는다.
    @Test
    void 설정_변경_응답에_크루_사진_주소가_있다() throws Exception {
        long crewId = createCrew(ownerId, "사진 설정 크루", 10, null);
        String imageId = "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
        jdbc.update(
                "UPDATE crews SET image_key = ? WHERE id = ?",
                "images/crew/" + ownerId + "/" + imageId + ".jpg",
                crewId);

        updateSettings(ownerId, crewId, "{\"capacity\":12}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capacity").value(12))
                .andExpect(jsonPath("$.imageUrl").value("/api/v1/images/" + imageId));
    }

    // AC-2
    @Test
    void 가입방식_변경은_저장되고_정원은_그대로다() throws Exception {
        long crewId = createCrew(ownerId, "방식 크루", 10, null);

        updateSettings(ownerId, crewId, "{\"joinPolicy\":\"INSTANT\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.joinPolicy").value("INSTANT"))
                .andExpect(jsonPath("$.capacity").value(10));

        long otherId = insertUser();
        mockMvc.perform(get("/api/v1/crews/{crewId}", crewId).header("Authorization", bearer(otherId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.joinPolicy").value("INSTANT"))
                .andExpect(jsonPath("$.capacity").value(10));
        assertEquals("INSTANT", joinPolicyOf(crewId));

        updateSettings(ownerId, crewId, "{\"capacity\":12,\"joinPolicy\":\"APPROVAL\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.joinPolicy").value("APPROVAL"))
                .andExpect(jsonPath("$.capacity").value(12));
    }

    // AC-3
    @Test
    void 잘못된_설정_변경은_거부하고_값을_바꾸지_않는다() throws Exception {
        long crewId = createCrew(ownerId, "거부 크루", 10, null);
        long memberId = insertUser();
        approveMember(crewId, memberId);
        approveMember(crewId, insertUser());

        updateSettings(memberId, crewId, "{\"capacity\":20}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));
        for (String body :
                List.of(
                        "{\"capacity\":0}",
                        "{\"capacity\":201}",
                        "{}",
                        "{\"joinPolicy\":\"OPEN\"}",
                        "{\"joinPolicy\":\"instant\"}",
                        "{\"capacity\":20,\"joinPolicy\":\"OPEN\"}")) {
            updateSettings(ownerId, crewId, body)
                    .andExpect(status().isUnprocessableContent())
                    .andExpect(jsonPath("$.code").value("INVALID_CREW"));
        }
        updateSettings(ownerId, crewId, "{\"capacity\":2,\"joinPolicy\":\"INSTANT\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_BELOW_MEMBERS"));
        assertEquals(10, capacityOf(crewId));
        assertEquals("APPROVAL", joinPolicyOf(crewId));

        // 경계: 현재 승인 인원(3)과 같은 정원은 허용한다.
        updateSettings(ownerId, crewId, "{\"capacity\":3}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capacity").value(3));

        updateSettings(ownerId, 999999L, "{\"capacity\":3}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CREW_NOT_FOUND"));

        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/crews/{crewId}", crewId)
                                .header("Authorization", bearer(ownerId)))
                .andExpect(status().isOk());
        updateSettings(ownerId, crewId, "{\"capacity\":5}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CREW_NOT_FOUND"));
        assertEquals(3, capacityOf(crewId));
    }

    // AC-4
    @Test
    void 생성시_가입방식을_저장한다() throws Exception {
        long instant = createCrew(ownerId, "바로 크루", 10, "INSTANT");
        long omitted = createCrew(ownerId, "기본 크루", 10, null);
        assertEquals("INSTANT", joinPolicyOf(instant));
        assertEquals("APPROVAL", joinPolicyOf(omitted));
        mockMvc.perform(get("/api/v1/crews/{crewId}", instant).header("Authorization", bearer(ownerId)))
                .andExpect(jsonPath("$.joinPolicy").value("INSTANT"));

        mockMvc.perform(
                        post("/api/v1/crews")
                                .header("Authorization", bearer(ownerId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\"잘못된 크루\",\"capacity\":10,\"joinPolicy\":\"OPEN\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_CREW"));
        assertEquals(2, (int) jdbc.queryForObject("SELECT count(*) FROM crews", Integer.class));
    }

    // AC-5
    @Test
    void 바로가입_크루는_정원_안에서_즉시_멤버가_되고_가득차면_거부한다() throws Exception {
        long crewId = createCrew(ownerId, "즉시 크루", 2, "INSTANT");
        long first = insertUser();
        long second = insertUser();

        requestJoin(first, crewId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        assertEquals("APPROVED", membershipOf(crewId, first));
        assertTrue(
                jdbc.queryForObject(
                        "SELECT joined_at IS NOT NULL FROM crew_memberships WHERE crew_id=? AND user_id=?",
                        Boolean.class,
                        crewId,
                        first));

        requestJoin(second, crewId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_EXCEEDED"));
        assertEquals(null, membershipOf(crewId, second));
        assertEquals(2, approvedCount(crewId));
    }

    // AC-5
    @Test
    void 바로가입은_탈퇴한_회원의_재가입도_즉시_승인한다() throws Exception {
        long crewId = createCrew(ownerId, "재가입 크루", 5, "INSTANT");
        long member = insertUser();
        requestJoin(member, crewId).andExpect(jsonPath("$.status").value("APPROVED"));
        mockMvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                                        "/api/v1/crews/{crewId}/members/me", crewId)
                                .header("Authorization", bearer(member)))
                .andExpect(status().isOk());
        requestJoin(member, crewId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        requestJoin(member, crewId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER_OR_PENDING"));
    }

    // AC-5
    @Test
    void 승인제_크루는_기존대로_대기하고_바로가입_전환후에도_기존_대기는_유지된다() throws Exception {
        long crewId = createCrew(ownerId, "전환 크루", 10, null);
        long waiting = insertUser();
        requestJoin(waiting, crewId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        updateSettings(ownerId, crewId, "{\"joinPolicy\":\"INSTANT\"}").andExpect(status().isOk());

        assertEquals("PENDING", membershipOf(crewId, waiting));
        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(waiting));

        long newcomer = insertUser();
        requestJoin(newcomer, crewId).andExpect(jsonPath("$.status").value("APPROVED"));
        decide(ownerId, crewId, waiting, "APPROVED").andExpect(status().isOk());
        assertEquals(3, approvedCount(crewId));
    }

    // AC-6
    @Test
    void 동시_승인도_정원을_넘지_않는다() throws Exception {
        long crewId = createCrew(ownerId, "동시 승인 크루", 2, null);
        List<Long> applicants = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            long applicant = insertUser();
            requestJoin(applicant, crewId).andExpect(status().isOk());
            applicants.add(applicant);
        }

        List<Integer> statuses =
                runConcurrently(
                        applicants.stream()
                                .<Callable<Integer>>map(
                                        applicant ->
                                                () ->
                                                        decide(ownerId, crewId, applicant, "APPROVED")
                                                                .andReturn()
                                                                .getResponse()
                                                                .getStatus())
                                .toList());

        assertEquals(1, statuses.stream().filter(s -> s == 200).count(), statuses.toString());
        assertEquals(4, statuses.stream().filter(s -> s == 409).count(), statuses.toString());
        assertEquals(2, approvedCount(crewId));
    }

    // AC-6
    @Test
    void 동시_바로가입도_정원을_넘지_않는다() throws Exception {
        long crewId = createCrew(ownerId, "동시 가입 크루", 3, "INSTANT");
        List<Long> joiners = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            joiners.add(insertUser());
        }

        List<Integer> statuses =
                runConcurrently(
                        joiners.stream()
                                .<Callable<Integer>>map(
                                        joiner ->
                                                () ->
                                                        requestJoin(joiner, crewId)
                                                                .andReturn()
                                                                .getResponse()
                                                                .getStatus())
                                .toList());

        assertEquals(2, statuses.stream().filter(s -> s == 200).count(), statuses.toString());
        assertEquals(3, approvedCount(crewId));
    }

    // AC-6: 승인과 정원 축소가 겹쳐도 어느 순서든 한쪽만 성공해 승인 인원이 정원을 넘지 않는다.
    @Test
    void 승인과_정원_축소가_겹쳐도_정원을_넘지_않는다() throws Exception {
        for (int round = 0; round < 8; round++) {
            long crewId = createCrew(ownerId, "축소 크루 " + round, 3, null);
            approveMember(crewId, insertUser());
            long applicant = insertUser();
            requestJoin(applicant, crewId).andExpect(status().isOk());

            List<Integer> statuses =
                    runConcurrently(
                            List.of(
                                    () ->
                                            decide(ownerId, crewId, applicant, "APPROVED")
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus(),
                                    () ->
                                            updateSettings(ownerId, crewId, "{\"capacity\":2}")
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus()));

            assertEquals(1, statuses.stream().filter(s -> s == 200).count(), statuses.toString());
            assertEquals(1, statuses.stream().filter(s -> s == 409).count(), statuses.toString());
            assertTrue(
                    approvedCount(crewId) <= capacityOf(crewId),
                    "round " + round + ": " + statuses);
        }
    }

    // AC-3: 크루 밖 회원도 403이고, 크루장이 아니면 잘못된 body보다 권한 거부가 먼저다.
    @Test
    void 크루_밖_회원과_비크루장의_잘못된_요청은_권한부터_거부한다() throws Exception {
        long crewId = createCrew(ownerId, "권한 크루", 10, null);
        long outsider = insertUser();
        long memberId = insertUser();
        approveMember(crewId, memberId);

        updateSettings(outsider, crewId, "{\"capacity\":20}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));
        updateSettings(memberId, crewId, "{\"capacity\":0}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));
        assertEquals(10, capacityOf(crewId));
    }

    // AC-6 (리뷰 A-1·B-2): 해산과 바로 가입이 겹쳐도 해산된 크루에 승인 멤버가 남지 않는다.
    @Test
    void 해산과_바로가입이_겹쳐도_해산된_크루에_멤버가_남지_않는다() throws Exception {
        for (int round = 0; round < 8; round++) {
            long crewId = createCrew(ownerId, "해산 크루 " + round, 10, "INSTANT");
            long joiner = insertUser();

            List<Integer> statuses =
                    runConcurrently(
                            List.of(
                                    () ->
                                            mockMvc.perform(
                                                            org.springframework.test.web.servlet
                                                                    .request.MockMvcRequestBuilders
                                                                    .delete(
                                                                            "/api/v1/crews/{crewId}",
                                                                            crewId)
                                                                    .header(
                                                                            "Authorization",
                                                                            bearer(ownerId)))
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus(),
                                    () ->
                                            requestJoin(joiner, crewId)
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus()));

            assertEquals(200, statuses.get(0), statuses.toString());
            assertEquals("INACTIVE", statusOf(crewId));
            assertEquals(0, approvedCount(crewId), "round " + round + ": " + statuses);
        }
    }

    // AC-1 (리뷰 B-1): 크루장 이양과 정원 변경이 겹쳐도 성공한 정원 변경이 이전 값으로 되돌아가지 않는다.
    @Test
    void 크루장_이양과_정원_변경이_겹쳐도_저장한_정원이_유지된다() throws Exception {
        for (int round = 0; round < 8; round++) {
            long crewId = createCrew(ownerId, "이양 크루 " + round, 10, null);
            long successor = insertUser();
            approveMember(crewId, successor);

            List<Integer> statuses =
                    runConcurrently(
                            List.of(
                                    () ->
                                            mockMvc.perform(
                                                            org.springframework.test.web.servlet
                                                                    .request.MockMvcRequestBuilders
                                                                    .delete(
                                                                            "/api/v1/crews/{crewId}/members/me",
                                                                            crewId)
                                                                    .header(
                                                                            "Authorization",
                                                                            bearer(ownerId))
                                                                    .contentType(
                                                                            MediaType
                                                                                    .APPLICATION_JSON)
                                                                    .content(
                                                                            "{\"successorUserId\":%d}"
                                                                                    .formatted(
                                                                                            successor)))
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus(),
                                    () ->
                                            updateSettings(ownerId, crewId, "{\"capacity\":30}")
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus()));

            assertEquals(200, statuses.get(0), statuses.toString());
            assertEquals(
                    successor,
                    jdbc.queryForObject(
                            "SELECT owner_id FROM crews WHERE id=?", Long.class, crewId));
            // 이양이 먼저면 이전 크루장의 변경은 403, 변경이 먼저면 30이 이양 뒤에도 남아야 한다.
            int expected = statuses.get(1) == 200 ? 30 : 10;
            assertTrue(statuses.get(1) == 200 || statuses.get(1) == 403, statuses.toString());
            assertEquals(expected, capacityOf(crewId), "round " + round + ": " + statuses);
        }
    }

    // 재검토 RR-1: 크루장 이양(A→B)과 A의 B 내보내기가 겹쳐도 LEFT 상태의 크루장이 남지 않는다.
    @Test
    void 크루장_이양과_내보내기가_겹쳐도_탈퇴한_크루장이_남지_않는다() throws Exception {
        for (int round = 0; round < 8; round++) {
            long crewId = createCrew(ownerId, "내보내기 크루 " + round, 10, null);
            long successor = insertUser();
            approveMember(crewId, successor);

            List<Integer> statuses =
                    runConcurrently(
                            List.of(
                                    () ->
                                            mockMvc.perform(
                                                            org.springframework.test.web.servlet
                                                                    .request.MockMvcRequestBuilders
                                                                    .delete(
                                                                            "/api/v1/crews/{crewId}/members/me",
                                                                            crewId)
                                                                    .header(
                                                                            "Authorization",
                                                                            bearer(ownerId))
                                                                    .contentType(
                                                                            MediaType
                                                                                    .APPLICATION_JSON)
                                                                    .content(
                                                                            "{\"successorUserId\":%d}"
                                                                                    .formatted(
                                                                                            successor)))
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus(),
                                    () ->
                                            mockMvc.perform(
                                                            org.springframework.test.web.servlet
                                                                    .request.MockMvcRequestBuilders
                                                                    .delete(
                                                                            "/api/v1/crews/{crewId}/members/{userId}",
                                                                            crewId,
                                                                            successor)
                                                                    .header(
                                                                            "Authorization",
                                                                            bearer(ownerId)))
                                                    .andReturn()
                                                    .getResponse()
                                                    .getStatus()));

            long owner =
                    jdbc.queryForObject("SELECT owner_id FROM crews WHERE id=?", Long.class, crewId);
            assertEquals(1, statuses.stream().filter(s -> s == 200).count(), statuses.toString());
            assertEquals(
                    "APPROVED",
                    membershipOf(crewId, owner),
                    "round " + round + ": owner must stay a member " + statuses);
        }
    }

    private List<Integer> runConcurrently(List<Callable<Integer>> tasks) throws Exception {
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(tasks.size())) {
            List<Future<Integer>> futures = new ArrayList<>();
            for (Callable<Integer> task : tasks) {
                futures.add(
                        executor.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return task.call();
                                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            List<Integer> results = new ArrayList<>();
            for (Future<Integer> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
            return results;
        }
    }

    private ResultActions updateSettings(long userId, long crewId, String body) throws Exception {
        return mockMvc.perform(
                patch("/api/v1/crews/{crewId}", crewId)
                        .header("Authorization", bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private ResultActions requestJoin(long userId, long crewId) throws Exception {
        return mockMvc.perform(
                post("/api/v1/crews/{crewId}/join-requests", crewId)
                        .header("Authorization", bearer(userId)));
    }

    private ResultActions decide(long owner, long crewId, long userId, String decision)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, userId)
                        .header("Authorization", bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"%s\"}".formatted(decision)));
    }

    private void approveMember(long crewId, long userId) throws Exception {
        requestJoin(userId, crewId).andExpect(status().isOk());
        decide(ownerId, crewId, userId, "APPROVED").andExpect(status().isOk());
    }

    private long createCrew(long owner, String name, int capacity, String joinPolicy)
            throws Exception {
        String policy = joinPolicy == null ? "" : ",\"joinPolicy\":\"%s\"".formatted(joinPolicy);
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/crews")
                                        .header("Authorization", bearer(owner))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"name\":\"%s\",\"capacity\":%d%s}"
                                                        .formatted(name, capacity, policy)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String body = created.getResponse().getContentAsString();
        return Long.parseLong(body.replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));
    }

    private long insertUser() {
        int n = ++userSeq;
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                "settings_user_" + n,
                "설정러너" + n,
                "0109000%04d".formatted(n));
    }

    private int capacityOf(long crewId) {
        return jdbc.queryForObject("SELECT capacity FROM crews WHERE id=?", Integer.class, crewId);
    }

    private String joinPolicyOf(long crewId) {
        return jdbc.queryForObject(
                "SELECT join_policy::text FROM crews WHERE id=?", String.class, crewId);
    }

    private String statusOf(long crewId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM crews WHERE id=?", String.class, crewId);
    }

    private String membershipOf(long crewId, long userId) {
        List<String> rows =
                jdbc.queryForList(
                        "SELECT status::text FROM crew_memberships WHERE crew_id=? AND user_id=?",
                        String.class,
                        crewId,
                        userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private int approvedCount(long crewId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM crew_memberships WHERE crew_id=? AND status='APPROVED'",
                Integer.class,
                crewId);
    }

    private static String bearer(long userId) {
        return SecurityTestSupport.bearer(userId);
    }
}
