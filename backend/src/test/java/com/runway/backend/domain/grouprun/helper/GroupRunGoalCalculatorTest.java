package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator.ResolvedGoals;
import com.runway.backend.global.exception.ApiException;
import org.junit.jupiter.api.Test;

class GroupRunGoalCalculatorTest {

    @Test
    void freeRunAllowsAllNullGoals() {
        ResolvedGoals goals = GroupRunGoalCalculator.resolve(null, null, null, null, null);
        assertThat(goals.distanceM()).isNull();
        assertThat(goals.durationSec()).isNull();
        assertThat(goals.paceSecPerKm()).isNull();
    }

    @Test
    void timeConvertsDistanceAndDurationToPace() {
        ResolvedGoals goals =
                GroupRunGoalCalculator.resolve("TIME", 5000, 1800, null, null);
        assertThat(goals.distanceM()).isEqualTo(5000);
        assertThat(goals.durationSec()).isEqualTo(1800);
        assertThat(goals.paceSecPerKm()).isEqualTo(360);
    }

    @Test
    void paceConvertsDistanceAndPaceToDuration() {
        ResolvedGoals goals =
                GroupRunGoalCalculator.resolve("PACE", 5000, null, 360, null);
        assertThat(goals.distanceM()).isEqualTo(5000);
        assertThat(goals.durationSec()).isEqualTo(1800);
        assertThat(goals.paceSecPerKm()).isEqualTo(360);
    }

    @Test
    void courseDistanceFallbackWhenTargetDistanceOmitted() {
        ResolvedGoals goals =
                GroupRunGoalCalculator.resolve("TIME", null, 1800, null, 5000);
        assertThat(goals.distanceM()).isEqualTo(5000);
        assertThat(goals.paceSecPerKm()).isEqualTo(360);
    }

    @Test
    void invalidGoalWhenGoalFieldsWithoutInputType() {
        assertThatThrownBy(() -> GroupRunGoalCalculator.resolve(null, 5000, 1800, null, null))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> {
                            ApiException api = (ApiException) ex;
                            assertThat(api.code()).isEqualTo("INVALID_GOAL");
                            assertThat(api.status().value()).isEqualTo(422);
                        });
    }

    @Test
    void invalidGoalForBadTimeCombo() {
        assertThatThrownBy(() -> GroupRunGoalCalculator.resolve("TIME", 5000, null, null, null))
                .isInstanceOf(ApiException.class)
                .extracting(ex -> ((ApiException) ex).code())
                .isEqualTo("INVALID_GOAL");
    }

    @Test
    void derivePaceReturnsNullWhenIncomplete() {
        assertThat(GroupRunGoalCalculator.derivePaceSecPerKm(null, 1800)).isNull();
        assertThat(GroupRunGoalCalculator.derivePaceSecPerKm(5000, null)).isNull();
    }
}
