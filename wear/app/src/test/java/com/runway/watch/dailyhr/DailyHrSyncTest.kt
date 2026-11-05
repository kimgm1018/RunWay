package com.runway.watch.dailyhr

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DailyHrSyncTest {
    private val utc: ZoneId = ZoneOffset.UTC
    private val today = LocalDate.of(2026, 10, 30)
    private val yesterday = today.minusDays(1)
    private val now = Instant.parse("2026-10-30T12:00:00Z")
    private lateinit var store: DailyHrStore

    @Before fun setUp() {
        RuntimeEnvironment.getApplication().deleteDatabase("daily_hr.db")
        store = DailyHrStore(RuntimeEnvironment.getApplication(), utc)
        store.saveConsent(HealthConsent(true, now, "a", Instant.EPOCH))
    }

    @After fun tearDown() { store.close() }

    private class FakeSender(private val results: List<Boolean> = listOf(true)) : SummarySender {
        val sent = mutableListOf<ByteArray>()
        override suspend fun send(bytes: ByteArray): Boolean {
            sent += bytes
            return results[minOf(sent.size - 1, results.lastIndex)]
        }
    }

    private fun messageId(bytes: ByteArray) = JSONObject(String(bytes, Charsets.UTF_8)).getString("messageId")

    /** Start of the minute [minutesAgo] minutes before the minute containing [now]. */
    private fun minutesAgo(minutesAgo: Int) = now.toEpochMilli() - minutesAgo * 60_000L

    @Test fun excludesExerciseMinutesAndSavesRevisionOneForToday() {
        // 300 resting minutes (80 bpm, ten at 60 bpm) plus 30 lower minutes inside an exercise interval.
        val resting = (1..300).map { minutesAgo(it) to if (it <= 10) 60.0 else 80.0 }
        val exercise = (301..330).map { minutesAgo(it) to 40.0 }
        store.addSamples(resting + exercise)
        store.addTransition(ActivityTransition(minutesAgo(330), true))
        store.addTransition(ActivityTransition(minutesAgo(301) + 30_000, false)) // ends mid-minute: minute 301 dropped

        val s = computeCurrent(store, utc, now)!!

        // 300 minutes -> k = 30 -> (10 * 60 + 20 * 80) / 30 = 73.3
        assertEquals(today, s.metricDate)
        assertEquals(1, s.revision)
        assertEquals(300, s.validSampleCount)
        assertEquals(73.3, s.estimatedRestingHrBpm, 0.0)
        assertEquals(now, s.computedAt)
        assertEquals(listOf(s), store.pending())
    }

    @Test fun countsOnlyNonExerciseMinutesInWindow() {
        store.addSamples((1..300).map { minutesAgo(it) to 60.0 })
        store.addTransition(ActivityTransition(minutesAgo(100), true))
        store.addTransition(ActivityTransition(minutesAgo(70), false))
        assertEquals(270, computeCurrent(store, utc, now)!!.validSampleCount)
    }

    @Test fun metricDateIsLocalDateOfNow() {
        store.addSamples((1..240).map { minutesAgo(it) to 60.0 })
        // 12:00Z is 2026-10-31 in UTC+14.
        assertEquals(today.plusDays(1), computeCurrent(store, ZoneOffset.ofHours(14), now)!!.metricDate)
    }

    @Test fun minutesOlderThan24HoursAreIgnored() {
        val window = (1..239).map { minutesAgo(it) to 60.0 }
        val old = (24 * 60 + 1..24 * 60 + 100).map { minutesAgo(it) to 50.0 }
        store.addSamples(window + old)
        assertNull(computeCurrent(store, utc, now))
        store.addSamples(listOf(minutesAgo(24 * 60) to 60.0)) // exactly now - 24h is inside the window
        assertEquals(240, computeCurrent(store, utc, now)!!.validSampleCount)
    }

    @Test fun openExerciseIntervalExcludesUntilNow() {
        store.addSamples((1..260).map { minutesAgo(it) to 60.0 })
        store.addTransition(ActivityTransition(minutesAgo(20), true)) // never ends: 240 minutes left
        assertEquals(240, computeCurrent(store, utc, now)!!.validSampleCount)
        store.addTransition(ActivityTransition(minutesAgo(21), true))
        assertNull(computeCurrent(store, utc, now))
    }

    @Test fun belowMinimumProducesNothing() {
        store.addSamples((1..239).map { minutesAgo(it) to 60.0 })
        assertNull(computeCurrent(store, utc, now))
        assertTrue(store.pending().isEmpty())
    }

    @Test fun recomputeWithSameDataKeepsRevision() {
        store.addSamples((1..300).map { minutesAgo(it) to 60.0 + it % 7 })
        val first = computeCurrent(store, utc, now)!!
        store.markAcked(first.metricDate, first.revision, "a")
        val again = computeCurrent(store, utc, now.plusSeconds(30))!!
        assertEquals(first.revision, again.revision)
        assertTrue(store.pending().isEmpty())
        store.addSamples(listOf(now.toEpochMilli() + 30_000 to 50.0)) // new minute in the next window
        val changed = computeCurrent(store, utc, now.plusSeconds(90))!!
        assertEquals(first.revision + 1, changed.revision)
    }

    @Test fun concurrentComputeCannotWritePreviousCollectionsEstimateAfterSwitch() {
        repeat(30) { iteration ->
            val updatedAt = now.plusSeconds((iteration * 2 + 1).toLong())
            store.saveConsent(HealthConsent(true, updatedAt, "old-$iteration", Instant.EPOCH))
            store.addSamples((1..300).map { minutesAgo(it) to 60.0 })
            val computation = FutureTask { computeCurrent(store, utc, now) }
            Thread(computation).start()
            store.saveConsent(HealthConsent(true, updatedAt.plusSeconds(1), "new-$iteration", now))
            computation.get(5, TimeUnit.SECONDS)
            assertTrue("Previous collection estimate survived iteration $iteration", store.pending().isEmpty())
        }
    }

    @Test fun oldAckWaitDoesNotSucceedWhenCollectionIsReplaced() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 240, now)
        store.saveConsent(HealthConsent(true, now.plusSeconds(1), "b", now))
        assertEquals(false, awaitAckInStore(store, yesterday, 1, 0L, "a"))
    }

    @Test fun legacyUnboundSummaryIsNeverSent() = runBlocking {
        store.saveConsent(HealthConsent(true, now.plusSeconds(1)))
        store.saveEstimate(yesterday, 55.0, 240, now)
        val sender = FakeSender()
        deliverPending(store, sender, { _, _, _, _ -> true }, {}, { 0L })
        assertTrue(sender.sent.isEmpty())
    }

    @Test fun collectionSwitchDuringRetryStopsOldSnapshot() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 240, now)
        val sender = FakeSender()
        deliverPending(store, sender, { _, _, _, _ ->
            store.saveConsent(HealthConsent(true, now.plusSeconds(1), "b", now))
            store.saveEstimate(yesterday, 60.0, 240, now)
            false
        }, {}, { 0L })
        assertEquals(1, sender.sent.size)
        assertEquals("a", JSONObject(String(sender.sent.single())).getJSONObject("payload").getString("collectionId"))
        assertEquals("b", store.pending().single().collectionId)
    }

    @Test fun noAckRetriesThreeTimesWithSameIdAndKeepsPending() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        val waits = mutableListOf<Long>()
        val sleeps = mutableListOf<Long>()
        deliverPending(store, sender, { _, _, _, timeout -> waits += timeout; false }, { sleeps += it }, { 7L })

        assertEquals(3, sender.sent.size)
        assertEquals(1, sender.sent.map(::messageId).toSet().size)
        assertEquals(listOf(10_000L, 10_000L, 10_000L), waits)
        assertEquals(listOf(1_007L, 2_007L), sleeps)
        assertEquals(1, store.pending().size)
    }

    @Test fun ackOnSecondAttemptStops() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        var calls = 0
        deliverPending(store, sender, { date, revision, _, _ ->
            calls++
            if (calls == 2) store.markAcked(date, revision, "a")
            calls == 2
        }, {}, { 0L })

        assertEquals(2, sender.sent.size)
        assertEquals(messageId(sender.sent[0]), messageId(sender.sent[1]))
        assertTrue(store.pending().isEmpty())
    }

    @Test fun failedSendCountsAsAttempt() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender(listOf(false))
        var waited = 0
        deliverPending(store, sender, { _, _, _, _ -> waited++; true }, {}, { 0L })

        assertEquals(3, sender.sent.size)
        assertEquals(0, waited)
        assertEquals(1, store.pending().size)
    }

    @Test fun exhaustedSummarySkipsTheRestOfTheRun() = runBlocking {
        store.saveEstimate(yesterday.minusDays(1), 54.0, 40, now)
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        deliverPending(store, sender, { _, _, _, _ -> false }, {}, { 0L })

        assertEquals(3, sender.sent.size)
        assertEquals(setOf("watch:1"), sender.sent.map(::messageId).toSet())
        assertEquals(2, store.pending().size)
    }

    @Test fun withdrawalMidRunStopsBeforeNextAttempt() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        deliverPending(store, sender, { _, _, _, _ ->
            store.saveConsent(HealthConsent(false, now.plusSeconds(1)))
            false
        }, {}, { 0L })

        assertEquals(1, sender.sent.size)
    }

    @Test fun withdrawalStopsBeforeNextSummary() = runBlocking {
        store.saveEstimate(yesterday.minusDays(1), 54.0, 40, now)
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        deliverPending(store, sender, { date, revision, _, _ ->
            store.markAcked(date, revision, "a")
            store.saveConsent(HealthConsent(false, now.plusSeconds(1)))
            true
        }, {}, { 0L })

        assertEquals(1, sender.sent.size)
    }

    @Test fun noConsentSendsNothing() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        store.saveConsent(HealthConsent(false, now.plusSeconds(1)))
        val sender = FakeSender()
        deliverPending(store, sender, { _, _, _, _ -> true }, {}, { 0L })

        assertTrue(sender.sent.isEmpty())
    }

    @Test fun eachSummaryGetsItsOwnMessageId() = runBlocking {
        store.saveEstimate(yesterday.minusDays(1), 54.0, 40, now)
        store.saveEstimate(yesterday, 55.0, 40, now)
        val sender = FakeSender()
        deliverPending(store, sender, { date, revision, _, _ -> store.markAcked(date, revision, "a"); true }, {}, { 0L })

        assertEquals(listOf("watch:1", "watch:2"), sender.sent.map(::messageId))
        assertTrue(store.pending().isEmpty())
    }

    @Test fun awaitAckInStoreSeesAckFromAnotherWriter() = runBlocking {
        store.saveEstimate(yesterday, 55.0, 40, now)
        assertEquals(false, awaitAckInStore(store, yesterday, 1, 0L))
        store.markAcked(yesterday, 1, "a")
        assertEquals(true, awaitAckInStore(store, yesterday, 1, 0L))
    }
}
