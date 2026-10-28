package com.runway.backend.global.geo;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * GeoJSON Point. coordinates는 [longitude, latitude] 순서의 2차원만 허용한다(고도 Z 거절).
 *
 * @see <a href="https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.2">RFC 7946 §3.1.2</a>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GeoJsonPoint(String type, List<Double> coordinates) {

    public static final String TYPE = "Point";

    public GeoJsonPoint {
        requireNonNull(type, "type");
        requireNonNull(coordinates, "coordinates");
        if (!TYPE.equals(type)) {
            throw new IllegalArgumentException("GeoJSON Point type must be \"Point\"");
        }
        if (coordinates.size() != 2) {
            throw new IllegalArgumentException("GeoJSON Point coordinates must be [lon, lat]");
        }
        double lon = requireFinite(coordinates.get(0), "longitude");
        double lat = requireFinite(coordinates.get(1), "latitude");
        if (lon < -180.0 || lon > 180.0) {
            throw new IllegalArgumentException("longitude must be between -180 and 180");
        }
        if (lat < -90.0 || lat > 90.0) {
            throw new IllegalArgumentException("latitude must be between -90 and 90");
        }
        coordinates = List.of(lon, lat);
    }

    public static GeoJsonPoint of(double longitude, double latitude) {
        return new GeoJsonPoint(TYPE, List.of(longitude, latitude));
    }

    public double longitude() {
        return coordinates.get(0);
    }

    public double latitude() {
        return coordinates.get(1);
    }

    private static void requireNonNull(Object value, String name) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
    }

    private static double requireFinite(Double value, String name) {
        if (value == null || !Double.isFinite(value)) {
            throw new IllegalArgumentException(name + " must be a finite number");
        }
        return value;
    }
}
