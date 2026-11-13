package com.runway.backend.domain.session.dto.response;

import java.math.BigDecimal;
import java.util.List;

/**
 * C12 출발 전 코스 페이스 계획 미리보기(S15P31E105-733). 세션 생성(S01) {@code plan}과 같은 모양이며 저장하지 않으므로 planId가
 * 없다. personalized는 건강정보 동의 회원의 AI 개인 계획 결과를 받았는지 여부다(미동의·AI 실패 대체는 false).
 */
public record CoursePacePlanResponse(
        long courseId,
        BigDecimal recommendedPaceSecPerKm,
        List<RunningSessionResponse.Segment> segments,
        boolean personalized) {

    public CoursePacePlanResponse {
        segments = List.copyOf(segments);
    }
}
