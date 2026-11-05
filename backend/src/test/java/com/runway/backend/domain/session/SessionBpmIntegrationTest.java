package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** P07 세션 BPM 조절 — 작업 계획 AC-6·AC-7·AC-8·AC-11. 모든 값은 합성 데이터다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class SessionBpmIntegrationTest extends RunningSessionIntegrationSupport {

    private static final String T1 = "2026-10-28T01:00:01Z";

    private long running() {
        return insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
    }

    private long approve(long sessionId, long version, int bpm) throws Exception {
        String body =
                mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, version, bpm)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return Long.parseLong(body.replaceAll(".*\"commandId\":(\\d+).*", "$1"));
    }

    // ---- AC-6 REQUEST 입력·상태 검사 ----

    @ParameterizedTest
    @ValueSource(strings = {"READY", "RUNNING", "PAUSED"})
    void 준비_운동중_일시정지에서_SET_BPM을_승인한다(String state) throws Exception {
        long sessionId = insertSession(userId, state, 2, watchId, phoneId, "PENDING", null);

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("SET_BPM"))
                .andExpect(jsonPath("$.expectedVersion").value(2))
                .andExpect(jsonPath("$.targetBpm").value(165))
                .andExpect(jsonPath("$.coachingId").value(nullValue()))
                .andExpect(jsonPath("$.result").value("PENDING"));

        assertThat(stateVersion(sessionId)).isEqualTo(2);
        assertThat(currentBpm(sessionId)).isNull();
        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(ints = {60, 220})
    void BPM_경계값_60과_220을_허용한다(int bpm) throws Exception {
        long sessionId = running();

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, bpm)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetBpm").value(bpm));
    }

    @ParameterizedTest
    @ValueSource(strings = {"59", "221", "165.5", "\"165\"", "null"})
    void 범위_밖이거나_정수가_아닌_BPM은_400(String bpm) throws Exception {
        long sessionId = running();

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, bpm)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 앱의_COACHING_요청과_coachingId_지정과_누락은_400() throws Exception {
        long sessionId = running();
        String coaching =
                "{\"phase\":\"REQUEST\",\"operation\":\"COACHING\",\"deviceId\":" + watchId
                        + ",\"expectedVersion\":2,\"targetBpm\":165,\"coachingId\":1}";
        String withCoachingId = bpmRequestBody(watchId, 2, 165).replace("\"coachingId\":null", "\"coachingId\":1");
        String missingCoachingId = bpmRequestBody(watchId, 2, 165).replace(",\"coachingId\":null", "");

        for (String body : new String[] {coaching, withCoachingId, missingCoachingId}) {
            mockMvc.perform(putBpm(userId, sessionId, body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        assertThat(commandCount(sessionId)).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"COMPLETED", "CANCELLED"})
    void 끝난_세션은_409_INVALID_SESSION_STATE(String state) throws Exception {
        long sessionId = insertSession(userId, state, 2, watchId, phoneId, "PENDING", null);

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void 폰_기록_전환_세션은_409_COACHING_UNAVAILABLE() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 3, phoneId, phoneId, "PENDING", null);

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(phoneId, 3, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COACHING_UNAVAILABLE"));
        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 3, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COACHING_UNAVAILABLE"));
        assertThat(commandCount(sessionId)).isZero();
    }

    @Test
    void 버전_불일치는_409_STALE_STATE() throws Exception {
        long sessionId = running();

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 1, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"));
    }

    @Test
    void 미확정_명령이_있으면_409_COMMAND_PENDING() throws Exception {
        long sessionId = running();
        insertCommand(sessionId, watchId, "PAUSE", 1, "UNKNOWN");

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_PENDING"));
    }

    @Test
    void 제어기기가_아닌_기기와_타인_세션은_403() throws Exception {
        long sessionId = running();

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(phoneId, 2, 165)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        mockMvc.perform(putBpm(otherUserId, sessionId, bpmRequestBody(otherWatchId, 2, 165)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SESSION_FORBIDDEN"));
        mockMvc.perform(putBpm(userId, 999_999_999L, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
    }

    @Test
    void 건강정보_미동의여도_수동_BPM은_승인한다() throws Exception {
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        long sessionId = running();

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("PENDING"));
    }

    // ---- AC-7 REQUEST 멱등 ----

    @Test
    void 같은_요청_재전송은_같은_명령을_돌려주고_다른_BPM은_409() throws Exception {
        long sessionId = running();
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("PENDING"));
        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 170)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));
        assertThat(commandCount(sessionId)).isEqualTo(1);

        // 적용 뒤의 재전송도 새 명령을 만들지 않고 저장된 결과를 돌려준다.
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(status().isOk());
        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("APPLIED"));
        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 같은_슬롯의_다른_종류_명령은_409_COMMAND_CONFLICT() throws Exception {
        long sessionId = running();
        insertCommand(sessionId, watchId, "PAUSE", 2, "PENDING");

        mockMvc.perform(putBpm(userId, sessionId, bpmRequestBody(watchId, 2, 165)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));
    }

    // ---- AC-8 RESULT 저장 ----

    private String bpmResult(long commandId, String result, String appliedAt) {
        return resultBody(commandId, watchId, result, appliedAt);
    }

    @Test
    void APPLIED는_BPM을_확정하고_버전을_1_올린다() throws Exception {
        long sessionId = running();
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(commandId))
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.persisted").value(true))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.currentBpm").value(165))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()))
                .andExpect(jsonPath("$.lastCommand.appliedAt").value(T1));

        // 같은 결과 재전송은 같은 응답이며 버전을 더 올리지 않는다.
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateVersion").value(3));
        // 확정 뒤 다른 결과는 충돌, UNKNOWN은 기존 결과를 돌려준다.
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "REJECTED", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COMMAND_CONFLICT"));
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "UNKNOWN", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));
        assertThat(stateVersion(sessionId)).isEqualTo(3);
    }

    @Test
    void 같은_BPM의_새_명령도_버전은_올린다() throws Exception {
        long sessionId = running();
        jdbc.update("UPDATE running_sessions SET current_bpm=165 WHERE id=?", sessionId);
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.currentBpm").value(165));
    }

    @Test
    void REJECTED는_BPM을_유지하고_버전만_올린다() throws Exception {
        long sessionId = running();
        jdbc.update("UPDATE running_sessions SET current_bpm=160 WHERE id=?", sessionId);
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "REJECTED", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("REJECTED"))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.currentBpm").value(160));
    }

    @Test
    void UNKNOWN은_상태와_버전을_바꾸지_않는다() throws Exception {
        long sessionId = running();
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "UNKNOWN", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UNKNOWN"))
                .andExpect(jsonPath("$.stateVersion").value(2))
                .andExpect(jsonPath("$.currentBpm").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand.result").value("UNKNOWN"));
        // UNKNOWN 뒤의 확정 결과는 저장한다.
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.currentBpm").value(165));
    }

    @Test
    void SET_BPM에_IGNORED는_400이고_PENDING_보고도_400() throws Exception {
        long sessionId = running();
        long commandId = approve(sessionId, 2, 165);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "IGNORED", null)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "PENDING", null)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", null)))
                .andExpect(status().isBadRequest());
        assertThat(stateVersion(sessionId)).isEqualTo(2);
    }

    @Test
    void 없는_명령과_다른_종류_명령은_404_COMMAND_NOT_FOUND() throws Exception {
        long sessionId = running();
        long pause = insertCommand(sessionId, watchId, "PAUSE", 2, "PENDING");

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(999_999_999L, "APPLIED", T1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMAND_NOT_FOUND"));
        mockMvc.perform(putBpm(userId, sessionId, bpmResult(pause, "APPLIED", T1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMMAND_NOT_FOUND"));
    }

    @Test
    void 폰_인계_뒤_이전_워치의_미저장_결과는_409_CONTROL_DEVICE_CHANGED() throws Exception {
        long sessionId = running();
        long commandId = approve(sessionId, 2, 165);
        jdbc.update(
                "UPDATE running_sessions SET control_device_id=?, state_version=3 WHERE id=?",
                phoneId,
                sessionId);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(commandId, "APPLIED", T1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_DEVICE_CHANGED"));
        assertThat(currentBpm(sessionId)).isNull();
    }

    // ---- AC-11 COACHING 결과 저장 ----

    @Test
    void 코칭_APPLIED는_추천_BPM을_확정하고_버전을_올린다() throws Exception {
        long sessionId = running();
        long[] coaching = insertCoaching(sessionId, watchId, 2, 168, "PENDING", false);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(coaching[1], "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.currentBpm").value(168))
                .andExpect(jsonPath("$.coaching").value(nullValue()));
    }

    @Test
    void 만료된_코칭의_IGNORED도_저장하고_BPM은_유지한다() throws Exception {
        long sessionId = running();
        jdbc.update("UPDATE running_sessions SET current_bpm=160 WHERE id=?", sessionId);
        long[] coaching = insertCoaching(sessionId, watchId, 2, 168, "PENDING", true);
        String ignored =
                "{\"phase\":\"RESULT\",\"commandId\":" + coaching[1] + ",\"deviceId\":" + watchId
                        + ",\"result\":\"IGNORED\",\"appliedAt\":null,\"reasonCode\":\"GUIDE_STALE\"}";

        mockMvc.perform(putBpm(userId, sessionId, ignored))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("IGNORED"))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.currentBpm").value(160))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()));
        mockMvc.perform(putBpm(userId, sessionId, ignored))
                .andExpect(jsonPath("$.stateVersion").value(3));
    }

    @Test
    void 만료된_코칭의_APPLIED도_결과는_저장한다() throws Exception {
        long sessionId = running();
        long[] coaching = insertCoaching(sessionId, watchId, 2, 168, "PENDING", true);

        mockMvc.perform(putBpm(userId, sessionId, bpmResult(coaching[1], "APPLIED", T1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentBpm").value(168))
                .andExpect(jsonPath("$.stateVersion").value(3));
    }
}
