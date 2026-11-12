package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.dto.response.RunningRouteResponse;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionRouteRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** S11 러닝 경로 조회(S15P31E105-549). 세션 확인과 위치 조회를 한 읽기 트랜잭션에서 하며 아무것도 잠그거나 바꾸지 않는다. */
@Service
@RequiredArgsConstructor
public class SessionRouteService {

    /** 표시용 응답 위치 상한(sessions.md S11 경로 선택 규칙 5). */
    static final int MAX_POINTS = 2000;

    private final SessionAccess access;
    private final RunningSessionRepository sessionRepository;
    private final SessionRouteRepository routeRepository;

    @Transactional(readOnly = true)
    public RunningRouteResponse route(long userId, long sessionId) {
        access.requireActiveUser(userId);
        RunningSession session =
                sessionRepository
                        .findById(sessionId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.isDeleted()) {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
        }
        if (session.getUserId() != userId) {
            throw new ApiException(ErrorCode.SESSION_FORBIDDEN);
        }
        List<RunningRouteResponse.Segment> segments =
                displaySegments(sessionId, session.getStartedAt(), session.getEndedAt()).stream()
                        .map(s -> new RunningRouteResponse.Segment(s.source(), s.coordinates()))
                        .toList();
        return new RunningRouteResponse(sessionId, segments);
    }

    /**
     * S11 경로 선택 규칙으로 고른 표시용 조각. 접근 권한 검사는 호출자가 먼저 한다(S11 본인, H09 공유 토큰). 시작 전 세션(startedAt
     * 없음)은 빈 목록이다. 좌표는 로그에 남기지 않는다.
     */
    @Transactional(readOnly = true)
    public List<RunningRouteSelector.Segment> displaySegments(
            long sessionId, Instant startedAt, Instant endedAt) {
        if (startedAt == null) {
            return List.of();
        }
        return RunningRouteSelector.select(
                routeRepository.findPoints(sessionId, startedAt, endedAt), MAX_POINTS);
    }
}
