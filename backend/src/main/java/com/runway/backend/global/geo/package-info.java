/**
 * PostGIS geography와 API GeoJSON 사이 변환.
 *
 * <h2>세 가지 표현</h2>
 *
 * <ol>
 *   <li><b>원본(raw)</b> — GPX·앱·클라이언트 JSON. 사람이 주고받는 형태다. 코스 API 명세의 {@code route}/{@code
 *       startPosition}은 GeoJSON이다.
 *       <pre>{@code
 * {"type":"Point","coordinates":[129.0, 35.0]}
 * // coordinates = [경도 longitude, 위도 latitude]  (일상 “위도,경도”와 순서 반대)
 * }</pre>
 *   <li><b>DB</b> — PostgreSQL PostGIS {@code geography(Point|LineString,4326)}. 지구 표면 거리·반경
 *       검색({@code ST_DWithin} 등)에 쓰는 바이너리 공간 타입이다. ERD의 {@code courses.route}, {@code
 *       courses.start_position}, {@code group_runs.meeting_position} 등이 해당한다.
 *   <li><b>EWKT 문자열</b> — Java와 SQL을 잇는 중간 텍스트. 예: {@code SRID=4326;POINT(129.0 35.0)}. {@code
 *       ST_GeogFromText}로 DB에 넣고, {@code ST_AsGeoJSON}으로 다시 JSON을 읽을 수 있다.
 * </ol>
 *
 * <h2>이 패키지가 하는 일</h2>
 *
 * {@link com.runway.backend.global.geo.GeoJsonPoint} / {@link
 * com.runway.backend.global.geo.GeoJsonLineString} ↔ EWKT 변환·검증만 담당한다. 코스 API·JPA Entity 매핑·추천 로직은
 * 포함하지 않는다. Hibernate Spatial은 geography 스키마와 기본 geometry 매핑이 어긋날 수 있어 여기에서는 쓰지 않는다.
 *
 * <h2>변환 흐름</h2>
 *
 * <pre>{@code
 * [클라이언트 GeoJSON]
 *        ↕  Jackson + GeoJson* record
 * [GeoJsonPoint / GeoJsonLineString]
 *        ↕  GeoJsonGeographyMapper.toEwkt / fromEwkt*
 * [EWKT  "SRID=4326;…"]
 *        ↕  ST_GeogFromText / ST_AsGeoJSON (SQL)
 * [PostGIS geography]
 * }</pre>
 *
 * 쓰기: GeoJSON → {@code toEwkt} → {@code ST_GeogFromText(?)}. 읽기: {@code ST_AsGeoJSON(…::geometry)}
 * → Jackson으로 record, 또는 EWKT를 {@code fromEwkt*}로 복원.
 *
 * <h2>규칙</h2>
 *
 * <ul>
 *   <li>SRID는 WGS84 {@code 4326}만 허용한다. 접두 없는 WKT를 읽을 때는 4326으로 해석한다.
 *   <li>2차원만 허용한다. 고도(Z)는 거절한다(스키마가 2D geography).
 *   <li>잘못된 입력은 {@link IllegalArgumentException}으로 거절한다.
 * </ul>
 */
package com.runway.backend.global.geo;
