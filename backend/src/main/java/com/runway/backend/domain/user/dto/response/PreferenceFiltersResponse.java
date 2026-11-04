package com.runway.backend.domain.user.dto.response;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record PreferenceFiltersResponse(
        boolean river,
        boolean beach,
        boolean park,
        boolean trail,
        boolean pedestrian,
        boolean flat,
        @JsonProperty("avoid_major_road") boolean avoidMajorRoad,
        @JsonProperty("avoid_steps") boolean avoidSteps,
        @JsonProperty("avoid_tunnel") boolean avoidTunnel) {
    static PreferenceFiltersResponse from(Map<String, Boolean> filters) {
        return new PreferenceFiltersResponse(
                filters.get("river"),
                filters.get("beach"),
                filters.get("park"),
                filters.get("trail"),
                filters.get("pedestrian"),
                filters.get("flat"),
                filters.get("avoid_major_road"),
                filters.get("avoid_steps"),
                filters.get("avoid_tunnel"));
    }
}
