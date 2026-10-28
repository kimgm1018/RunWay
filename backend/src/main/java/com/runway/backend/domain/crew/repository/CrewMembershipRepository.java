package com.runway.backend.domain.crew.repository;

import com.runway.backend.domain.crew.entity.CrewMembership;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CrewMembershipRepository extends JpaRepository<CrewMembership, Long> {

    long countByCrewIdAndStatus(Long crewId, CrewMembershipStatus status);

    Optional<CrewMembership> findByCrewIdAndUserId(Long crewId, Long userId);

    List<CrewMembership> findByUserIdAndStatusIn(
            Long userId, Collection<CrewMembershipStatus> statuses);

    List<CrewMembership> findByCrewIdAndStatus(Long crewId, CrewMembershipStatus status);

    @Query(
            """
            select m.crewId as crewId, count(m) as cnt
            from CrewMembership m
            where m.crewId in :crewIds and m.status = :status
            group by m.crewId
            """)
    List<CrewIdCount> countApprovedByCrewIds(
            @Param("crewIds") Collection<Long> crewIds,
            @Param("status") CrewMembershipStatus status);

    interface CrewIdCount {
        Long getCrewId();

        long getCnt();
    }
}
