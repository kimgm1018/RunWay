package com.runway.backend.domain.community.dto.response;

import java.util.List;

public record RegionListResponse(List<RegionItemResponse> items, String currentRegionCode) {}
