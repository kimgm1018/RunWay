package com.runway.backend.global.geo;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

/**
 * GeoJSON LineString. 각 좌표는 [longitude, latitude] 2차원만 허용한다(고도 Z 거절).
 *
 * @see <a href="https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.4">RFC 7946 §3.1.4</a>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GeoJsonLineString(String type, List<List<Double>> coordinates) {

    public static final String TYPE = "LineString";

    public GeoJsonLineString {
        requireNonNull(type, "type");
        requireNonNull(coordinates, "coordinates");
        if (!TYPE.equals(type)) {
            throw new IllegalArgumentException("GeoJSON LineString type must be \"LineString\"");
        }
        if (coordinates.size() < 2) {
            throw new IllegalArgumentException("GeoJSON LineString needs at least 2 positions");
        }
        List<List<Double>> normalized = new ArrayList<>(coordinates.size());
        for (List<Double> position : coordinates) {
            if (position == null || position.size() != 2) {
                throw new IllegalArgumentException(
                        "GeoJSON LineString position must be [lon, lat]");
            }
            normalized.add(GeoJsonPoint.of(position.get(0), position.get(1)).coordinates());
        }
        coordinates = List.copyOf(normalized);
    }

    public static GeoJsonLineString of(List<List<Double>> positions) {
        return new GeoJsonLineString(TYPE, positions);
    }

    public int positionCount() {
        return coordinates.size();
    }

    private static void requireNonNull(Object value, String name) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
    }
}
