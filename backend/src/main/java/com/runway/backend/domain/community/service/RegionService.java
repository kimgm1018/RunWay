package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.response.RegionItemResponse;
import com.runway.backend.domain.community.dto.response.RegionListResponse;
import com.runway.backend.domain.community.repository.RegionRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RegionService {

    private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
    private static final String VALIDATION_MESSAGE = "요청 값이 유효하지 않습니다.";

    private final RegionRepository regionRepository;

    @Transactional(readOnly = true)
    public RegionListResponse list(Double latitude, Double longitude) {
        validateCoordinates(latitude, longitude);

        List<RegionItemResponse> items =
                regionRepository.findAllByOrderBySidoNameAscSigunguNameAscRegionCodeAsc().stream()
                        .map(RegionItemResponse::from)
                        .toList();
        // 좌표 기반 현재 지역 판정은 이번 범위 밖이다. 좌표를 받아도 항상 null.
        return new RegionListResponse(items, null);
    }

    private static void validateCoordinates(Double latitude, Double longitude) {
        if (latitude == null && longitude == null) {
            return;
        }
        List<Map<String, String>> fields = new ArrayList<>();
        if (latitude == null) {
            fields.add(field("latitude", "longitude와 함께 필요합니다."));
        }
        if (longitude == null) {
            fields.add(field("longitude", "latitude와 함께 필요합니다."));
        }
        if (!fields.isEmpty()) {
            throw validationError(fields);
        }
        try {
            GeoJsonPoint.of(longitude, latitude);
        } catch (IllegalArgumentException e) {
            throw validationError(List.of(field("latitude/longitude", e.getMessage())));
        }
    }

    private static ApiException validationError(List<Map<String, String>> fields) {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                VALIDATION_ERROR,
                VALIDATION_MESSAGE,
                Map.of("fields", List.copyOf(fields)));
    }

    private static Map<String, String> field(String name, String reason) {
        return Map.of("name", name, "reason", reason);
    }
}
