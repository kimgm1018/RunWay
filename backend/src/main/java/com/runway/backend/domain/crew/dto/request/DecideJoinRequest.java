package com.runway.backend.domain.crew.dto.request;

import jakarta.validation.constraints.NotBlank;

public record DecideJoinRequest(@NotBlank String status) {}
