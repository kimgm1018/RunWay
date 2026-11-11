package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.coaching.decide.PaceDecideRequest.History;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** AI10 contract. Contains health samples: never log these objects. */
public interface GroupPacePort {
    Optional<Result> evaluate(Request request);

    record LastChange(String direction, Instant changedAt) {}
    @JsonInclude(JsonInclude.Include.ALWAYS)
    record Participant(Long userId, boolean active, History history, List<Double> futureGradePct) {}
    @JsonInclude(JsonInclude.Include.ALWAYS)
    record Request(long groupRunId, int currentGroupPaceSecPerKm,
            Integer goalPaceSecPerKm, Integer startRecommendedPaceSecPerKm,
            int elapsedSec, Double progressRatio, Instant now, LastChange lastChange,
            List<Participant> participants,
            // S15P31E105-680: sent only for GOAL, so an older AI (which ignores it anyway) and TOGETHER stay identical.
            @JsonInclude(JsonInclude.Include.NON_NULL) String paceMode) {
        public Request(long groupRunId, int currentGroupPaceSecPerKm, Integer goalPaceSecPerKm,
                Integer startRecommendedPaceSecPerKm, int elapsedSec, Double progressRatio, Instant now,
                LastChange lastChange, List<Participant> participants) {
            this(groupRunId, currentGroupPaceSecPerKm, goalPaceSecPerKm, startRecommendedPaceSecPerKm,
                    elapsedSec, progressRatio, now, lastChange, participants, null);
        }
    }
    record Result(int groupPaceSecPerKm, boolean changed, String direction, String reason,
            int strugglingCount, int excludedCount, int paceOnlyCount,
            List<String> warnings, String modelVersion) {}
}
