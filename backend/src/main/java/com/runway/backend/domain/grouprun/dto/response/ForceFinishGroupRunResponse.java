package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;

public record ForceFinishGroupRunResponse(long groupRunId, String status, Instant endedAt) {}
