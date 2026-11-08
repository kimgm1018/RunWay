package com.runway.backend.domain.session.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 서버가 승인한 제어 명령과 실제 결과. S03~S06이 명령을 승인(PENDING)하고 실행기기의 결과를 기록하며, S08은 인계·중단 시 미확인으로 표시한다. P07(BPM·코칭)은 같은 행을 쓴다.
 */
@Entity
@Table(name = "session_control_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SessionControlEvent {

    public static final String WATCH_DISCONNECTED = "WATCH_DISCONNECTED";
    public static final String START_UNCONFIRMED_ABORTED = "START_UNCONFIRMED_ABORTED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, updatable = false)
    private Long sessionId;

    @Column(name = "device_id", nullable = false, updatable = false)
    private Long deviceId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "action",
            nullable = false,
            updatable = false,
            columnDefinition = "session_control_events_action_enum")
    private ControlAction action;

    @Column(name = "target_bpm", updatable = false)
    private Integer targetBpm;

    @Column(name = "expected_version", nullable = false, updatable = false)
    private Long expectedVersion;

    @Column(name = "coaching_id", updatable = false)
    private Long coachingId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "result",
            nullable = false,
            columnDefinition = "session_control_events_result_enum")
    private ControlResult result;

    @Column(name = "applied_at")
    private Instant appliedAt;

    @Column(name = "reason_code", length = 64)
    private String reasonCode;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** S03~S06 REQUEST 승인. 실행기기의 실제 결과가 보고되기 전까지 PENDING이다. */
    public static SessionControlEvent request(
            long sessionId, long deviceId, ControlAction action, long expectedVersion, Instant now) {
        SessionControlEvent event = new SessionControlEvent();
        event.sessionId = sessionId;
        event.deviceId = deviceId;
        event.action = action;
        event.expectedVersion = expectedVersion;
        event.result = ControlResult.PENDING;
        event.createdAt = now;
        return event;
    }

    /**
     * P07 승인. SET_BPM(수동, coachingId=null) 또는 서버 내부 COACHING(추천 ID 필수)이며 targetBpm은 60~220이다. 결과 보고 전까지
     * PENDING이다.
     */
    public static SessionControlEvent bpmRequest(
            long sessionId,
            long deviceId,
            ControlAction action,
            long expectedVersion,
            int targetBpm,
            Long coachingId,
            Instant now) {
        if (action != ControlAction.SET_BPM && action != ControlAction.COACHING) {
            throw new IllegalArgumentException("not a BPM command: " + action);
        }
        if ((action == ControlAction.COACHING) != (coachingId != null)) {
            throw new IllegalArgumentException("coachingId is required only for COACHING");
        }
        SessionControlEvent event = request(sessionId, deviceId, action, expectedVersion, now);
        event.targetBpm = targetBpm;
        event.coachingId = coachingId;
        return event;
    }

    /** 확정 결과. 확정 후에는 다른 결과로 바꾸지 않는다. */
    public boolean isConfirmed() {
        return result == ControlResult.APPLIED
                || result == ControlResult.REJECTED
                || result == ControlResult.IGNORED;
    }

    public boolean sameOutcome(ControlResult result, Instant appliedAt, String reasonCode) {
        return this.result == result
                && Objects.equals(this.appliedAt, appliedAt)
                && Objects.equals(this.reasonCode, reasonCode);
    }

    /** 미확정 명령에만 호출한다. UNKNOWN은 실제 적용 여부를 모른다는 뜻이므로 적용시각을 남기지 않는다. */
    public void recordResult(ControlResult result, Instant appliedAt, String reasonCode) {
        if (isConfirmed()) {
            throw new IllegalStateException("command already confirmed: " + id);
        }
        this.result = result;
        this.appliedAt = result == ControlResult.APPLIED ? appliedAt : null;
        this.reasonCode = reasonCode;
    }

    public boolean isPending() {
        return result == ControlResult.PENDING;
    }

    public boolean isUnconfirmed() {
        return result == ControlResult.PENDING || result == ControlResult.UNKNOWN;
    }

    /** 실제 실행 여부를 추측하지 않는다. 대기 중인 명령만 미확인으로 바꾸고 기존 UNKNOWN의 사유는 보존한다. */
    public void markUnknownIfPending(String reasonCode) {
        if (result == ControlResult.PENDING) {
            this.result = ControlResult.UNKNOWN;
            this.reasonCode = reasonCode;
        }
    }
}
