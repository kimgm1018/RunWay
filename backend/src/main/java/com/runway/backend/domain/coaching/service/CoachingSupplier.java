package com.runway.backend.domain.coaching.service;

import java.math.BigDecimal;

/**
 * 실시간 코칭 추천 공급자. 현재는 {@link DummyCoachingSupplier}만 있으며, 실제 AI 연동 업무에서 이 인터페이스의 구현만 교체한다. 발행 조건·저장·전달은
 * 공급자와 무관하게 세션 서비스가 처리한다.
 */
public interface CoachingSupplier {

    /** 추천을 만들지 않으면 null을 돌려준다(입력 부족 등). */
    Proposal propose(Input input);

    /**
     * @param planPaceSecPerKm 초기 계획의 추천 페이스(초/km). 계획이 없으면 null
     * @param currentBpm 서버에 확정된 현재 BPM. 없으면 null
     */
    record Input(long sessionId, BigDecimal planPaceSecPerKm, Integer currentBpm) {}

    /**
     * @param recommendedPaceSecPerKm 권장 페이스(초/km), 양수·소수 둘째 자리
     * @param targetBpm 적용할 박자, 60~220
     */
    record Proposal(BigDecimal recommendedPaceSecPerKm, int targetBpm) {}
}
