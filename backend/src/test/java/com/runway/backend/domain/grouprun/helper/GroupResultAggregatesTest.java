package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class GroupResultAggregatesTest {

    @Test
    void ready_multipleEligible_minDistance_meanPaceRounded_gap() {
        GroupResultAggregates.Result r =
                GroupResultAggregates.of(
                        true, List.of(5000.0, 4200.5, 4800.0), List.of(360.0, 371.0, 365.0));

        assertThat(r.distanceM()).isEqualTo(4200.5);
        assertThat(r.averagePaceSecPerKm()).isEqualTo(365);
        assertThat(r.maxGapM()).isEqualTo(799.5);
    }

    @Test
    void ready_paceMeanRoundsHalfUp() {
        GroupResultAggregates.Result r =
                GroupResultAggregates.of(true, List.of(1000.0, 1000.0), List.of(360.0, 361.0));

        assertThat(r.averagePaceSecPerKm()).isEqualTo(361);
    }

    @Test
    void ready_singleEligible_gapIsZero() {
        GroupResultAggregates.Result r =
                GroupResultAggregates.of(true, List.of(5000.0), List.of(360.0));

        assertThat(r.distanceM()).isEqualTo(5000.0);
        assertThat(r.averagePaceSecPerKm()).isEqualTo(360);
        assertThat(r.maxGapM()).isEqualTo(0.0);
    }

    @Test
    void ready_nullPacesSkipped_andAllNullPaceGivesNullPace() {
        List<Double> paces = new ArrayList<>();
        paces.add(null);
        paces.add(400.0);
        GroupResultAggregates.Result some =
                GroupResultAggregates.of(true, List.of(1000.0, 2000.0), paces);
        assertThat(some.averagePaceSecPerKm()).isEqualTo(400);
        assertThat(some.distanceM()).isEqualTo(1000.0);

        List<Double> none = new ArrayList<>();
        none.add(null);
        GroupResultAggregates.Result r = GroupResultAggregates.of(true, List.of(1000.0), none);
        assertThat(r.averagePaceSecPerKm()).isNull();
        assertThat(r.distanceM()).isEqualTo(1000.0);
        assertThat(r.maxGapM()).isEqualTo(0.0);
    }

    @Test
    void notReady_allNull() {
        GroupResultAggregates.Result r =
                GroupResultAggregates.of(false, List.of(5000.0, 4000.0), List.of(360.0, 370.0));

        assertThat(r).isEqualTo(GroupResultAggregates.Result.EMPTY);
    }

    @Test
    void noEligible_allNull() {
        assertThat(GroupResultAggregates.of(true, List.of(), List.of()))
                .isEqualTo(GroupResultAggregates.Result.EMPTY);
        assertThat(GroupResultAggregates.of(true, null, null))
                .isEqualTo(GroupResultAggregates.Result.EMPTY);
    }
}
