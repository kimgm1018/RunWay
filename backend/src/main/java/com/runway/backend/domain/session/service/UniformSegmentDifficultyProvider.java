package com.runway.backend.domain.session.service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * AI 난이도 비율 연동 전 기본 구현. 항상 빈 값을 돌려주어 모든 1km 구간이 같은 평균 페이스를 갖는다. AI 구현 Bean이 생기면 제거한다
 * (S15P31E105-297).
 */
@Component
class UniformSegmentDifficultyProvider implements SegmentDifficultyProvider {

    @Override
    public Optional<List<BigDecimal>> ratios(
            Long courseId, BigDecimal totalDistanceM, int segmentCount) {
        return Optional.empty();
    }
}
