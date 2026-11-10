package com.runway.watch.batch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** W07 body, hash and size rules (devices-health.md W07). Synthetic values only. */
class BatchFormatTest {
    private val at = Instant.parse("2026-10-27T01:00:01Z")

    @Test
    fun `hash matches the W07 spec example`() {
        val items = BatchFormat.items(listOf(Reading(at, 1, heartRateBpm = 142.0)))
        val hash = BatchFormat.hash("00000000-0000-4000-8000-000000000101", "101", "5001", items)
        assertEquals("ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c", hash)
    }

    @Test
    fun `body carries numeric ids, every metric key and the hash`() {
        val items = BatchFormat.items(listOf(Reading(at, 1, heartRateBpm = 142.0)))
        val body = JSONObject(BatchFormat.body("00000000-0000-4000-8000-000000000101", "101", "5001", items))
        assertEquals(101L, body.getLong("deviceId"))
        assertEquals(5001L, body.getLong("sessionId"))
        assertEquals("1", body.getString("schemaVersion"))
        assertEquals("ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c", body.getString("payloadHash"))
        val item = body.getJSONArray("items").getJSONObject(0)
        assertEquals(
            setOf("type", "measuredAt", "elapsedDurationSec", "heartRateBpm", "cadenceSpm", "speedMps", "gradePercent",
                "totalDistanceM", "routeProgressM", "isHrMeasured"),
            item.keys().asSequence().toSet(),
        )
        assertTrue(item.getBoolean("isHrMeasured"))
        assertTrue(item.isNull("speedMps"))
    }

    @Test
    fun `readings at the same time merge, others stay apart, values keep the DB scale`() {
        val later = at.plusNanos(123_456_789)
        val items = BatchFormat.items(
            listOf(
                Reading(at, 1, heartRateBpm = 150.456),
                Reading(at, 1, speedMps = 3.12345),
                Reading(later, 2, totalDistanceM = 10.005, cadenceSpm = 172.0),
            ),
        )
        assertEquals(2, items.size)
        assertEquals("2026-10-27T01:00:01Z", items[0]["measuredAt"])
        assertEquals("150.46", items[0]["heartRateBpm"].toString())
        assertEquals("3.123", items[0]["speedMps"].toString())
        assertEquals("2026-10-27T01:00:01.123456Z", items[1]["measuredAt"])
        assertEquals(false, items[1]["isHrMeasured"])
        assertEquals(null, items[1]["heartRateBpm"])
        assertEquals("10.01", items[1]["totalDistanceM"].toString())
    }

    @Test
    fun `readings without any value make no item`() {
        assertTrue(BatchFormat.items(listOf(Reading(at, 1))).isEmpty())
        assertTrue(BatchFormat.items(listOf(Reading(at, 1, heartRateBpm = 0.0))).isEmpty())
    }

    @Test
    fun `canonical JSON sorts keys and escapes control characters`() {
        assertEquals("""{"a":"x\n\u0001","b":[1,null,true]}""", Jcs.write(mapOf("b" to listOf(1, null, true), "a" to "x\n\u0001")))
    }

    @Test
    fun `split keeps every envelope within 32 KiB without dropping items`() {
        val readings = (0 until 400).map { Reading(at.plusSeconds(it.toLong()), it.toLong(), heartRateBpm = 140.0 + it % 10, speedMps = 3.0) }
        val items = BatchFormat.items(readings)
        val size = { part: List<Map<String, Any?>> ->
            BatchFormat.envelope("watch:1", "5001", BatchFormat.body("00000000-0000-4000-8000-000000000000", "101", "5001", part)).size
        }
        val parts = BatchFormat.split(items, size)
        assertTrue(parts.size > 1)
        assertEquals(items, parts.flatten())
        parts.forEach { assertTrue(size(it) <= BatchFormat.MAX_MESSAGE_BYTES) }
    }

    @Test
    fun `envelope is a BATCH_DATA message whose payload is the body`() {
        val body = BatchFormat.body("00000000-0000-4000-8000-000000000101", "101", "5001", BatchFormat.items(listOf(Reading(at, 1, heartRateBpm = 142.0))))
        val json = JSONObject(String(BatchFormat.envelope("watch:7", "5001", body), Charsets.UTF_8))
        assertEquals("BATCH_DATA", json.getString("type"))
        assertEquals(1, json.getInt("protocolVersion"))
        assertEquals("watch:7", json.getString("messageId"))
        assertEquals(5001L, json.getLong("sessionId"))
        assertFalse(json.has("payloadHash"))
        assertEquals(JSONObject(body).toString(), json.getJSONObject("payload").toString())
    }

    // S15P31E105-549: watch GPS goes into the same batch as a W07 GPS_POINT, apart from the metric sample.
    @Test
    fun `a location becomes a GPS_POINT next to the metric sample of the same time`() {
        val fix = GeoFix(latitude = 37.49791234567, longitude = 127.02761234567, accuracyM = 4.567, altitudeM = 31.005)
        val items = BatchFormat.items(listOf(Reading(at, 1, heartRateBpm = 150.0), Reading(at, 1, location = fix)))
        assertEquals(listOf("METRIC_SAMPLE", "GPS_POINT"), items.map { it["type"] })
        val point = items[1]
        assertEquals(setOf("type", "measuredAt", "coordinates", "accuracyM", "altitudeM"), point.keys)
        assertEquals("2026-10-27T01:00:01Z", point["measuredAt"])
        assertEquals("[127.027612,37.497912]", Jcs.write(point["coordinates"]))
        assertEquals("4.57", point["accuracyM"].toString())
        assertEquals("31.01", point["altitudeM"].toString())
    }

    @Test
    fun `a location alone makes only a GPS_POINT and keeps missing quality null`() {
        val items = BatchFormat.items(listOf(Reading(at, 1, location = GeoFix(37.5, 127.0, null, null))))
        assertEquals(1, items.size)
        assertEquals("GPS_POINT", items[0]["type"])
        assertEquals(null, items[0]["accuracyM"])
        assertEquals(null, items[0]["altitudeM"])
        assertEquals("[127,37.5]", Jcs.write(items[0]["coordinates"]))
    }

    @Test
    fun `a location out of range or not finite makes no item`() {
        val bad = listOf(GeoFix(91.0, 127.0, 3.0, null), GeoFix(37.0, 181.0, 3.0, null), GeoFix(Double.NaN, 127.0, 3.0, null))
        assertTrue(BatchFormat.items(bad.map { Reading(at, 1, location = it) }).isEmpty())
    }

    @Test
    fun `quality beyond the DB scale is sent as unknown so the batch is not refused`() {
        val items = BatchFormat.items(listOf(Reading(at, 1, location = GeoFix(37.5, 127.0, 1e9, -2e8))))
        assertEquals(null, items[0]["accuracyM"])
        assertEquals(null, items[0]["altitudeM"])
    }

    @Test
    fun `a negative accuracy is left out rather than sent`() {
        val items = BatchFormat.items(listOf(Reading(at, 1, location = GeoFix(37.5, 127.0, -1.0, null))))
        assertEquals(null, items[0]["accuracyM"])
    }
}
