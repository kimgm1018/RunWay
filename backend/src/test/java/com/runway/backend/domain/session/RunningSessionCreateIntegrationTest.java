package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.testcontainers.junit.jupiter.Testcontainers;

/** S01 — AC-1~AC-6. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class RunningSessionCreateIntegrationTest extends RunningSessionIntegrationSupport {

    private int sessionCount() {
        return count("SELECT count(*) FROM running_sessions");
    }

    @Test
    void 자유러닝_세션은_READY_버전1로_생성된다() throws Exception {
        mockMvc.perform(createRequest(userId, "{" + devices() + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sessionId").isNumber())
                .andExpect(jsonPath("$.controlDeviceId").value(watchId))
                .andExpect(jsonPath("$.relayDeviceId").value(phoneId))
                .andExpect(jsonPath("$.state").value("READY"))
                .andExpect(jsonPath("$.stateVersion").value(1))
                .andExpect(jsonPath("$.currentBpm").value(nullValue()))
                .andExpect(jsonPath("$.startedAt").value(nullValue()))
                .andExpect(jsonPath("$.endedAt").value(nullValue()))
                .andExpect(jsonPath("$.goal.courseId").value(nullValue()))
                .andExpect(jsonPath("$.goal.targetPaceSecPerKm").value(nullValue()))
                .andExpect(jsonPath("$.plan").value(nullValue()))
                .andExpect(jsonPath("$.analysis.status").value("PENDING"))
                .andExpect(jsonPath("$.coaching").value(nullValue()))
                .andExpect(jsonPath("$.pendingCommand").value(nullValue()))
                .andExpect(jsonPath("$.lastCommand").value(nullValue()))
                .andExpect(jsonPath("$.serverReceiveAt").isString())
                .andExpect(jsonPath("$.serverSendAt").isString())
                .andExpect(jsonPath("$.recordingMode").value("WATCH"))
                .andExpect(jsonPath("$.groupEndedAt").value(nullValue()));

        assertThat(
                        count(
                                "SELECT count(*) FROM running_sessions WHERE user_id=? AND status='READY'"
                                        + " AND state_version=1 AND analysis_status='PENDING'",
                                userId))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{\"relayDeviceId\":%2$d}",
                "{\"controlDeviceId\":0,\"relayDeviceId\":%2$d}",
                "{\"controlDeviceId\":-1,\"relayDeviceId\":%2$d}",
                "{\"controlDeviceId\":\"%1$d\",\"relayDeviceId\":%2$d}",
                "{\"controlDeviceId\":%1$d.5,\"relayDeviceId\":%2$d}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetDistanceM\":5000.5}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetDistanceM\":\"5000\"}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetPaceSecPerKm\":300.123}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetPaceSecPerKm\":300.0000000000000001}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetPaceSecPerKm\":123456789}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"targetPaceSecPerKm\":1e400}",
                "{\"controlDeviceId\":%1$d,\"relayDeviceId\":%2$d,\"courseId\":0}",
                "[]"
            })
    void 형식이_틀린_요청은_400이고_세션을_만들지_않는다(String template) throws Exception {
        mockMvc.perform(createRequest(userId, template.formatted(watchId, phoneId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(sessionCount()).isZero();
    }

    @Test
    void 잘못된_JSON은_400이다() throws Exception {
        mockMvc.perform(createRequest(userId, "{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 코스와_시간_목표면_코스거리를_1km_구간으로_나눠_같은_페이스로_계획한다() throws Exception {
        long courseId = insertCourse("ACTIVE", "5000.00");
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"courseId\":" + courseId + ",\"targetDurationSec\":1500}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.goal.courseId").value(courseId))
                .andExpect(jsonPath("$.plan.planId").isNumber())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(5)))
                .andExpect(jsonPath("$.plan.segments[0].sequence").value(1))
                .andExpect(jsonPath("$.plan.segments[0].startDistanceM").value(0))
                .andExpect(jsonPath("$.plan.segments[0].endDistanceM").value(1000.0))
                .andExpect(jsonPath("$.plan.segments[4].sequence").value(5))
                .andExpect(jsonPath("$.plan.segments[4].startDistanceM").value(4000.0))
                .andExpect(jsonPath("$.plan.segments[4].endDistanceM").value(5000.0))
                .andExpect(jsonPath("$.plan.segments[*].recommendedPaceSecPerKm", everyItem(is(300.0))));
        assertThat(count("SELECT count(*) FROM pace_plans WHERE cue_bpm IS NULL AND route_progress IS NULL"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isEqualTo(5);
    }

    @Test
    void 끝거리가_1km로_나누어지지_않으면_마지막_구간이_짧다() throws Exception {
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"targetDistanceM\":2500,\"targetDurationSec\":750}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(3)))
                .andExpect(jsonPath("$.plan.segments[2].startDistanceM").value(2000.0))
                .andExpect(jsonPath("$.plan.segments[2].endDistanceM").value(2500.0))
                .andExpect(jsonPath("$.plan.segments[2].recommendedPaceSecPerKm").value(300.0));
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isEqualTo(3);
    }

    @Test
    void 페이스만_있으면_구간없는_계획이다() throws Exception {
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetPaceSecPerKm\":330.5}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.goal.targetPaceSecPerKm").value(330.5))
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(330.5))
                .andExpect(jsonPath("$.plan.segments", hasSize(0)));
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isZero();
    }

    @Test
    void 페이스는_저장값과_같은_소수둘째자리_표기로_응답한다() throws Exception {
        String body =
                mockMvc.perform(
                                createRequest(
                                        userId, "{" + devices() + ",\"targetPaceSecPerKm\":300}"))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(body)
                .contains("\"targetPaceSecPerKm\":300.00")
                .contains("\"recommendedPaceSecPerKm\":300.00")
                .doesNotContain("E+");
    }

    @Test
    void 거리0_코스와_페이스목표면_구간없이_계획을_만든다() throws Exception {
        long zeroCourse = insertCourse("ACTIVE", "0");
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"courseId\":" + zeroCourse
                                        + ",\"targetPaceSecPerKm\":330}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(330.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(0)));
        assertThat(count("SELECT count(*) FROM pace_plan_segments")).isZero();
    }

    @Test
    void 거리와_시간이면_나눈_페이스를_반올림한다() throws Exception {
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"targetDistanceM\":3000,\"targetDurationSec\":1000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(333.33))
                .andExpect(jsonPath("$.plan.segments", hasSize(3)))
                .andExpect(jsonPath("$.plan.segments[2].endDistanceM").value(3000.0));
    }

    @Test
    void 거리만_있으면_계획이_없다() throws Exception {
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":5000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.goal.targetDistanceM").value(5000))
                .andExpect(jsonPath("$.plan").value(nullValue()));
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                ",\"targetDistanceM\":5000,\"targetDurationSec\":1500,\"targetPaceSecPerKm\":300",
                ",\"targetDistanceM\":0",
                ",\"targetDurationSec\":-1",
                ",\"targetPaceSecPerKm\":0",
                ",\"targetDistanceM\":45001",
                ",\"targetDistanceM\":45001,\"targetDurationSec\":9000"
            })
    void 목표가_모순되거나_양수가_아니면_422_INVALID_GOAL(String goal) throws Exception {
        mockMvc.perform(createRequest(userId, "{" + devices() + goal + "}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        assertThat(sessionCount()).isZero();
    }

    @Test
    void 목표거리_상한_45km는_허용하고_45개_구간으로_계획한다() throws Exception {
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"targetDistanceM\":45000,\"targetDurationSec\":13500}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.plan.recommendedPaceSecPerKm").value(300.0))
                .andExpect(jsonPath("$.plan.segments", hasSize(45)))
                .andExpect(jsonPath("$.plan.segments[44].endDistanceM").value(45000.0));
    }

    @Test
    void 코스거리로_계산한_페이스가_0이면_422_INVALID_GOAL() throws Exception {
        long huge = insertCourse("ACTIVE", "2000000000");
        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"courseId\":" + huge + ",\"targetDurationSec\":1}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        assertThat(sessionCount()).isZero();
    }

    @Test
    void 코스_상태와_존재를_검사한다() throws Exception {
        long merged = insertCourse("MERGED", "5000");
        long blocked = insertCourse("BLOCKED", "5000");
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"courseId\":999999}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COURSE_NOT_FOUND"));
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"courseId\":" + merged + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"courseId\":" + blocked + "}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
        assertThat(sessionCount()).isZero();
    }

    @Test
    void 비교기록은_본인_미삭제_완료_같은코스만_허용한다() throws Exception {
        long course = insertCourse("ACTIVE", "5000");
        long otherCourse = insertCourse("ACTIVE", "3000");
        long valid = insertSession(userId, "COMPLETED", 1, watchId, phoneId, "READY", course);
        long others = insertSession(otherUserId, "COMPLETED", 1, otherWatchId, otherPhoneId, "READY", course);
        long deleted = insertSession(userId, "COMPLETED", 1, watchId, phoneId, "READY", course);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);
        long cancelled = insertSession(userId, "CANCELLED", 1, watchId, phoneId, "PENDING", course);
        long differentCourse =
                insertSession(userId, "COMPLETED", 1, watchId, phoneId, "READY", otherCourse);

        for (long invalid : new long[] {others, deleted, cancelled, differentCourse, 999999}) {
            mockMvc.perform(
                            createRequest(
                                    userId,
                                    "{" + devices() + ",\"courseId\":" + course
                                            + ",\"comparisonSessionId\":" + invalid + "}"))
                    .andExpect(status().isUnprocessableContent())
                    .andExpect(jsonPath("$.code").value("INVALID_COMPARISON_SESSION"));
        }
        // 자유러닝에는 비교 모드가 없다.
        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"comparisonSessionId\":" + valid + "}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_COMPARISON_SESSION"));
        assertThat(count("SELECT count(*) FROM running_sessions WHERE status='READY'")).isZero();

        mockMvc.perform(
                        createRequest(
                                userId,
                                "{" + devices() + ",\"courseId\":" + course
                                        + ",\"comparisonSessionId\":" + valid + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.goal.comparisonSessionId").value(valid));
    }

    @Test
    void 활성_세션이_있으면_409로_기존ID를_알려주고_목표를_덮어쓰지_않는다() throws Exception {
        String first =
                mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":3000}"))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long sessionId = Long.parseLong(first.replaceAll("(?s).*\"sessionId\":(\\d+).*", "$1"));

        mockMvc.perform(createRequest(userId, "{" + devices() + ",\"targetDistanceM\":9000}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ACTIVE_SESSION_EXISTS"))
                .andExpect(jsonPath("$.details.sessionId").value(sessionId));
        assertThat(sessionCount()).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT goal_distance FROM running_sessions WHERE id=?",
                                Integer.class,
                                sessionId))
                .isEqualTo(3000);
    }

    @Test
    void 기존기록_버전0과_종료된_세션은_활성검사에서_제외한다() throws Exception {
        insertSession(userId, "READY", 0, null, null, "LEGACY", null);
        insertSession(userId, "INTERRUPTED", 2, watchId, phoneId, "FAILED", null);
        insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);

        mockMvc.perform(createRequest(userId, "{" + devices() + "}")).andExpect(status().isCreated());
    }

    @Test
    void 회원_잠금을_거치지_않은_경로도_DB가_두번째_활성_세션을_막는다() {
        insertSession(userId, "READY", 0, null, null, "LEGACY", null);
        insertSession(userId, "COMPLETED", 3, watchId, phoneId, "READY", null);
        long deleted = insertSession(userId, "PAUSED", 2, watchId, phoneId, "PENDING", null);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);
        insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);

        assertThatThrownBy(() -> insertSession(userId, "READY", 1, watchId, phoneId, "PENDING", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_running_sessions_active");
    }

    @Test
    void 기기는_본인_연결중_유형일치여야_한다() throws Exception {
        long unlinkedPhone = insertDevice(userId, "PHONE", true);
        String[] bodies = {
            "{\"controlDeviceId\":" + otherWatchId + ",\"relayDeviceId\":" + phoneId + "}",
            "{\"controlDeviceId\":" + watchId + ",\"relayDeviceId\":" + unlinkedPhone + "}",
            "{\"controlDeviceId\":" + phoneId + ",\"relayDeviceId\":" + phoneId + "}",
            "{\"controlDeviceId\":" + watchId + ",\"relayDeviceId\":" + watchId + "}",
            "{\"controlDeviceId\":999999,\"relayDeviceId\":" + phoneId + "}"
        };
        for (String body : bodies) {
            mockMvc.perform(createRequest(userId, body))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("DEVICE_FORBIDDEN"));
        }
        assertThat(sessionCount()).isZero();
    }

    @Test
    void 건강정보_미동의_회원도_세션을_만들수_있다() throws Exception {
        long disagree = insertUser("DISAGREE");
        long watch = insertDevice(disagree, "WATCH", false);
        long phone = insertDevice(disagree, "PHONE", false);
        mockMvc.perform(
                        createRequest(
                                disagree,
                                "{\"controlDeviceId\":" + watch + ",\"relayDeviceId\":" + phone + "}"))
                .andExpect(status().isCreated());
    }

    @Test
    void 인증_없음과_탈퇴회원은_401이다() throws Exception {
        mockMvc.perform(
                        post("/api/v1/running-sessions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{" + devices() + "}"))
                .andExpect(status().isUnauthorized());
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);
        mockMvc.perform(createRequest(userId, "{" + devices() + "}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(sessionCount()).isZero();
    }
}
