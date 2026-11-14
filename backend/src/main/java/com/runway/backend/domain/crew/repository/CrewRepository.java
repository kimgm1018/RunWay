package com.runway.backend.domain.crew.repository;

import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewStatus;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CrewRepository extends JpaRepository<Crew, Long> {

    /**
     * 크루 행을 쓰거나 승인 인원과 정원을 함께 판단하는 쓰기(M04 가입 신청·M06 승인·M08 탈퇴·M09 내보내기·M11 해산·M12 설정 변경)가
     * 같은 크루 행 잠금을 먼저 잡아, 인원 계산과 저장 사이에 다른 승인·정원 축소가 끼어들거나 이전 값으로 덮어쓰지
     * 못하게 한다(S15P31E105-570). 동시 승인 경합도 이 잠금으로 직렬화한다(S15P31E105-593).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Crew c where c.id = :id")
    Optional<Crew> findByIdForUpdate(@Param("id") long id);

    @Query(
            """
            select c from Crew c
            where c.status = :status
            order by c.id asc
            """)
    List<Crew> searchActive(@Param("status") CrewStatus status);

    @Query(
            """
            select c from Crew c
            where c.status = :status
              and c.regionCode = :regionCode
            order by c.id asc
            """)
    List<Crew> searchActiveByRegion(
            @Param("status") CrewStatus status, @Param("regionCode") String regionCode);

    /** 이름 부분 일치. {@code escapedQuery}는 {@code !}를 이스케이프 문자로 처리한 값이다(S15P31E105-820). */
    @Query(
            """
            select c from Crew c
            where c.status = :status
              and lower(c.name) like lower(concat('%', :escapedQuery, '%')) escape '!'
            order by c.id asc
            """)
    List<Crew> searchActiveByName(
            @Param("status") CrewStatus status, @Param("escapedQuery") String escapedQuery);

    /** 이름 부분 일치와 지역 필터. {@code escapedQuery}는 {@code !}를 이스케이프 문자로 처리한 값이다. */
    @Query(
            """
            select c from Crew c
            where c.status = :status
              and lower(c.name) like lower(concat('%', :escapedQuery, '%')) escape '!'
              and c.regionCode = :regionCode
            order by c.id asc
            """)
    List<Crew> searchActiveByNameAndRegion(
            @Param("status") CrewStatus status,
            @Param("escapedQuery") String escapedQuery,
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
