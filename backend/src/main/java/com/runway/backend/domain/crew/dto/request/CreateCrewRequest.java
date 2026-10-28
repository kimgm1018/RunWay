package com.runway.backend.domain.crew.dto.request;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** M03 생성 요청. 스키마에 없는 필드(imageId, regionName, regionPosition, level)는 수신만 하고 저장하지 않는다. */
public record CreateCrewRequest(
        @NotBlank @Size(max = 100) String name,
        @Size(max = 10000) String description,
        @Size(max = 1024) String imageKey,
        @Size(max = 40) String regionCode,
        @NotNull @Min(1) @Max(200) Integer capacity,
        @Size(max = 36) String imageId,
        @Size(max = 200) String regionName,
        JsonNode regionPosition,
        @Size(max = 32) String level) {}
