package com.runway.backend.domain.coaching.decide;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.coaching.decide.PaceDecision.Action;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** 발행 규칙 — 421 플랜 AC-4·AC-5·AC-11(T-7). 모든 값은 합성 데이터다. */
class CoachingPublishRuleTest {

    private static final Instant NOW = Instant.parse("2026-11-05T03:00:00Z");
    private static final BigDecimal GUIDE = new BigDecimal("360.00");
    private static final long VERSION = 4;

    private static PaceDecision decision(boolean suggested, Action action, String pace, Integer bpm) {
        return new PaceDecision(
                suggested, action, new BigDecimal(pace), bpm, null, null, null, null, VERSION,
                NOW.plusSeconds(20));
    }

    /** 2분 전, 마지막 적용 60초 전, 입력 2초 전. */
    private static java.util.Optional<CoachingPublishRule.Publish> early(PaceDecision d, Integer currentBpm) {
        return CoachingPublishRule.evaluate(
                d, VERSION, NOW.minusSeconds(2), GUIDE, currentBpm, false, false, false, NOW.minusSeconds(60), NOW);
    }

    @Test
    void 두_분_재평가에는_유지_안내도_보낸다() {
        var publish =
                CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "360.00", 165), VERSION,
                        NOW.minusSeconds(2), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
            assertThat(p.targetBpm()).isEqualTo(165);
            // min(지금 + 20초, 입력 + 20초, AI 만료)
            assertThat(p.expiresAt()).isEqualTo(NOW.plusSeconds(18));
        });
    }

    @Test
    void 두_분_유지_안내는_AI가_제안하지_않으면_현재_안내_페이스와_BPM을_그대로_보낸다() {
        // AI는 5초 빠른 페이스·다른 BPM을 골랐지만 조정을 제안하지 않았다.
        var publish =
                CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "355.00", 170), VERSION,
                        NOW.minusSeconds(2), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
            assertThat(p.targetBpm()).isEqualTo(165);
            assertThat(p.followsDecision()).isFalse();
        });
    }

    @Test
    void 현재_BPM이_없으면_두_분_재평가에서_AI_판단을_그대로_보낸다() {
        var publish =
                CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "355.00", 170), VERSION,
                        NOW.minusSeconds(2), GUIDE, null, false, false, true, NOW.minusSeconds(130), NOW);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("355.00");
            assertThat(p.targetBpm()).isEqualTo(170);
            assertThat(p.followsDecision()).isTrue();
        });
    }

    @Test
    void 두_분_재평가에서도_이어지는_감속_권고는_10초_이상_느릴_때만_따른다() {
        var small = decision(true, Action.EASE_OFF, "365.00", 160);
        var big = decision(true, Action.EASE_OFF, "375.00", 160);

        // 직전도 감속 권고이고 5초만 느리면 현재 안내를 유지한다.
        assertThat(CoachingPublishRule.evaluate(
                        small, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, true, true,
                        NOW.minusSeconds(130), NOW))
                .get()
                .satisfies(p -> {
                    assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
                    assertThat(p.targetBpm()).isEqualTo(165);
                    assertThat(p.followsDecision()).isFalse();
                });
        // 15초 느리면 감속 권고를 따른다.
        assertThat(CoachingPublishRule.evaluate(
                        big, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, true, true,
                        NOW.minusSeconds(130), NOW))
                .get()
                .satisfies(p -> assertThat(p.recommendedPace()).isEqualByComparingTo("375.00"));
        // 첫 감속 권고면 차이가 작아도 따른다.
        assertThat(CoachingPublishRule.evaluate(
                        small, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, true,
                        NOW.minusSeconds(130), NOW))
                .get()
                .satisfies(p -> assertThat(p.recommendedPace()).isEqualByComparingTo("365.00"));
    }

    @Test
    void 두_분_재평가에서_AI가_제안하면_AI_판단을_보낸다() {
        var publish =
                CoachingPublishRule.evaluate(
                        decision(true, Action.GUIDE_PACE, "355.00", 170), VERSION,
                        NOW.minusSeconds(2), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("355.00");
            assertThat(p.targetBpm()).isEqualTo(170);
            assertThat(p.followsDecision()).isTrue();
        });
    }

    @Test
    void 사용자가_BPM을_직접_바꿨으면_AI_BPM으로_덮어쓰지_않는다() {
        var change = decision(true, Action.GUIDE_PACE, "350.00", 172);

        var publish =
                CoachingPublishRule.evaluate(
                        change, VERSION, NOW.minusSeconds(2), GUIDE, 158, true, false, false,
                        NOW.minusSeconds(60), NOW);

        // 페이스만 AI를 따르고 BPM은 사용자가 정한 158을 유지한다.
        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("350.00");
            assertThat(p.targetBpm()).isEqualTo(158);
        });
        // 페이스도 같으면 바뀌는 것이 없으므로 보내지 않는다.
        var samePace = decision(true, Action.GUIDE_PACE, "360.00", 172);
        assertThat(CoachingPublishRule.evaluate(
                        samePace, VERSION, NOW.minusSeconds(2), GUIDE, 158, true, false, false,
                        NOW.minusSeconds(60), NOW))
                .isEmpty();
    }

    @Test
    void 두_분_전에는_AI가_제안하고_내용이_다를_때만_보낸다() {
        assertThat(early(decision(false, Action.GUIDE_PACE, "355.00", 165), 165)).isEmpty();
        assertThat(early(decision(true, Action.GUIDE_PACE, "360.00", 165), 165)).isEmpty();
        assertThat(early(decision(true, Action.GUIDE_PACE, "355.00", 165), 165)).isPresent();
        assertThat(early(decision(true, Action.GUIDE_PACE, "360.00", 170), 165)).isPresent();
    }

    @Test
    void 두_분_전_변경은_마지막_적용_후_30초가_지나야_보내고_EASE_OFF는_예외다() {
        var change = decision(true, Action.GUIDE_PACE, "355.00", 165);
        var easeOff = decision(true, Action.EASE_OFF, "390.00", 160);
        Instant applied10sAgo = NOW.minusSeconds(10);

        assertThat(CoachingPublishRule.evaluate(
                        change, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, false, applied10sAgo, NOW))
                .isEmpty();
        assertThat(CoachingPublishRule.evaluate(
                        change, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, false, NOW.minusSeconds(30), NOW))
                .isPresent();
        assertThat(CoachingPublishRule.evaluate(
                        easeOff, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, false, applied10sAgo, NOW))
                .isPresent();
    }

    @Test
    void 감속_권고가_이어지면_30초_간격과_10초_이상_차이를_지킨다() {
        Instant applied10sAgo = NOW.minusSeconds(10);
        Instant applied40sAgo = NOW.minusSeconds(40);
        // 지금 안내(360)보다 30초 느린 감속 권고
        var bigStep = decision(true, Action.EASE_OFF, "390.00", 160);
        // 지금 안내보다 5초만 느린 감속 권고
        var smallStep = decision(true, Action.EASE_OFF, "365.00", 160);

        // 첫 감속 권고는 30초 안이어도 보낸다.
        assertThat(CoachingPublishRule.evaluate(
                        bigStep, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, false,
                        applied10sAgo, NOW))
                .isPresent();
        // 직전도 감속 권고였으면 30초 안에는 보내지 않는다.
        assertThat(CoachingPublishRule.evaluate(
                        bigStep, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, true, false,
                        applied10sAgo, NOW))
                .isEmpty();
        // 30초가 지나고 10초/km 이상 느리면 보낸다.
        assertThat(CoachingPublishRule.evaluate(
                        bigStep, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, true, false,
                        applied40sAgo, NOW))
                .isPresent();
        // 30초가 지나도 10초/km 미만 차이면 보내지 않는다.
        assertThat(CoachingPublishRule.evaluate(
                        smallStep, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, true, false,
                        applied40sAgo, NOW))
                .isEmpty();
        // 첫 감속 권고에는 차이 하한을 두지 않는다.
        assertThat(CoachingPublishRule.evaluate(
                        smallStep, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, false,
                        applied10sAgo, NOW))
                .isPresent();
    }

    @Test
    void cueBpm이_없으면_현재_BPM을_쓰고_그것도_없으면_보내지_않는다() {
        var noBpm = decision(true, Action.GUIDE_PACE, "355.00", null);

        assertThat(early(noBpm, 168)).get().extracting(CoachingPublishRule.Publish::targetBpm).isEqualTo(168);
        assertThat(early(noBpm, null)).isEmpty();
    }

    @Test
    void NOT_RUNNING과_다른_버전_판단은_보내지_않는다() {
        assertThat(early(decision(true, Action.NOT_RUNNING, "355.00", 165), 165)).isEmpty();
        var otherVersion =
                new PaceDecision(true, Action.GUIDE_PACE, new BigDecimal("355.00"), 165, null, null,
                        null, null, VERSION - 1, NOW.plusSeconds(20));
        assertThat(early(otherVersion, 165)).isEmpty();
    }

    @Test
    void 남은_유효시간이_5초_미만이면_보내지_않는다() {
        // 입력 기준시각이 16초 전이면 4초 남는다.
        assertThat(CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "360.00", 165), VERSION,
                        NOW.minusSeconds(16), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW))
                .isEmpty();
        assertThat(CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "360.00", 165), VERSION,
                        NOW.minusSeconds(15), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW))
                .isPresent();
    }

    @Test
    void 이미_만료된_판단은_보내지_않는다() {
        // 입력 기준시각 + 20초가 지금이다.
        assertThat(CoachingPublishRule.evaluate(
                        decision(false, Action.GUIDE_PACE, "360.00", 165), VERSION,
                        NOW.minusSeconds(20), GUIDE, 165, false, false, true, NOW.minusSeconds(130), NOW))
                .isEmpty();
        var aiExpired =
                new PaceDecision(false, Action.GUIDE_PACE, GUIDE, 165, null, null, null, null,
                        VERSION, NOW);
        assertThat(CoachingPublishRule.evaluate(
                        aiExpired, VERSION, NOW.minusSeconds(2), GUIDE, 165, false, false, true,
                        NOW.minusSeconds(130), NOW))
                .isEmpty();
    }
}
