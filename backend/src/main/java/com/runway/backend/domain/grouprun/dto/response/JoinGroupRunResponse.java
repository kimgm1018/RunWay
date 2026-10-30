package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;

public record JoinGroupRunResponse(long groupRunId, long userId, Instant joinedAt) {}
