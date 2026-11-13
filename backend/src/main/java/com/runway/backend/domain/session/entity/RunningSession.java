package com.runway.backend.domain.session.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 러닝 세션의 현재 상태. 상태·목표·BPM의 확정 변경은 모두 stateVersion 하나로 보호한다. 기록 통계 컬럼은 종료 후 분석만 쓴다.
 */
@Entity
@Table(name = "running_sessions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RunningSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(name = "course_id")
    private Long courseId;

    @Column(name = "comparison_session_id")
    private Long comparisonSessionId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "running_sessions_status_enum")
    private RunningSessionStatus status;

    @Column(name = "goal_distance")
    private Integer goalDistance;

    @Column(name = "goal_duration")
    private Integer goalDuration;

    @Column(name = "goal_pace", precision = 10, scale = 2)
    private BigDecimal goalPace;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "control_device_id")
    private Long controlDeviceId;

    @Column(name = "relay_device_id")
    private Long relayDeviceId;

    @Column(name = "phone_only", nullable = false)
    private boolean phoneOnly;

    @Column(name = "state_version", nullable = false)
    private long stateVersion;

    @Column(name = "current_bpm")
    private Integer currentBpm;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "analysis_status",
            nullable = false,
            columnDefinition = "running_sessions_analysis_status_enum")
    private AnalysisStatus analysisStatus;

    // 종료 후 분석(S15P31E105-312)이 덮어쓰는 기록 통계. 분석 전·미측정은 null이다.
    @Column(name = "total_distance", precision = 12, scale = 2)
    private BigDecimal totalDistance;

    @Column(name = "moving_duration")
    private Integer movingDuration;

    @Column(name = "elapsed_duration")
    private Integer elapsedDuration;

    @Column(name = "moving_duration_to_goal")
    private Integer movingDurationToGoal;

    @Column(name = "goal_achieved")
    private Boolean goalAchieved;

    @Column(name = "average_pace", precision = 10, scale = 2)
    private BigDecimal averagePace;

    @Column(name = "average_heart_rate", precision = 7, scale = 2)
    private BigDecimal averageHeartRate;

    @Column(name = "average_cadence", precision = 8, scale = 2)
    private BigDecimal averageCadence;

    @Column(name = "max_heart_rate", precision = 7, scale = 2)
    private BigDecimal maxHeartRate;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** S01. 새 세션은 READY·stateVersion=1·분석 대기로 시작한다. */
    public static RunningSession ready(
            long userId, long controlDeviceId, long relayDeviceId, SessionGoal goal, Instant now) {
        RunningSession session = new RunningSession();
        session.userId = userId;
        session.controlDeviceId = controlDeviceId;
        session.relayDeviceId = relayDeviceId;
        session.phoneOnly = controlDeviceId == relayDeviceId;
        session.status = RunningSessionStatus.READY;
        session.stateVersion = 1;
        session.analysisStatus = AnalysisStatus.PENDING;
        session.applyGoal(goal);
        session.createdAt = now;
        session.updatedAt = now;
        return session;
    }

    public SessionGoal goal() {
        return new SessionGoal(courseId, comparisonSessionId, goalDistance, goalDuration, goalPace);
    }

    public boolean isActive() {
        return stateVersion >= 1
                && (status == RunningSessionStatus.READY
                        || status == RunningSessionStatus.RUNNING
                        || status == RunningSessionStatus.PAUSED);
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public boolean isPhoneFallback() {
        return !phoneOnly && isPhoneControlled();
    }

    public boolean isPhoneControlled() {
        return controlDeviceId != null && controlDeviceId.equals(relayDeviceId);
    }

    public boolean isPhoneOnly() {
        return phoneOnly;
    }

    /** S08 UPDATE_GOAL. 실제로 달라진 목표만 반영하며 버전을 1 올린다. */
    public void changeGoal(SessionGoal goal, Instant now) {
        applyGoal(goal);
        bumpVersion(now);
    }

    /** S08 TAKE_OVER_PHONE. 운동 상태·시작시각·목표는 유지하고 기록·제어만 중계 폰으로 넘긴다. */
    public void takeOverByRelayPhone(Instant now) {
        controlDeviceId = relayDeviceId;
        currentBpm = null;
        bumpVersion(now);
    }

    /** S08 ABORT_UNCONFIRMED_START. 실제 시작·종료시각은 추정하지 않으므로 null로 둔다. */
    public void abortUnconfirmedStart(Instant now) {
        status = RunningSessionStatus.INTERRUPTED;
        analysisStatus = AnalysisStatus.FAILED;
        currentBpm = null;
        bumpVersion(now);
    }

    /** 세션 제어 공통 계약 "작업별 승인 조건". START·PAUSE·RESUME·END만 상태를 바꾸며 SET_BPM·COACHING은 상태를 유지한다. */
    public static boolean canApprove(ControlAction action, RunningSessionStatus status) {
        return switch (action) {
            case START -> status == RunningSessionStatus.READY;
            case PAUSE -> status == RunningSessionStatus.RUNNING;
            case RESUME -> status == RunningSessionStatus.PAUSED;
            case END -> status == RunningSessionStatus.RUNNING || status == RunningSessionStatus.PAUSED;
            case SET_BPM ->
                    status == RunningSessionStatus.READY
                            || status == RunningSessionStatus.RUNNING
                            || status == RunningSessionStatus.PAUSED;
            case COACHING -> status == RunningSessionStatus.RUNNING;
        };
    }

    /**
     * P07 RESULT/APPLIED. 확정된 BPM을 저장하고 버전을 1 올린다. 같은 BPM이어도 새 명령의 확정이므로 버전은 증가한다. 운동 상태는 바꾸지 않는다.
     */
    public void applyBpm(int bpm, Instant now) {
        currentBpm = bpm;
        bumpVersion(now);
    }

    /**
     * S03~S06 RESULT/APPLIED. 실행기기가 보고한 실제 적용시각을 시작·종료시각으로 저장하고 버전을 1 올린다. 결과 저장과 같은 트랜잭션에서
     * 호출한다.
     */
    public void applyControl(ControlAction action, Instant appliedAt, Instant now) {
        if (!canApprove(action, status)) {
            throw new IllegalStateException(action + " cannot be applied from " + status);
        }
        switch (action) {
            case START -> {
                status = RunningSessionStatus.RUNNING;
                startedAt = appliedAt;
            }
            case PAUSE -> status = RunningSessionStatus.PAUSED;
            case RESUME -> status = RunningSessionStatus.RUNNING;
            case END -> {
                status = RunningSessionStatus.COMPLETED;
                endedAt = appliedAt;
            }
            default -> throw new IllegalStateException(action + " is not a state command");
        }
        bumpVersion(now);
    }

    /** RESULT/REJECTED. 운동 상태는 그대로 두고 요청 슬롯을 마감하기 위해 버전만 올린다. */
    public void confirmRejection(Instant now) {
        bumpVersion(now);
    }

    /** S07. 준비 상태만 취소하며 실제 시작·종료시각은 만들지 않는다. */
    public void cancel(Instant now) {
        if (status != RunningSessionStatus.READY) {
            throw new IllegalStateException("only READY can be cancelled: " + status);
        }
        status = RunningSessionStatus.CANCELLED;
        bumpVersion(now);
    }

    /** 종료 후 분석을 시작할 수 있는 세션인지. 신규 프로토콜의 COMPLETED이면서 분석 대기(PENDING)여야 한다. */
    public boolean canStartAnalysis() {
        return stateVersion >= 1
                && status == RunningSessionStatus.COMPLETED
                && analysisStatus == AnalysisStatus.PENDING;
    }

    /**
     * 분석 PENDING → PROCESSING. 세션 행을 잠근 트랜잭션에서 호출해 한 경로만 시작하게 한다. PENDING과 PROCESSING은 모두 "분석 중"으로
     * 표시되므로 버전은 올리지 않는다.
     */
    public void startAnalysis(Instant now) {
        if (!canStartAnalysis()) {
            throw new IllegalStateException("analysis cannot start from " + analysisStatus);
        }
        analysisStatus = AnalysisStatus.PROCESSING;
        updatedAt = now;
    }

    /** 분석 PROCESSING → READY. 계산 결과를 덮어쓰며(가산하지 않음) 버전을 1 올린다. 분할 저장과 같은 트랜잭션에서 호출한다. */
    public void completeAnalysis(SessionAnalysisStats stats, Instant now) {
        requireProcessing();
        totalDistance = stats.totalDistance();
        movingDuration = stats.movingDuration();
        elapsedDuration = stats.elapsedDuration();
        movingDurationToGoal = stats.movingDurationToGoal();
        goalAchieved = stats.goalAchieved();
        averagePace = stats.averagePace();
        averageHeartRate = stats.averageHeartRate();
        averageCadence = stats.averageCadence();
        maxHeartRate = stats.maxHeartRate();
        analysisStatus = AnalysisStatus.READY;
        bumpVersion(now);
    }

    /** 분석 PROCESSING → FAILED. 통계는 건드리지 않고 버전을 1 올린다. 자동 재시도하지 않는다. */
    public void failAnalysis(Instant now) {
        requireProcessing();
        analysisStatus = AnalysisStatus.FAILED;
        bumpVersion(now);
    }

    private void requireProcessing() {
        if (analysisStatus != AnalysisStatus.PROCESSING) {
            throw new IllegalStateException("analysis is not PROCESSING: " + analysisStatus);
        }
    }

    /** S09. 상태·버전·분석·시작/종료시각은 바꾸지 않는다. */
    public void markDeleted(Instant deletedAt) {
        this.deletedAt = deletedAt;
        this.updatedAt = deletedAt;
    }

    private void applyGoal(SessionGoal goal) {
        courseId = goal.courseId();
        comparisonSessionId = goal.comparisonSessionId();
        goalDistance = goal.distanceM();
        goalDuration = goal.durationSec();
        goalPace = goal.paceSecPerKm();
    }

    private void bumpVersion(Instant now) {
        stateVersion++;
        updatedAt = now;
    }
}
