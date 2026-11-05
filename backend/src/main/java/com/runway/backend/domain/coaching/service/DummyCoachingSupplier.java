package com.runway.backend.domain.coaching.service;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * AI 연동 전 기본 더미 코칭(S15P31E105-257 D-2). 실측 입력으로 계산하지 않고 "현재 페이스·BPM 유지" 안내를 만든다. 페이스는 초기 계획 페이스, 없으면
 * 6'00"/km. BPM은 현재 BPM, 없으면 160이다.
 */
@Component
public class DummyCoachingSupplier implements CoachingSupplier {

    static final BigDecimal DEFAULT_PACE_SEC_PER_KM = new BigDecimal("360.00");
    static final int DEFAULT_BPM = 160;

    @Override
    public Proposal propose(Input input) {
        BigDecimal pace =
                input.planPaceSecPerKm() == null || input.planPaceSecPerKm().signum() <= 0
                        ? DEFAULT_PACE_SEC_PER_KM
                        : input.planPaceSecPerKm().setScale(2, RoundingMode.HALF_UP);
        int bpm = input.currentBpm() == null ? DEFAULT_BPM : input.currentBpm();
        return new Proposal(pace, bpm);
    }
}
