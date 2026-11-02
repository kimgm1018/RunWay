package com.runway.backend.domain.session.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 세션 준비 시 계산한 초기 페이스 계획. 추천 박자·코스 진행거리는 단순 규칙 계획에서 사용하지 않는다. */
@Entity
@Table(name = "pace_plans")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PacePlan {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, updatable = false)
    private Long sessionId;

    @Column(name = "recommended_pace", nullable = false, precision = 10, scale = 2)
    private BigDecimal recommendedPace;

    @Column(name = "cue_bpm", precision = 7, scale = 2)
    private BigDecimal cueBpm;

    @Column(name = "route_progress", precision = 12, scale = 2)
    private BigDecimal routeProgress;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public static PacePlan of(long sessionId, BigDecimal recommendedPace, Instant now) {
        PacePlan plan = new PacePlan();
        plan.sessionId = sessionId;
        plan.recommendedPace = recommendedPace;
        plan.createdAt = now;
        return plan;
    }
}
