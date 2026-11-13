package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
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
import tools.jackson.databind.json.JsonMapper;

class GroupRunApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long hostId;
    private long memberId;
    private long outsiderId;
    private long crewId;

    @BeforeEach
    void seed() {
        hostId = insertUser("gr_api_host", "호스트", "01022220001");
        memberId = insertUser("gr_api_member", "멤버", "01022220002");
        outsiderId = insertUser("gr_api_out", "외부인", "01022220003");
        insertDevice(hostId, "WATCH");
        insertDevice(hostId, "PHONE");
        insertDevice(memberId, "WATCH");
        insertDevice(memberId, "PHONE");
        crewId = insertCrew(hostId, "API 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
    }

    @Test
    void create_hostAutoJoins_andTimeGoalDerivesPace() throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/group-runs")
                                        .header("Authorization", SecurityTestSupport.bearer(hostId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(createBody(crewId)))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.hostId").value(hostId))
                        .andExpect(jsonPath("$.status").value("SCHEDULED"))
                        .andExpect(jsonPath("$.targetDistanceM").value(5000))
                        .andExpect(jsonPath("$.targetDurationSec").value(1800))
                        .andExpect(jsonPath("$.goalPaceSecPerKm").value(360))
                        .andReturn();

        long groupRunId =
                mapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*) FROM group_run_participants
                                WHERE group_run_id=? AND user_id=?
                                """,
                                Integer.class,
                                groupRunId,
                                hostId))
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM group_runs WHERE id=?",
                                Integer.class,
                                groupRunId))
                .isEqualTo(1);
    }

    @Test
    void list_byCrewId_returnsCreatedRunsForCrewMembers() throws Exception {
        long groupRunId = createGroupRun(hostId);

        long otherCrewId = insertCrew(hostId, "다른 크루");
        approveMember(otherCrewId, hostId);
        long otherGroupRunId =
                mapper.readTree(
                                mockMvc.perform(
                                                post("/api/v1/group-runs")
                                                        .header(
                                                                "Authorization",
                                                                SecurityTestSupport.bearer(hostId))
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(createBody(otherCrewId)))
                                        .andExpect(status().isCreated())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString())
                        .get("id")
                        .asLong();

        mockMvc.perform(
                        get("/api/v1/group-runs")
                                .param("crewId", String.valueOf(crewId))
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(groupRunId))
                .andExpect(jsonPath("$.items[0].title").value("모집 그룹런"))
                .andExpect(jsonPath("$.items[0].hostId").value(hostId))
                .andExpect(jsonPath("$.items[0].status").value("SCHEDULED"))
                .andExpect(jsonPath("$.items[0].goalDistance").value(5000))
                .andExpect(jsonPath("$.items[0].goalDuration").value(1800));

        mockMvc.perform(
                        get("/api/v1/group-runs")
                                .param("crewId", String.valueOf(otherCrewId))
                                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(otherGroupRunId));

        mockMvc.perform(
                        get("/api/v1/group-runs")
                                .param("crewId", String.valueOf(otherCrewId))
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)));
    }

    @Test
    void detail_returnsMeetingPositionGoals_missingNotFound() throws Exception {
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        get("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(groupRunId))
                .andExpect(jsonPath("$.title").value("모집 그룹런"))
                .andExpect(jsonPath("$.hostId").value(hostId))
                .andExpect(jsonPath("$.crewId").value(crewId))
                .andExpect(jsonPath("$.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.meetingPosition.type").value("Point"))
                .andExpect(jsonPath("$.meetingPosition.coordinates[0]").value(129.118))
                .andExpect(jsonPath("$.meetingPosition.coordinates[1]").value(35.153))
                .andExpect(jsonPath("$.meetingPlaceName").value("집결지"))
                .andExpect(jsonPath("$.meetingAddress").value("부산"))
                .andExpect(jsonPath("$.participantCount").value(2))
                .andExpect(jsonPath("$.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.targetDurationSec").value(1800))
                .andExpect(jsonPath("$.goalPaceSecPerKm").value(360));

        mockMvc.perform(
                        get("/api/v1/group-runs/{id}", 9_999_999L)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    void nonMemberCreate_forbidden() throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs")
                                .header("Authorization", SecurityTestSupport.bearer(outsiderId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(createBody(crewId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CREW_FORBIDDEN"));
    }

    @Test
    void join_successThenDuplicate_conflict() throws Exception {
        long groupRunId = createGroupRun(hostId);

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupRunId").value(groupRunId))
                .andExpect(jsonPath("$.userId").value(memberId))
                .andExpect(jsonPath("$.joinedAt").isNotEmpty());

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("FULL_OR_ALREADY_JOINED"));
    }

    @Test
    void leave_nonHostSucceeds_hostRejected() throws Exception {
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        delete("/api/v1/group-runs/{id}/participants/me", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT count(*) FROM group_run_participants
                                WHERE group_run_id=? AND user_id=?
                                """,
                                Integer.class,
                                groupRunId,
                                memberId))
                .isZero();

        mockMvc.perform(
                        delete("/api/v1/group-runs/{id}/participants/me", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    @Test
    void patch_hostTimeGoalDerivesPace_nonHostForbidden() throws Exception {
        long groupRunId = createGroupRun(hostId);

        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "targetDistanceM": 5000,
                                          "goalInputType": "TIME",
                                          "targetDurationSec": 1500
                                        }
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.targetDurationSec").value(1500))
                .andExpect(jsonPath("$.goalPaceSecPerKm").value(300));

        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title":"가로채기"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));
    }

    // S15P31E105-778: G04 PATCH도 G01과 같은 길이 규칙을 DTO에서 검사해 DB 오류(500) 대신 400을 준다.
    @Test
    void patch_overLongTextFields_badRequest_andKeepsRow() throws Exception {
        long groupRunId = createGroupRun(hostId);
        String[] bodies = {
            "{\"title\":\"%s\"}".formatted("가".repeat(101)),
            "{\"description\":\"%s\"}".formatted("a".repeat(10001)),
            "{\"meetingPlaceName\":\"%s\"}".formatted("가".repeat(201)),
            "{\"meetingAddress\":\"%s\"}".formatted("가".repeat(256))
        };
        for (String body : bodies) {
            mockMvc.perform(
                            patch("/api/v1/group-runs/{id}", groupRunId)
                                    .header("Authorization", SecurityTestSupport.bearer(hostId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        String title100 = "가".repeat(100);
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"%s\"}".formatted(title100)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value(title100));
    }

    // S15P31E105-636 AC-2: G07 참가자 프로필 사진 주소. 사진 없는 참가자는 null 키.
    @Test
    void participants_includeProfileImageUrl() throws Exception {
        long groupRunId = createGroupRun(hostId);
        String imageId = "3f4a5b6c-7d8e-4f9a-8b1c-2d3e4f5a6b7c";
        jdbc.update(
                "UPDATE users SET profile_image_key = ? WHERE id = ?",
                "images/profile/" + hostId + "/" + imageId + ".jpg",
                hostId);
        jdbc.update("UPDATE users SET profile_image_key = NULL WHERE id = ?", memberId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());

        String body =
                mockMvc.perform(
                                get("/api/v1/group-runs/{id}/participants", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(memberId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items", hasSize(2)))
                        .andExpect(
                                jsonPath("$.items[?(@.userId==" + hostId + ")].profileImageUrl")
                                        .value("/api/v1/images/" + imageId))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(body).contains("\"profileImageUrl\":null");
    }

    @Test
    void participants_listReadyStatus() throws Exception {
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":true}
                                        """))
                .andExpect(status().isOk());

        MvcResult listed =
                mockMvc.perform(
                                get("/api/v1/group-runs/{id}/participants", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(memberId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items", hasSize(2)))
                        .andExpect(jsonPath("$.items[0].sessionId").isNumber())
                        .andExpect(jsonPath("$.items[0].nickname").isNotEmpty())
                        .andExpect(jsonPath("$.items[1].sessionId").value(nullValue()))
                        .andReturn();
        String body = listed.getResponse().getContentAsString();
        assertThat(body).contains("\"readyStatus\":\"READY\"");
        assertThat(body).contains("\"readyStatus\":\"WAITING\"");
        assertThat(participantSessionId(groupRunId, hostId)).isNotNull();
        assertThat(participantSessionId(groupRunId, memberId)).isNull();
        assertThat(body).contains("\"isHost\":true");
    }

    @Test
    void nonHostPatch_forbidden() throws Exception {
        long groupRunId = createGroupRun(hostId);

        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title":"가로채기"}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_HOST"));
    }

    @Test
    void nonScheduledState_patchJoinReady_conflict() throws Exception {
        long groupRunId = createGroupRun(hostId);
        jdbc.update(
                """
                UPDATE group_runs
                SET status = 'RUNNING'::group_runs_status_enum
                WHERE id = ?
                """,
                groupRunId);

        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title":"이미 출발"}
                                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EDIT_NOT_ALLOWED"));

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":true}
                                        """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));

        mockMvc.perform(
                        delete("/api/v1/group-runs/{id}/participants/me", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RUN_ALREADY_STARTED"));
    }

    @Test
    void hostLeave_conflict() throws Exception {
        long groupRunId = createGroupRun(hostId);

        mockMvc.perform(
                        delete("/api/v1/group-runs/{id}/participants/me", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    @Test
    void nonParticipantReady_forbidden() throws Exception {
        long groupRunId = createGroupRun(hostId);

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":true}
                                        """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_PARTICIPANT"));
    }

    @Test
    void readyToggle_asParticipant() throws Exception {
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId)))
                .andExpect(status().isOk());

        assertThat(participantSessionId(groupRunId, memberId)).isNull();

        MvcResult readyOn =
                mockMvc.perform(
                                post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(memberId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"ready":true}
                                                """))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.readyStatus").value("READY"))
                        .andExpect(jsonPath("$.readyCount").value(1))
                        .andExpect(jsonPath("$.participantCount").value(2))
                        .andExpect(jsonPath("$.sessionId").isNumber())
                        .andReturn();

        long sessionId =
                mapper.readTree(readyOn.getResponse().getContentAsString()).get("sessionId").asLong();
        assertThat(participantSessionId(groupRunId, memberId)).isEqualTo(sessionId);
        String sessionSnapshot =
                jdbc.queryForObject(
                        """
                        SELECT status::text || ':' || goal_distance || ':' || goal_duration
                        FROM running_sessions WHERE id=?
                        """,
                        String.class,
                        sessionId);
        assertThat(sessionSnapshot).isEqualTo("READY:5000:1800");

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":true}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value((int) sessionId));

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(memberId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":false}
                                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readyStatus").value("WAITING"))
                .andExpect(jsonPath("$.readyCount").value(0))
                .andExpect(jsonPath("$.sessionId").value(nullValue()));

        assertThat(participantSessionId(groupRunId, memberId)).isNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT ready FROM group_run_participants WHERE group_run_id=? AND user_id=?",
                                Boolean.class,
                                groupRunId,
                                memberId))
                .isFalse();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM running_sessions WHERE id=?",
                                String.class,
                                sessionId))
                .isEqualTo("CANCELLED");
    }

    @Test
    void readyTrue_withoutDevices_rejected() throws Exception {
        long noDeviceUser = insertUser("gr_api_nodev", "무기기", "01022220009");
        approveMember(crewId, noDeviceUser);
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header(
                                        "Authorization",
                                        SecurityTestSupport.bearer(noDeviceUser)))
                .andExpect(status().isOk());

        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header(
                                        "Authorization",
                                        SecurityTestSupport.bearer(noDeviceUser))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"ready":true}
                                        """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DEVICE_NOT_FOUND"));
        assertThat(participantSessionId(groupRunId, noDeviceUser)).isNull();
    }

    // S15P31E105-779: 출발 시각은 앱과 같이 지금 이후 13일 안(KST 날짜), 05:00~22:00(KST)만 받는다. 생성·PATCH 모두.
    @Test
    void scheduledAt_outsideAppWindow_badRequest_onCreateAndPatch() throws Exception {
        String[] invalid = {
            java.time.Instant.now().minusSeconds(3 * 24 * 3600).toString(),
            "2099-01-01T00:00:00Z",
            GroupRunTestTimes.atKst(14, java.time.LocalTime.of(10, 0)),
            GroupRunTestTimes.atKst(1, java.time.LocalTime.of(4, 30)),
            GroupRunTestTimes.atKst(1, java.time.LocalTime.of(22, 30))
        };
        for (String at : invalid) {
            mockMvc.perform(
                            post("/api/v1/group-runs")
                                    .header("Authorization", SecurityTestSupport.bearer(hostId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            createBody(crewId)
                                                    .replace(
                                                            GroupRunTestTimes.validScheduledAt(),
                                                            at)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        long groupRunId = createGroupRun(hostId);
        for (String at : invalid) {
            mockMvc.perform(
                            patch("/api/v1/group-runs/{id}", groupRunId)
                                    .header("Authorization", SecurityTestSupport.bearer(hostId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"scheduledAt\":\"%s\"}".formatted(at)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        // 경계값은 받는다: 내일 05:00 생성, 300초 목표(아래 테스트), 13일 뒤 22:00 PATCH.
        mockMvc.perform(
                        post("/api/v1/group-runs")
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        createBody(crewId)
                                                .replace(
                                                        GroupRunTestTimes.validScheduledAt(),
                                                        GroupRunTestTimes.atKst(
                                                                1, java.time.LocalTime.of(5, 0)))))
                .andExpect(status().isCreated());
        String lastDay = GroupRunTestTimes.atKst(13, java.time.LocalTime.of(22, 0));
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"scheduledAt\":\"%s\"}".formatted(lastDay)))
                .andExpect(status().isOk());
    }

    // S15P31E105-779: G04는 출발 시각을 바꿀 때만 범위를 본다. 앱 수정 화면은 장소만 고쳐도 scheduledAt을 다시 보내므로,
    // 이미 지난 출발 시각을 그대로 보내면 통과하고 1분이라도 바꾸면 400이다.
    @Test
    void patch_sameScheduledAtOutsideWindow_isAccepted_changedIsRejected() throws Exception {
        long groupRunId = createGroupRun(hostId);
        jdbc.update(
                "UPDATE group_runs SET scheduled_at = '2026-01-01T01:00:00Z' WHERE id = ?",
                groupRunId);
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"scheduledAt":"2026-01-01T01:00:00Z","meetingPlaceName":"새 집결지"}
                                        """))
                .andExpect(status().isOk());
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"scheduledAt":"2026-01-01T01:01:00Z"}
                                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    // S15P31E105-779: TIME 목표 시간은 앱 눈금과 같이 5~180분.
    @Test
    void targetDuration_outsideAppRange_unprocessable() throws Exception {
        for (int seconds : new int[] {299, 10801, 1_000_000_000}) {
            mockMvc.perform(
                            post("/api/v1/group-runs")
                                    .header("Authorization", SecurityTestSupport.bearer(hostId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            createBody(crewId)
                                                    .replace(
                                                            "\"targetDurationSec\":1800",
                                                            "\"targetDurationSec\":" + seconds)))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        }
        long groupRunId = createGroupRun(hostId);
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"targetDistanceM":5000,"goalInputType":"TIME","targetDurationSec":10801}
                                        """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        mockMvc.perform(
                        patch("/api/v1/group-runs/{id}", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"targetDistanceM":5000,"goalInputType":"TIME","targetDurationSec":10800}
                                        """))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/group-runs")
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        createBody(crewId)
                                                .replace(
                                                        "\"targetDurationSec\":1800",
                                                        "\"targetDurationSec\":300")))
                .andExpect(status().isCreated());
    }

    @Test
    void invalidGoal_unprocessable() throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs")
                                .header("Authorization", SecurityTestSupport.bearer(hostId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "title":"잘못된 목표",
                                          "crewId":%d,
                                          "scheduledAt":"%s",
                                          "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                                          "meetingPlaceName":"집결지",
                                          "goalInputType":"TIME",
                                          "targetDistanceM":5000,
                                          "targetDurationSec":-1
                                        }
                                        """
                                                .formatted(crewId, GroupRunTestTimes.validScheduledAt())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
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
                        .andExpect(status().isCreated())
                        .andReturn();
        return mapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
    }

    private static String createBody(long crewId) {
        return """
                {
                  "title":"모집 그룹런",
                  "crewId":%d,
                  "scheduledAt":"%s",
                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                  "meetingPlaceName":"집결지",
                  "meetingAddress":"부산",
                  "targetDistanceM":5000,
                  "goalInputType":"TIME",
                  "targetDurationSec":1800
                }
                """
                .formatted(crewId, GroupRunTestTimes.validScheduledAt());
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

    private long insertDevice(long userId, String type) {
        return jdbc.queryForObject(
                """
                INSERT INTO user_devices(user_id, device_type, linked_at)
                VALUES (?, ?::user_devices_device_type_enum, now())
                RETURNING id
                """,
                Long.class,
                userId,
                type);
    }

    private Long participantSessionId(long groupRunId, long userId) {
        return jdbc.query(
                        """
                        SELECT session_id FROM group_run_participants
                        WHERE group_run_id=? AND user_id=?
                        """,
                        rs -> rs.next() ? rs.getObject(1, Long.class) : null,
                        groupRunId,
                        userId);
    }
}
