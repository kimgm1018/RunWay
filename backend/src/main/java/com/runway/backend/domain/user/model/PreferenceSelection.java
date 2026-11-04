package com.runway.backend.domain.user.model;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** A complete recommendation default; false always means no preference. */
public record PreferenceSelection(String shape, Map<String, Boolean> filters) {
    public static final List<String> FILTERS =
            List.of(
                    "river",
                    "beach",
                    "park",
                    "trail",
                    "pedestrian",
                    "flat",
                    "avoid_major_road",
                    "avoid_steps",
                    "avoid_tunnel");

    public PreferenceSelection {
        filters = Map.copyOf(filters);
    }

    public static PreferenceSelection defaults() {
        return new PreferenceSelection(
                "loop", FILTERS.stream().collect(Collectors.toMap(key -> key, key -> false)));
    }
}
