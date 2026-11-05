package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.runway.backend.domain.user.repository.RecommendationPreferencesRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

class PreferencesConcurrencyIntegrationTest extends PreferencesIntegrationSupport {
    @Autowired UserAccountRepository owners;
    @Autowired RecommendationPreferencesRepository preferences;
    @Autowired PlatformTransactionManager manager;
    @Autowired jakarta.persistence.EntityManager entities;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void overlappingSavesKeepOneCompleteLastWriterState(boolean alreadySaved) throws Exception {
        if (alreadySaved) service.save(user, selection("loop", false));
        var firstValue = selection("loop", true);
        var lastValue = selection("point_to_point", false);
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var once = new AtomicBoolean();
        doAnswer(
                        call -> {
                            var row = call.callRealMethod();
                            if (once.compareAndSet(false, true)) {
                                locked.countDown();
                                assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                            }
                            return row;
                        })
                .when(owners)
                .lock(user);
        try (var pool = Executors.newFixedThreadPool(3)) {
            var first = pool.submit(() -> service.save(user, firstValue));
            Future<?> second = null;
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                // A distinct member must not wait on this owner's lock.
                assertThat(
                                pool.submit(() -> service.save(other, lastValue))
                                        .get(1, TimeUnit.SECONDS))
                        .isEqualTo(lastValue);
                second = pool.submit(() -> service.save(user, lastValue));
                awaitLock();
                assertThat(second.isDone()).isFalse();
            } finally {
                release.countDown();
            }
            assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo(firstValue);
            assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo(lastValue);
        }
        assertThat(service.read(user)).isEqualTo(lastValue);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_recommendation_preferences WHERE"
                                        + " user_id=?",
                                Integer.class,
                                user))
                .isEqualTo(1);
    }

    private void awaitLock() throws Exception {
        long deadline = System.nanoTime() + Duration.ofMillis(1700).toNanos();
        while (System.nanoTime() < deadline) {
            if (Boolean.TRUE.equals(
                    jdbc.queryForObject(
                            """
                            SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                            WHERE datname=current_database() AND wait_event_type='Lock'
                            AND query LIKE '%FOR UPDATE%')
                            """,
                            Boolean.class))) return;
            Thread.sleep(10);
        }
        fail("No real PostgreSQL lock contention observed");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void failedFlushRollsBackInitialOrExistingSave(boolean existing) {
        var old = selection("loop", false);
        if (existing) service.save(user, old);
        doAnswer(
                        call -> {
                            entities.flush();
                            throw new TransientDataAccessResourceException("synthetic failure");
                        })
                .when(preferences)
                .flush();
        assertThatThrownBy(() -> service.save(user, selection("point_to_point", true)))
                .isInstanceOf(TransientDataAccessResourceException.class);
        assertThat(service.read(user)).isEqualTo(old);
        assertThat(count()).isEqualTo(existing ? 1 : 0);
    }

    @Test
    void databaseLockTimeoutReturns503AndLeavesDataUnchanged() throws Exception {
        var old = selection("loop", false);
        service.save(user, old);
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var pool = Executors.newSingleThreadExecutor()) {
            var owner =
                    pool.submit(
                            () ->
                                    new TransactionTemplate(manager)
                                            .execute(
                                                    status -> {
                                                        owners.lock(user);
                                                        locked.countDown();
                                                        try {
                                                            assertThat(
                                                                            release.await(
                                                                                    10,
                                                                                    TimeUnit
                                                                                            .SECONDS))
                                                                    .isTrue();
                                                        } catch (InterruptedException e) {
                                                            throw new RuntimeException(e);
                                                        }
                                                        return true;
                                                    }));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                mvc.perform(
                                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                        .put(PreferencesApiIntegrationTest.URL)
                                        .header(
                                                "Authorization",
                                                com.runway.backend.global.security
                                                        .SecurityTestSupport.bearer(user))
                                        .contentType(
                                                org.springframework.http.MediaType.APPLICATION_JSON)
                                        .content(body("loop", true).toString()))
                        .andExpect(
                                org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                        .status()
                                        .isServiceUnavailable())
                        .andExpect(
                                org.springframework.test.web.servlet.result.MockMvcResultMatchers
                                        .jsonPath("$.code")
                                        .value("SERVICE_UNAVAILABLE"));
            } finally {
                release.countDown();
            }
            assertThat(owner.get(5, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(service.read(user)).isEqualTo(old);
    }

    @Test
    void readFailureIs503AndNeverReturnsDefaults() throws Exception {
        doThrow(new TransientDataAccessResourceException("synthetic read failure"))
                .when(preferences)
                .findByUserId(user);
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                        PreferencesApiIntegrationTest.URL)
                                .header(
                                        "Authorization",
                                        com.runway.backend.global.security.SecurityTestSupport
                                                .bearer(user)))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isServiceUnavailable())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                                        "$.code")
                                .value("SERVICE_UNAVAILABLE"));
    }
}
