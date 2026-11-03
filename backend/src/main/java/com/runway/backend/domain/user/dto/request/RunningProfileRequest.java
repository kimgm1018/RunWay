package com.runway.backend.domain.user.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnore;

import jakarta.validation.constraints.AssertTrue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.annotation.JsonDeserialize;

public record RunningProfileRequest(
        JsonNode selfReportedLevel,
        JsonNode inputType,
        @JsonDeserialize(using = ExactDecimalNodeDeserializer.class)
                JsonNode usualPaceSecPerKm,
        JsonNode baselineDistanceM,
        JsonNode baselineDurationSec) {
    @JsonIgnore
    @AssertTrue(message = "러닝 수준과 제출한 필드의 자료형을 확인해 주세요.")
    public boolean isFormatValid() {
        return (selfReportedLevel != null
                        || inputType != null
                        || usualPaceSecPerKm != null
                        || baselineDistanceM != null
                        || baselineDurationSec != null)
                && (selfReportedLevel == null || selfReportedLevel.isString())
                && (inputType == null || inputType.isString())
                && (usualPaceSecPerKm == null || usualPaceSecPerKm.isNumber())
                && optionalInteger(baselineDistanceM)
                && optionalInteger(baselineDurationSec);
    }

    private static boolean optionalInteger(JsonNode value) {
        return value == null || (value.isIntegralNumber() && value.canConvertToInt());
    }

    @Override
    public String toString() {
        return "RunningProfileRequest[REDACTED]";
    }
}
