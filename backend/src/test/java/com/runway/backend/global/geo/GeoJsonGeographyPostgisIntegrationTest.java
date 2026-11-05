package com.runway.backend.global.geo;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class GeoJsonGeographyPostgisIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private JdbcTemplate jdbc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void geography_Point와_LineString을_GeoJSON으로_읽는다() throws Exception {
        GeoJsonPoint start = GeoJsonPoint.of(129.0, 35.0);
        GeoJsonLineString route =
                GeoJsonLineString.of(List.of(List.of(129.0, 35.0), List.of(129.001, 35.001)));

        String startEwkt = GeoJsonGeographyMapper.toEwkt(start);
        String routeEwkt = GeoJsonGeographyMapper.toEwkt(route);

        jdbc.update(
                """
                INSERT INTO courses(description, route, start_position, distance, status, region_code)
                VALUES (
                  '[geo-util-test]',
                  ST_GeogFromText(?),
                  ST_GeogFromText(?),
                  100.00,
                  'ACTIVE',
                  NULL
                )
                """,
                routeEwkt,
                startEwkt);

        String startJson =
                jdbc.queryForObject(
                        """
                        SELECT ST_AsGeoJSON(start_position::geometry)
                        FROM courses
                        WHERE description = '[geo-util-test]'
                        """,
                        String.class);
        String routeJson =
                jdbc.queryForObject(
                        """
                        SELECT ST_AsGeoJSON(route::geometry)
                        FROM courses
                        WHERE description = '[geo-util-test]'
                        """,
                        String.class);

        GeoJsonPoint readStart = objectMapper.readValue(startJson, GeoJsonPoint.class);
        GeoJsonLineString readRoute = objectMapper.readValue(routeJson, GeoJsonLineString.class);

        assertThat(readStart.longitude()).isEqualTo(129.0);
        assertThat(readStart.latitude()).isEqualTo(35.0);
        assertThat(readRoute.positionCount()).isEqualTo(2);
        assertThat(readRoute.coordinates().get(1)).containsExactly(129.001, 35.001);

        JsonNode startNode = objectMapper.readTree(startJson);
        assertThat(startNode.get("coordinates").get(0).asDouble()).isEqualTo(129.0);
        assertThat(startNode.get("coordinates").get(1).asDouble()).isEqualTo(35.0);

        jdbc.update("DELETE FROM courses WHERE description = '[geo-util-test]'");
    }
}
