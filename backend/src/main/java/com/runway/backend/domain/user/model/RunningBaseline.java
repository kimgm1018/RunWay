package com.runway.backend.domain.user.model;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import java.math.BigDecimal;
import java.math.RoundingMode;

public record RunningBaseline(BigDecimal pace, Integer distance, Integer duration) {
    public static final BigDecimal MAX_PACE = new BigDecimal("99999999.99");
    private static final BigDecimal MIN_ROUNDABLE_PACE = new BigDecimal("0.005");

    public RunningBaseline {
        if (pace == null
                || pace.compareTo(MIN_ROUNDABLE_PACE) < 0
                || pace.compareTo(MAX_PACE) > 0
                || (distance == null) != (duration == null)
                || (distance != null && (distance <= 0 || duration <= 0))) {
            throw new ApiException(ErrorCode.INVALID_RUNNING_BASELINE);
        }
        // Reject values that round to zero before rescaling; a tiny exponent can require
        // an enormous power of ten even when the JSON token itself is short.
        pace = pace.setScale(2, RoundingMode.HALF_UP);
        if (pace.signum() <= 0 || pace.compareTo(MAX_PACE) > 0) {
            throw new ApiException(ErrorCode.INVALID_RUNNING_BASELINE);
        }
    }

    public static RunningBaseline pace(BigDecimal pace) {
        return new RunningBaseline(pace, null, null);
    }

    public static RunningBaseline distanceTime(BigDecimal pace, int distance, int duration) {
        return new RunningBaseline(pace, distance, duration);
    }

    @Override
    public String toString() {
        return "RunningBaseline[REDACTED]";
    }
}
