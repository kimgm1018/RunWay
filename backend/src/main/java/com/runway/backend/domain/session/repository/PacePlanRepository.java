package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.PacePlan;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PacePlanRepository extends JpaRepository<PacePlan, Long> {

    Optional<PacePlan> findFirstBySessionIdOrderByIdDesc(Long sessionId);

    /** 목표가 바뀌면 이전 계획을 구간과 함께 지운다. 구간이 계획을 참조하므로 구간을 먼저 지운다. */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    DELETE FROM pace_plan_segments
                    WHERE pace_plan_id IN (SELECT id FROM pace_plans WHERE session_id = :sessionId)
                    """,
            nativeQuery = true)
    void deleteSegmentsBySessionId(@Param("sessionId") long sessionId);

    @Modifying(flushAutomatically = true)
    @Query(value = "DELETE FROM pace_plans WHERE session_id = :sessionId", nativeQuery = true)
    void deletePlansBySessionId(@Param("sessionId") long sessionId);
}
