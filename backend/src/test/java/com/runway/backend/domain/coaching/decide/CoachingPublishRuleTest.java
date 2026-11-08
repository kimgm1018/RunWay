package com.runway.backend.domain.coaching.decide;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.coaching.decide.PaceDecision.Action;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** 발행 규칙 — 421 플랜 AC-4·AC-5·AC-11(T-7)과 503 coachingLevel. 모든 값은 합성 데이터다. */
class CoachingPublishRuleTest {

    private static final Instant NOW = Instant.parse("2026-11-05T03:00:00Z");
    private static final BigDecimal GUIDE = new BigDecimal("360.00");
    private static final long VERSION = 4;

    private static PaceDecision decision(boolean suggested, Action action, String pace, Integer bpm) {
        return decision(suggested, action, pace, bpm, null);
    }

    private static PaceDecision decision(
            boolean suggested, Action action, String pace, Integer bpm, CoachingLevel level) {
        return new PaceDecision(
                suggested,
                action,
                new BigDecimal(pace),
                bpm,
                null,
                null,
                null,
                null,
                VERSION,
                NOW.plusSeconds(20),
                level);
    }

    private static java.util.Optional<CoachingPublishRule.Publish> eval(
            PaceDecision d,
            Integer currentBpm,
            boolean manualBpm,
            boolean previousEaseOff,
            boolean reevaluationDue,
            Instant lastAppliedAt,
            CoachingLevel lastAppliedLevel) {
        return CoachingPublishRule.evaluate(
                d,
                VERSION,
                NOW.minusSeconds(2),
                GUIDE,
                currentBpm,
                manualBpm,
                previousEaseOff,
                reevaluationDue,
                lastAppliedAt,
                lastAppliedLevel,
                NOW);
    }

    /** 2분 전, 마지막 적용 60초 전, 입력 2초 전. */
    private static java.util.Optional<CoachingPublishRule.Publish> early(
            PaceDecision d, Integer currentBpm) {
        return eval(d, currentBpm, false, false, false, NOW.minusSeconds(60), null);
    }

    @Test
    void 두_분_재평가에는_유지_안내도_보낸다() {
        var publish =
                eval(
                        decision(false, Action.GUIDE_PACE, "360.00", 165),
                        165,
                        false,
                        false,
                        true,
                        NOW.minusSeconds(130),
                        null);

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
                eval(
                        decision(false, Action.GUIDE_PACE, "355.00", 170),
                        165,
                        false,
                        false,
                        true,
                        NOW.minusSeconds(130),
                        null);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
            assertThat(p.targetBpm()).isEqualTo(165);
            assertThat(p.followsDecision()).isFalse();
        });
    }

    @Test
    void 현재_BPM이_없으면_두_분_재평가에서_AI_판단을_그대로_보낸다() {
        var publish =
                eval(
                        decision(false, Action.GUIDE_PACE, "355.00", 170),
                        null,
                        false,
                        false,
                        true,
                        NOW.minusSeconds(130),
                        null);

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
        assertThat(eval(small, 165, false, true, true, NOW.minusSeconds(130), null))
                .get()
                .satisfies(p -> {
                    assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
                    assertThat(p.targetBpm()).isEqualTo(165);
                    assertThat(p.followsDecision()).isFalse();
                });
        // 15초 느리면 감속 권고를 따른다.
        assertThat(eval(big, 165, false, true, true, NOW.minusSeconds(130), null))
                .get()
                .satisfies(p -> assertThat(p.recommendedPace()).isEqualByComparingTo("375.00"));
        // 첫 감속 권고면 차이가 작아도 따른다.
        assertThat(eval(small, 165, false, false, true, NOW.minusSeconds(130), null))
                .get()
                .satisfies(p -> assertThat(p.recommendedPace()).isEqualByComparingTo("365.00"));
    }

    @Test
    void 두_분_재평가에서_AI가_제안하면_AI_판단을_보낸다() {
        var publish =
                eval(
                        decision(true, Action.GUIDE_PACE, "355.00", 170),
                        165,
                        false,
                        false,
                        true,
                        NOW.minusSeconds(130),
                        null);

        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("355.00");
            assertThat(p.targetBpm()).isEqualTo(170);
            assertThat(p.followsDecision()).isTrue();
        });
    }

    @Test
    void 사용자가_BPM을_직접_바꿨으면_AI_BPM으로_덮어쓰지_않는다() {
        var change = decision(true, Action.GUIDE_PACE, "350.00", 172);

        var publish = eval(change, 158, true, false, false, NOW.minusSeconds(60), null);

        // 페이스만 AI를 따르고 BPM은 사용자가 정한 158을 유지한다.
        assertThat(publish).get().satisfies(p -> {
            assertThat(p.recommendedPace()).isEqualByComparingTo("350.00");
            assertThat(p.targetBpm()).isEqualTo(158);
        });
        // 페이스도 같으면 바뀌는 것이 없으므로 보내지 않는다.
        var samePace = decision(true, Action.GUIDE_PACE, "360.00", 172);
        assertThat(eval(samePace, 158, true, false, false, NOW.minusSeconds(60), null)).isEmpty();
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

        assertThat(eval(change, 165, false, false, false, applied10sAgo, null)).isEmpty();
        assertThat(eval(change, 165, false, false, false, NOW.minusSeconds(30), null)).isPresent();
        assertThat(eval(easeOff, 165, false, false, false, applied10sAgo, null)).isPresent();
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
        assertThat(eval(bigStep, 165, false, false, false, applied10sAgo, null)).isPresent();
        // 직전도 감속 권고였으면 30초 안에는 보내지 않는다.
        assertThat(eval(bigStep, 165, false, true, false, applied10sAgo, null)).isEmpty();
        // 30초가 지나고 10초/km 이상 느리면 보낸다.
        assertThat(eval(bigStep, 165, false, true, false, applied40sAgo, null)).isPresent();
        // 30초가 지나도 10초/km 미만 차이면 보내지 않는다.
        assertThat(eval(smallStep, 165, false, true, false, applied40sAgo, null)).isEmpty();
        // 첫 감속 권고에는 차이 하한을 두지 않는다.
        assertThat(eval(smallStep, 165, false, false, false, applied10sAgo, null)).isPresent();
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
                new PaceDecision(
                        true,
                        Action.GUIDE_PACE,
                        new BigDecimal("355.00"),
                        165,
                        null,
                        null,
                        null,
                        null,
                        VERSION - 1,
                        NOW.plusSeconds(20),
                        null);
        assertThat(early(otherVersion, 165)).isEmpty();
    }

    @Test
    void 남은_유효시간이_5초_미만이면_보내지_않는다() {
        // 입력 기준시각이 16초 전이면 4초 남는다.
        assertThat(
                        CoachingPublishRule.evaluate(
                                decision(false, Action.GUIDE_PACE, "360.00", 165),
                                VERSION,
                                NOW.minusSeconds(16),
                                GUIDE,
                                165,
                                false,
                                false,
                                true,
                                NOW.minusSeconds(130),
                                null,
                                NOW))
                .isEmpty();
        assertThat(
                        CoachingPublishRule.evaluate(
                                decision(false, Action.GUIDE_PACE, "360.00", 165),
                                VERSION,
                                NOW.minusSeconds(15),
                                GUIDE,
                                165,
                                false,
                                false,
                                true,
                                NOW.minusSeconds(130),
                                null,
                                NOW))
                .isPresent();
    }

    @Test
    void 이미_만료된_판단은_보내지_않는다() {
        // 입력 기준시각 + 20초가 지금이다.
        assertThat(
                        CoachingPublishRule.evaluate(
                                decision(false, Action.GUIDE_PACE, "360.00", 165),
                                VERSION,
                                NOW.minusSeconds(20),
                                GUIDE,
                                165,
                                false,
                                false,
                                true,
                                NOW.minusSeconds(130),
                                null,
                                NOW))
                .isEmpty();
        var aiExpired =
                new PaceDecision(
                        false,
                        Action.GUIDE_PACE,
                        GUIDE,
                        165,
                        null,
                        null,
                        null,
                        null,
                        VERSION,
                        NOW,
                        null);
        assertThat(
                        CoachingPublishRule.evaluate(
                                aiExpired,
                                VERSION,
                                NOW.minusSeconds(2),
                                GUIDE,
                                165,
                                false,
                                false,
                                true,
                                NOW.minusSeconds(130),
                                null,
                                NOW))
                .isEmpty();
    }

    @Test
    void 페이스_BPM이_같아도_코칭_단계가_바뀌면_30초_후_보낸다() {
        var caution =
                decision(true, Action.GUIDE_PACE, "360.00", 165, CoachingLevel.CAUTION);
        Instant applied40sAgo = NOW.minusSeconds(40);
        Instant applied10sAgo = NOW.minusSeconds(10);

        assertThat(eval(caution, 165, false, false, false, applied40sAgo, CoachingLevel.OK))
                .isPresent();
        assertThat(eval(caution, 165, false, false, false, applied10sAgo, CoachingLevel.OK))
                .isEmpty();
        // 단계가 같으면 보내지 않는다.
        assertThat(eval(caution, 165, false, false, false, applied40sAgo, CoachingLevel.CAUTION))
                .isEmpty();
        // 한쪽이 null이면 단계 변경으로 보지 않는다.
        assertThat(eval(caution, 165, false, false, false, applied40sAgo, null)).isEmpty();
        assertThat(
                        eval(
                                decision(true, Action.GUIDE_PACE, "360.00", 165, null),
                                165,
                                false,
                                false,
                                false,
                                applied40sAgo,
                                CoachingLevel.OK))
                .isEmpty();
    }

    @Test
    void 이어지는_EASE_OFF에서_작은_감속이라도_단계가_바뀌면_안내_유지로_보낸다() {
        // 직전 EASE_OFF·동일 페이스 390은 smallEaseOffStep이지만 OK→DANGER면 발행한다(B-1).
        var samePaceDanger =
                decision(true, Action.EASE_OFF, "360.00", 165, CoachingLevel.DANGER);
        var slightlySlowerDanger =
                decision(true, Action.EASE_OFF, "365.00", 160, CoachingLevel.DANGER);
        Instant applied40sAgo = NOW.minusSeconds(40);
        Instant applied10sAgo = NOW.minusSeconds(10);

        assertThat(eval(samePaceDanger, 165, false, true, false, applied40sAgo, CoachingLevel.OK))
                .get()
                .satisfies(p -> {
                    assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
                    assertThat(p.targetBpm()).isEqualTo(165);
                    assertThat(p.followsDecision()).isFalse();
                });
        assertThat(eval(samePaceDanger, 165, false, true, false, applied10sAgo, CoachingLevel.OK))
                .isEmpty();
        // 단계가 같으면 작은 감속은 여전히 막는다.
        assertThat(
                        eval(
                                samePaceDanger,
                                165,
                                false,
                                true,
                                false,
                                applied40sAgo,
                                CoachingLevel.DANGER))
                .isEmpty();
        // 5초만 느린 감속도 단계는 바꾸되 페이스는 안내를 유지한다.
        assertThat(
                        eval(
                                slightlySlowerDanger,
                                165,
                                false,
                                true,
                                false,
                                applied40sAgo,
                                CoachingLevel.OK))
                .get()
                .satisfies(p -> {
                    assertThat(p.recommendedPace()).isEqualByComparingTo("360.00");
                    assertThat(p.targetBpm()).isEqualTo(165);
                    assertThat(p.followsDecision()).isFalse();
                });
    }
}
