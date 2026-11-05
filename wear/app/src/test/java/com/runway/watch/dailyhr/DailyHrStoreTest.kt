package com.runway.watch.dailyhr

import android.database.sqlite.SQLiteDatabase
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
class DailyHrStoreTest {
    private val utc: ZoneId = ZoneOffset.UTC
    private val d1 = LocalDate.of(2026, 10, 1)
    private val d2 = LocalDate.of(2026, 10, 2)
    private val at = Instant.parse("2026-10-03T00:00:00Z")
    private lateinit var store: DailyHrStore

    @Before fun setUp() {
        RuntimeEnvironment.getApplication().deleteDatabase("daily_hr.db")
        store = DailyHrStore(RuntimeEnvironment.getApplication(), utc)
    }

    @After fun tearDown() { store.close() }

    private fun dayMs(d: LocalDate, hour: Int = 0) = d.atStartOfDay(utc).toInstant().toEpochMilli() + hour * 3_600_000L

    @Test fun sameCollectionSurvivesConsentUpdateAndRestartButDifferentCollectionClearsAll() {
        val start = Instant.parse("2026-10-01T00:00:00Z")
        store.saveConsent(HealthConsent(true, start, "a", start))
        store.addSamples(listOf(start.toEpochMilli() to 60.0))
        store.addDrops(DropReason.ACCURACY, 2)
        store.addTransition(ActivityTransition(start.toEpochMilli(), true))
        val summary = store.saveEstimate(d1, 55.0, 240, at)
        assertEquals("a", summary.collectionId)
        store.saveConsent(HealthConsent(true, at, "a", start))
        store.close()
        store = DailyHrStore(RuntimeEnvironment.getApplication(), utc)
        assertEquals(listOf(summary), store.pending())
        assertEquals(start, store.consent()!!.collectionStartedAt)
        store.saveConsent(HealthConsent(true, at.plusSeconds(1), "b", at))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.minuteMeansBetween(0, Long.MAX_VALUE).isEmpty())
        assertTrue(store.dropCounts().isEmpty())
        assertTrue(store.transitions().isEmpty())
    }

    @Test fun bindingLegacyCollectionDeletesUnownedRecordsAndIgnoresStaleConsent() {
        agree()
        store.saveEstimate(d1, 55.0, 240, at)
        store.addSamples(listOf(at.toEpochMilli() to 60.0))
        val bound = HealthConsent(true, at.plusSeconds(1), "a", at)
        store.saveConsent(bound)
        assertTrue(store.pending().isEmpty())
        assertTrue(store.minuteMeansBetween(0, Long.MAX_VALUE).isEmpty())
        store.saveConsent(HealthConsent(true, at, "old", Instant.EPOCH))
        assertEquals(bound, store.consent())
    }

    @Test fun delayedAckCannotAcknowledgeNewCollectionWithSameDateAndRevision() {
        store.saveConsent(HealthConsent(true, at, "a", Instant.EPOCH))
        store.saveEstimate(d1, 55.0, 240, at)
        store.saveConsent(HealthConsent(true, at.plusSeconds(1), "b", at))
        val current = store.saveEstimate(d1, 60.0, 240, at)
        store.markAcked(d1, 1, "a")
        store.markAcked(d1, 1)
        assertEquals(listOf(current), store.pending())
        store.markAcked(d1, 1, "b")
        assertTrue(store.pending().isEmpty())
    }

    @Test fun queuedSensorBatchDropsOldTimestampsAndOldCallbackEpoch() {
        store.saveConsent(HealthConsent(true, at, "a", Instant.EPOCH))
        store.saveConsent(HealthConsent(true, at.plusSeconds(1), "b", at))
        store.addSamples(listOf(at.toEpochMilli() - 1 to 40.0, at.toEpochMilli() to 60.0))
        store.addSamples(listOf(at.toEpochMilli() + 60_000 to 50.0), "a")
        store.addTransition(ActivityTransition(at.toEpochMilli() - 1, true))
        store.addTransition(ActivityTransition(at.toEpochMilli(), true), "a")
        store.addDrops(DropReason.ACCURACY, 2, "a")
        assertEquals(listOf(at.toEpochMilli() to 60.0), store.minuteMeansBetween(0, Long.MAX_VALUE))
        assertTrue(store.transitions().isEmpty())
        assertTrue(store.dropCounts().isEmpty())
    }

    @Test fun collectionCutoffDoesNotRoundDownSubMillisecondStart() {
        store.saveConsent(HealthConsent(true, at, "a", at.plusNanos(1)))
        store.addSamples(listOf(at.toEpochMilli() to 40.0, at.toEpochMilli() + 1 to 60.0))
        store.addTransition(ActivityTransition(at.toEpochMilli(), true))
        assertEquals(listOf(at.toEpochMilli() to 60.0), store.minuteMeansBetween(0, Long.MAX_VALUE))
        assertTrue(store.transitions().isEmpty())
    }

    @Test fun firstSaveIsRevisionOneAndPending() {
        val s = store.saveEstimate(d1, 55.0, 40, at)
        assertEquals(1, s.revision)
        assertEquals(METHOD, s.method)
        assertEquals(listOf(s), store.pending())
    }

    @Test fun sameValueAndCountKeepsRevisionAndAck() {
        store.saveEstimate(d1, 55.0, 40, at)
        store.markAcked(d1, 1)
        val again = store.saveEstimate(d1, 55.0, 40, at.plusSeconds(60))
        assertEquals(1, again.revision)
        assertTrue(store.pending().isEmpty())
    }

    @Test fun sameValueUnackedStaysPending() {
        store.saveEstimate(d1, 55.0, 40, at)
        assertEquals(1, store.saveEstimate(d1, 55.0, 40, at).revision)
        assertEquals(1, store.pending().size)
    }

    @Test fun changedValueOrCountBumpsRevisionAndClearsAck() {
        store.saveEstimate(d1, 55.0, 40, at)
        store.markAcked(d1, 1)
        assertEquals(2, store.saveEstimate(d1, 56.0, 40, at).revision)
        assertEquals(listOf(2), store.pending().map { it.revision })
        store.markAcked(d1, 2)
        assertEquals(3, store.saveEstimate(d1, 56.0, 41, at).revision)
        assertEquals(1, store.pending().size)
    }

    @Test fun markAckedOnlyMatchesSameRevision() {
        store.saveEstimate(d1, 55.0, 40, at)
        store.saveEstimate(d1, 56.0, 40, at)
        store.markAcked(d1, 1)
        assertEquals(1, store.pending().size)
        store.markAcked(d1, 2)
        assertTrue(store.pending().isEmpty())
    }

    @Test fun pendingIsOrderedByDate() {
        store.saveEstimate(d2, 50.0, 40, at)
        store.saveEstimate(d1, 51.0, 40, at)
        assertEquals(listOf(d1, d2), store.pending().map { it.metricDate })
    }

    private fun agree() = store.saveConsent(HealthConsent(true, at))

    @Test fun samplesAreBucketedIntoOneRowPerMinute() {
        agree()
        val m0 = dayMs(d1, 1)
        store.addSamples(listOf(m0 to 60.0, m0 + 1_000 to 62.0))
        store.addSamples(listOf(m0 + 59_999 to 64.0, m0 + 60_000 to 70.0))
        assertEquals(listOf(m0 to 62.0, m0 + 60_000 to 70.0), store.minuteMeansBetween(0, Long.MAX_VALUE))
    }

    @Test fun minuteMeansBetweenUsesHalfOpenRange() {
        agree()
        val m0 = dayMs(d1, 1)
        store.addSamples(listOf(m0 to 60.0, m0 + 60_000 to 61.0, m0 + 120_000 to 62.0))
        assertEquals(listOf(m0 + 60_000 to 61.0), store.minuteMeansBetween(m0 + 60_000, m0 + 120_000))
    }

    @Test fun dropsAccumulate() {
        agree()
        store.addDrops(DropReason.ACCURACY, 2)
        store.addDrops(DropReason.ACCURACY, 3)
        store.addDrops(DropReason.OUT_OF_RANGE, 1)
        assertEquals(mapOf(DropReason.ACCURACY to 5, DropReason.OUT_OF_RANGE to 1), store.dropCounts())
    }

    @Test fun transitionsRoundTrip() {
        agree()
        store.addTransition(ActivityTransition(2000L, false))
        store.addTransition(ActivityTransition(1000L, true))
        assertEquals(listOf(ActivityTransition(1000L, true), ActivityTransition(2000L, false)), store.transitions())
    }

    @Test fun clearAllKeepsConsentStateAndCounter() {
        agree()
        store.addSamples(listOf(1L to 60.0))
        store.addDrops(DropReason.ACCURACY, 1)
        store.addTransition(ActivityTransition(1L, true))
        store.saveEstimate(d1, 55.0, 40, at)
        store.saveState(CollectionState.COLLECTING)
        store.nextMessageId()
        store.clearAll()
        assertTrue(store.minuteMeansBetween(0, Long.MAX_VALUE).isEmpty())
        assertTrue(store.dropCounts().isEmpty())
        assertTrue(store.transitions().isEmpty())
        assertTrue(store.pending().isEmpty())
        assertEquals(HealthConsent(true, at), store.consent())
        assertEquals(CollectionState.COLLECTING, store.state())
        assertEquals("watch:2", store.nextMessageId())
    }

    @Test fun nextMessageIdPersistsAcrossInstances() {
        assertEquals("watch:1", store.nextMessageId())
        assertEquals("watch:2", store.nextMessageId())
        store.close()
        store = DailyHrStore(RuntimeEnvironment.getApplication(), utc)
        assertEquals("watch:3", store.nextMessageId())
    }

    @Test fun consentAndStateDefaults() {
        assertNull(store.consent())
        assertEquals(CollectionState.OFF_NO_CONSENT, store.state())
        store.saveConsent(HealthConsent(false, at))
        assertFalse(store.consent()!!.agreed)
        store.saveConsent(HealthConsent(true, at.plusSeconds(1)))
        assertEquals(HealthConsent(true, at.plusSeconds(1)), store.consent())
    }

    @Test fun rawWritesAreIgnoredWithoutConsent() {
        store.addSamples(listOf(1L to 60.0))
        store.addDrops(DropReason.ACCURACY, 1)
        store.addTransition(ActivityTransition(1L, true))
        store.saveConsent(HealthConsent(false, at))
        store.addSamples(listOf(2L to 60.0))
        store.addDrops(DropReason.ACCURACY, 1)
        store.addTransition(ActivityTransition(2L, true))
        assertTrue(store.minuteMeansBetween(0, Long.MAX_VALUE).isEmpty())
        assertTrue(store.dropCounts().isEmpty())
        assertTrue(store.transitions().isEmpty())
    }

    private val pruneAt = Instant.parse("2026-10-10T12:00:00Z")
    private val cutoffMs = pruneAt.minus(Duration.ofHours(48)).toEpochMilli()

    @Test fun pruneDeletesMinutesOlderThan48HoursEvenWhenPending() {
        agree()
        store.addSamples(listOf(cutoffMs - 60_000 to 60.0, cutoffMs to 61.0))
        store.saveEstimate(LocalDate.of(2026, 10, 8), 55.0, 300, at) // unacked summary does not keep minutes
        store.prune(pruneAt)
        assertEquals(listOf(cutoffMs to 61.0), store.minuteMeansBetween(0, Long.MAX_VALUE))
    }

    @Test fun pruneDropsOldTransitionsButKeepsLatestBeforeCutoff() {
        agree()
        store.addTransition(ActivityTransition(cutoffMs - 3_000, true))
        store.addTransition(ActivityTransition(cutoffMs - 2_000, false))
        store.addTransition(ActivityTransition(cutoffMs - 1_000, true)) // exercise spanning the cutoff
        store.addTransition(ActivityTransition(cutoffMs + 1_000, false))
        store.prune(pruneAt)
        assertEquals(
            listOf(ActivityTransition(cutoffMs - 1_000, true), ActivityTransition(cutoffMs + 1_000, false)),
            store.transitions(),
        )
    }

    @Test fun pruneDeletesOnlyAckedSummariesOlderThanTwoDays() {
        val today = LocalDate.of(2026, 10, 10)
        listOf(3L, 2L).forEach { daysAgo ->
            val date = today.minusDays(daysAgo)
            store.saveEstimate(date, 55.0, 300, at)
            store.markAcked(date, 1)
        }
        store.saveEstimate(today.minusDays(5), 56.0, 300, at) // unacked: never deleted
        store.prune(pruneAt)
        assertEquals(listOf(today.minusDays(5)), store.pending().map { it.metricDate })
        // The acked summary of today - 2 survives: re-saving the same value keeps its revision and ack.
        assertEquals(1, store.saveEstimate(today.minusDays(2), 55.0, 300, at).revision)
        assertEquals(listOf(today.minusDays(5)), store.pending().map { it.metricDate })
        // The acked summary of today - 3 was deleted, so saving it again starts a new pending revision 1.
        store.saveEstimate(today.minusDays(3), 55.0, 300, at)
        assertEquals(listOf(today.minusDays(5), today.minusDays(3)), store.pending().map { it.metricDate })
    }

    @Test fun upgradeFromVersionOneKeepsConsentAndContinuesRevisions() {
        store.close()
        val app = RuntimeEnvironment.getApplication()
        app.deleteDatabase("daily_hr.db")
        SQLiteDatabase.openOrCreateDatabase(app.getDatabasePath("daily_hr.db"), null).use { db ->
            db.execSQL("CREATE TABLE samples(epoch_ms INTEGER PRIMARY KEY, bpm REAL NOT NULL)")
            db.execSQL("CREATE TABLE drops(reason TEXT PRIMARY KEY, count INTEGER NOT NULL)")
            db.execSQL("CREATE TABLE transitions(epoch_ms INTEGER PRIMARY KEY, exercising INTEGER NOT NULL)")
            db.execSQL(
                "CREATE TABLE summaries(metric_date TEXT PRIMARY KEY, revision INTEGER NOT NULL, value REAL NOT NULL, " +
                    "count INTEGER NOT NULL, method TEXT NOT NULL, computed_at TEXT NOT NULL, acked INTEGER NOT NULL)",
            )
            db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execSQL("INSERT INTO samples VALUES(1000, 60.0)")
            db.execSQL("INSERT INTO transitions VALUES(1000, 1)")
            db.execSQL("INSERT INTO summaries VALUES('2026-10-01', 1, 55.0, 40, 'LOWER_10PCT_MEAN_V1', '$at', 0)")
            db.execSQL("INSERT INTO meta VALUES('consent_access', 'AGREEE')")
            db.execSQL("INSERT INTO meta VALUES('consent_updated_at', '$at')")
            db.execSQL("INSERT INTO meta VALUES('message_counter', '4')")
            db.version = 1
        }
        store = DailyHrStore(app, utc)

        assertEquals(HealthConsent(true, at), store.consent())
        assertEquals("watch:5", store.nextMessageId())
        assertEquals(listOf(ActivityTransition(1000L, true)), store.transitions())
        assertTrue(store.pending().isEmpty()) // v1 summaries are marked acked, not resent
        // The next V2 estimate for the same date continues the revision so the phone's V1 record is overwritten.
        assertEquals(2, store.saveEstimate(LocalDate.of(2026, 10, 1), 56.0, 300, at).revision)
        store.addSamples(listOf(60_000L to 61.0))
        assertEquals(listOf(60_000L to 61.0), store.minuteMeansBetween(0, Long.MAX_VALUE))
    }
}
