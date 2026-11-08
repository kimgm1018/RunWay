package com.runway.backend.domain.crew;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

class CrewApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;

    @BeforeEach
    void seedUser() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('crew_user','hash','러너','2000-01-01','MALE','01011112222','AGREEE')
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
    void 정원초과_승인은_409() throws Exception {
        long applicantId = insertUser("full_crew_user", "만석지원", "01077778888");
        long crewId = createCrew(userId, "정원1 크루", 1);

        mockMvc.perform(
                        post("/api/v1/crews/{crewId}/join-requests", crewId)
                                .header("Authorization", SecurityTestSupport.bearer(applicantId)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        patch("/api/v1/crews/{crewId}/join-requests/{userId}", crewId, applicantId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"status":"APPROVED"}
                                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREW_CAPACITY_EXCEEDED"));
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
