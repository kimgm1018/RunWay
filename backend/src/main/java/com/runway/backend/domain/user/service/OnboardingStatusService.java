package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.repository.UserProfileRepository;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class OnboardingStatusService {
    private final UserProfileRepository profiles;

    @Transactional(readOnly = true)
    public boolean isCompleted(long userId) {
        return profiles.hasCompletedSetup(userId);
    }
}
