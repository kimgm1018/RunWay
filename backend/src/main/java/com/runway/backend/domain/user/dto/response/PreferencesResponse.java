package com.runway.backend.domain.user.dto.response;

import com.runway.backend.domain.user.model.PreferenceSelection;

public record PreferencesResponse(String shape, PreferenceFiltersResponse filters) {
    public static PreferencesResponse from(PreferenceSelection selection) {
        return new PreferencesResponse(
                selection.shape(), PreferenceFiltersResponse.from(selection.filters()));
    }
}
