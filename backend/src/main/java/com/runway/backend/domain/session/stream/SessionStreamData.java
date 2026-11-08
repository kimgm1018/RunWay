package com.runway.backend.domain.session.stream;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import com.runway.backend.domain.session.dto.response.RunningSessionResponse;

/** S10 이벤트의 data. S02 전체 상태에 SERVER_END일 때만 commandId를 더한다. */
public record SessionStreamData(
        @JsonUnwrapped RunningSessionResponse session,
        @JsonInclude(JsonInclude.Include.NON_NULL) Long commandId) {}
