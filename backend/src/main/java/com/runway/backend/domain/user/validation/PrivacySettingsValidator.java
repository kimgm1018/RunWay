package com.runway.backend.domain.user.validation;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class PrivacySettingsValidator {
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    public boolean parse(String body) {
        JsonNode root;
        try {
            root = JSON.readTree(body);
        } catch (JacksonException | IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (root == null || !root.isObject() || !root.has("isPrivate")) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (root.size() != 1 || !root.get("isPrivate").isBoolean()) {
            throw new ApiException(ErrorCode.INVALID_VISIBILITY);
        }
        return root.get("isPrivate").asBoolean();
    }
}
