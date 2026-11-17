package com.runway.backend.domain.grouprun.dto.request;

import jakarta.validation.constraints.Pattern;

public record JoinNowGroupRunRequest(
        @Pattern(regexp = "WATCH|PHONE", message = "WATCH 또는 PHONE만 허용됩니다.")
                String recordingDevice) {}
