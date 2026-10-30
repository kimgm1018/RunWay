package com.runway.backend.domain.runningrecord.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record RunningRecordListResponse(List<RunningRecordListItemResponse> items, String page) {}
