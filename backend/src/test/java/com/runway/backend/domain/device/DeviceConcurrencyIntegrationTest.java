package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.device.repository.UserDeviceRepository;
import com.runway.backend.domain.device.service.DeviceService;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** 동시에 시작한 요청이 실제 DB 트랜잭션에서 겹치도록 실행해 최종 DB 상태로 판정한다. */
class DeviceConcurrencyIntegrationTest extends SharedContextIntegrationSupport {
    private static final int THREADS = 8;

    @Autowired private DeviceService deviceService;
    @Autowired private UserDeviceRepository userDeviceRepository;
    @Autowired private TransactionTemplate transactionTemplate;
    @Autowired private JdbcTemplate jdbc;

    private long userId;

    @BeforeEach
    void seedUser() {
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('device_race','hash','러너','2000-01-01','MALE','01011112222','AGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    private <T> List<T> runTogether(Callable<T> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        CountDownLatch ready = new CountDownLatch(THREADS);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<T>> futures = new ArrayList<>();
            for (int i = 0; i < THREADS; i++) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return task.call();
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    @RepeatedTest(3)
    void 동시_등록은_연결중_기기를_하나만_남긴다() throws Exception {
        List<DeviceService.Registration> results =
                runTogether(() -> deviceService.register(userId, DeviceType.WATCH));

        assertThat(results.stream().filter(DeviceService.Registration::created)).hasSize(1);
        assertThat(results.stream().map(r -> r.device().id()).distinct()).hasSize(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_devices WHERE user_id=? AND device_type='WATCH'"
                                        + " AND unlinked_at IS NULL",
                                Integer.class,
                                userId))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_devices", Integer.class))
                .isEqualTo(1);
    }

    @RepeatedTest(3)
    void 동시_해제는_모두_성공하고_해제시각은_한번만_기록한다() throws Exception {
        long deviceId = deviceService.register(userId, DeviceType.WATCH).device().id();

        List<Integer> updated =
                runTogether(
                        () ->
                                transactionTemplate.execute(
                                        status ->
                                                userDeviceRepository.unlink(
                                                        deviceId, userId, Instant.now())));
        assertThat(updated.stream().mapToInt(Integer::intValue).sum()).isEqualTo(1);

        List<Boolean> serviceCalls =
                runTogether(
                        () -> {
                            deviceService.unlink(userId, deviceId);
                            return true;
                        });
        assertThat(serviceCalls).containsOnly(true);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT unlinked_at IS NOT NULL FROM user_devices WHERE id=?",
                                Boolean.class,
                                deviceId))
                .isTrue();
    }

    @RepeatedTest(3)
    void 연결중_기기의_동시_해제도_모두_200이다() throws Exception {
        long deviceId = deviceService.register(userId, DeviceType.PHONE).device().id();

        List<Boolean> serviceCalls =
                runTogether(
                        () -> {
                            deviceService.unlink(userId, deviceId);
                            return true;
                        });

        assertThat(serviceCalls).containsOnly(true);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_devices WHERE unlinked_at IS NULL",
                                Integer.class))
                .isZero();
    }
}
