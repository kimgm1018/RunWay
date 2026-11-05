package com.runway.backend.domain.coaching.decide;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

/**
 * 세션 통합 테스트용 AI04 대역. 기본 응답은 기준 페이스 유지·BPM 160·발행 제안 없음이며, 테스트가 {@link #respond}로 바꿀 수 있다. 받은 요청을
 * 기록한다. 모든 값은 합성 데이터다.
 */
public class FakePaceDecider implements PaceDecider {

    public static final int DEFAULT_BPM = 160;

    private final List<PaceDecideRequest> requests = new CopyOnWriteArrayList<>();
    private volatile Function<PaceDecideRequest, Optional<PaceDecision>> responder =
            FakePaceDecider::keepGuide;

    @Override
    public Optional<PaceDecision> decide(PaceDecideRequest request) {
        requests.add(request);
        return responder.apply(request);
    }

    public void respond(Function<PaceDecideRequest, Optional<PaceDecision>> responder) {
        this.responder = responder;
    }

    public void reset() {
        requests.clear();
        responder = FakePaceDecider::keepGuide;
    }

    public List<PaceDecideRequest> requests() {
        return requests;
    }

    /** 기준 페이스·BPM 160 유지 판단. */
    public static Optional<PaceDecision> keepGuide(PaceDecideRequest request) {
        return Optional.of(
                decision(
                        request,
                        false,
                        PaceDecision.Action.GUIDE_PACE,
                        request.context().anchorPaceSecPerKm(),
                        DEFAULT_BPM));
    }

    public static PaceDecision decision(
            PaceDecideRequest request,
            boolean publishSuggested,
            PaceDecision.Action action,
            BigDecimal pace,
            Integer cueBpm) {
        return new PaceDecision(
                publishSuggested,
                action,
                pace,
                cueBpm,
                new BigDecimal("150.00"),
                new BigDecimal("152.00"),
                new BigDecimal("155.00"),
                null,
                request.context().stateVersion(),
                Instant.now().plusSeconds(20));
    }

    @TestConfiguration(proxyBeanMethods = false)
    public static class Config {
        @Bean
        @Primary
        FakePaceDecider fakePaceDecider() {
            return new FakePaceDecider();
        }
    }
}
