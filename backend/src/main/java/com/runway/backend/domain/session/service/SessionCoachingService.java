package com.runway.backend.domain.session.service;

import com.runway.backend.domain.coaching.decide.CoachingInputAssembler;
import com.runway.backend.domain.coaching.decide.CoachingPublishRule;
import com.runway.backend.domain.coaching.decide.CoachingSource;
import com.runway.backend.domain.coaching.decide.PaceDecider;
import com.runway.backend.domain.coaching.decide.PaceDecision;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.PacePlanSegment;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.PacePlanRepository;
import com.runway.backend.domain.session.repository.PacePlanSegmentRepository;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionCoachingRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.global.exception.ApiException;

import lombok.extern.slf4j.Slf4j;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;

/**
 * 서버 내부 COACHING 발행(pace-coaching.md "코칭을 보내는 시점", S15P31E105-421). 새 측정 batch가 저장되면 AI04로 판단해 유효한 추천만
 * COACHING 명령으로 승인한다.
 *
 * <ol>
 *   <li><b>준비</b>(읽기 트랜잭션, 잠금 없음): 발행 전제를 확인하고 AI04 입력을 만든다. 입력이 부족하거나 20초 이상 오래됐으면 끝낸다.
 *   <li><b>판단</b>(트랜잭션 밖): AI04를 최대 3초 동안 부른다. 원격 호출이 세션 잠금·W07·P07을 막지 않게 한다.
 *   <li><b>확정</b>(쓰기 트랜잭션, 세션 잠금): 상태 버전·발행 전제를 다시 확인하고 발행 규칙({@link CoachingPublishRule})을 통과한 추천만
 *       저장·승인한다. AI 호출 중 일시정지·수동 BPM·종료·폰 인계가 있었다면 버전 또는 전제가 달라져 버린다.
 * </ol>
 *
 * <p>수동 제어·다른 코칭과는 세션 잠금, 요청 슬롯(uq_control_version), 미확정 명령 1개(uq_control_pending)로 직렬화된다. 폰의 S10 구독이
 * 없는 세션은 호출자({@code CoachingTrigger})가 판단하지 않는다.
 */
@Slf4j
@Service
public class SessionCoachingService {

    /** 코칭 없이 다시 판단해 유지 안내를 보내는 간격. */
    static final Duration REEVALUATE_AFTER = Duration.ofMinutes(2);

    /**
     * 적용되지 않은 코칭(REJECTED·IGNORED) 뒤 다시 발행할 수 있는 최소 간격(S15P31E105-257 리뷰 R-1). 같은 실패가 batch마다 반복돼 사용자
     * 조작을 막지 않게 한다.
     */
    static final Duration RETRY_AFTER_NOT_APPLIED = Duration.ofSeconds(30);

    private final SessionAccess access;
    private final SessionReferenceRepository referenceRepository;
    private final RunningSessionRepository sessionRepository;
    private final SessionCoachingRepository coachingRepository;
    private final SessionControlEventRepository controlEventRepository;
    private final PacePlanRepository pacePlanRepository;
    private final PacePlanSegmentRepository segmentRepository;
    private final PaceDecider decider;
    private final ApplicationEventPublisher events;
    private final JsonMapper jsonMapper;
    private final TransactionTemplate readTx;
    private final TransactionTemplate writeTx;

    /**
     * 직전에 보낸 코칭이 감속 권고(EASE_OFF)였던 세션. 감속 권고가 이어질 때 30초 간격을 적용하는 데 쓴다(리뷰 B-6). DB에 판단 종류 컬럼이
     * 없어 메모리에만 두며, 서버를 재시작하면 비어 감속 권고가 한 번 더 바로 나갈 수 있다(2026-11-05 사용자 확정).
     */
    private final Map<Long, Instant> lastIssuedEaseOff = new ConcurrentHashMap<>();

    /**
     * 감속 권고 기억의 유효시간. 그 사이 다른 코칭(2분 유지 안내 포함)을 보내면 기억은 지워지므로, 이보다 오래된 기억은 끝난 세션의 것이다. 기억이
     * 쌓이지 않게 정리한다(후속 리뷰 F-3).
     */
    static final Duration EASE_OFF_MEMORY = Duration.ofMinutes(10);

    private static final int EASE_OFF_SWEEP_SIZE = 1024;

    public SessionCoachingService(
            SessionAccess access,
            SessionReferenceRepository referenceRepository,
            RunningSessionRepository sessionRepository,
            SessionCoachingRepository coachingRepository,
            SessionControlEventRepository controlEventRepository,
            PacePlanRepository pacePlanRepository,
            PacePlanSegmentRepository segmentRepository,
            PaceDecider decider,
            ApplicationEventPublisher events,
            JsonMapper jsonMapper,
            PlatformTransactionManager transactionManager) {
        this.access = access;
        this.referenceRepository = referenceRepository;
        this.sessionRepository = sessionRepository;
        this.coachingRepository = coachingRepository;
        this.controlEventRepository = controlEventRepository;
        this.pacePlanRepository = pacePlanRepository;
        this.segmentRepository = segmentRepository;
        this.decider = decider;
        this.events = events;
        this.jsonMapper = jsonMapper;
        this.readTx = new TransactionTemplate(transactionManager);
        this.readTx.setReadOnly(true);
        this.writeTx = new TransactionTemplate(transactionManager);
    }

    /** 준비 단계 결과. */
    record Prepared(long userId, CoachingInputAssembler.Assembled input) {}

    /** {@link #issueIfDue(long, BooleanSupplier)}를 호출 빈도 제한 없이 부른다. */
    public Optional<SessionControlEvent> issueIfDue(long sessionId) {
        return issueIfDue(sessionId, () -> true);
    }

    /**
     * 조건을 만족하면 AI04로 판단해 코칭 명령을 하나 승인한다. 트랜잭션 안에서 부르지 않는다.
     *
     * @param callPermit AI04를 부르기 직전에 확인하는 호출 허가(세션별 호출 간격 제한). false면 부르지 않는다
     * @return 승인한 명령. 조건을 만족하지 않거나 판단이 없으면 빈 값
     */
    public Optional<SessionControlEvent> issueIfDue(long sessionId, BooleanSupplier callPermit) {
        Prepared prepared = readTx.execute(status -> prepare(sessionId, now()));
        if (prepared == null || !callPermit.getAsBoolean()) {
            return Optional.empty();
        }
        Optional<PaceDecision> decision = decider.decide(prepared.input().request());
        if (decision.isEmpty()) {
            return Optional.empty();
        }
        SessionControlEvent command =
                writeTx.execute(status -> confirm(sessionId, prepared, decision.get(), now()));
        return Optional.ofNullable(command);
    }

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** 잠금 없이 발행 전제를 확인하고 AI04 입력을 만든다. 만들 수 없으면 null. */
    private Prepared prepare(long sessionId, Instant now) {
        var ownership = referenceRepository.findOwnership(sessionId).orElse(null);
        if (ownership == null || ownership.deleted()) {
            return null;
        }
        RunningSession session = sessionRepository.findById(sessionId).orElse(null);
        if (session == null || session.isDeleted() || !eligible(session, now)) {
            return null;
        }
        CoachingSource source = source(session);
        CoachingInputAssembler.Result result = CoachingInputAssembler.assemble(source, now);
        if (result.assembled() == null) {
            log.debug("코칭 판단 생략 (sessionId={}, {})", sessionId, result.skip());
            return null;
        }
        return new Prepared(session.getUserId(), result.assembled());
    }

    private CoachingSource source(RunningSession session) {
        long sessionId = session.getId();
        CoachingSource.Plan plan =
                pacePlanRepository
                        .findFirstBySessionIdOrderByIdDesc(sessionId)
                        .map(this::plan)
                        .orElse(null);
        CourseData course = course(session.getCourseId());
        return new CoachingSource(
                sessionId,
                // 발행 전제에서 동의를 확인했으므로 동의 사용자다.
                session.getUserId(),
                session.getStateVersion(),
                session.getStartedAt(),
                session.getGoalDistance(),
                session.getGoalDuration(),
                session.getGoalPace(),
                course == null ? null : course.distanceM(),
                course == null ? null : course.profile(),
                plan,
                coachingRepository.lastAppliedCoaching(sessionId).orElse(null),
                coachingRepository.lastAppliedResume(sessionId).orElse(null),
                coachingRepository.recentSamples(
                        sessionId, CoachingInputAssembler.HISTORY_CELLS * 5));
    }

    private CoachingSource.Plan plan(PacePlan plan) {
        List<CoachingSource.PlanSegment> segments = new ArrayList<>();
        for (PacePlanSegment s : segmentRepository.findByPacePlanIdOrderBySegmentSequenceAsc(plan.getId())) {
            segments.add(
                    new CoachingSource.PlanSegment(
                            s.getStartDistance(), s.getEndDistance(), s.getRecommendedPace()));
        }
        return new CoachingSource.Plan(plan.getRecommendedPace(), segments);
    }

    private record CourseData(
            BigDecimal distanceM, List<CoachingSource.GradeSegment> profile) {}

    /** 코스 거리와 100m 경사. 경사 JSON을 읽을 수 없으면 경사만 모름으로 둔다. */
    private CourseData course(Long courseId) {
        if (courseId == null) {
            return null;
        }
        var course = coachingRepository.courseGrade(courseId).orElse(null);
        if (course == null) {
            return null;
        }
        return new CourseData(course.distanceM(), gradeProfile(course.profileJson()));
    }

    private List<CoachingSource.GradeSegment> gradeProfile(String json) {
        if (json == null) {
            return null;
        }
        try {
            JsonNode root = jsonMapper.readTree(json);
            if (root == null || !root.isArray()) {
                return null;
            }
            List<CoachingSource.GradeSegment> result = new ArrayList<>();
            for (JsonNode node : root) {
                JsonNode start = node.get("startDistanceM");
                JsonNode end = node.get("endDistanceM");
                JsonNode grade = node.get("gradePercent");
                if (start == null || end == null || grade == null
                        || !start.isNumber() || !end.isNumber() || !grade.isNumber()) {
                    return null;
                }
                result.add(
                        new CoachingSource.GradeSegment(
                                start.doubleValue(), end.doubleValue(), grade.doubleValue()));
            }
            return result;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 세션 잠금 아래에서 다시 확인하고 추천 저장·명령 승인을 한 트랜잭션으로 처리한다. 보내지 않으면 null. */
    private SessionControlEvent confirm(
            long sessionId, Prepared prepared, PaceDecision decision, Instant now) {
        RunningSession session;
        try {
            session =
                    access.lockOwnedSession(
                                    prepared.userId(), sessionId, SessionAccess.LockPurpose.UPDATE)
                            .session();
        } catch (ApiException e) {
            // 탈퇴·삭제·잠금 사이 그룹 연결 변경 등. 다음 batch에서 다시 판단한다.
            return null;
        }
        var input = prepared.input();
        long version = session.getStateVersion();
        if (version != input.request().context().stateVersion() || !eligible(session, now)) {
            // AI 호출 중 일시정지·수동 BPM·종료·폰 인계 등으로 상태가 바뀌었다.
            return null;
        }
        Instant lastApplied = lastAppliedBase(session);
        Optional<CoachingPublishRule.Publish> publish =
                CoachingPublishRule.evaluate(
                        decision,
                        version,
                        input.inputAsOf(),
                        input.anchorPace(),
                        session.getCurrentBpm(),
                        coachingRepository.hasAppliedManualBpm(sessionId),
                        previousEaseOff(sessionId, now),
                        !now.isBefore(lastApplied.plus(REEVALUATE_AFTER)),
                        lastApplied,
                        now);
        if (publish.isEmpty()) {
            return null;
        }
        long coachingId =
                coachingRepository.insertDecision(
                        sessionId,
                        (int) input.request().elapsedSec(),
                        publish.get().recommendedPace(),
                        publish.get().targetBpm(),
                        // 유지 안내는 AI가 고른 페이스가 아니므로 그 예측 심박을 남기지 않는다.
                        publish.get().followsDecision() ? decision.predictedHr30Bpm() : null,
                        publish.get().followsDecision() ? decision.predictedHr60Bpm() : null,
                        publish.get().followsDecision() ? decision.predictedHr120Bpm() : null,
                        decision.routeProgressM(),
                        version,
                        now,
                        publish.get().expiresAt());
        SessionControlEvent command =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.bpmRequest(
                                sessionId,
                                session.getControlDeviceId(),
                                ControlAction.COACHING,
                                version,
                                publish.get().targetBpm(),
                                coachingId,
                                now));
        events.publishEvent(SessionStreamChanged.coaching(sessionId));
        boolean easeOff =
                publish.get().followsDecision() && decision.action() == PaceDecision.Action.EASE_OFF;
        // 커밋된 명령만 기록한다.
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        if (easeOff) {
                            rememberEaseOff(sessionId, now);
                        } else {
                            lastIssuedEaseOff.remove(sessionId);
                        }
                    }
                });
        return command;
    }

    private boolean previousEaseOff(long sessionId, Instant now) {
        Instant at = lastIssuedEaseOff.get(sessionId);
        return at != null && now.isBefore(at.plus(EASE_OFF_MEMORY));
    }

    private void rememberEaseOff(long sessionId, Instant now) {
        if (lastIssuedEaseOff.size() >= EASE_OFF_SWEEP_SIZE) {
            Instant cutoff = now.minus(EASE_OFF_MEMORY);
            lastIssuedEaseOff.values().removeIf(at -> at.isBefore(cutoff));
        }
        lastIssuedEaseOff.put(sessionId, now);
    }

    /**
     * 발행 전제(2분 조건 제외): 워치로 기록 중인 RUNNING, 건강정보 동의, 그룹 미종료, 현재 제어기기의 미확정 명령 없음, 같은 요청 슬롯 미사용, 적용되지
     * 않은 직전 코칭 뒤 30초 경과.
     */
    private boolean eligible(RunningSession session, Instant now) {
        if (session.getStatus() != RunningSessionStatus.RUNNING
                || session.getStateVersion() < 1
                || session.getStartedAt() == null
                || session.getControlDeviceId() == null
                || session.isPhoneFallback()) {
            return false;
        }
        if (!coachingRepository.healthConsented(session.getUserId())) {
            return false;
        }
        if (access.groupEndedAt(session.getId()).isPresent()) {
            return false;
        }
        if (access.pendingCommand(session) != null
                || controlEventRepository
                        .findBySessionIdAndExpectedVersion(session.getId(), session.getStateVersion())
                        .isPresent()) {
            return false;
        }
        var lastCoaching = coachingRepository.lastCoaching(session.getId());
        return lastCoaching.isEmpty()
                || lastCoaching.get().applied()
                || !now.isBefore(lastCoaching.get().issuedAt().plus(RETRY_AFTER_NOT_APPLIED));
    }

    /** 마지막 실제 시작·재개·코칭 적용 시각 중 가장 최근 값. 서버에 APPLIED로 확인된 시각만 쓴다. */
    private Instant lastAppliedBase(RunningSession session) {
        Instant base = session.getStartedAt();
        Optional<Instant> lastApplied =
                coachingRepository.lastAppliedResumeOrCoaching(session.getId());
        if (lastApplied.isPresent() && lastApplied.get().isAfter(base)) {
            base = lastApplied.get();
        }
        return base;
    }
}
