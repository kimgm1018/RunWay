package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.global.security.SecurityTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.util.Optional;

/** C12 출발 전 코스 페이스 계획 미리보기(S15P31E105-733): S01과 같은 계획 준비, 저장 없음. */
class CoursePacePlanIntegrationTest extends RunningSessionIntegrationSupport {
    @org.springframework.beans.factory.annotation.Autowired
    private com.runway.backend.domain.device.service.ConsentService consentService;

    private MockHttpServletRequestBuilder planRequest(long user, long course, String query) {
        return get("/api/v1/courses/" + course + "/pace-plan" + query)
                .header("Authorization", SecurityTestSupport.bearer(user));
    }

    @Test
    void noGoal_returnsAiKmPlanWithoutStoringAnything() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        mockMvc.perform(planRequest(userId, course, ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseId").value(course))
                .andExpect(jsonPath("$.recommendedPaceSecPerKm").value(360))
                .andExpect(jsonPath("$.segments.length()").value(3))
                .andExpect(jsonPath("$.segments[0].sequence").value(1))
                .andExpect(jsonPath("$.segments[2].endDistanceM").value(2500))
                .andExpect(jsonPath("$.personalized").value(true));
        assertThat(personalPlan.calls.get()).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_sessions")).isZero();
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @Test
    void timeGoal_keepsTheUsersMeanAndFallsBackToCourseRatiosWhenAiHasNoPlan() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        // The fake AI returns nothing for a timed goal, so the plan uses course ratios and is not personal.
        mockMvc.perform(planRequest(userId, course, "?targetDurationSec=900"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendedPaceSecPerKm").value(360))
                .andExpect(jsonPath("$.segments.length()").value(3))
                .andExpect(jsonPath("$.personalized").value(false));
    }

    @Test
    void timeAndPaceTogether_isAnInvalidGoal() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        mockMvc.perform(planRequest(userId, course, "?targetDurationSec=900&targetPaceSecPerKm=360"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_GOAL"));
        assertThat(personalPlan.calls.get()).isZero();
    }

    @Test
    void paceWithMoreThanTwoDecimals_isAValidationError() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        mockMvc.perform(planRequest(userId, course, "?targetPaceSecPerKm=360.123"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonConsentingUser_getsThePopulationPlanMarkedNotPersonal() throws Exception {
        consentService.change(userId, false);
        long course = insertCourse("ACTIVE", "2500");
        mockMvc.perform(planRequest(userId, course, ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.segments.length()").value(3))
                .andExpect(jsonPath("$.personalized").value(false));
    }

    @Test
    void aiUnavailableWithoutGoal_is503() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        personalPlan.answer = (u, g) -> Optional.empty();
        mockMvc.perform(planRequest(userId, course, "")).andExpect(status().isServiceUnavailable());
    }

    @Test
    void missingOrInactiveCourseAndNoToken_areRejected() throws Exception {
        long deleted = insertCourse("BLOCKED", "2500");
        mockMvc.perform(planRequest(userId, deleted, ""))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
        mockMvc.perform(planRequest(userId, 99_999_999L, "")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/courses/" + deleted + "/pace-plan"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anotherUsersPrivateCourse_isInaccessibleWithoutCallingAi() throws Exception {
        long course = insertCourse("ACTIVE", "2500");
        jdbc.update("UPDATE courses SET is_private=true, creator_id=? WHERE id=?", otherUserId, course);
        mockMvc.perform(planRequest(userId, course, ""))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COURSE_INACCESSIBLE"));
        assertThat(personalPlan.calls.get()).isZero();
        mockMvc.perform(planRequest(otherUserId, course, "")).andExpect(status().isOk());
    }

    @Test
    void anActiveSessionDoesNotBlockThePreview() throws Exception {
        insertReadySession();
        long course = insertCourse("ACTIVE", "1000");
        mockMvc.perform(planRequest(userId, course, "")).andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM running_sessions")).isEqualTo(1);
    }
}
