package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.entity.RecommendationPreferences;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RecommendationPreferencesRepository
        extends JpaRepository<RecommendationPreferences, Long> {
    Optional<RecommendationPreferences> findByUserId(long userId);
}
