package com.runway.backend.domain.crew;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.crew.dto.response.CrewSummaryResponse;
import com.runway.backend.domain.crew.service.CrewService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

class CrewApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CrewService crewService;

    private long userId;

    @BeforeEach
    void seedUser() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('crew_user','hash','러너','2000-01-01','MALE','01011112222','AGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    @Test
    void 헤더없으면_401() throws Exception {
        mockMvc.perform(
                        post("/api/v1/crews")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"name":"테스트 크루","capacity":10}
                                        """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void 생성_상세_내목록_검색_흐름() throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/crews")
                                        .header("Authorization", SecurityTestSupport.bearer(userId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "name":"하천 러닝",
                                                  "description":"주말 러닝",
                                                  "capacity":10
                                                }
                                                """))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.id").isNumber())
                        .andExpect(jsonPath("$.ownerId").value(userId))
                        .andExpect(jsonPath("$.name").value("하천 러닝"))
                        .andExpect(jsonPath("$.createdAt").isNotEmpty())
                        .andReturn();

        String body = created.getResponse().getContentAsString();
        long crewId = Long.parseLong(body.replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(crewId))
                .andExpect(jsonPath("$.memberCount").value(1))
                .andExpect(jsonPath("$.myMembershipStatus").value("APPROVED"))
                .andExpect(jsonPath("$.capacity").value(10));

        mockMvc.perform(
                        get("/api/v1/users/me/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].isOwner").value(true))
                .andExpect(jsonPath("$.items[0].myMembershipStatus").value("APPROVED"));

        mockMvc.perform(
                        get("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .param("q", "하천"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].name").value("하천 러닝"))
                .andExpect(jsonPath("$.items[0].myMembershipStatus").value("APPROVED"));
    }

    @Test
    void 없는크루_상세는_404() throws Exception {
        mockMvc.perform(
                        get("/api/v1/crews/{crewId}", 999999L)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CREW_NOT_FOUND"));
    }

    @ParameterizedTest
    @MethodSource("crewSearchFilters")
    void 목록_검색어와지역_조합조회(
            String query, int regionCase, List<String> nameMatches) throws Exception {
        List<String> regions =
                jdbc.queryForList(
                        "SELECT region_code FROM regions ORDER BY region_code LIMIT 2",
                        String.class);
        assertThat(regions).hasSize(2);
        String firstRegion = regions.get(0);
        String secondRegion = regions.get(1);
        seedSearchCrew("Run 한강", "ACTIVE", 10, firstRegion);
        seedSearchCrew("RUN 바다", "ACTIVE", 10, secondRegion);
        seedSearchCrew("Run 미설정", "ACTIVE", 10, null);
        seedSearchCrew("Run 휴면", "INACTIVE", 10, firstRegion);

        String region =
                switch (regionCase) {
                    case 0 -> null;
                    case 1 -> "";
                    case 2 -> "   ";
                    case 3 -> " " + firstRegion + " ";
                    case 4 -> secondRegion;
                    case 5 -> "NO_SUCH_REGION_569";
                    default -> throw new IllegalArgumentException("Unknown test region");
                };
        List<String> regionMatches =
                switch (regionCase) {
                    case 0, 1, 2 -> List.of("Run 한강", "RUN 바다", "Run 미설정");
                    case 3 -> List.of("Run 한강");
                    case 4 -> List.of("RUN 바다");
                    default -> List.of();
                };
        List<String> expected = nameMatches.stream().filter(regionMatches::contains).toList();

        // HTTP 미지정과 별도로 실제 Java null을 서비스/Repository 경로에 전달한다.
        assertThat(crewService.search(userId, query, region).items())
                .extracting(CrewSummaryResponse::name)
                .containsExactlyElementsOf(expected);

        MockHttpServletRequestBuilder request =
                get("/api/v1/crews")
                        .header("Authorization", SecurityTestSupport.bearer(userId));
        if (query != null) {
            request.param("q", query);
        }
        if (region != null) {
            request.param("regionCode", region);
        }
        var result =
                mockMvc.perform(request)
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(expected.size()));
        if (!expected.isEmpty()) {
            result.andExpect(jsonPath("$.items[*].name").value(contains(expected.toArray())));
        }
    }

    private static Stream<Arguments> crewSearchFilters() {
        List<String> all = List.of("Run 한강", "RUN 바다", "Run 미설정");
        return Stream.of(
                        Arguments.of(null, all),
                        Arguments.of("", all),
                        Arguments.of("   ", all),
                        Arguments.of("Run", all),
                        Arguments.of(" rUn ", all),
                        Arguments.of("한강", List.of("Run 한강")),
                        Arguments.of("불일치", List.of()),
                        Arguments.of("null", List.of()))
                .flatMap(
                        entry ->
                                java.util.stream.IntStream.range(0, 6)
                                        .mapToObj(
                                                region ->
                                                        Arguments.of(
                                                                entry.get()[0],
                                                                region,
                                                                entry.get()[1])));
    }

    @Test
    void 목록_모집우선정렬_인원과내상태() throws Exception {
        long owner = insertUser("search_owner", "크루장", "01022223333");
        long full = createCrew(owner, "Run 만석", 1);
        long pending = createCrew(owner, "Run 신청중", 10);
        long approved = createCrew(userId, "Run 가입됨", 10);
        long outsider = createCrew(owner, "Run 미가입", 10);
        jdbc.update(
                "INSERT INTO crew_memberships(crew_id, user_id, status) VALUES (?, ?, 'PENDING')",
                pending,
                userId);

        for (String query : new String[] {null, "Run"}) {
            MockHttpServletRequestBuilder request =
                    get("/api/v1/crews")
                            .header("Authorization", SecurityTestSupport.bearer(userId));
            if (query != null) {
                request.param("q", query);
            }
            mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(4))
                    .andExpect(jsonPath("$.items[0].id").value(pending))
                    .andExpect(jsonPath("$.items[0].memberCount").value(1))
                    .andExpect(jsonPath("$.items[0].myMembershipStatus").value("PENDING"))
                    .andExpect(jsonPath("$.items[1].id").value(approved))
                    .andExpect(jsonPath("$.items[1].memberCount").value(1))
                    .andExpect(jsonPath("$.items[1].myMembershipStatus").value("APPROVED"))
                    .andExpect(jsonPath("$.items[2].id").value(outsider))
                    .andExpect(jsonPath("$.items[2].myMembershipStatus").value(nullValue()))
                    .andExpect(jsonPath("$.items[3].id").value(full))
                    .andExpect(jsonPath("$.items[3].capacity").value(1))
                    .andExpect(jsonPath("$.items[3].memberCount").value(1));
        }
    }

    @Test
    void 목록_반복조회_검색어삭제() throws Exception {
        long owner = insertUser("retry_owner", "크루장", "01022224444");
        long first = createCrew(owner, "Run 한강", 10);
        createCrew(owner, "Run 바다", 10);
        var crewsBefore = jdbc.queryForList("SELECT * FROM crews ORDER BY id");
        var membershipsBefore = jdbc.queryForList("SELECT * FROM crew_memberships ORDER BY id");

        mockMvc.perform(
                        get("/api/v1/users/me/crews")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
        for (String query : new String[] {null, null, "한강", "", "   "}) {
            MockHttpServletRequestBuilder request =
                    get("/api/v1/crews")
                            .header("Authorization", SecurityTestSupport.bearer(userId));
            if (query != null) {
                request.param("q", query);
            }
            mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value("한강".equals(query) ? 1 : 2))
                    .andExpect(jsonPath("$.items[0].id").value(first))
                    .andExpect(jsonPath("$.items[0].myMembershipStatus").value(nullValue()));
        }
        assertThat(jdbc.queryForList("SELECT * FROM crews ORDER BY id")).isEqualTo(crewsBefore);
        assertThat(jdbc.queryForList("SELECT * FROM crew_memberships ORDER BY id"))
                .isEqualTo(membershipsBefore);
    }

    @Test
    void 목록_무인증_401() throws Exception {
        mockMvc.perform(get("/api/v1/crews"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    private long seedSearchCrew(String name, String status, int capacity, String regionCode) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status, region_code)
                VALUES (?, ?, ?, ?::crews_status_enum, ?)
                RETURNING id
                """,
                Long.class,
                userId,
                name,
                capacity,
                status,
                regionCode);
    }

    @Test
    void 가입신청_목록_승인_거절_재신청_흐름() throws Exception {
        long applicantId = insertUser("applicant", "지원자", "01033334444");
        long outsiderId = insertUser("outsider", "외부인", "01055556666");
        enableCommunityNotifications(applicantId);

        long crewId = createCrew(userId, "가입 테스트 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.crewId").value(crewId))
                .andExpect(jsonPath("$.userId").value(applicantId))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.requestedAt").isNotEmpty());

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER_OR_PENDING"));

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(applicantId))
                .andExpect(jsonPath("$.items[0].status").value("PENDING"))
                .andExpect(jsonPath("$.items[0].nickname").value("지원자"))
                .andExpect(jsonPath("$.items[0].joinedAt").value(nullValue()));

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"REJECTED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"));
        assertNotification(
                applicantId,
                "CREW_JOIN_REJECTED",
                crewId,
                "CREW_JOIN_REJECTED:" + crewId + ":" + applicantId,
                "「가입 테스트 크루」크루 가입이 거절되었습니다.");

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.crewId").value(crewId))
                .andExpect(jsonPath("$.userId").value(applicantId))
                .andExpect(jsonPath("$.status").value("APPROVED"));
        assertNotification(
                applicantId,
                "CREW_JOIN_APPROVED",
                crewId,
                "CREW_JOIN_APPROVED:" + crewId + ":" + applicantId,
                "「가입 테스트 크루」크루 가입이 승인되었습니다.");

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberCount").value(2))
                .andExpect(jsonPath("$.myMembershipStatus").value("APPROVED"));
    }

    @Test
    void 멤버목록_탈퇴_내보내기_흐름() throws Exception {
        long memberId = insertUser("member_user", "멤버", "01099990000");
        long outsiderId = insertUser("kick_outsider", "외부", "01088887777");
        long crewId = createCrew(userId, "멤버 관리 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, memberId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/members", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[?(@.userId==" + userId + ")].isOwner").value(true))
                .andExpect(jsonPath("$.items[?(@.userId==" + memberId + ")].nickname").value("멤버"))
                .andExpect(
                        jsonPath("$.items[?(@.userId==" + memberId + ")].status")
                                .value("APPROVED"));

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OWNER_CANNOT_LEAVE"));

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/{userId}", crewId, userId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANNOT_REMOVE_OWNER"));

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/{userId}", crewId, memberId)
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));

        // re-approve path already done; member still APPROVED — leave as self
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LEFT"))
                .andExpect(jsonPath("$.leftAt").isNotEmpty());

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/members", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(userId));

        // bring member back then OWNER removes
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, memberId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/{userId}", crewId, memberId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LEFT"))
                .andExpect(jsonPath("$.leftAt").isNotEmpty());
    }

    @Test
    void 크루장_이양_탈퇴_및_해산() throws Exception {
        long memberId = insertUser("succ_user", "후임", "01066665555");
        long pendingId = insertUser("pend_diss", "대기", "01055554444");
        long crewId = createCrew(userId, "이양해산 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, memberId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"successorUserId":%d}
                                        """
                                                .formatted(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LEFT"));

        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/members", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(memberId))
                .andExpect(jsonPath("$.items[0].isOwner").value(true));

        long soloCrewId = createCrew(userId, "1인 해산 크루", 5);
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/members/me", soloCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OWNER_CANNOT_LEAVE"));

        enableCommunityNotifications(pendingId);
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", soloCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(pendingId)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}", soloCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(soloCrewId))
                .andExpect(jsonPath("$.status").value("INACTIVE"));

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}", soloCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INACTIVE"));

        String status =
                jdbc.queryForObject(
                        "SELECT status::text FROM crews WHERE id = ?", String.class, soloCrewId);
        org.junit.jupiter.api.Assertions.assertEquals("INACTIVE", status);
        Long rejectSpam =
                jdbc.queryForObject(
                        """
                        SELECT count(*) FROM notifications
                        WHERE user_id = ? AND notification_type = 'CREW_JOIN_REJECTED'
                        """,
                        Long.class,
                        pendingId);
        org.junit.jupiter.api.Assertions.assertEquals(0L, rejectSpam);
    }

    @Test
    void 정원초과_가입신청은_409() throws Exception {
        long applicantId = insertUser("full_crew_user", "만석지원", "01077778888");
        long crewId = createCrew(userId, "정원1 크루", 1);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_EXCEEDED"));

        Long pendingCount =
                jdbc.queryForObject(
                        """
                        SELECT count(*) FROM crew_memberships
                        WHERE crew_id = ? AND user_id = ? AND status = 'PENDING'
                        """,
                        Long.class,
                        crewId,
                        applicantId);
        org.junit.jupiter.api.Assertions.assertEquals(0L, pendingCount);
    }

    @Test
    void 정원초과_승인은_409() throws Exception {
        long firstId = insertUser("full_crew_first", "선승인", "01077778881");
        long secondId = insertUser("full_crew_second", "후승인", "01077778882");
        long crewId = createCrew(userId, "정원2 크루", 2);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(firstId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(secondId)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, firstId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, secondId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_EXCEEDED"));

        String secondStatus =
                jdbc.queryForObject(
                        """
                        SELECT status::text FROM crew_memberships
                        WHERE crew_id = ? AND user_id = ?
                        """,
                        String.class,
                        crewId,
                        secondId);
        org.junit.jupiter.api.Assertions.assertEquals("PENDING", secondStatus);
    }

    @Test
    void 정원초과_거절후_재신청은_409_상태를_유지한다() throws Exception {
        long rejectedId = insertUser("reapply_rejected", "재신청자", "01077778883");
        long fillerId = insertUser("reapply_filler", "채움", "01077778884");
        long crewId = createCrew(userId, "재신청 정원2", 2);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(rejectedId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, rejectedId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"REJECTED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(fillerId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, fillerId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(rejectedId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_EXCEEDED"));

        String status =
                jdbc.queryForObject(
                        """
                        SELECT status::text FROM crew_memberships
                        WHERE crew_id = ? AND user_id = ?
                        """,
                        String.class,
                        crewId,
                        rejectedId);
        org.junit.jupiter.api.Assertions.assertEquals("REJECTED", status);
    }

    @Test
    void 만원_대기중_재신청은_ALREADY가_CAPACITY보다_앞선다() throws Exception {
        long waitingId = insertUser("already_waiting", "대기중", "01077778885");
        long fillerId = insertUser("already_filler", "선승인", "01077778886");
        long crewId = createCrew(userId, "ALREADY 우선 정원2", 2);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(waitingId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(fillerId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, fillerId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(waitingId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER_OR_PENDING"));
    }

    @RepeatedTest(3)
    void 동시_승인은_정원을_넘기지_않는다() throws Exception {
        long firstId = insertUser("race_first_" + System.nanoTime(), "경합1", uniquePhone());
        long secondId = insertUser("race_second_" + System.nanoTime(), "경합2", uniquePhone());
        long crewId = createCrew(userId, "동시승인 정원2", 2);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(firstId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(secondId)))
                .andExpect(status().isOk());

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Integer>> futures = new ArrayList<>();
            for (long targetId : List.of(firstId, secondId)) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await(10, TimeUnit.SECONDS);
                                    return mockMvc.perform(
                                                    patch(
                                                                    "/api/v1/crews/{crewId}/join-requests/{userId}",
                                                                    crewId,
                                                                    targetId)
                                                            .header(
                                                                    "Authorization",
                                                                    SecurityTestSupport.bearer(
                                                                            userId))
                                                            .contentType(
                                                                    MediaType.APPLICATION_JSON)
                                                            .content(
                                                                    """
                                                                    {"status":"APPROVED"}
                                                                    """))
                                            .andReturn()
                                            .getResponse()
                                            .getStatus();
                                }));
            }
            org.junit.jupiter.api.Assertions.assertTrue(ready.await(10, TimeUnit.SECONDS));
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get(30, TimeUnit.SECONDS));
            }
            assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        } finally {
            pool.shutdownNow();
        }

        Long approved =
                jdbc.queryForObject(
                        """
                        SELECT count(*) FROM crew_memberships
                        WHERE crew_id = ? AND status = 'APPROVED'
                        """,
                        Long.class,
                        crewId);
        org.junit.jupiter.api.Assertions.assertEquals(2L, approved);
    }

    // S15P31E105-636 AC-1·AC-2: 크루 대표 사진과 사람 프로필 사진 주소. 사진이 없으면 키는 두고 null.
    @Test
    void 크루_사진과_구성원_프로필_사진_주소() throws Exception {
        String crewImageId = "0b6f4a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
        String profileImageId = "7c8d9e0f-1a2b-4c3d-9e8f-7a6b5c4d3e2f";
        String crewUrl = "/api/v1/images/" + crewImageId;
        String profileUrl = "/api/v1/images/" + profileImageId;
        long photoCrewId = createCrew(userId, "사진 크루", 10);
        long plainCrewId = createCrew(userId, "기본 크루", 10);
        jdbc.update(
                "UPDATE crews SET image_key = ? WHERE id = ?",
                "images/crew/" + userId + "/" + crewImageId + ".jpg",
                photoCrewId);
        jdbc.update(
                "UPDATE users SET profile_image_key = ? WHERE id = ?",
                "images/profile/" + userId + "/" + profileImageId + ".png",
                userId);
        long applicantId = insertUser("photo_applicant", "신청자", uniquePhone());

        // M01 검색
        mockMvc.perform(
                        get("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(applicantId))
                                .param("q", "사진"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].imageUrl").value(crewUrl));
        // M02 상세: 있는 크루는 주소, 없는 크루는 null 키
        mockMvc.perform(
                        get("/api/v1/crews/{crewId}", photoCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imageUrl").value(crewUrl));
        String plainDetail =
                mockMvc.perform(
                                get("/api/v1/crews/{crewId}", plainCrewId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(applicantId)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(plainDetail).contains("\"imageUrl\":null");
        // M10 내 크루
        String myCrews =
                mockMvc.perform(
                                get("/api/v1/users/me/crews")
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.items[?(@.id==" + photoCrewId + ")].imageUrl")
                                        .value(crewUrl))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(myCrews).contains("\"imageUrl\":null");

        // M05 가입 신청 목록: 사진 없는 신청자는 null 키
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", photoCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        String requests =
                mockMvc.perform(
                                get("/api/v1/crews/{crewId}/join-requests", photoCrewId)
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(1))
                        .andExpect(jsonPath("$.items[0].userId").value(applicantId))
                        .andExpect(jsonPath("$.items[0].nickname").value("신청자"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(requests).contains("\"profileImageUrl\":null");
        // 신청자가 사진을 올리면 다음 조회부터 주소가 온다.
        String applicantImageId = "1d2c3b4a-5f6e-4d7c-8b9a-a1b2c3d4e5f6";
        jdbc.update(
                "UPDATE users SET profile_image_key = ? WHERE id = ?",
                "images/profile/" + applicantId + "/" + applicantImageId + ".jpg",
                applicantId);
        mockMvc.perform(
                        get("/api/v1/crews/{crewId}/join-requests", photoCrewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.items[0].profileImageUrl")
                                .value("/api/v1/images/" + applicantImageId));

        // M07 멤버 목록: 크루장 사진 주소, 사진을 지운 회원은 null 키
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", photoCrewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isOk());
        jdbc.update("UPDATE users SET profile_image_key = NULL WHERE id = ?", applicantId);
        String members =
                mockMvc.perform(
                                get("/api/v1/crews/{crewId}/members", photoCrewId)
                                        .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(2))
                        .andExpect(
                                jsonPath("$.items[?(@.userId==" + userId + ")].profileImageUrl")
                                        .value(profileUrl))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(members).contains("\"profileImageUrl\":null");
    }

    private String uniquePhone() {
        long n = Math.floorMod(System.nanoTime(), 100_000_000L);
        return String.format("010%08d", n);
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    @Test
    void 가입신청_알림_크루장에게_한건_재신청은_새알림() throws Exception {
        long applicantId = insertUser("req_notify_a", "알림지원자", "01090000001");
        long bystanderId = insertUser("req_notify_b", "구경꾼", "01090000002");
        enableCommunityNotifications(userId);
        enableCommunityNotifications(bystanderId);
        long crewId = createCrew(userId, "알림 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(1L);
        assertThat(countJoinRequestedNotifications(bystanderId, crewId)).isEqualTo(0L);
        assertThat(countJoinRequestedNotifications(applicantId, crewId)).isEqualTo(0L);
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT message FROM notifications
                                WHERE user_id = ? AND notification_type = 'CREW_JOIN_REQUESTED'
                                """,
                                String.class,
                                userId))
                .isEqualTo("「알림 크루」크루에 알림지원자님이 가입을 신청했습니다.");

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(1L);

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"REJECTED\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(2L);
    }

    @Test
    void 가입신청_알림_수신끈_크루장과_바로가입크루는_없다() throws Exception {
        long applicantId = insertUser("req_notify_c", "수신끔지원자", "01090000003");
        long crewId = createCrew(userId, "수신끔 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(0L);

        enableCommunityNotifications(userId);
        long instantCrewId = createCrew(userId, "바로가입 크루", 10);
        jdbc.update("UPDATE crews SET join_policy = 'INSTANT' WHERE id = ?", instantCrewId);
        long instantApplicantId = insertUser("req_notify_d", "바로가입자", "01090000004");
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", instantCrewId)
                                .header(
                                        "Authorization",
                                        SecurityTestSupport.bearer(instantApplicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        assertThat(countJoinRequestedNotifications(userId, instantCrewId)).isEqualTo(0L);
    }

    @Test
    void 가입신청_철회는_행과_알림을_지우고_재신청할_수_있다() throws Exception {
        long applicantId = insertUser("req_cancel_a", "철회자", "01090000005");
        enableCommunityNotifications(userId);
        long crewId = createCrew(userId, "철회 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(1L);

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isNoContent());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(0L);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM crew_memberships WHERE crew_id = ? AND user_id = ?",
                                Long.class,
                                crewId,
                                applicantId))
                .isEqualTo(0L);

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(1L);
    }

    @Test
    void 가입신청_철회는_승인된_멤버와_없는_크루에서_실패() throws Exception {
        long applicantId = insertUser("req_cancel_b", "승인된사람", "01090000006");
        long crewId = createCrew(userId, "철회 실패 크루", 10);
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"APPROVED\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM crew_memberships WHERE crew_id = ? AND user_id = ?",
                                String.class,
                                crewId,
                                applicantId))
                .isEqualTo("APPROVED");

        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", 999999L)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CREW_NOT_FOUND"));
    }

    @Test
    void 가입신청_철회는_거절된_신청_타인_무토큰에서_실패하고_재신청후_철회는_현재_알림만_지운다()
            throws Exception {
        long applicantId = insertUser("req_cancel_c", "재신청자", "01090000007");
        long strangerId = insertUser("req_cancel_d", "제3자", "01090000008");
        enableCommunityNotifications(userId);
        long crewId = createCrew(userId, "철회 경계 크루", 10);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(strangerId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));
        mockMvc.perform(delete("/api/v1/crews/{crewId}/join-requests/me", crewId))
                .andExpect(status().isUnauthorized());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM crew_memberships WHERE crew_id = ? AND user_id = ?",
                                String.class,
                                crewId,
                                applicantId))
                .isEqualTo("PENDING");

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"status\":\"REJECTED\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_PENDING"));

        // 거절 후 재신청 → 알림 2건(신청마다 1건). 철회하면 현재 신청의 알림만 지워지고 처음 신청의 알림은 남는다.
        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(2L);
        mockMvc.perform(
                        delete("/api/v1/crews/{crewId}/join-requests/me", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isNoContent());
        assertThat(countJoinRequestedNotifications(userId, crewId)).isEqualTo(1L);
    }

    private long countJoinRequestedNotifications(long recipientId, long crewId) {
        Long count =
                jdbc.queryForObject(
                        """
                        SELECT count(*) FROM notifications
                        WHERE user_id = ? AND notification_type = 'CREW_JOIN_REQUESTED'
                          AND target_id = ?
                        """,
                        Long.class,
                        recipientId,
                        crewId);
        return count == null ? 0L : count;
    }

    private void enableCommunityNotifications(long userId) {
        jdbc.update(
                """
                INSERT INTO user_settings(
                    user_id, voice_coaching_enabled, bpm_guide_enabled,
                    group_notifications_enabled, community_notifications_enabled,
                    location_collection_mode, account_visibility)
                VALUES (?, false, false, false, true, 'OFF', 'PRIVATE')
                """,
                userId);
    }

    private void assertNotification(
            long userId, String type, long targetId, String dedupeKey, String message) {
        var row =
                jdbc.queryForMap(
                        """
                        SELECT notification_type, target_id, dedupe_key, message
                        FROM notifications
                        WHERE user_id = ? AND dedupe_key = ?
                        """,
                        userId,
                        dedupeKey);
        org.junit.jupiter.api.Assertions.assertEquals(type, row.get("notification_type"));
        org.junit.jupiter.api.Assertions.assertEquals(
                targetId, ((Number) row.get("target_id")).longValue());
        org.junit.jupiter.api.Assertions.assertEquals(dedupeKey, row.get("dedupe_key"));
        org.junit.jupiter.api.Assertions.assertEquals(message, row.get("message"));
    }

    private long createCrew(long ownerId, String name, int capacity) throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/crews")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(ownerId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"name":"%s","capacity":%d}
                                                """
                                                        .formatted(name, capacity)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String body = created.getResponse().getContentAsString();
        return Long.parseLong(body.replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));
    }
}
