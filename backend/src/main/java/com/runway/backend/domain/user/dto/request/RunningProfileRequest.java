package com.runway.backend.domain.user.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnore;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.AssertTrue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.annotation.JsonDeserialize;

public record RunningProfileRequest(
        @Schema(
                        type = "string",
                        implementation = String.class,
                        allowableValues = {"BEGINNER", "INTERMEDIATE", "ADVANCED"},
                        description = "최초 생성 시 필수. 기존 프로필의 페이스만 수정하면 생략")
                JsonNode selfReportedLevel,
        @Schema(
                        type = "string",
                        implementation = String.class,
                        allowableValues = {"PACE", "DISTANCE_TIME"},
                        description = "최초 저장 시 필수. 기존 수준만 수정하면 페이스 입력 전체 생략")
                JsonNode inputType,
        @Schema(
                        type = "number",
                        implementation = java.math.BigDecimal.class,
                        description = "두 입력 방식 모두 필수인 양수 초/km. 프론트 계산값을 소수 둘째 자리로 반올림해 저장")
                @JsonDeserialize(using = ExactDecimalNodeDeserializer.class)
                JsonNode usualPaceSecPerKm,
        @Schema(
                        type = "integer",
                        implementation = Integer.class,
                        format = "int32",
                        description = "DISTANCE_TIME: 양수 미터")
                JsonNode baselineDistanceM,
        @Schema(
                        type = "integer",
                        implementation = Integer.class,
                        format = "int32",
                        description = "DISTANCE_TIME: 양수 초")
                JsonNode baselineDurationSec) {
    @JsonIgnore
    @Schema(hidden = true)
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
