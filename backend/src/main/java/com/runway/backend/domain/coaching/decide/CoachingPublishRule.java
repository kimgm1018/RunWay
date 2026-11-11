package com.runway.backend.domain.coaching.decide;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * AI04 판단을 COACHING 명령으로 보낼지와 보낼 값을 정한다(S15P31E105-421 플랜 3장 "발행 규칙", pace-coaching.md "코칭을 보내는 시점").
 * 세션 잠금 아래에서 다시 읽은 값으로 호출한다. DB·시계에 의존하지 않는다.
 */
public final class CoachingPublishRule {

    /** 추천 유효시간. 생성 후 20초를 넘지 않는다(ck_coaching_context). */
    public static final Duration VALID_FOR = Duration.ofSeconds(20);

    /**
     * 페이스가 그대로인 발행(코칭 단계·BPM만 바뀜)과 이어지는 감속 권고(EASE_OFF)는 마지막 적용(코칭·재개·시작) 후 이만큼 지나야
     * 보낸다. 첫 EASE_OFF는 예외(2026-11-05 사용자 확정). AI가 안내 페이스를 바꾸는 GUIDE_PACE에는 적용하지 않는다. 페이스 변경의
     * 쿨다운(안내 변경·재개 뒤 120초)과 10초/km 미만 유지는 AI04가 그룹 페이스와 같은 규칙으로 한 곳에서 맡는다(S15P31E105-624).
     */
    public static final Duration MIN_CHANGE_INTERVAL = Duration.ofSeconds(30);

    /** 감속 권고가 이어질 때 다시 보내려면 지금 안내보다 이만큼(초/km) 이상 느려야 한다. */
    public static final BigDecimal MIN_EASE_OFF_STEP = BigDecimal.TEN;

    /** 발행 시점에 남아 있어야 하는 최소 유효시간. 전달 중 바로 만료될 추천을 보내지 않는다(리뷰 B-11). */
    public static final Duration MIN_REMAINING = Duration.ofSeconds(5);

    private CoachingPublishRule() {}

    /**
     * 보낼 추천.
     *
     * @param followsDecision AI가 고른 페이스를 그대로 보내는지. 2분 유지 안내에서 현재 안내를 유지하면 false이며, 이때 AI 예측 심박은 이
     *     페이스의 예측이 아니므로 저장하지 않는다
     */
    public record Publish(
            BigDecimal recommendedPace, int targetBpm, Instant expiresAt, boolean followsDecision) {}

    /**
     * @param stateVersion 잠금 아래에서 읽은 현재 상태 버전
     * @param guidePace 현재 안내 페이스(입력의 기준 페이스)
     * @param currentBpm 서버에 확정된 현재 BPM. 없으면 null
     * @param manualBpm 이번 러닝에서 사용자가 BPM을 직접 바꿔 적용한 적이 있는지. 있으면 AI BPM으로 덮어쓰지 않고 현재 BPM을 유지한다
     *     (2026-11-05 사용자 확정)
     * @param previousEaseOff 이 세션에 직전에 보낸 코칭이 감속 권고(EASE_OFF)였는지
     * @param reevaluationDue "코칭 없이 2분 경과" 조건을 만족하는지
     * @param lastAppliedAt 마지막 실제 시작·재개·코칭 적용 시각 중 가장 최근 값
     * @param lastAppliedLevel 워치에 적용된 마지막 코칭 단계. 없으면 null(S15P31E105-503)
     */
    public static Optional<Publish> evaluate(
            PaceDecision decision,
            long stateVersion,
            Instant inputAsOf,
            BigDecimal guidePace,
            Integer currentBpm,
            boolean manualBpm,
            boolean previousEaseOff,
            boolean reevaluationDue,
            Instant lastAppliedAt,
            CoachingLevel lastAppliedLevel,
            Instant now) {
        if (decision.action() == PaceDecision.Action.NOT_RUNNING
                || decision.basedOnStateVersion() != stateVersion) {
            return Optional.empty();
        }
        // 사용자가 직접 정한 BPM은 러닝이 끝날 때까지 유지한다. AI가 BPM을 계산하지 못했으면 현재 BPM을 유지하고, 그것도 없으면 보내지
        // 않는다(N7-2, 2026-11-05 사용자 확정).
        Integer aiBpm = manualBpm && currentBpm != null ? currentBpm : decision.cueBpm();
        Integer bpm = aiBpm != null ? aiBpm : currentBpm;
        if (bpm == null) {
            return Optional.empty();
        }
        Instant expiresAt = min(now.plus(VALID_FOR), inputAsOf.plus(VALID_FOR));
        if (decision.expiresAt() != null) {
            expiresAt = min(expiresAt, decision.expiresAt());
        }
        if (now.plus(MIN_REMAINING).isAfter(expiresAt)) {
            return Optional.empty();
        }
        boolean easeOff = decision.action() == PaceDecision.Action.EASE_OFF;
        // 감속 권고가 이어질 때는 지금 안내보다 충분히(10초/km 이상) 느릴 때만 감속으로 본다.
        boolean smallEaseOffStep =
                easeOff
                        && previousEaseOff
                        && guidePace != null
                        && decision.recommendedPaceSecPerKm().subtract(guidePace).compareTo(MIN_EASE_OFF_STEP)
                                < 0;
        boolean levelChanged =
                decision.coachingLevel() != null
                        && lastAppliedLevel != null
                        && decision.coachingLevel() != lastAppliedLevel;
        if (reevaluationDue) {
            // 현재 BPM이 아직 없으면(출발 직후) 현재 안내와 짝이 맞는 BPM이 없으므로 AI 판단을 그대로 보내 BPM을 처음 정한다(후속 리뷰 F-1).
            if (currentBpm == null || (decision.publishSuggested() && !smallEaseOffStep)) {
                return Optional.of(
                        new Publish(decision.recommendedPaceSecPerKm(), bpm, expiresAt, true));
            }
            // AI가 조정을 제안하지 않았거나 이어지는 감속 차이가 작으면 현재 안내 페이스·BPM을 그대로 유지 안내한다. 작은 차이가 쌓여 안내
            // 페이스가 한쪽으로 밀리지 않게 한다(리뷰 A-7·후속 리뷰 F-5, 2026-11-05 사용자 확정).
            return Optional.of(new Publish(guidePace, currentBpm, expiresAt, false));
        }
        if (!decision.publishSuggested()) {
            return Optional.empty();
        }
        // 이어지는 작은 감속은 막되, 코칭 단계가 바뀌면 안내는 유지한 채 발행한다(S15P31E105-503 B-1).
        if (smallEaseOffStep && !levelChanged) {
            return Optional.empty();
        }
        boolean samePace =
                guidePace != null && guidePace.compareTo(decision.recommendedPaceSecPerKm()) == 0;
        if (samePace && bpm.equals(currentBpm) && !levelChanged) {
            // 같은 조정 판단을 연속 발행하지 않는다. 단계는 양쪽이 non-null이고 다를 때만 변경으로 본다(S15P31E105-503).
            return Optional.empty();
        }
        // 첫 감속 권고만 30초 간격의 예외다. 감속 권고가 이어지면 30초를 지키고, 지금 안내보다 10초/km 이상 느릴 때만 보낸다.
        // 러너가 안내를 따라 느려질 때마다 "실측 + 30초/km"가 반복돼 안내가 15초마다 계속 느려지지 않게 한다(리뷰 B-6, 2026-11-05 사용자 확정).
        // AI가 안내 페이스를 바꾼 GUIDE_PACE는 AI04 쿨다운(120초)을 이미 거쳤으므로 여기서 다시 막지 않는다(S15P31E105-624).
        boolean aiPaceChange = !easeOff && !samePace;
        boolean rateLimited = easeOff ? previousEaseOff : !aiPaceChange;
        if (rateLimited && now.isBefore(lastAppliedAt.plus(MIN_CHANGE_INTERVAL))) {
            return Optional.empty();
        }
        if (smallEaseOffStep) {
            int holdBpm = currentBpm != null ? currentBpm : bpm;
            return Optional.of(new Publish(guidePace, holdBpm, expiresAt, false));
        }
        return Optional.of(
                new Publish(decision.recommendedPaceSecPerKm(), bpm, expiresAt, true));
    }

    private static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }
}
