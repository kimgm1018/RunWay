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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 서버가 승인한 제어 명령과 실제 결과. 명령 생성은 S03~S06·P07 업무가 맡고, 이 업무는 조회와 인계·중단 시 미확인 표시만 한다.
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
