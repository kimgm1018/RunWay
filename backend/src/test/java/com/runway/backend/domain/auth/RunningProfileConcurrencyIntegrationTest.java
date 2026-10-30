package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.auth.service.LoginService;
import com.runway.backend.domain.user.dto.request.RunningProfileRequest;
import com.runway.backend.domain.user.repository.ProfileOwnerLockRepository;
import com.runway.backend.domain.user.service.RunningProfileService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

class RunningProfileConcurrencyIntegrationTest extends AuthIntegrationSupport {
    @Autowired RunningProfileService service;
    @Autowired LoginService login;
    @Autowired JsonMapper mapper;
    @MockitoSpyBean ProfileOwnerLockRepository owners;

    RunningProfileRequest profile(String level, int pace) {
        return mapper.readValue(
                "{\"selfReportedLevel\":\""
                        + level
                        + "\",\"inputType\":\"PACE\",\"usualPaceSecPerKm\":"
                        + pace
                        + "}",
                RunningProfileRequest.class);
    }

    RunningProfileRequest level() {
        return mapper.readValue(
                "{\"selfReportedLevel\":\"ADVANCED\"}", RunningProfileRequest.class);
    }

    RunningProfileRequest baseline() {
        return mapper.readValue(
                "{\"inputType\":\"DISTANCE_TIME\","
                    + "\"baselineDistanceM\":5000,\"baselineDurationSec\":2000,\"usualPaceSecPerKm\":400}",
                RunningProfileRequest.class);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void simultaneousInitialSetupCreatesOneRowAndFollowsLockOrder(boolean identical)
            throws Exception {
        var first = profile("BEGINNER", 360);
        var second = identical ? first : profile("INTERMEDIATE", 420);
        overlap(() -> service.saveProfile(user, first), () -> service.saveProfile(user, second));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_profiles WHERE user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
        assertThat(service.readProfile(user).selfReportedLevel().name())
                .isEqualTo(identical ? "BEGINNER" : "INTERMEDIATE");
        assertThat(service.readProfile(user).usualPaceSecPerKm())
                .isEqualByComparingTo(identical ? "360" : "420");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void levelOnlyAndBaselineWritesBothSurviveInEitherOrder(boolean levelFirst) throws Exception {
        service.saveProfile(user, profile("BEGINNER", 360));
        Supplier<?> changeLevel = () -> service.saveProfile(user, level());
        Supplier<?> changeBaseline = () -> service.saveProfile(user, baseline());
        overlap(
                levelFirst ? changeLevel : changeBaseline,
                levelFirst ? changeBaseline : changeLevel);
        assertThat(service.readProfile(user).selfReportedLevel().name()).isEqualTo("ADVANCED");
        var saved = service.readProfile(user);
        assertThat(saved.usualPaceSecPerKm()).isEqualByComparingTo("400");
        assertThat(saved.baselineDistanceM()).isEqualTo(5000);
        assertThat(saved.baselineDurationSec()).isEqualTo(2000);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void fullProfileAndBaselineWritesHaveConsistentLastWriterState(boolean fullFirst)
            throws Exception {
        service.saveProfile(user, profile("BEGINNER", 360));
        Supplier<?> full = () -> service.saveProfile(user, profile("ADVANCED", 420));
        Supplier<?> baseline = () -> service.saveProfile(user, baseline());
        overlap(fullFirst ? full : baseline, fullFirst ? baseline : full);
        var saved = service.readProfile(user);
        assertThat(service.readProfile(user).selfReportedLevel().name()).isEqualTo("ADVANCED");
        assertThat(saved.usualPaceSecPerKm()).isEqualByComparingTo(fullFirst ? "400" : "420");
        if (fullFirst) {
            assertThat(saved.baselineDistanceM()).isEqualTo(5000);
            assertThat(saved.baselineDurationSec()).isEqualTo(2000);
        } else {
            assertThat(saved.baselineDistanceM()).isNull();
            assertThat(saved.baselineDurationSec()).isNull();
        }
    }

    @Test
    void loginWaitsForInitialSetupCommitBeforeReportingCompleted() throws Exception {
        overlap(
                () -> service.saveProfile(user, profile("BEGINNER", 360)),
                () -> {
                    var response = login.login("runner01", "Runner9!");
                    assertThat(response.onboardingCompleted()).isTrue();
                    return response;
                });
    }

    @Test
    void anotherMemberIsNotBlockedByOwnersLock() throws Exception {
        long other =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('parallel223',?,'다른러너','2000-01-01','MALE','01000000000','DISAGREE') RETURNING id
                        """,
                        Long.class,
                        encoded);
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(
                        call -> {
                            boolean found = (boolean) call.callRealMethod();
                            locked.countDown();
                            assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            return found;
                        })
                .when(owners)
                .lock(user);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> service.saveProfile(user, profile("BEGINNER", 360)));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                var second =
                        executor.submit(() -> service.saveProfile(other, profile("ADVANCED", 400)));
                assertThat(second.get(1500, TimeUnit.MILLISECONDS).onboardingCompleted()).isTrue();
                assertThat(first.isDone()).isFalse();
            } finally {
                release.countDown();
            }
            assertThat(first.get(5, TimeUnit.SECONDS).onboardingCompleted()).isTrue();
        }
    }

    private void overlap(Supplier<?> firstAction, Supplier<?> secondAction) throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var calls = new AtomicInteger();
        doAnswer(
                        call -> {
                            boolean found = (boolean) call.callRealMethod();
                            if (calls.getAndIncrement() == 0) {
                                locked.countDown();
                                assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            }
                            return found;
                        })
                .when(owners)
                .lock(user);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(firstAction::get);
            Future<?> second = null;
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                second = executor.submit(secondAction::get);
                waitForDatabaseLock();
                assertThat(second.isDone()).isFalse();
            } finally {
                release.countDown();
            }
            assertThat(first.get(5, TimeUnit.SECONDS)).isNotNull();
            assertThat(second.get(5, TimeUnit.SECONDS)).isNotNull();
        }
    }

    private void waitForDatabaseLock() throws Exception {
        long until = System.nanoTime() + Duration.ofMillis(1700).toNanos();
        while (System.nanoTime() < until) {
            Boolean waiting =
                    jdbc.queryForObject(
                            """
                            SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                             WHERE datname=current_database() AND wait_event_type='Lock'
                               AND query LIKE '%FOR UPDATE%')
                            """,
                            Boolean.class);
            if (Boolean.TRUE.equals(waiting)) return;
            Thread.sleep(10);
        }
        fail("Expected real PostgreSQL lock contention, not sequential execution");
    }
}
