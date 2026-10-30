package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.user.dto.request.RunningProfileRequest;
import com.runway.backend.domain.user.validation.RunningProfileValidator;
import com.runway.backend.global.exception.ApiException;

import jakarta.validation.Validation;
import jakarta.validation.ValidatorFactory;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;

class RunningProfileValidationTest {
    private static final ValidatorFactory FORMATS = Validation.buildDefaultValidatorFactory();

    @AfterAll
    static void closeValidationFactory() {
        FORMATS.close();
    }

    private final JsonMapper mapper = JsonMapper.builder().build();
    private final RunningProfileValidator validator = new RunningProfileValidator();

    @Test
    void omissionIsDifferentFromNullAndLevelOnlyNeedsNoBaseline() {
        var input =
                validator.profile(
                        mapper.readValue(
                                "{\"selfReportedLevel\":\"BEGINNER\"}",
                                RunningProfileRequest.class));
        assertThat(input.baseline()).isNull();
        for (String field :
                new String[] {
                    "selfReportedLevel",
                    "inputType",
                    "usualPaceSecPerKm",
                    "baselineDistanceM",
                    "baselineDurationSec"
                }) {
            String body =
                    field.equals("selfReportedLevel")
                            ? "{\"selfReportedLevel\":null}"
                            : "{\"selfReportedLevel\":\"BEGINNER\",\"" + field + "\":null}";
            assertError(body, 400, "VALIDATION_ERROR");
        }
    }

    @ParameterizedTest
    @CsvSource({
        "360.125,360.13", "360.12499999999999999,360.12",
        "0.005,0.01", "99999999.99,99999999.99"
    })
    void exactDecimalRounding(String supplied, String expected) {
        var input =
                validator.profile(
                        mapper.readValue(
                                "{\"selfReportedLevel\":\"ADVANCED\",\"inputType\":\"PACE\","
                                        + "\"usualPaceSecPerKm\":"
                                        + supplied
                                        + "}",
                                RunningProfileRequest.class));
        assertThat(input.baseline().pace()).isEqualByComparingTo(expected);
        assertThat(input.baseline().distance()).isNull();
        assertThat(input.baseline().duration()).isNull();
    }

    @Test
    void distanceTimeStoresSubmittedPaceWithoutRecalculating() {
        for (String[] sample :
                new String[][] {
                    {"3000", "1000", "333.335", "333.34"},
                    {"5000", "1800", "410.125", "410.13"},
                    {"2147483647", "2147483647", "1000", "1000.00"}
                }) {
            var request =
                    mapper.readValue(
                            "{\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":"
                                    + sample[0]
                                    + ",\"baselineDurationSec\":"
                                    + sample[1]
                                    + ",\"usualPaceSecPerKm\":"
                                    + sample[2]
                                    + "}",
                            RunningProfileRequest.class);
            assertThat(FORMATS.getValidator().validate(request)).isEmpty();
            var result = validator.profile(request).baseline();
            assertThat(result.pace()).isEqualByComparingTo(new BigDecimal(sample[3]));
            assertThat(result.distance()).isEqualTo(Integer.valueOf(sample[0]));
            assertThat(result.duration()).isEqualTo(Integer.valueOf(sample[1]));
        }
    }

    @Test
    void invalidCombinationsAndNumericBoundsAreBusinessErrors() {
        for (String extra :
                new String[] {
                    "\"inputType\":\"UNKNOWN\"",
                    "\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":5000,\"baselineDurationSec\":1800",
                    "\"inputType\":\"DISTANCE_TIME\",\"usualPaceSecPerKm\":360,\"baselineDistanceM\":0,\"baselineDurationSec\":1800",
                    "\"inputType\":\"DISTANCE_TIME\",\"usualPaceSecPerKm\":360,\"baselineDistanceM\":5000,\"baselineDurationSec\":-1",
                    "\"inputType\":\"DISTANCE_TIME\",\"usualPaceSecPerKm\":0.004,\"baselineDistanceM\":5000,\"baselineDurationSec\":1800",
                    "\"inputType\":\"DISTANCE_TIME\",\"usualPaceSecPerKm\":99999999.994,\"baselineDistanceM\":5000,\"baselineDurationSec\":1800",
                    "\"inputType\":\"PACE\"",
                    "\"usualPaceSecPerKm\":360",
                    "\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":5000",
                    "\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":0,\"baselineDurationSec\":1800",
                    "\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":1,\"baselineDurationSec\":2147483647",
                    "\"inputType\":\"DISTANCE_TIME\",\"baselineDistanceM\":2147483647,\"baselineDurationSec\":1",
                    "\"inputType\":\"PACE\",\"usualPaceSecPerKm\":360,\"baselineDistanceM\":5000",
                    "\"inputType\":\"PACE\",\"usualPaceSecPerKm\":0",
                    "\"inputType\":\"PACE\",\"usualPaceSecPerKm\":-1",
                    "\"inputType\":\"PACE\",\"usualPaceSecPerKm\":0.004",
                    "\"inputType\":\"PACE\",\"usualPaceSecPerKm\":99999999.994"
                }) {
            assertError(
                    "{\"selfReportedLevel\":\"BEGINNER\"," + extra + "}",
                    422,
                    "INVALID_RUNNING_BASELINE");
        }
        assertError("{\"selfReportedLevel\":\"unknown\"}", 422, "INVALID_LEVEL");
    }

    @Test
    void malformedTypesDoNotCoerce() {
        for (String body :
                new String[] {
                    "{}",
                    "{\"selfReportedLevel\":1}",
                    "{\"selfReportedLevel\":[]}",
                    "{\"selfReportedLevel\":\"BEGINNER\",\"inputType\":1}",
                    "{\"selfReportedLevel\":\"BEGINNER\",\"usualPaceSecPerKm\":\"360\"}",
                    "{\"selfReportedLevel\":\"BEGINNER\",\"baselineDistanceM\":1.5}",
                    "{\"selfReportedLevel\":\"BEGINNER\",\"baselineDurationSec\":2147483648}",
                    "{\"selfReportedLevel\":\"BEGINNER\",\"baselineDistanceM\":true}"
                }) {
            assertError(body, 400, "VALIDATION_ERROR");
        }
    }

    @Test
    void profileDtoChecksTypesButLeavesCombinationsToBusinessValidator() {
        for (String body :
                new String[] {
                    "{\"inputType\":null}", "{\"inputType\":true}",
                    "{\"usualPaceSecPerKm\":null}", "{\"usualPaceSecPerKm\":\"360\"}",
                    "{\"baselineDistanceM\":1.5}", "{\"baselineDurationSec\":2147483648}",
                    "{\"baselineDistanceM\":null}"
                }) {
            var request = mapper.readValue(body, RunningProfileRequest.class);
            assertThat(FORMATS.getValidator().validate(request)).as(body).isNotEmpty();
        }
        for (String body :
                new String[] {
                    "{\"inputType\":\"UNKNOWN\"}",
                    "{\"inputType\":\"PACE\"}",
                    "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":0}"
                }) {
            var request = mapper.readValue(body, RunningProfileRequest.class);
            assertThat(FORMATS.getValidator().validate(request)).as(body).isEmpty();
            assertThatThrownBy(() -> validator.profile(request))
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            error -> assertThat(error.status().value()).isEqualTo(422));
        }
    }

    @Test
    void profilePatchAcceptsEitherFieldGroupWithoutInventingOtherValues() {
        var paceOnly =
                mapper.readValue(
                        "{\"inputType\":\"PACE\",\"usualPaceSecPerKm\":360}",
                        RunningProfileRequest.class);
        assertThat(FORMATS.getValidator().validate(paceOnly)).isEmpty();
        assertThat(validator.profile(paceOnly).level()).isNull();
        assertThat(validator.profile(paceOnly).baseline().pace()).isEqualByComparingTo("360");
        var levelOnly =
                mapper.readValue(
                        "{\"selfReportedLevel\":\"BEGINNER\"}", RunningProfileRequest.class);
        assertThat(FORMATS.getValidator().validate(levelOnly)).isEmpty();
        assertThat(validator.profile(levelOnly).baseline()).isNull();
    }

    private void assertError(String body, int status, String code) {
        var request = mapper.readValue(body, RunningProfileRequest.class);
        var violations = FORMATS.getValidator().validate(request);
        if (status == 400) {
            assertThat(violations).as("DTO rejects malformed request: %s", body).isNotEmpty();
            return;
        }
        assertThat(violations).as("Business-invalid input still has valid JSON types").isEmpty();
        assertThatThrownBy(() -> validator.profile(request))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error -> {
                            assertThat(error.status().value()).isEqualTo(status);
                            assertThat(error.code()).isEqualTo(code);
                            assertThat(error.details()).isEmpty();
                        });
    }

    @Test
    void extremeNegativeExponentIsRejectedBeforeExpensiveRescaling() {
        assertError(
                "{\"selfReportedLevel\":\"BEGINNER\",\"inputType\":\"PACE\","
                        + "\"usualPaceSecPerKm\":1e-2147483647}",
                422,
                "INVALID_RUNNING_BASELINE");
    }
}
