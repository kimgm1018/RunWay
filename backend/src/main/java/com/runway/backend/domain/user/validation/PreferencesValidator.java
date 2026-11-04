package com.runway.backend.domain.user.validation;

import com.runway.backend.domain.user.dto.request.PreferencesRequest;
import com.runway.backend.domain.user.model.PreferenceSelection;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Set;

@Component
public class PreferencesValidator {
    public PreferenceSelection validate(PreferencesRequest request) {
        if (request == null || !request.isFormatValid()) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        JsonNode shape = request.shape();
        JsonNode filters = request.filters();
        var values = new LinkedHashMap<String, Boolean>();
        for (String key : PreferenceSelection.FILTERS) {
            JsonNode value = filters.get(key);
            if (value == null || !value.isBoolean()) {
                throw new ApiException(ErrorCode.VALIDATION_ERROR);
            }
            values.put(key, value.booleanValue());
        }
        if (!Set.of("loop", "out_and_back", "point_to_point").contains(shape.asString())) {
            throw new ApiException(ErrorCode.INVALID_SHAPE);
        }
        return new PreferenceSelection(shape.asString(), values);
    }
}
