package com.runway.backend.domain.user.validation;

import com.runway.backend.domain.user.dto.request.UserSettingsRequest;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Component;

import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Set;

@Component
public class UserSettingsValidator {
    // Local parser: strictness must not change unrelated endpoints.
    private static final JsonMapper JSON =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    public UserSettingsRequest parse(String body) {
        JsonNode root;
        try {
            root = JSON.readTree(body);
        } catch (JacksonException | IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (root == null || !root.isObject()) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        keys(
                root,
                Set.of(
                        "voiceCoachingEnabled",
                        "bpmGuideEnabled",
                        "locationRecordingMode",
                        "notifications"));
        Boolean voice = bool(root, "voiceCoachingEnabled");
        Boolean bpm = bool(root, "bpmGuideEnabled");
        String mode = null;
        if (root.has("locationRecordingMode")) {
            JsonNode value = root.get("locationRecordingMode");
            if (!value.isString()
                    || !Set.of("ALWAYS", "RUNNING_ONLY", "OFF").contains(value.asString())) {
                throw invalid();
            }
            mode = value.asString();
        }
        Boolean group = null;
        Boolean community = null;
        if (root.has("notifications")) {
            JsonNode value = root.get("notifications");
            if (!value.isObject()) {
                throw invalid();
            }
            keys(value, Set.of("groupRun", "community"));
            group = bool(value, "groupRun");
            community = bool(value, "community");
        }
        return new UserSettingsRequest(voice, bpm, mode, group, community);
    }

    private static void keys(JsonNode node, Set<String> allowed) {
        for (String key : node.propertyNames()) {
            if (!allowed.contains(key)) {
                throw invalid();
            }
        }
    }

    private static Boolean bool(JsonNode node, String key) {
        if (!node.has(key)) {
            return null;
        }
        JsonNode value = node.get(key);
        if (!value.isBoolean()) {
            throw invalid();
        }
        return value.asBoolean();
    }

    private static ApiException invalid() {
        return new ApiException(ErrorCode.INVALID_SETTING);
    }
}
