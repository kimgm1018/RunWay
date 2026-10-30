package com.runway.backend.domain.device.repository;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.device.entity.UserDevice;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserDeviceRepository extends JpaRepository<UserDevice, Long> {

    Optional<UserDevice> findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(
            Long userId, DeviceType deviceType);

    List<UserDevice> findByUserIdOrderByLinkedAtDescIdDesc(Long userId);

    boolean existsByIdAndUserId(Long id, Long userId);

    /** 연결 중인 본인 기기만 해제한다. 동시 요청은 행 잠금 후 조건을 다시 평가하므로 한 번만 반영된다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(
            """
            update UserDevice d set d.unlinkedAt = :unlinkedAt
            where d.id = :id and d.userId = :userId and d.unlinkedAt is null
            """)
    int unlink(
            @Param("id") long id,
            @Param("userId") long userId,
            @Param("unlinkedAt") Instant unlinkedAt);

    /** 탈퇴(WITHDRAWN) 회원은 남은 Access Token이 있어도 기기 API를 사용할 수 없다. */
    @Query(
            value =
                    "SELECT EXISTS (SELECT 1 FROM users WHERE id = :userId AND account_status = 'ACTIVE')",
            nativeQuery = true)
    boolean activeUserExists(@Param("userId") long userId);
}
