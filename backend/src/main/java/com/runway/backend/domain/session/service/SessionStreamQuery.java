package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

/** S10 전송마다 읽는 최신 스냅샷. 회원 탈퇴·세션 삭제·소유자 불일치면 빈 값을 돌려주고 호출자가 스트림을 닫는다. */
@Service
@RequiredArgsConstructor
public class SessionStreamQuery {

    private final RunningSessionRepository sessionRepository;
    private final SessionReferenceRepository referenceRepository;
    private final SessionAccess access;

    /** S02와 같은 일관성으로 상태·계획·명령을 한 스냅샷에서 읽는다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Optional<RunningSessionResponse> current(long userId, long sessionId) {
        if (!referenceRepository.activeUserExists(userId)) {
            return Optional.empty();
        }
        return sessionRepository
                .findById(sessionId)
                .filter(session -> !session.isDeleted() && session.getUserId() == userId)
                .map(session -> access.response(session, Instant.now()));
    }
}
