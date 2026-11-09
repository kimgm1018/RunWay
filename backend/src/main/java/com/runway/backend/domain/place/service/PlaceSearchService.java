package com.runway.backend.domain.place.service;

import com.runway.backend.domain.place.dto.response.PlaceSearchResponse;
import com.runway.backend.domain.place.dto.response.PlaceSearchResponse.Item;
import com.runway.backend.domain.place.search.PlaceSearchPort;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class PlaceSearchService {
    private final PlaceSearchPort searchPort;

    public PlaceSearchService(PlaceSearchPort searchPort) {
        this.searchPort = searchPort;
    }

    public PlaceSearchResponse search(String query, Double latitude, Double longitude) {
        String text = query == null ? "" : query.strip();
        if (text.codePointCount(0, text.length()) > 100) throw invalid();
        GeoJsonPoint reference = reference(latitude, longitude);
        if (text.isEmpty()) return new PlaceSearchResponse(List.of());
        var places = new LinkedHashSet<>(searchPort.search(text, reference));
        return new PlaceSearchResponse(
                places.stream().limit(10)
                        .map(p -> new Item(p.name(), p.address(), p.position().coordinates(),
                                reference == null ? null : distanceM(reference, p.position())))
                        .toList());
    }

    private static GeoJsonPoint reference(Double latitude, Double longitude) {
        if (latitude == null && longitude == null) return null;
        if (latitude == null || longitude == null) throw invalid();
        try {
            return GeoJsonPoint.of(longitude, latitude);
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
    }

    private static double distanceM(GeoJsonPoint from, GeoJsonPoint to) {
        double lat1 = Math.toRadians(from.latitude());
        double lat2 = Math.toRadians(to.latitude());
        double dLat = lat2 - lat1;
        double dLon = Math.toRadians(to.longitude() - from.longitude());
        double a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLon / 2), 2);
        return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    }

    private static ApiException invalid() {
        return new ApiException(ErrorCode.VALIDATION_ERROR);
    }
}
