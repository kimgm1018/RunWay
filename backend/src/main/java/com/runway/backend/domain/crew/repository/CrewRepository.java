package com.runway.backend.domain.crew.repository;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewStatus;
import java.util.List;
import org.springframework.data.domain.Pageable;
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

    /** 통합 검색용 keyset 조회. {@code escapedQuery}는 {@code !}를 이스케이프 문자로 처리한 값이다. */
    @Query(
            """
            select c from Crew c
            where c.status = :status
              and c.id > :afterId
              and lower(c.name) like lower(concat('%', :escapedQuery, '%')) escape '!'
            order by c.id asc
            """)
    List<Crew> searchActiveByNameAfter(
            @Param("status") CrewStatus status,
            @Param("escapedQuery") String escapedQuery,
            @Param("afterId") long afterId,
            Pageable pageable);
}
