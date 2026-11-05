package com.runway.backend.domain.course.dto.request;

import com.runway.backend.global.geo.GeoJsonLineString;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.util.List;

/**
 * C10 선택 코스 저장 요청. C01 후보의 {@code route}·{@code distanceM}·{@code elevationProfile}과 {@code
 * candidateToken}을 받은 그대로 보낸다. 값이 하나라도 다르면 서명이 맞지 않아 저장하지 않는다.
 */
public record SaveGeneratedCourseRequest(
        @NotBlank String candidateToken,
        @NotNull GeoJsonLineString route,
        @NotNull BigDecimal distanceM,
        @NotEmpty List<@NotNull GradeSegment> elevationProfile) {}
