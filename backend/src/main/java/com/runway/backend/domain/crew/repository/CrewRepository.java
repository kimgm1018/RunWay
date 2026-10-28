package com.runway.backend.domain.crew.repository;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CrewRepository extends JpaRepository<Crew, Long> {

    @Query(
            """
            select c from Crew c
            where c.status = :status
              and (:q is null or lower(c.name) like lower(concat('%', :q, '%')))
              and (:regionCode is null or c.regionCode = :regionCode)
            order by c.id asc
            """)
    List<Crew> searchActive(
            @Param("status") CrewStatus status,
            @Param("q") String q,
            @Param("regionCode") String regionCode);
}
