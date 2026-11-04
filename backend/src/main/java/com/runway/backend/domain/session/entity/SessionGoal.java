package com.runway.backend.domain.session.entity;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.stream.Stream;

/** 세션 목표. 모든 값이 null이면 무목표 자유러닝이다. */
public record SessionGoal(
        Long courseId,
        Long comparisonSessionId,
        Integer distanceM,
        Integer durationSec,
        BigDecimal paceSecPerKm) {

    /** 페이스는 소수 자릿수 표기(5 vs 5.00)와 무관하게 값으로 비교한다. */
    public boolean sameAs(SessionGoal other) {
        return Objects.equals(courseId, other.courseId)
                && Objects.equals(comparisonSessionId, other.comparisonSessionId)
                && Objects.equals(distanceM, other.distanceM)
                && Objects.equals(durationSec, other.durationSec)
                && (paceSecPerKm == null
                        ? other.paceSecPerKm == null
                        : other.paceSecPerKm != null
                                && paceSecPerKm.compareTo(other.paceSecPerKm) == 0);
    }

    public long targetCount() {
        return Stream.of(distanceM, durationSec, paceSecPerKm).filter(Objects::nonNull).count();
    }
}
