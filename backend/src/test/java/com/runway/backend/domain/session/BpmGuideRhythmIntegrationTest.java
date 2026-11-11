package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.service.SessionCoachingService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-706: BPM 안내 설정(user_settings.bpm_guide_enabled)이 꺼져 있으면 세션 스냅샷의 rhythmCueEnabled=false로 워치 리듬
 * 재생을 막는다. 코칭 발행(페이스·BPM 값)은 설정과 무관하게 그대로다. 사용자가 직접 바꾼 BPM(SET_BPM APPLIED)은 재생한다.
 */
@Testcontainers
class BpmGuideRhythmIntegrationTest extends RunningSessionIntegrationSupport {

    @Autowired private SessionCoachingService coachingService;

    private void setBpmGuide(long user, boolean enabled) {
        jdbc.update("DELETE FROM user_settings WHERE user_id=?", user);
        jdbc.update(
                """
                INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,
                    group_notifications_enabled,community_notifications_enabled,
                    location_collection_mode,account_visibility)
                VALUES (?,true,?,false,false,'OFF','PRIVATE')
                """,
                user,
                enabled);
    }

    private long runningSession() {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        return sessionId;
    }

    private void expectRhythm(long sessionId, boolean enabled) throws Exception {
        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rhythmCueEnabled").value(enabled));
    }

    @Test
    void 설정_행이_없으면_기존처럼_리듬을_재생한다() throws Exception {
        expectRhythm(runningSession(), true);
    }

    @Test
    void BPM_안내를_켠_사용자는_리듬을_재생한다() throws Exception {
        setBpmGuide(userId, true);
        expectRhythm(runningSession(), true);
    }

    @Test
    void BPM_안내를_끈_사용자는_리듬을_재생하지_않는다() throws Exception {
        setBpmGuide(userId, false);
        expectRhythm(runningSession(), false);
    }

    @Test
    void 러닝_중_설정을_바꾸면_다음_스냅샷부터_반영된다() throws Exception {
        setBpmGuide(userId, true);
        long sessionId = runningSession();
        expectRhythm(sessionId, true);

        jdbc.update("UPDATE user_settings SET bpm_guide_enabled=false WHERE user_id=?", userId);
        expectRhythm(sessionId, false);

        jdbc.update("UPDATE user_settings SET bpm_guide_enabled=true WHERE user_id=?", userId);
        expectRhythm(sessionId, true);
    }

    @Test
    void 설정이_꺼져도_사용자가_직접_바꾼_BPM은_재생한다() throws Exception {
        setBpmGuide(userId, false);
        long sessionId = runningSession();
        insertCommand(sessionId, watchId, "SET_BPM", 2, "APPLIED");
        expectRhythm(sessionId, true);
    }

    @Test
    void 적용되지_않은_수동_BPM_요청은_예외가_아니다() throws Exception {
        setBpmGuide(userId, false);
        long sessionId = runningSession();
        insertCommand(sessionId, watchId, "SET_BPM", 2, "REJECTED");
        expectRhythm(sessionId, false);
    }

    @Test
    void 그룹런_세션에도_같은_규칙을_쓴다() throws Exception {
        setBpmGuide(userId, false);
        long sessionId = runningSession();
        joinGroup(insertGroupRun("RUNNING", false), userId, sessionId);
        expectRhythm(sessionId, false);

        jdbc.update("UPDATE user_settings SET bpm_guide_enabled=true WHERE user_id=?", userId);
        expectRhythm(sessionId, true);
    }

    @Test
    void 설정이_꺼져도_코칭_페이스와_BPM_발행은_그대로다() throws Exception {
        setBpmGuide(userId, false);
        long sessionId = runningSession();

        SessionControlEvent command = coachingService.issueIfDue(sessionId).orElseThrow();

        // 기존 발행과 같은 값(SessionCoachingIntegrationTest): 기준 페이스 400초/km, AI BPM 160.
        assertThat(command.getAction().name()).isEqualTo("COACHING");
        assertThat(command.getTargetBpm()).isEqualTo(160);
        mockMvc.perform(getRequest(userId, sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coaching.commandId").value(command.getId()))
                .andExpect(jsonPath("$.coaching.recommendedPaceSecPerKm").value(400.0))
                .andExpect(jsonPath("$.coaching.targetBpm").value(160))
                .andExpect(jsonPath("$.rhythmCueEnabled").value(false));
    }
}
