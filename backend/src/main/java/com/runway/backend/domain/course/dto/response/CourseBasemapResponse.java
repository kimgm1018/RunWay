package com.runway.backend.domain.course.dto.response;

/**
 * C03 코스 썸네일(S15P31E105-612). 서버가 위에서 내려다본 평면으로 그린 썸네일 PNG(600×900)다.
 *
 * @param imageUrl 썸네일 이미지 URL({@code /api/v1/images/{imageId}}, 다른 이미지와 같은 F02 조회)
 * @param osmDataTimestamp OSM 데이터 기준 시각(ISO-8601 UTC). 알 수 없으면 null
 */
public record CourseBasemapResponse(String imageUrl, String osmDataTimestamp) {}
