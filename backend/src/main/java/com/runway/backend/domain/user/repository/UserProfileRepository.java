package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.entity.UserProfile;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface UserProfileRepository extends JpaRepository<UserProfile, Long> {
    Optional<UserProfile> findByUserId(long userId);

    // Native numeric checks preserve the existing login behavior for legacy non-finite values
    // without materializing them as BigDecimal.
    @Query(
            value =
                    """
                    SELECT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = :userId
                        AND running_level IS NOT NULL AND average_pace > 0
                        AND average_pace NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
                    """,
            nativeQuery = true)
    boolean hasCompletedSetup(long userId);
}
