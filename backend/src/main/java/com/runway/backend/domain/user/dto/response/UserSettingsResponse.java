package com.runway.backend.domain.user.dto.response;

public record UserSettingsResponse(
        boolean voiceCoachingEnabled,
        boolean bpmGuideEnabled,
        String locationRecordingMode,
        Notifications notifications) {
    public record Notifications(boolean groupRun, boolean community) {}
}
