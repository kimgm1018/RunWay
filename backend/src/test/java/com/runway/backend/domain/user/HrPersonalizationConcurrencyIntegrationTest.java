package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

class HrPersonalizationConcurrencyIntegrationTest extends HrPersonalizationIntegrationSupport {

    @Test
    void twoConcurrentSavesForSameUserGetVersionsOneAndTwo() throws Exception {
        assertThat(saveConcurrently(user, 2)).containsExactlyInAnyOrder(1, 2);
        assertVersions(user, 1, 2);
    }

    @Test
    void manyConcurrentSavesForSameUserGetContiguousUniqueVersions() throws Exception {
        int threads = 8;
        assertThat(saveConcurrently(user, threads))
                .containsExactlyInAnyOrder(1, 2, 3, 4, 5, 6, 7, 8);
        assertVersions(user, 1, 2, 3, 4, 5, 6, 7, 8);
        assertThat(service.findLatest(user).orElseThrow().personalizationVersion())
                .isEqualTo(threads);
    }

    @Test
    void concurrentSavesForDifferentUsersKeepVersionsIndependent() throws Exception {
        var ready = new CountDownLatch(4);
        var go = new CountDownLatch(1);
        long[] owners = {user, user, other, other};
        try (var pool = Executors.newFixedThreadPool(owners.length)) {
            var futures = new ArrayList<Future<Integer>>();
            for (long owner : owners) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    go.await();
                                    return service.saveNextVersion(owner, command());
                                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            for (var future : futures) {
                future.get(15, TimeUnit.SECONDS);
            }
        }
        assertVersions(user, 1, 2);
        assertVersions(other, 1, 2);
    }

    private List<Integer> saveConcurrently(long userId, int threads) throws Exception {
        var ready = new CountDownLatch(threads);
        var go = new CountDownLatch(1);
        var versions = new ArrayList<Integer>();
        try (var pool = Executors.newFixedThreadPool(threads)) {
            var futures = new ArrayList<Future<Integer>>();
            for (int i = 0; i < threads; i++) {
                int run = i;
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    go.await();
                                    return service.saveNextVersion(
                                            userId, command("model-synthetic-" + run, run));
                                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            for (var future : futures) {
                // 어느 스레드도 UNIQUE 위반 등으로 실패하면 get()이 예외를 던진다.
                versions.add(future.get(15, TimeUnit.SECONDS));
            }
        }
        return versions;
    }

    private void assertVersions(long userId, Integer... expected) {
        assertThat(
                        jdbc.queryForList(
                                "SELECT personalization_version FROM user_hr_personalization"
                                        + " WHERE user_id=? ORDER BY personalization_version",
                                Integer.class,
                                userId))
                .containsExactly(expected);
    }
}
