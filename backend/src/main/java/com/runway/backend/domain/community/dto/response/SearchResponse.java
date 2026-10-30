package com.runway.backend.domain.community.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SearchResponse(
        List<SearchUserItemResponse> users, List<SearchCrewItemResponse> crews, String page) {}
