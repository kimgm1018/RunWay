package com.runway.backend.domain.user.validation;

import com.runway.backend.domain.user.dto.request.RunningProfileRequest;
import com.runway.backend.domain.user.entity.RunningLevel;
import com.runway.backend.domain.user.exception.RunningProfileErrors;
import com.runway.backend.domain.user.model.RunningBaseline;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

/** Checks business values and combinations after request Bean Validation. */
@Component
public class RunningProfileValidator {
    public ProfileInput profile(RunningProfileRequest request) {
        RunningLevel level = null;
        if (!absent(request.selfReportedLevel())) {
            try {
                level = RunningLevel.valueOf(request.selfReportedLevel().stringValue());
            } catch (IllegalArgumentException exception) {
                throw RunningProfileErrors.invalidLevel();
            }
        }
        return new ProfileInput(
                level,
                validateBaselineInput(
                        request.inputType(),
                        request.usualPaceSecPerKm(),
                        request.baselineDistanceM(),
                        request.baselineDurationSec()));
    }

    private RunningBaseline validateBaselineInput(
            JsonNode type, JsonNode pace, JsonNode distance, JsonNode duration) {
        if (absent(type) && absent(pace) && absent(distance) && absent(duration)) {
            return null;
        }
        if (absent(type)) throw RunningProfileErrors.invalidBaseline();
        return switch (type.stringValue()) {
            case "PACE" -> {
                if (absent(pace) || !absent(distance) || !absent(duration)) {
                    throw RunningProfileErrors.invalidBaseline();
                }
                yield RunningBaseline.pace(pace.decimalValue());
            }
            case "DISTANCE_TIME" -> {
                if (absent(pace) || absent(distance) || absent(duration)) {
                    throw RunningProfileErrors.invalidBaseline();
                }
                yield RunningBaseline.distanceTime(
                        pace.decimalValue(), distance.intValue(), duration.intValue());
            }
            default -> throw RunningProfileErrors.invalidBaseline();
        };
    }

    private boolean absent(JsonNode node) {
        return node == null || node.isMissingNode();
    }

    public record ProfileInput(RunningLevel level, RunningBaseline baseline) {
        @Override
        public String toString() {
            return "ProfileInput[REDACTED]";
        }
    }
}
