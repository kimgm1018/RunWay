package com.runway.backend.domain.user.dto.request;

/** Validated partial patch. Null means omitted; explicit JSON null is rejected before creation. */
public record UserSettingsRequest(
        Boolean voiceCoachingEnabled,
        Boolean bpmGuideEnabled,
        String locationRecordingMode,
        Boolean groupRun,
        Boolean community) {}
