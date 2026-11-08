package com.runway.watch.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** 9.7 서버 기준 시각: offset and error bound from one STATE_QUERY round trip; the device clock is never changed. */
class ServerClockTest {
    private val t0 = Instant.parse("2026-10-28T01:00:00Z")

    @Test
    fun `offset is the mean of both legs and the error bound half the network round trip`() {
        // 서버 처리 10ms, 왕복 200ms → 네트워크 190ms, 오차 95ms. 서버 시계가 1초 빠름.
        val e = ServerClock.estimate(t0, t0.plusMillis(1_100), t0.plusMillis(1_110), t0.plusMillis(200))!!
        assertEquals(Duration.ofMillis(1_005), e.offset)
        assertEquals(Duration.ofMillis(95), e.errorBound)
        assertEquals(t0.plusMillis(200), e.measuredAt)

        // 서버 시계가 늦은 경우 음수.
        val late = ServerClock.estimate(t0, t0.minusMillis(1_900), t0.minusMillis(1_900), t0.plusMillis(200))!!
        assertEquals(Duration.ofMillis(-2_000), late.offset)
    }

    @Test
    fun `inconsistent times give no estimate`() {
        assertNull(ServerClock.estimate(t0, t0, t0, t0.minusMillis(1)))
        assertNull(ServerClock.estimate(t0, t0.plusMillis(10), t0, t0.plusMillis(20)))
        assertNull(ServerClock.estimate(t0, t0, t0.plusMillis(500), t0.plusMillis(100)))
    }

    @Test
    fun `only replies to our own queries count`() {
        val clock = ServerClock()
        assertNull(clock.onReply(t0, t0, t0, t0.plusMillis(100)))
        assertNull(clock.current(t0.plusMillis(100)))

        clock.querySent(t0)
        assertNotNull(clock.onReply(t0, t0.plusMillis(50), t0.plusMillis(50), t0.plusMillis(100)))
        // 같은 응답이 다시 와도 한 번만 쓴다.
        assertNull(clock.onReply(t0, t0.plusMillis(50), t0.plusMillis(50), t0.plusMillis(100)))
    }

    @Test
    fun `an echo with different sub-millisecond digits still matches`() {
        val clock = ServerClock()
        clock.querySent(t0.plusNanos(123_456))
        assertNotNull(clock.onReply(t0.plusNanos(100_000), t0.plusMillis(50), t0.plusMillis(50), t0.plusMillis(100)))
    }

    @Test
    fun `too uncertain or too old estimates are not used`() {
        val clock = ServerClock(maxErrorBound = Duration.ofSeconds(1), maxAge = Duration.ofMinutes(10))
        clock.querySent(t0)
        assertNull(clock.onReply(t0, t0.plusMillis(1), t0.plusMillis(1), t0.plusSeconds(3)))
        assertNull(clock.current(t0.plusSeconds(3)))

        clock.querySent(t0)
        clock.onReply(t0, t0.plusMillis(3_100), t0.plusMillis(3_100), t0.plusMillis(200))
        val at = t0.plusMillis(200)
        assertEquals(at.plusMillis(3_000 + 100), clock.latestServerTime(at))
        assertEquals(at.plusMillis(3_000), clock.toServerTime(at))
        assertNotNull(clock.current(at.plus(Duration.ofMinutes(10))))
        assertNull(clock.current(at.plus(Duration.ofMinutes(10)).plusMillis(1)))
        assertNull(clock.latestServerTime(at.plus(Duration.ofMinutes(11))))
        assertEquals(at.plus(Duration.ofMinutes(11)), clock.toServerTime(at.plus(Duration.ofMinutes(11))))
    }
}
