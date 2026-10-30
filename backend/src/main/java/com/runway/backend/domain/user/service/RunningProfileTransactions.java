package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.dto.response.RunningProfileResponse;
import com.runway.backend.domain.user.entity.UserProfile;
import com.runway.backend.domain.user.exception.RunningProfileErrors;
import com.runway.backend.domain.user.repository.ProfileOwnerLockRepository;
import com.runway.backend.domain.user.repository.UserProfileRepository;
import com.runway.backend.domain.user.validation.RunningProfileValidator.ProfileInput;

import jakarta.persistence.EntityManager;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunningProfileTransactions {
    private final UserProfileRepository profiles;
    private final ProfileOwnerLockRepository owners;
    private final OnboardingStatusService onboarding;
    private final EntityManager entities;

    @Transactional(readOnly = true)
    public RunningProfileResponse readProfile(long userId) {
        return RunningProfileResponse.from(find(userId), onboarding.isCompleted(userId));
    }

    @Transactional
    public RunningProfileResponse saveProfile(long userId, ProfileInput input) {
        lockOwner(userId);
        UserProfile profile = profiles.findByUserId(userId).orElse(null);
        if (profile == null) {
            if (input.level() == null) throw RunningProfileErrors.invalidLevel();
            if (input.baseline() == null) throw RunningProfileErrors.invalidBaseline();
            profile = profiles.save(UserProfile.create(userId, input.level(), input.baseline()));
        } else {
            if (input.level() != null) profile.changeLevel(input.level());
            if (input.baseline() != null) profile.changeBaseline(input.baseline());
        }
        profiles.flush();
        // The database owns created_at/updated_at; read the trigger result, not the JVM clock.
        entities.refresh(profile);
        return RunningProfileResponse.from(profile, onboarding.isCompleted(userId));
    }

    private void lockOwner(long userId) {
        if (!owners.lock(userId)) throw RunningProfileErrors.notSet();
    }

    private UserProfile find(long userId) {
        return profiles.findByUserId(userId).orElseThrow(() -> RunningProfileErrors.notSet());
    }
}
