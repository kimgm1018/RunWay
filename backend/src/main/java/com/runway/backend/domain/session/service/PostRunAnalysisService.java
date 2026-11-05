package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.AnalysisStatus;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionAnalysisRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import com.runway.backend.domain.session.stream.SessionStreamChanged;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 세션 종료 후 분석(S15P31E105-312). 커밋된 END({@link PersonalSessionEndedEvent})만 대상으로 하며 요청 스레드와 별개로 실행한다.
 *
 * <p>트랜잭션은 단계마다 독립(REQUIRES_NEW)이며 순서는 다음과 같다.
 *
 * <ol>
 *   <li><b>선점</b>: 세션 행을 잠그고 PENDING이면 PROCESSING으로 바꿔 커밋한다. 행 잠금으로 직렬화되므로 같은 세션을 여러 경로가 동시에 불러도 한
 *       경로만 계산한다. 이미 PROCESSING·READY·FAILED·LEGACY이면 아무것도 하지 않는다(자동 재시도 없음).
 *   <li><b>계산·저장</b>: 세션 행을 다시 잠그고 W07 원본에서 계산해 세션 통계 덮어쓰기, 구간 교체, READY, stateVersion +1을 한 트랜잭션으로
 *       커밋한다.
 *   <li><b>실패</b>: 계산·저장이 실패하면 위 트랜잭션은 전부 롤백되고, 별도 트랜잭션에서 FAILED·stateVersion +1로 표시한다.
 * </ol>
 *
 * 비정상 종료로 PROCESSING에 남은 세션은 {@link #failInterruptedAnalyses()}가 기동 시 FAILED로 바꾼다.
 */
@Service
public class PostRunAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(PostRunAnalysisService.class);

    /** {@link #analyze(long)}의 결과. */
    public enum Outcome {
        /** 선점하지 못했다(이미 분석 중·완료·실패, 종료 전, 없는 세션 등). 상태를 바꾸지 않았다. */
        SKIPPED,
        /** 분석을 마쳐 READY로 저장했다. */
        READY,
        /** 분석이 실패해 FAILED로 표시했다. */
        FAILED
    }

    private final RunningSessionRepository sessionRepository;
    private final SessionControlEventRepository controlEventRepository;
    private final SessionAnalysisRepository analysisRepository;
    private final TransactionTemplate tx;
    private final ApplicationEventPublisher events;

    public PostRunAnalysisService(
            RunningSessionRepository sessionRepository,
            SessionControlEventRepository controlEventRepository,
            SessionAnalysisRepository analysisRepository,
            PlatformTransactionManager transactionManager,
            ApplicationEventPublisher events) {
        this.events = events;
        this.sessionRepository = sessionRepository;
        this.controlEventRepository = controlEventRepository;
        this.analysisRepository = analysisRepository;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 세션 하나를 동기로 분석한다. 이벤트 소비자와 테스트가 같은 진입점을 쓴다. 예외를 던지지 않으며 실패는 FAILED 상태로 남긴다.
     */
    public Outcome analyze(long sessionId) {
        try {
            if (!Boolean.TRUE.equals(tx.execute(status -> claim(sessionId)))) {
                return Outcome.SKIPPED;
            }
        } catch (RuntimeException e) {
            // 선점 커밋 여부를 알 수 없다. PENDING으로 남았으면 자동 재시도하지 않는다.
            log.warn("종료 후 분석 선점 실패 (sessionId={}, {})", sessionId, e.getClass().getSimpleName());
            return Outcome.SKIPPED;
        }
        try {
            tx.executeWithoutResult(status -> computeAndSave(sessionId));
            return Outcome.READY;
        } catch (RuntimeException e) {
            // 로그에는 세션 ID·예외 종류만 남긴다(메시지에 건강·위치 값이 들어갈 수 있다).
            log.warn("종료 후 분석 실패 (sessionId={}, {})", sessionId, e.getClass().getSimpleName());
            markFailed(sessionId);
            return Outcome.FAILED;
        }
    }

    /**
     * 기동 시 남아 있는 PROCESSING을 모두 FAILED로 바꾸고 stateVersion을 올린다. 자동으로 다시 분석하지 않는다.
     *
     * @return FAILED로 바뀐 세션 수
     */
    public int failInterruptedAnalyses() {
        Integer count = tx.execute(status -> analysisRepository.failProcessingSessions());
        return count == null ? 0 : count;
    }

    private boolean claim(long sessionId) {
        RunningSession session = sessionRepository.findByIdForUpdate(sessionId).orElse(null);
        if (session == null || !session.canStartAnalysis()) {
            return false;
        }
        session.startAnalysis(now());
        events.publishEvent(SessionStreamChanged.analysis(sessionId));
        return true;
    }

    private void computeAndSave(long sessionId) {
        RunningSession session =
                sessionRepository
                        .findByIdForUpdate(sessionId)
                        .orElseThrow(() -> new IllegalStateException("session not found"));
        if (session.getAnalysisStatus() != AnalysisStatus.PROCESSING) {
            throw new IllegalStateException("analysis is not PROCESSING");
        }
        List<AnalysisSample> samples = analysisRepository.findSamples(sessionId);
        List<PostRunAnalysisCalculator.PauseResumeEvent> pauseResumeEvents =
                controlEventRepository
                        .findBySessionIdAndActionInAndResultOrderByAppliedAtAscIdAsc(
                                sessionId,
                                List.of(ControlAction.PAUSE, ControlAction.RESUME),
                                ControlResult.APPLIED)
                        .stream()
                        .map(PostRunAnalysisService::toPauseResume)
                        .toList();

        PostRunAnalysisCalculator.Result result =
                PostRunAnalysisCalculator.calculate(
                        session.getStartedAt(),
                        session.getEndedAt(),
                        session.getGoalDistance(),
                        session.getGoalDuration(),
                        samples,
                        pauseResumeEvents);

        analysisRepository.replaceSplits(sessionId, result.splits());
        session.completeAnalysis(result.stats(), now());
        events.publishEvent(SessionStreamChanged.analysis(sessionId));
        // 커밋 전에 flush해 제약 위반을 이 트랜잭션의 실패(→ FAILED)로 다룬다.
        sessionRepository.flush();
    }

    private void markFailed(long sessionId) {
        try {
            tx.executeWithoutResult(
                    status ->
                            sessionRepository
                                    .findByIdForUpdate(sessionId)
                                    .filter(s -> s.getAnalysisStatus() == AnalysisStatus.PROCESSING)
                                    .ifPresent(
                                            s -> {
                                                s.failAnalysis(now());
                                                events.publishEvent(
                                                        SessionStreamChanged.analysis(sessionId));
                                            }));
        } catch (RuntimeException e) {
            // PROCESSING으로 남으면 다음 기동의 failInterruptedAnalyses가 FAILED로 바꾼다.
            log.error(
                    "종료 후 분석 FAILED 표시 실패 (sessionId={}, {})",
                    sessionId,
                    e.getClass().getSimpleName());
        }
    }

    private static PostRunAnalysisCalculator.PauseResumeEvent toPauseResume(SessionControlEvent event) {
        return new PostRunAnalysisCalculator.PauseResumeEvent(event.getAction(), event.getAppliedAt());
    }

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 DB 값과 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
