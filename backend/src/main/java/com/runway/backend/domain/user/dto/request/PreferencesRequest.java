package com.runway.backend.domain.user.dto.request;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.runway.backend.domain.user.model.PreferenceSelection;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

import tools.jackson.databind.JsonNode;

/** U12 only: retain raw types so Jackson coercion cannot turn strings into booleans. */
public record PreferencesRequest(@NotNull JsonNode shape, @NotNull JsonNode filters) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static PreferencesRequest from(JsonNode body) {
        if (body == null
                || !body.isObject()
                || body.size() != 2
                || !body.has("shape")
                || !body.has("filters")) {
            throw new IllegalArgumentException("추천 기본값의 필수 필드를 확인해 주세요.");
        }
        return new PreferencesRequest(body.get("shape"), body.get("filters"));
    }

    @JsonIgnore
    @AssertTrue(message = "추천 기본값 필드와 자료형을 확인해 주세요.")
    public boolean isFormatValid() {
        if (shape == null
                || !shape.isString()
                || filters == null
                || !filters.isObject()
                || filters.size() != PreferenceSelection.FILTERS.size()) return false;
        for (String key : PreferenceSelection.FILTERS) {
            JsonNode value = filters.get(key);
            if (value == null || !value.isBoolean()) return false;
        }
        return true;
    }

    @Override
    public String toString() {
        return "PreferencesRequest[REDACTED]";
    }
}
