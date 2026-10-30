package com.runway.backend.domain.community.dto.response;

import com.runway.backend.domain.community.entity.Region;

public record RegionItemResponse(String regionCode, String sidoName, String sigunguName) {

    public static RegionItemResponse from(Region region) {
        return new RegionItemResponse(
                region.getRegionCode(), region.getSidoName(), region.getSigunguName());
    }
}
