package com.runway.watch.session

import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Server time offset learned from one STATE_QUERY → STATE_RESULT round trip (9.7 서버 기준 시각).
 * [offset] is added to the watch clock to get server time; [errorBound] is half the network round trip, the most
 * the true offset can differ from [offset]. The device clock is never changed.
 */
data class ClockEstimate(val offset: Duration, val errorBound: Duration, val measuredAt: Instant)

/**
 * Keeps the best recent [ClockEstimate]. Only replies to a query this watch sent are used (the echoed clientSendAt
 * must be one we sent), so the phone's periodic pushes with clientSendAt=null never count (D-8).
 */
class ServerClock(
    /** An estimate whose round trip is longer than twice this is too uncertain to use. */
    private val maxErrorBound: Duration = Duration.ofSeconds(5),
    /** The watch clock drifts; an estimate older than this is no longer used. */
    private val maxAge: Duration = Duration.ofMinutes(10),
) {
    private val sent = ArrayDeque<Instant>()
    private var best: ClockEstimate? = null

    /** Records a query send time so its reply can be matched. Keeps the last few only. */
    @Synchronized
    fun querySent(clientSendAt: Instant) {
        sent.addLast(clientSendAt.truncatedTo(ChronoUnit.MILLIS))
        while (sent.size > MAX_OUTSTANDING) sent.removeFirst()
    }

    /**
     * Learns from a reply: t0 = clientSendAt (watch), t1 = serverReceiveAt, t2 = serverSendAt (server),
     * t3 = [receivedAt] (watch). offset = ((t1 − t0) + (t2 − t3)) / 2, round trip = (t3 − t0) − (t2 − t1).
     * Returns the new estimate, or null when the reply is not ours or is inconsistent.
     */
    @Synchronized
    fun onReply(clientSendAt: Instant, serverReceiveAt: Instant, serverSendAt: Instant, receivedAt: Instant): ClockEstimate? {
        // The query is sent with millisecond precision; match the echo the same way.
        if (!sent.remove(clientSendAt.truncatedTo(ChronoUnit.MILLIS))) return null
        val estimate = estimate(clientSendAt, serverReceiveAt, serverSendAt, receivedAt) ?: return null
        if (estimate.errorBound > maxErrorBound) return null
        val current = best
        // A fresher estimate replaces an older one unless the older is tighter and still young.
        if (current == null || estimate.errorBound <= current.errorBound ||
            Duration.between(current.measuredAt, receivedAt) > REPLACE_AFTER
        ) {
            best = estimate
        }
        return estimate
    }

    /** The usable estimate at [now], or null when there is none or it is too old (then coaching is not applied). */
    @Synchronized
    fun current(now: Instant): ClockEstimate? = best?.takeIf { !now.isBefore(it.measuredAt) && Duration.between(it.measuredAt, now) <= maxAge }

    /** Server time at [now] plus the error bound: the latest the server clock can be. Null without an estimate. */
    fun latestServerTime(now: Instant): Instant? = current(now)?.let { now.plus(it.offset).plus(it.errorBound) }

    /** Watch time [at] in server time, or [at] itself without an estimate. */
    fun toServerTime(at: Instant): Instant = current(at)?.let { at.plus(it.offset) } ?: at

    companion object {
        private const val MAX_OUTSTANDING = 8
        private val REPLACE_AFTER: Duration = Duration.ofMinutes(2)

        fun estimate(t0: Instant, t1: Instant, t2: Instant, t3: Instant): ClockEstimate? {
            if (t3.isBefore(t0) || t2.isBefore(t1)) return null
            val roundTrip = Duration.between(t0, t3).minus(Duration.between(t1, t2))
            if (roundTrip.isNegative) return null
            val offset = Duration.between(t0, t1).plus(Duration.between(t3, t2)).dividedBy(2)
            return ClockEstimate(offset, roundTrip.dividedBy(2), t3)
        }
    }
}
