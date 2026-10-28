package com.runway.backend.global.geo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

class GeoJsonGeographyMapperTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void Point는_EWKT로_왕복한다() {
        GeoJsonPoint point = GeoJsonPoint.of(129.0, 35.0);

        String ewkt = GeoJsonGeographyMapper.toEwkt(point);
        assertThat(ewkt).isEqualTo("SRID=4326;POINT(129.0 35.0)");

        GeoJsonPoint roundTrip = GeoJsonGeographyMapper.fromEwktPoint(ewkt);
        assertThat(roundTrip.type()).isEqualTo("Point");
        assertThat(roundTrip.longitude()).isEqualTo(129.0);
        assertThat(roundTrip.latitude()).isEqualTo(35.0);
    }

    @Test
    void LineString은_EWKT로_왕복한다() {
        GeoJsonLineString line =
                GeoJsonLineString.of(List.of(List.of(129.0, 35.0), List.of(129.001, 35.001)));

        String ewkt = GeoJsonGeographyMapper.toEwkt(line);
        assertThat(ewkt).isEqualTo("SRID=4326;LINESTRING(129.0 35.0, 129.001 35.001)");

        GeoJsonLineString roundTrip = GeoJsonGeographyMapper.fromEwktLineString(ewkt);
        assertThat(roundTrip.type()).isEqualTo("LineString");
        assertThat(roundTrip.positionCount()).isEqualTo(2);
        assertThat(roundTrip.coordinates().get(0)).containsExactly(129.0, 35.0);
        assertThat(roundTrip.coordinates().get(1)).containsExactly(129.001, 35.001);
    }

    @Test
    void Point_GeoJSON_JSON_직렬화역직렬화한다() throws Exception {
        String json =
                """
                {"type":"Point","coordinates":[129.0,35.0]}
                """;
        GeoJsonPoint point = objectMapper.readValue(json, GeoJsonPoint.class);
        assertThat(point.longitude()).isEqualTo(129.0);
        assertThat(point.latitude()).isEqualTo(35.0);
        assertThat(
                        objectMapper
                                .readTree(objectMapper.writeValueAsString(point))
                                .get("type")
                                .asText())
                .isEqualTo("Point");
    }

    @Test
    void LineString_GeoJSON_JSON_직렬화역직렬화한다() throws Exception {
        String json =
                """
                {"type":"LineString","coordinates":[[129.0,35.0],[129.001,35.001]]}
                """;
        GeoJsonLineString line = objectMapper.readValue(json, GeoJsonLineString.class);
        assertThat(line.positionCount()).isEqualTo(2);
        assertThat(
                        objectMapper
                                .readTree(objectMapper.writeValueAsString(line))
                                .get("type")
                                .asText())
                .isEqualTo("LineString");
    }

    @Test
    void 잘못된_Point_type은_거절한다() {
        assertThatThrownBy(() -> new GeoJsonPoint("Polygon", List.of(129.0, 35.0)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 잘못된_위도는_거절한다() {
        assertThatThrownBy(() -> GeoJsonPoint.of(129.0, 91.0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 잘못된_경도는_거절한다() {
        assertThatThrownBy(() -> GeoJsonPoint.of(181.0, 35.0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 점_하나_LineString은_거절한다() {
        assertThatThrownBy(() -> GeoJsonLineString.of(List.of(List.of(129.0, 35.0))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 잘못된_LineString_type은_거절한다() {
        assertThatThrownBy(
                        () ->
                                new GeoJsonLineString(
                                        "MultiLineString",
                                        List.of(List.of(129.0, 35.0), List.of(129.1, 35.1))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void null_좌표는_IAE로_거절한다() {
        assertThatThrownBy(() -> new GeoJsonPoint("Point", null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GeoJsonGeographyMapper.fromEwktPoint(null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void GeoJSON_고도_Z는_거절한다() {
        assertThatThrownBy(() -> new GeoJsonPoint("Point", List.of(129.0, 35.0, 12.5)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                GeoJsonLineString.of(
                                        List.of(List.of(129.0, 35.0, 10.0), List.of(129.1, 35.1))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void SRID가_다르면_거절한다() {
        assertThatThrownBy(() -> GeoJsonGeographyMapper.fromEwktPoint("SRID=3857;POINT(129 35)"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 거대_SRID는_IAE로_거절한다() {
        assertThatThrownBy(
                        () ->
                                GeoJsonGeographyMapper.fromEwktPoint(
                                        "SRID=99999999999;POINT(129 35)"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void LineString_EWKT_비숫자와_Z_후행콤마는_거절한다() {
        assertThatThrownBy(
                        () ->
                                GeoJsonGeographyMapper.fromEwktLineString(
                                        "SRID=4326;LINESTRING(foo bar, 1 2)"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                GeoJsonGeographyMapper.fromEwktLineString(
                                        "SRID=4326;LINESTRING(129 35 10, 129.1 35.1 20)"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                GeoJsonGeographyMapper.fromEwktLineString(
                                        "SRID=4326;LINESTRING(129 35, 129.1 35.1,)"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void SRID_없는_POINT_WKT는_4326으로_읽는다() {
        GeoJsonPoint point = GeoJsonGeographyMapper.fromEwktPoint("POINT(129 35)");
        assertThat(point.longitude()).isEqualTo(129.0);
        assertThat(point.latitude()).isEqualTo(35.0);
    }
}
