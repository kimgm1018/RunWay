package com.runway.backend.domain.survey.dto.response;

import java.time.Instant;

/** SV01 응답. submittedAt은 DB가 기록한 제출 시각(created_at)이다. */
public record SatisfactionSurveyResponse(
        long surveyId, int score, String comment, String source, Instant submittedAt) {}
