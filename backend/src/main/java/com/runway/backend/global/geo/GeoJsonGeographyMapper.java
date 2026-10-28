package com.runway.backend.global.geo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * GeoJSON Point/LineString과 PostGIS geography용 EWKT(SRID=4326) 상호 변환.
 *
 * <p>스키마의 {@code geography(...,4326)} 컬럼에는 {@code ST_GeogFromText} 등으로 EWKT를 넘긴다. 좌표 순서는
 * GeoJSON·WKT 모두 longitude latitude 이다. 2차원만 허용한다.
 *
 * <p>읽기 시 SRID가 없는 WKT({@code POINT(...)} 등)는 WGS84(4326)로 해석한다. {@link #toEwkt}는 항상 {@code
 * SRID=4326;} 접두를 붙인다.
 */
public final class GeoJsonGeographyMapper {

    public static final int SRID_WGS84 = 4326;
    private static final int MAX_ERROR_INPUT_CHARS = 80;

    private static final Pattern EWKT_POINT =
            Pattern.compile(
                    "^\\s*(?:SRID\\s*=\\s*(\\d+)\\s*;\\s*)?POINT\\s*\\(\\s*"
                            + "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)"
                            + "\\s+"
                            + "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)"
                            + "\\s*\\)\\s*$",
                    Pattern.CASE_INSENSITIVE);

    private static final Pattern EWKT_LINESTRING =
            Pattern.compile(
                    "^\\s*(?:SRID\\s*=\\s*(\\d+)\\s*;\\s*)?LINESTRING\\s*\\((.+)\\)\\s*$",
                    Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private GeoJsonGeographyMapper() {}

    public static String toEwkt(GeoJsonPoint point) {
        requireNonNull(point, "point");
        return String.format(
                Locale.ROOT,
                "SRID=%d;POINT(%s %s)",
                SRID_WGS84,
                formatOrdinate(point.longitude()),
                formatOrdinate(point.latitude()));
    }

    public static String toEwkt(GeoJsonLineString lineString) {
        requireNonNull(lineString, "lineString");
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < lineString.coordinates().size(); i++) {
            if (i > 0) {
                body.append(", ");
            }
            List<Double> position = lineString.coordinates().get(i);
            body.append(formatOrdinate(position.get(0)))
                    .append(' ')
                    .append(formatOrdinate(position.get(1)));
        }
        return "SRID=" + SRID_WGS84 + ";LINESTRING(" + body + ")";
    }

    public static GeoJsonPoint fromEwktPoint(String ewkt) {
        requireNonNull(ewkt, "ewkt");
        Matcher matcher = EWKT_POINT.matcher(ewkt.trim());
        if (!matcher.matches()) {
            throw new IllegalArgumentException("not a POINT EWKT: " + preview(ewkt));
        }
        requireSrid4326OrAbsent(matcher.group(1));
        return GeoJsonPoint.of(parseDouble(matcher.group(2)), parseDouble(matcher.group(3)));
    }

    public static GeoJsonLineString fromEwktLineString(String ewkt) {
        requireNonNull(ewkt, "ewkt");
        Matcher matcher = EWKT_LINESTRING.matcher(ewkt.trim());
        if (!matcher.matches()) {
            throw new IllegalArgumentException("not a LINESTRING EWKT: " + preview(ewkt));
        }
        requireSrid4326OrAbsent(matcher.group(1));
        // limit -1 keeps trailing empty tokens so "…," is rejected
        String[] pairs = matcher.group(2).split(",", -1);
        if (pairs.length < 2) {
            throw new IllegalArgumentException("LINESTRING needs at least 2 positions");
        }
        List<List<Double>> positions = new ArrayList<>(pairs.length);
        for (String pair : pairs) {
            String trimmed = pair.trim();
            if (trimmed.isEmpty()) {
                throw new IllegalArgumentException("LINESTRING has an empty position");
            }
            String[] parts = trimmed.split("\\s+");
            if (parts.length != 2) {
                throw new IllegalArgumentException(
                        "LINESTRING position must be \"lon lat\" (2D only)");
            }
            positions.add(List.of(parseDouble(parts[0]), parseDouble(parts[1])));
        }
        return GeoJsonLineString.of(positions);
    }

    private static void requireSrid4326OrAbsent(String sridText) {
        if (sridText == null) {
            return;
        }
        final int srid;
        try {
            srid = Integer.parseInt(sridText);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("invalid SRID: " + sridText, ex);
        }
        if (srid != SRID_WGS84) {
            throw new IllegalArgumentException("SRID must be " + SRID_WGS84 + " but was " + srid);
        }
    }

    private static double parseDouble(String text) {
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("invalid ordinate: " + text, ex);
        }
    }

    private static void requireNonNull(Object value, String name) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
    }

    private static String preview(String input) {
        String trimmed = input.trim();
        if (trimmed.length() <= MAX_ERROR_INPUT_CHARS) {
            return trimmed;
        }
        return trimmed.substring(0, MAX_ERROR_INPUT_CHARS) + "...";
    }

    private static String formatOrdinate(double value) {
        return Double.toString(value);
    }
}
