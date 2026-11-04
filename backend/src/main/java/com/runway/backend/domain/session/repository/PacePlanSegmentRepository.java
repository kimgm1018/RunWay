package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.PacePlanSegment;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PacePlanSegmentRepository extends JpaRepository<PacePlanSegment, Long> {

    List<PacePlanSegment> findByPacePlanIdOrderBySegmentSequenceAsc(Long pacePlanId);
}
