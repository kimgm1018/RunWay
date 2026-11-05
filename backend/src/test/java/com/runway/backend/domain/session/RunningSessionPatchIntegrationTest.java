package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S08 — AC-9~AC-16. */
@Testcontainers
class RunningSessionPatchIntegrationTest extends RunningSessionIntegrationSupport {

    private String result(long commandId) {
        return jdbc.queryForObject(
                "SELECT result::text || ':' || coalesce(reason_code,'') FROM session_control_events WHERE id=?",
                String.class,
                commandId);
    }

    // --- UPDATE_GOAL ---

    @Test
    void 출발전_목표를_바꾸면_버전이_오르고_계획이_교체된다() throws Exception {
        long sessionId = insertReadySession();
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":300}"))
                .andExpect(status().isOk());
        long firstPlan = jdbc.queryForObject("SELECT id FROM pace_plans", Long.class);

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":2,\"targetDistanceM\":5000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.goal.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.goal.targetPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(5)))
                .andExpect(jsonPath("$.plan.segments[4].endDistanceM").value(5000.0));

        assertThat(count("SELECT count(*) FROM pace_plans")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans WHERE id=?", firstPlan)).isZero();
        assertThat(stateVersion(sessionId)).isEqualTo(3);
    }

    @Test
    void null은_해제하고_계획이_없어지면_plan_null이다() throws Exception {
        long sessionId = insertReadySession();
        jdbc.update("UPDATE running_sessions SET goal_pace=300 WHERE id=?", sessionId);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.goal.targetPaceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.plan").value(nullValue()))
                .andExpect(jsonPath("$.stateVersion").value(2));
    }

    @Test
    void 같은_목표_재요청은_버전을_올리지_않고_오래된_버전의_다른_변경은_STALE() throws Exception {
        long sessionId = insertReadySession();
        String change = "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}";
        mockMvc.perform(patchRequest(userId, sessionId, change)).andExpect(status().isOk());
        mockMvc.perform(patchRequest(userId, sessionId, change))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(2));
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":7000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 미완료_명령이나_READY가_아니면_목표를_바꿀수_없다() throws Exception {
        long pending = insertReadySession();
        insertCommand(pending, watchId, "SET_BPM", 1, "PENDING");
        mockMvc.perform(
                        patchRequest(
                                userId,
                                pending,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));

        jdbc.update("DELETE FROM session_control_events");
        jdbc.update("UPDATE running_sessions SET status='RUNNING', started_at=now() WHERE id=?", pending);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                pending,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void 같은_목표면_코스가_MERGED로_바뀌어도_200이다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        long sessionId = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", course);
        jdbc.update("UPDATE courses SET status='MERGED' WHERE id=?", course);

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":9,\"courseId\":" + course + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(1));
    }

    @Test
    void 바뀐_목표는_S01과_같은_검증을_받는다() throws Exception {
        long merged = insertCourse("MERGED", "5000");
        long active = insertCourse("ACTIVE", "4000");
        long comparison = insertSession(userId, "COMPLETED", 1, watchId, phoneId, "READY", active);
        long sessionId = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", active);
        jdbc.update("UPDATE running_sessions SET comparison_session_id=? WHERE id=?", comparison, sessionId);

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":1,"
                                        + "\"targetDurationSec\":1,\"targetPaceSecPerKm\":1}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"courseId\":" + merged
                                        + ",\"comparisonSessionId\":null}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
        // 코스를 해제하면서 비교 기록을 남기면 자유러닝 비교가 되므로 거절한다.
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"courseId\":null}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_COMPARISON_SESSION"));
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"courseId\":null,"
                                        + "\"comparisonSessionId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.goal.courseId").value(nullValue()))
                .andExpect(jsonPath("$.goal.comparisonSessionId").value(nullValue()))
                .andExpect(jsonPath("$.stateVersion").value(2));
    }

    @Test
    void 비교_대상과_코스가_그대로면_삭제된_비교_기록도_보존하고_목표만_바꾼다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        long otherCourse = insertCourse("ACTIVE", "3000");
        long comparison = insertSession(userId, "COMPLETED", 1, watchId, phoneId, "READY", course);
        long sessionId = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", course);
        jdbc.update("UPDATE running_sessions SET comparison_session_id=? WHERE id=?", comparison, sessionId);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", comparison);

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":3000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.goal.targetDistanceM").value(3000))
                .andExpect(jsonPath("$.goal.comparisonSessionId").value(comparison))
                .andExpect(jsonPath("$.stateVersion").value(2));
        // 코스가 바뀌면 남겨 둔 비교 기록도 새 조합으로 다시 검사한다.
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":2,\"courseId\":" + otherCourse
                                        + "}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_COMPARISON_SESSION"));
    }

    @Test
    void 코스를_바꾸면_새_코스거리로_계획을_다시_계산한다() throws Exception {
        long before = insertCourse("ACTIVE", "4000");
        long after = insertCourse("ACTIVE", "3000");
        long sessionId = insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", before);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDurationSec\":1200}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(4)))
                .andExpect(jsonPath("$.plan.segments[3].endDistanceM").value(4000.0));

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":2,\"courseId\":" + after + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.goal.courseId").value(after))
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(400.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(3)))
                .andExpect(jsonPath("$.plan.segments[2].endDistanceM").value(3000.0))
                .andExpect(jsonPath("$.plan.segments[*].recommendedPaceSecPerKm", everyItem(is(400.0))))
                .andExpect(jsonPath("$.stateVersion").value(3));
        assertThat(count("SELECT count(*) FROM pace_plans")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isEqualTo(3);
        assertThat(count("SELECT count(*) FROM pace_plan_segments WHERE end_distance=3000")).isEqualTo(1);
    }

    @Test
    void 그룹_연결_세션의_개인_목표_변경은_거절한다() throws Exception {
        long sessionId = insertReadySession();
        joinGroup(insertGroupRun("SCHEDULED", false), userId, sessionId);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{\"expectedVersion\":1}",
                "{\"operation\":\"RESET\",\"expectedVersion\":1}",
                "{\"operation\":\"UPDATE_GOAL\"}",
                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":0}",
                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"deviceId\":1}",
                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":1.5}",
                "{\"operation\":\"REPORT_PREPARED\",\"expectedVersion\":1,\"deviceId\":1,\"ready\":true}",
                "{\"operation\":\"REPORT_PREPARED\",\"expectedVersion\":1,\"deviceId\":1,\"ready\":\"true\",\"reasonCode\":null}",
                "{\"operation\":\"REPORT_PREPARED\",\"expectedVersion\":1,\"ready\":true,\"reasonCode\":null}",
                "{\"operation\":\"TAKE_OVER_PHONE\",\"expectedVersion\":1,\"deviceId\":1}",
                "{\"operation\":\"TAKE_OVER_PHONE\",\"expectedVersion\":1,\"deviceId\":1,\"receivedWatchBatchesUploaded\":true,\"targetDistanceM\":1}",
                "{\"operation\":\"ABORT_UNCONFIRMED_START\",\"expectedVersion\":1}"
            })
    void 작업별_필드가_맞지_않으면_400이다(String body) throws Exception {
        long sessionId = insertReadySession();
        mockMvc.perform(patchRequest(userId, sessionId, body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(stateVersion(sessionId)).isEqualTo(1);
    }

    @Test
    void 타인_세션과_없는_세션() throws Exception {
        long others = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        String body = "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}";
        mockMvc.perform(patchRequest(userId, others, body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"));
        mockMvc.perform(patchRequest(userId, 999999, body))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        assertThat(stateVersion(others)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "abc"})
    void 잘못된_경로_ID는_400이다(String sessionId) throws Exception {
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":5000}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    // --- REPORT_PREPARED ---

    @Test
    void 워치_준비결과는_버전만_확인하고_DB를_바꾸지_않는다() throws Exception {
        long sessionId = insertSession(userId, "READY", 2, watchId, phoneId, "PENDING", null);
        for (String ready : new String[] {"true", "false"}) {
            mockMvc.perform(
                            patchRequest(
                                    userId,
                                    sessionId,
                                    "{\"operation\":\"REPORT_PREPARED\",\"deviceId\":" + watchId
                                            + ",\"expectedVersion\":2,\"ready\":" + ready + ",\"reasonCode\":null}"))
                    .andExpect(status().isOk())
                    .andExpect(content().json("{\"expectedVersion\":2}", true));
        }
        assertThat(stateVersion(sessionId)).isEqualTo(2);

        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"REPORT_PREPARED\",\"deviceId\":" + watchId
                                        + ",\"expectedVersion\":1,\"ready\":true,\"reasonCode\":\"LOW_BATTERY\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"REPORT_PREPARED\",\"deviceId\":" + phoneId
                                        + ",\"expectedVersion\":2,\"ready\":true,\"reasonCode\":null}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));

        jdbc.update("UPDATE running_sessions SET status='RUNNING', started_at=now() WHERE id=?", sessionId);
        mockMvc.perform(
                        patchRequest(
                                userId,
                                sessionId,
                                "{\"operation\":\"REPORT_PREPARED\",\"deviceId\":" + watchId
                                        + ",\"expectedVersion\":2,\"ready\":true,\"reasonCode\":null}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    // --- TAKE_OVER_PHONE ---

    private String takeOver(long expectedVersion, long deviceId, boolean uploaded) {
        return "{\"operation\":\"TAKE_OVER_PHONE\",\"deviceId\":" + deviceId + ",\"expectedVersion\":"
                + expectedVersion + ",\"receivedWatchBatchesUploaded\":" + uploaded + "}";
    }

    @Test
    void 폰_인계는_제어기기를_바꾸고_워치_대기명령을_UNKNOWN으로_남긴다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        jdbc.update("UPDATE running_sessions SET current_bpm=170, goal_distance=5000 WHERE id=?", sessionId);
        long applied = insertCommand(sessionId, watchId, "START", 1, "APPLIED");
        long pause = insertCommand(sessionId, watchId, "PAUSE", 5, "PENDING");
        String startedAt =
                jdbc.queryForObject(
                        "SELECT started_at::text FROM running_sessions WHERE id=?", String.class, sessionId);

        mockMvc.perform(patchRequest(userId, sessionId, takeOver(5, phoneId, true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.controlDeviceId").value(phoneId))
                .andExpect(jsonPath("$.relayDeviceId").value(phoneId))
                .andExpect(jsonPath("$.recordingMode").value("PHONE_FALLBACK"))
                .andExpect(jsonPath("$.currentBpm").value(nullValue()))
                .andExpect(jsonPath("$.stateVersion").value(6))
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.goal.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()))
                .andExpect(jsonPath("$.lastCommand.commandId").value(pause))
                .andExpect(jsonPath("$.lastCommand.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.lastCommand.reasonCode").value("WATCH_DISCONNECTED"));

        assertThat(result(pause)).isEqualTo("UNKNOWN:WATCH_DISCONNECTED");
        assertThat(result(applied)).isEqualTo("APPLIED:");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT control_device_id || ':' || relay_device_id || ':' || status::text"
                                        + " || ':' || coalesce(current_bpm::text,'null')"
                                        + " FROM running_sessions WHERE id=?",
                                String.class,
                                sessionId))
                .isEqualTo(phoneId + ":" + phoneId + ":RUNNING:null");
        assertThat(stateVersion(sessionId)).isEqualTo(6);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT started_at::text FROM running_sessions WHERE id=?",
                                String.class,
                                sessionId))
                .isEqualTo(startedAt);
    }

    @Test
    void 기존_워치_UNKNOWN의_사유는_보존한다() throws Exception {
        long sessionId = insertSession(userId, "PAUSED", 4, watchId, phoneId, "PENDING", null);
        long unknown = insertCommand(sessionId, watchId, "RESUME", 4, "UNKNOWN");
        jdbc.update("UPDATE session_control_events SET reason_code='ACK_TIMEOUT' WHERE id=?", unknown);

        mockMvc.perform(patchRequest(userId, sessionId, takeOver(4, phoneId, true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("PAUSED"));
        assertThat(result(unknown)).isEqualTo("UNKNOWN:ACK_TIMEOUT");
    }

    @Test
    void 인계_재요청은_종료후에도_현재상태를_반환한다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        mockMvc.perform(patchRequest(userId, sessionId, takeOver(5, phoneId, true)))
                .andExpect(status().isOk());
        jdbc.update(
                "UPDATE running_sessions SET status='COMPLETED', ended_at=now(), state_version=8 WHERE id=?",
                sessionId);

        mockMvc.perform(patchRequest(userId, sessionId, takeOver(5, phoneId, true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("COMPLETED"))
                .andExpect(jsonPath("$.stateVersion").value(8));
    }

    @Test
    void 인계_거절_사례() throws Exception {
        long ready = insertReadySession();
        mockMvc.perform(patchRequest(userId, ready, takeOver(1, phoneId, true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        jdbc.update("UPDATE running_sessions SET status='RUNNING', started_at=now(), state_version=5 WHERE id=?", ready);
        mockMvc.perform(patchRequest(userId, ready, takeOver(5, phoneId, false)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UPLOAD_PENDING"));
        mockMvc.perform(patchRequest(userId, ready, takeOver(5, otherPhoneId, true)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        mockMvc.perform(patchRequest(userId, ready, takeOver(5, watchId, true)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        mockMvc.perform(patchRequest(userId, ready, takeOver(4, phoneId, true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
        assertThat(stateVersion(ready)).isEqualTo(5);
    }

    @Test
    void 건강정보_미동의_회원도_인계할수_있다() throws Exception {
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        long sessionId = insertSession(userId, "RUNNING", 5, watchId, phoneId, "PENDING", null);
        mockMvc.perform(patchRequest(userId, sessionId, takeOver(5, phoneId, true)))
                .andExpect(status().isOk());
    }

    // --- ABORT_UNCONFIRMED_START ---

    private String abort(long expectedVersion, long deviceId) {
        return "{\"operation\":\"ABORT_UNCONFIRMED_START\",\"deviceId\":" + deviceId
                + ",\"expectedVersion\":" + expectedVersion + "}";
    }

    @Test
    void 시작_미확인_운동을_중단하고_재요청은_현재상태를_준다() throws Exception {
        long sessionId = insertReadySession();
        jdbc.update("UPDATE running_sessions SET current_bpm=165 WHERE id=?", sessionId);
        long start = insertCommand(sessionId, watchId, "START", 1, "PENDING");

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(patchRequest(userId, sessionId, abort(1, phoneId)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.state").value("INTERRUPTED"))
                    .andExpect(jsonPath("$.analysis.status").value("FAILED"))
                    .andExpect(jsonPath("$.currentBpm").value(nullValue()))
                    .andExpect(jsonPath("$.pendingCommand").value(nullValue()))
                    .andExpect(jsonPath("$.startedAt").value(nullValue()))
                    .andExpect(jsonPath("$.endedAt").value(nullValue()))
                    .andExpect(jsonPath("$.stateVersion").value(2))
                    .andExpect(jsonPath("$.lastCommand.commandId").value(start));
        }
        assertThat(result(start)).isEqualTo("UNKNOWN:START_UNCONFIRMED_ABORTED");

        mockMvc.perform(createRequest(userId, "{" + devices() + "}")).andExpect(status().isCreated());
    }

    @Test
    void 중계폰이_해제됐으면_본인의_새_연결폰으로_중단할수_있다() throws Exception {
        long sessionId = insertReadySession();
        long start = insertCommand(sessionId, watchId, "START", 1, "PENDING");
        jdbc.update("UPDATE user_devices SET unlinked_at=now() WHERE id=?", phoneId);
        long newPhone = insertDevice(userId, "PHONE", false);

        // 해제된 원래 폰, 다른 회원의 폰, 본인 워치는 여전히 거절한다.
        for (long device : new long[] {phoneId, otherPhoneId, watchId}) {
            mockMvc.perform(patchRequest(userId, sessionId, abort(1, device)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        }
        for (int i = 0; i < 2; i++) {
            mockMvc.perform(patchRequest(userId, sessionId, abort(1, newPhone)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.state").value("INTERRUPTED"))
                    .andExpect(jsonPath("$.relayDeviceId").value(phoneId))
                    .andExpect(jsonPath("$.stateVersion").value(2));
        }
        assertThat(result(start)).isEqualTo("UNKNOWN:START_UNCONFIRMED_ABORTED");
    }

    @Test
    void 중계폰이_연결중이면_그_폰만_중단할수_있다() throws Exception {
        long sessionId = insertReadySession();
        insertCommand(sessionId, watchId, "START", 1, "PENDING");
        long secondUser = insertUser("AGREEE");
        long foreignPhone = insertDevice(secondUser, "PHONE", false);
        mockMvc.perform(patchRequest(userId, sessionId, abort(1, foreignPhone)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        assertThat(stateVersion(sessionId)).isEqualTo(1);
    }

    @Test
    void 이미_UNKNOWN인_START도_중단하며_사유를_보존한다() throws Exception {
        long sessionId = insertReadySession();
        long start = insertCommand(sessionId, watchId, "START", 1, "UNKNOWN");
        mockMvc.perform(patchRequest(userId, sessionId, abort(1, phoneId))).andExpect(status().isOk());
        assertThat(result(start)).isEqualTo("UNKNOWN:");
    }

    @Test
    void 시작이_확정됐거나_START가_없으면_중단할수_없다() throws Exception {
        long noStart = insertReadySession();
        mockMvc.perform(patchRequest(userId, noStart, abort(1, phoneId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        // 회원별 활성 세션은 하나뿐이므로(uq_running_sessions_active) 다음 사례 전에 닫는다.
        jdbc.update("UPDATE running_sessions SET status='CANCELLED' WHERE id=?", noStart);

        long running = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        insertCommand(running, watchId, "START", 1, "APPLIED");
        mockMvc.perform(patchRequest(userId, running, abort(2, phoneId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        long stale = insertSession(otherUserId, "READY", 3, otherWatchId, otherPhoneId, "PENDING", null);
        insertCommand(stale, otherWatchId, "START", 3, "PENDING");
        mockMvc.perform(patchRequest(otherUserId, stale, abort(2, otherPhoneId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
        mockMvc.perform(patchRequest(otherUserId, stale, abort(3, otherWatchId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
    }
}
