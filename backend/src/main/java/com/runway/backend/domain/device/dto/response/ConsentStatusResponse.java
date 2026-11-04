package com.runway.backend.domain.device.dto.response;

import java.util.List;

/** W05 응답. 네 동의 유형을 고정 순서로 담는다. */
public record ConsentStatusResponse(List<ConsentResponse> items) {}
