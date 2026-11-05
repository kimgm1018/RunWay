package com.runway.backend.domain.session.stream;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.service.SessionStreamQuery;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * 구독 등록소의 등록·제거 경합 — S15P31E105-257 리뷰 B-2/A-3 회귀 확인. 새 구독 등록과 같은 세션의 마지막 구독 제거가 겹쳐도 새 구독이 등록소에 남아야
 * 한다. 스냅샷 조회는 끝나지 않게 막아 최초 전송이 구독을 닫지 않도록 한다.
 */
class SessionStreamRegistryTest {

    private final CountDownLatch never = new CountDownLatch(1);
    private SessionStreamRegistry registry;

    @BeforeEach
    void setUp() {
        SessionStreamQuery query = Mockito.mock(SessionStreamQuery.class);
        Mockito.when(query.current(Mockito.anyLong(), Mockito.anyLong()))
                .thenAnswer(
                        invocation -> {
                            never.await();
                            return Optional.empty();
                        });
        registry = new SessionStreamRegistry(query, Duration.ofHours(1), Duration.ofHours(1));
    }

    @AfterEach
    void tearDown() {
        registry.shutdown();
    }

    @Test
    @SuppressWarnings("unchecked")
    void 새_구독과_마지막_구독_제거가_겹쳐도_새_구독은_남는다() throws Exception {
        Field field = SessionStreamRegistry.class.getDeclaredField("subscribers");
        field.setAccessible(true);
        Map<Long, List<Object>> subscribers = (Map<Long, List<Object>>) field.get(registry);
        Method remove = null;
        for (Method method : SessionStreamRegistry.class.getDeclaredMethods()) {
            if (method.getName().equals("remove")) {
                remove = method;
                method.setAccessible(true);
            }
        }
        Method removeSubscriber = remove;

        int orphans = 0;
        for (long sessionId = 1; sessionId <= 2_000; sessionId++) {
            long id = sessionId;
            registry.subscribe(1L, id, null);
            Object first = subscribers.get(id).get(0);
            CyclicBarrier barrier = new CyclicBarrier(2);
            Thread add =
                    new Thread(
                            () -> {
                                try {
                                    barrier.await();
                                    registry.subscribe(1L, id, null);
                                } catch (Exception e) {
                                    throw new IllegalStateException(e);
                                }
                            });
            Thread drop =
                    new Thread(
                            () -> {
                                try {
                                    barrier.await();
                                    removeSubscriber.invoke(registry, first);
                                } catch (Exception e) {
                                    throw new IllegalStateException(e);
                                }
                            });
            add.start();
            drop.start();
            add.join();
            drop.join();
            if (registry.subscriberCount(id) != 1) {
                orphans++;
            }
        }

        assertThat(orphans).isZero();
    }

    @Test
    void 한_세션의_연결이_상한을_넘으면_오래된_연결부터_정리한다() {
        for (int i = 0; i < SessionStreamRegistry.MAX_SUBSCRIBERS_PER_SESSION + 2; i++) {
            registry.subscribe(1L, 7L, null);
        }

        assertThat(registry.subscriberCount(7L))
                .isEqualTo(SessionStreamRegistry.MAX_SUBSCRIBERS_PER_SESSION);
    }

    @Test
    void 구독이_모두_끝나면_세션별_전송_대기열도_정리한다() throws Exception {
        SessionStreamQuery closing = Mockito.mock(SessionStreamQuery.class);
        // 빈 스냅샷은 삭제·탈퇴로 보고 구독을 닫는다.
        Mockito.when(closing.current(Mockito.anyLong(), Mockito.anyLong())).thenReturn(Optional.empty());
        SessionStreamRegistry other =
                new SessionStreamRegistry(closing, Duration.ofHours(1), Duration.ofHours(1));
        try {
            for (long sessionId = 1; sessionId <= 100; sessionId++) {
                other.subscribe(1L, sessionId, null);
            }
            long deadline = System.currentTimeMillis() + 10_000;
            while (other.laneCount() > 0 && System.currentTimeMillis() < deadline) {
                Thread.sleep(20);
            }
            assertThat(other.laneCount()).isZero();
            for (long sessionId = 1; sessionId <= 100; sessionId++) {
                assertThat(other.subscriberCount(sessionId)).isZero();
            }
        } finally {
            other.shutdown();
        }
    }
}
