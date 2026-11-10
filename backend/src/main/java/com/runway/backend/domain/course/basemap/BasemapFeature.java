package com.runway.backend.domain.course.basemap;

import java.util.List;
import java.util.Locale;

/**
 * Route 바탕 지도 지형지물 하나(검증을 통과한 값). 저장하지 않고 썸네일을 그리는 데만 쓴다.
 *
 * @param kind 종류
 * @param roadClass 도로 등급. 도로가 아니거나 등급을 모르면 null
 * @param polygon true면 Polygon(첫 고리가 바깥, 나머지는 구멍), false면 LineString(부분 하나)
 * @param parts 좌표 배열들. 각 배열은 {@code [lon0, lat0, lon1, lat1, ...]}
 * @param heightM 건물 높이(m, Route 계약 검증값). 건물이 아니면 0. 평면 썸네일은 쓰지 않는다
 */
public record BasemapFeature(
        Kind kind, RoadClass roadClass, boolean polygon, List<double[]> parts, double heightM) {

    public BasemapFeature {
        parts = List.copyOf(parts);
    }

    /** 지형지물 종류. Route 계약의 kind 문자열은 이름의 소문자다. */
    public enum Kind {
        SEA,
        GREEN,
        PARK,
        BEACH,
        WATER,
        RIVER,
        COAST,
        ROAD,
        BUILDING;

        /** 계약 문자열(소문자)로 찾는다. 없으면 null. */
        public static Kind fromWire(String value) {
            for (Kind kind : values()) {
                if (kind.wire().equals(value)) {
                    return kind;
                }
            }
            return null;
        }

        public String wire() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /** 도로 등급. rank가 작을수록 큰 길이다(그리기는 rank가 큰 것부터). */
    public enum RoadClass {
        MOTORWAY(0),
        TRUNK(1),
        PRIMARY(2),
        SECONDARY(3),
        TERTIARY(4),
        UNCLASSIFIED(5),
        RESIDENTIAL(6),
        LIVING_STREET(7),
        PEDESTRIAN(8),
        FOOTWAY(9),
        PATH(9),
        CYCLEWAY(9);

        private final int rank;

        RoadClass(int rank) {
            this.rank = rank;
        }

        public int rank() {
            return rank;
        }

        /** 계약 문자열(소문자)로 찾는다. 없으면 null. */
        public static RoadClass fromWire(String value) {
            for (RoadClass roadClass : values()) {
                if (roadClass.name().toLowerCase(Locale.ROOT).equals(value)) {
                    return roadClass;
                }
            }
            return null;
        }
    }
}
