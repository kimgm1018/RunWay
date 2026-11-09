package com.runway.watch.dailyhr

import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyHrMessagesTest {
    private val summary = DailyHrSummary(
        metricDate = LocalDate.parse("2026-10-30"),
        revision = 2,
        estimatedRestingHrBpm = 58.4,
        method = METHOD,
        validSampleCount = 120,
        computedAt = Instant.parse("2026-10-31T01:02:03Z"),
        collectionId = "collection-a",
    )

    private fun received(
        type: String = "DAILY_HR_RECEIVED",
        version: Int = 1,
        date: String = "2026-10-30",
        revision: Int = 2,
    ): ByteArray = JSONObject()
        .put("protocolVersion", version)
        .put("type", type)
        .put("messageId", "9:1")
        .put("replyTo", "1:5")
        .put("senderDeviceId", "9")
        .put("sessionId", JSONObject.NULL)
        .put("payload", JSONObject().put("metricDate", date).put("revision", revision))
        .toString().toByteArray(Charsets.UTF_8)

    @Test
    fun encodeSummary_buildsEnvelope() {
        val bytes = DailyHrMessages.encodeSummary("1:5", summary)
        assertTrue(bytes.size <= DailyHrMessages.MAX_BYTES)
        val json = JSONObject(String(bytes, Charsets.UTF_8))
        assertEquals(1, json.getInt("protocolVersion"))
        assertEquals("DAILY_HR_SUMMARY", json.getString("type"))
        assertEquals("1:5", json.getString("messageId"))
        for (key in listOf("sessionId", "senderDeviceId", "replyTo")) {
            assertTrue(key, json.has(key))
            assertTrue(key, json.isNull(key))
        }
        val p = json.getJSONObject("payload")
        assertEquals("2026-10-30", p.getString("metricDate"))
        assertEquals(2, p.getInt("revision"))
        assertEquals("collection-a", p.getString("collectionId"))
        assertEquals(58.4, p.getDouble("estimatedRestingHrBpm"), 0.0)
        assertEquals("ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2", p.getString("method"))
        assertEquals(120, p.getInt("validSampleCount"))
        assertTrue(p.getString("computedAt").endsWith("Z"))
    }

    @Test
    fun decodeReceived_valid() {
        assertEquals(
            DailyHrReceipt(LocalDate.parse("2026-10-30"), 2, null),
            DailyHrMessages.decodeReceived(received()),
        )
    }

    @Test fun decodeReceiptCarriesCollectionId() {
        val json = JSONObject(String(received()))
        json.getJSONObject("payload").put("collectionId", "collection-a")
        assertEquals(DailyHrReceipt(LocalDate.parse("2026-10-30"), 2, "collection-a"),
            DailyHrMessages.decodeReceived(json.toString().toByteArray()))
    }

    @Test fun boundConsentRequiresCollectionStartToRejectQueuedSamples() {
        val ts = "2026-10-30T01:00:00Z"
        assertNull(HealthConsent.fromDataMap("AGREE", ts, "collection-a", null))
        assertNull(HealthConsent.fromDataMap("AGREE", ts, "collection-a", "bad"))
        assertEquals(HealthConsent(true, Instant.parse(ts), "collection-a", Instant.parse(ts)),
            HealthConsent.fromDataMap("AGREE", ts, "collection-a", ts))
    }

    @Test
    fun decodeReceived_rejectsMalformed() {
        assertNull(DailyHrMessages.decodeReceived(received(type = "OTHER")))
        assertNull(DailyHrMessages.decodeReceived(received(version = 2)))
        assertNull(DailyHrMessages.decodeReceived("not json".toByteArray()))
        assertNull(DailyHrMessages.decodeReceived(received(date = "2026-13-45")))
        assertNull(DailyHrMessages.decodeReceived(received(revision = 0)))
    }

    @Test
    fun consent_fromDataMap() {
        val ts = "2026-10-30T01:00:00Z"
        assertTrue(HealthConsent.fromDataMap("AGREE", ts)!!.agreed)
        assertFalse(HealthConsent.fromDataMap("DISAGREE", ts)!!.agreed)
        // S15P31E105-314: no compatibility for the pre-V24 typo; an old app's value reads as no consent.
        assertNull(HealthConsent.fromDataMap("AGREEE", ts))
        assertNull(HealthConsent.fromDataMap(null, ts))
        assertNull(HealthConsent.fromDataMap("AGREE", null))
        assertNull(HealthConsent.fromDataMap("AGREE", "garbage"))
    }

    @Test
    fun newerConsent_ignoresOlder() {
        val current = HealthConsent(false, Instant.parse("2026-10-30T02:00:00Z"))
        val older = HealthConsent(true, Instant.parse("2026-10-30T01:00:00Z"))
        val newer = HealthConsent(true, Instant.parse("2026-10-30T03:00:00Z"))
        assertEquals(current, newerConsent(current, older))
        assertEquals(newer, newerConsent(current, newer))
        assertEquals(older, newerConsent(null, older))
        val same = current.copy(agreed = true)
        assertEquals(current, newerConsent(current, same))
    }
}
