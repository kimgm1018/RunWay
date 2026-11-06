package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.dto.response.RunningSessionResponse.RecordComparison;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.repository.SessionAnalysisRepository;
import com.runway.backend.domain.session.repository.SessionAnalysisRepository.ComparisonTarget;
import com.runway.backend.domain.session.repository.SessionAnalysisRepository.SampleMark;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import com.runway.backend.domain.session.service.RecordComparisonCalculator.Gap;
import com.runway.backend.domain.session.service.RecordComparisonCalculator.Track;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * S02/S10 {@code comparison}(sessions.md "기록 비교")을 저장된 샘플에서 계산한다. S02 응답을 만드는 호출자의 트랜잭션 안에서 읽기만 하며 결과를 저장하지 않는다.
 *
 * <p>비교 기록의 곡선은 종료된 러닝이라 거의 바뀌지 않으므로 메모리에 두고, 샘플 표식(개수·최대 ID)이나 적용된 일시정지·재개가 바뀌면 다시 만든다. 서버
 * 재시작 시 비워지며 {@link #MAX_CACHED}개를 넘으면 모두 비운다. 측정값은 로그에 남기지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RecordComparisonService {

    static final int MAX_CACHED = 256;

    static final String WAITING = "WAITING";
    static final String AVAILABLE = "AVAILABLE";
    static final String NO_RECORD = "NO_RECORD";
    static final String UNAVAILABLE = "UNAVAILABLE";

    private final SessionAnalysisRepository analysisRepository;
    private final SessionControlEventRepository controlEventRepository;

    private record CachedTrack(long userId, SampleMark mark, List<PauseResumeEvent> pauses, Track track) {}

    private final Map<Long, CachedTrack> pastTracks = new ConcurrentHashMap<>();
    private final Object[] cacheLocks = java.util.stream.IntStream.range(0, 64)
            .mapToObj(index -> new Object()).toArray();

    private Object cacheLock(long userId) {
        return cacheLocks[Math.floorMod(userId, cacheLocks.length)];
    }

    /** Called after withdrawal commits; an in-flight comparison cannot refill after this returns. */
    public void forgetUser(long userId) {
        synchronized (cacheLock(userId)) {
            pastTracks.entrySet().removeIf(entry -> entry.getValue().userId() == userId);
        }
    }


    /**
     * 비교 기록을 고르지 않은 세션은 null. 표시용 값이므로 계산 오류가 S01·S06·S08 등 같은 트랜잭션의 명령 저장을 막지 않게 WAITING으로 대신한다.
     * DB 오류는 트랜잭션이 이미 실패한 것이므로 그대로 던진다.
     */
    public RecordComparison compare(RunningSession session, Instant now) {
        Long targetId = session.getComparisonSessionId();
        if (targetId == null) {
            return null;
        }
        try {
            synchronized (cacheLock(session.getUserId())) {
                if (!analysisRepository.cacheOwnerActive(session.getUserId(), targetId)) {
                    pastTracks.remove(targetId);
                    return new RecordComparison(UNAVAILABLE, null, null, null, null);
                }
                return calculate(session, targetId, now);
            }
        } catch (DataAccessException e) {
            throw e;
        } catch (RuntimeException e) {
            // 측정값은 로그에 남기지 않는다.
            log.warn("기록 비교 계산 실패 (sessionId={}, {})", session.getId(), e.getClass().getSimpleName());
            return new RecordComparison(WAITING, null, null, null, null);
        }
    }

    private RecordComparison calculate(RunningSession session, long targetId, Instant now) {
        Optional<ComparisonTarget> found =
                analysisRepository.findComparisonTarget(session.getUserId(), targetId);
        if (found.isEmpty()
                || found.get().deleted()
                || !RunningSessionStatus.COMPLETED.name().equals(found.get().status())
                || found.get().startedAt() == null
                || found.get().endedAt() == null) {
            pastTracks.remove(targetId);
            return new RecordComparison(UNAVAILABLE, null, null, null, null);
        }
        ComparisonTarget target = found.get();
        Track past = pastTrack(session.getUserId(), targetId, target);
        if (past.distance() <= 0) {
            return new RecordComparison(NO_RECORD, target.startedAt(), null, null, null);
        }
        if (session.getStartedAt() == null) {
            return waiting(target);
        }
        Instant until = session.getEndedAt() != null ? session.getEndedAt() : now;
        Track current =
                RecordComparisonCalculator.track(
                        session.getStartedAt(),
                        until,
                        analysisRepository.findDistanceSamples(session.getId()),
                        pauseResumeEvents(session.getId()));
        Gap gap = RecordComparisonCalculator.compare(current, past);
        if (gap == null) {
            return waiting(target);
        }
        return new RecordComparison(
                AVAILABLE,
                target.startedAt(),
                gap.distanceM(),
                gap.currentElapsedSec(),
                gap.pastElapsedSec());
    }

    private static RecordComparison waiting(ComparisonTarget target) {
        return new RecordComparison(WAITING, target.startedAt(), null, null, null);
    }

    private Track pastTrack(long userId, long targetId, ComparisonTarget target) {
        // 늦게 도착한 batch(샘플 표식)나 종료 뒤 확정된 일시정지 결과가 있으면 다시 만든다.
        SampleMark mark = analysisRepository.sampleMark(targetId);
        List<PauseResumeEvent> pauses = pauseResumeEvents(targetId);
        CachedTrack cached = pastTracks.get(targetId);
        if (cached != null && cached.mark().equals(mark) && cached.pauses().equals(pauses)) {
            return cached.track();
        }
        Track track =
                RecordComparisonCalculator.track(
                        target.startedAt(),
                        target.endedAt(),
                        analysisRepository.findDistanceSamples(targetId),
                        pauses);
        if (pastTracks.size() >= MAX_CACHED) {
            pastTracks.clear();
        }
        pastTracks.put(targetId, new CachedTrack(userId, mark, pauses, track));
        return track;
    }

    private List<PauseResumeEvent> pauseResumeEvents(long sessionId) {
        return controlEventRepository
                .findBySessionIdAndActionInAndResultOrderByAppliedAtAscIdAsc(
                        sessionId,
                        List.of(ControlAction.PAUSE, ControlAction.RESUME),
                        ControlResult.APPLIED)
                .stream()
                .map(event -> new PauseResumeEvent(event.getAction(), event.getAppliedAt()))
                .toList();
    }

    int cachedCount() {
        return pastTracks.size();
    }
}
