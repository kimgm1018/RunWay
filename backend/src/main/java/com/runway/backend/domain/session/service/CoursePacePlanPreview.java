package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.dto.response.CoursePacePlanResponse;
import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 코스 러닝 출발 화면용 계획 미리보기(S15P31E105-733). 세션 생성(S01)과 같은 계획 준비를 쓰고 아무것도 저장하지 않는다. 코스가 거리를
 * 정하므로 목표는 완주 시간이나 페이스 중 하나만 받는다. 트랜잭션 밖에서 호출해야 한다(원격 AI 호출).
 */
@Service
@RequiredArgsConstructor
public class CoursePacePlanPreview {
    private final SessionPlanPreparation preparation;
    private final SessionAccess access;

    public CoursePacePlanResponse preview(
            long userId, long courseId, Integer targetDurationSec, BigDecimal targetPaceSecPerKm) {
        if (targetDurationSec != null && targetPaceSecPerKm != null) {
            throw new ApiException(ErrorCode.INVALID_GOAL);
        }
        if (targetPaceSecPerKm != null && targetPaceSecPerKm.stripTrailingZeros().scale() > 2) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        // Same course check as S01 before any AI call: missing 404, not ACTIVE or another user's private
        // course 403 (review B-1).
        access.requireUsableCourse(userId, courseId);
        var prepared =
                preparation.prepare(
                        userId,
                        new SessionGoal(courseId, null, null, targetDurationSec, targetPaceSecPerKm));
        var draft =
                prepared.draft().orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
        List<RunningSessionResponse.Segment> segments = new ArrayList<>();
        int sequence = 1;
        for (var segment : draft.segments()) {
            segments.add(
                    new RunningSessionResponse.Segment(
                            sequence++,
                            segment.startDistanceM(),
                            segment.endDistanceM(),
                            segment.paceSecPerKm()));
        }
        return new CoursePacePlanResponse(
                courseId, draft.paceSecPerKm(), segments, prepared.personalResult());
    }
}
