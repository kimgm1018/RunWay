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

@Entity
@Table(name = "pace_plan_segments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PacePlanSegment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pace_plan_id", nullable = false, updatable = false)
    private Long pacePlanId;

    @Column(name = "segment_sequence", nullable = false)
    private Integer segmentSequence;

    @Column(name = "start_distance", nullable = false, precision = 12, scale = 2)
    private BigDecimal startDistance;

    @Column(name = "end_distance", nullable = false, precision = 12, scale = 2)
    private BigDecimal endDistance;

    @Column(name = "recommended_pace", nullable = false, precision = 10, scale = 2)
    private BigDecimal recommendedPace;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public static PacePlanSegment of(
            long pacePlanId,
            int sequence,
            BigDecimal startDistance,
            BigDecimal endDistance,
            BigDecimal recommendedPace,
            Instant now) {
        PacePlanSegment segment = new PacePlanSegment();
        segment.pacePlanId = pacePlanId;
        segment.segmentSequence = sequence;
        segment.startDistance = startDistance;
        segment.endDistance = endDistance;
        segment.recommendedPace = recommendedPace;
        segment.createdAt = now;
        return segment;
    }
}
