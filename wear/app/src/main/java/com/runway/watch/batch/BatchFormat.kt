package com.runway.watch.batch

import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/**
 * One watch GPS fix (S15P31E105-549): WGS84 degrees, horizontal accuracy and altitude in metres. A quality the device
 * did not report stays null; nothing is assumed for it.
 */
data class GeoFix(val latitude: Double, val longitude: Double, val accuracyM: Double?, val altitudeM: Double?)

/**
 * One reading as it reached the app (S15P31E105-311). Values the device did not measure stay null; nothing is
 * filled from an older reading. [measuredAt] is the original measurement time, never the receive time.
 */
data class Reading(
    val measuredAt: Instant,
    val elapsedSec: Long,
    val heartRateBpm: Double? = null,
    val cadenceSpm: Double? = null,
    val speedMps: Double? = null,
    val totalDistanceM: Double? = null,
    /** A GPS fix; it becomes a GPS_POINT item of its own, never part of a METRIC_SAMPLE (S15P31E105-549). */
    val location: GeoFix? = null,
) {
    val hasMetric: Boolean get() = heartRateBpm != null || cadenceSpm != null || speedMps != null || totalDistanceM != null
    val hasValue: Boolean get() = hasMetric || location != null

    /** Names of the values this reading carries, the keys of [BatchMarks.latest]. */
    val metrics: List<String>
        get() = listOfNotNull(
            heartRateBpm?.let { "heartRate" }, cadenceSpm?.let { "cadence" },
            speedMps?.let { "speed" }, totalDistanceM?.let { "totalDistance" }, location?.let { "location" },
        )
}

/**
 * W07 batch body and BATCH_DATA envelope (devices-health.md W07, watch-mobile-server-integration.md 6장·9.3).
 * The body is written once in canonical (RFC 8785 JCS) form, so the bytes the phone relays are the bytes hashed.
 * Never log the body: it holds health values.
 */
object BatchFormat {
    const val SCHEMA_VERSION = "1"
    const val MAX_MESSAGE_BYTES = 32 * 1024
    /** Accuracy and altitude are NUMERIC(10,2) on the server: below 1e8 in absolute value. */
    private const val MAX_QUALITY = 99_999_999.995

    /**
     * Items for [readings]: readings with the same measuredAt become one METRIC_SAMPLE, others stay separate. A GPS fix
     * becomes its own GPS_POINT at its own time, after the metric sample of that time (S15P31E105-549).
     * Values are rounded to the DB scale (devices-health.md W07 서버 검사 3) so the server never has to round.
     */
    fun items(readings: List<Reading>): List<Map<String, Any?>> {
        val metrics = readings.filter { it.hasMetric }.groupBy { micros(it.measuredAt) }
        val points = readings.mapNotNull { r -> r.location?.let { micros(r.measuredAt) to it } }
            .groupBy({ it.first }, { it.second })
        val out = mutableListOf<Map<String, Any?>>()
        for (at in (metrics.keys + points.keys).toSortedSet()) {
            metrics[at]?.let { group -> metricItem(at, group)?.let(out::add) }
            points[at]?.firstNotNullOfOrNull { gpsItem(at, it) }?.let(out::add)
        }
        return out
    }

    private fun metricItem(at: Instant, group: List<Reading>): Map<String, Any?>? {
        fun pick(f: (Reading) -> Double?) = group.firstNotNullOfOrNull(f)
        val hr = pick { it.heartRateBpm }?.takeIf { it > 0 }
        val item = linkedMapOf(
            "type" to "METRIC_SAMPLE",
            "measuredAt" to at.toString(),
            "elapsedDurationSec" to group.maxOf { it.elapsedSec }.coerceAtLeast(0),
            "heartRateBpm" to hr?.let { decimal(it, 2) },
            "cadenceSpm" to pick { it.cadenceSpm }?.let { decimal(it.coerceAtLeast(0.0), 2) },
            "speedMps" to pick { it.speedMps }?.let { decimal(it.coerceAtLeast(0.0), 3) },
            "gradePercent" to null,
            "totalDistanceM" to pick { it.totalDistanceM }?.let { decimal(it.coerceAtLeast(0.0), 2) },
            "routeProgressM" to null,
            "isHrMeasured" to (hr != null),
        )
        val measured = item["heartRateBpm"] != null || item["cadenceSpm"] != null || item["speedMps"] != null || item["totalDistanceM"] != null
        return if (measured) item else null
    }

    /**
     * W07 GPS_POINT. Coordinates keep 6 decimals (about 0.1 m): with at most 15 significant digits and no value below
     * 1e-6, the plain decimal is also the ECMAScript form the server hashes. A bad accuracy is sent as unknown.
     */
    private fun gpsItem(at: Instant, fix: GeoFix): Map<String, Any?>? {
        val lat = fix.latitude
        val lng = fix.longitude
        if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
        return linkedMapOf(
            "type" to "GPS_POINT",
            "measuredAt" to at.toString(),
            "coordinates" to listOf(decimal(lng, 6), decimal(lat, 6)),
            // DB NUMERIC(10,2)를 넘는 품질 값은 batch 전체 422를 부르므로 모르는 값(null)으로 보낸다.
            "accuracyM" to fix.accuracyM?.takeIf { it >= 0 && it < MAX_QUALITY }?.let { decimal(it, 2) },
            "altitudeM" to fix.altitudeM?.takeIf { abs(it) < MAX_QUALITY }?.let { decimal(it, 2) },
        )
    }

    /** W07 hash: body without payloadHash, deviceId/sessionId as decimal strings, JCS, SHA-256, lowercase hex. */
    fun hash(id: String, deviceId: String, sessionId: String, items: List<Map<String, Any?>>): String {
        val projection = mapOf(
            "id" to id,
            "deviceId" to deviceId,
            "sessionId" to sessionId,
            "schemaVersion" to SCHEMA_VERSION,
            "items" to items,
        )
        val digest = MessageDigest.getInstance("SHA-256").digest(Jcs.write(projection).toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** The W07 request body, ids as JSON numbers, keys in JCS order. */
    fun body(id: String, deviceId: String, sessionId: String, items: List<Map<String, Any?>>): String = Jcs.write(
        mapOf(
            "id" to id,
            "deviceId" to deviceId.toLong(),
            "sessionId" to sessionId.toLong(),
            "schemaVersion" to SCHEMA_VERSION,
            "items" to items,
            "payloadHash" to hash(id, deviceId, sessionId, items),
        ),
    )

    /** BATCH_DATA envelope; the payload is the W07 body unchanged (9.3). */
    fun envelope(messageId: String, sessionId: String, body: String): ByteArray =
        ("{\"protocolVersion\":1,\"type\":\"BATCH_DATA\",\"messageId\":${Jcs.write(messageId)}," +
            "\"replyTo\":null,\"senderDeviceId\":null,\"sessionId\":${sessionId.toLong()},\"payload\":$body}")
            .toByteArray(Charsets.UTF_8)

    /**
     * Splits [items] into bodies whose envelope stays within 32 KiB. A single item that cannot fit alone is an error
     * (6장: never dropped silently); items are never moved between bodies afterwards.
     */
    fun split(
        items: List<Map<String, Any?>>,
        envelopeSize: (List<Map<String, Any?>>) -> Int,
    ): List<List<Map<String, Any?>>> {
        val out = mutableListOf<List<Map<String, Any?>>>()
        var current = mutableListOf<Map<String, Any?>>()
        for (item in items) {
            val next = current + item
            if (envelopeSize(next) <= MAX_MESSAGE_BYTES) {
                current = next.toMutableList()
                continue
            }
            if (current.isEmpty()) throw IllegalStateException("BATCH_ITEM_TOO_LARGE")
            out += current
            current = mutableListOf(item)
            if (envelopeSize(current) > MAX_MESSAGE_BYTES) throw IllegalStateException("BATCH_ITEM_TOO_LARGE")
        }
        if (current.isNotEmpty()) out += current
        return out
    }

    /** W07 accepts at most microseconds and a trailing Z. */
    private fun micros(at: Instant): Instant = at.truncatedTo(ChronoUnit.MICROS)

    private fun decimal(value: Double, scale: Int): BigDecimal? =
        if (value.isNaN() || value.isInfinite()) null
        else BigDecimal.valueOf(value).setScale(scale, RoundingMode.HALF_UP).stripTrailingZeros()
}

/**
 * Minimal RFC 8785 writer for the values a batch holds: maps with string keys, lists, strings, booleans, null,
 * integers and [BigDecimal]s within the DB scale. Those decimals have at most 15 significant digits, so their plain
 * form is the ECMAScript shortest form JCS asks for.
 */
object Jcs {
    fun write(value: Any?): String = StringBuilder().also { append(it, value) }.toString()

    private fun append(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is Boolean -> out.append(value)
            is Int, is Long -> out.append(value.toString())
            is BigDecimal -> out.append(if (value.signum() == 0) "0" else value.stripTrailingZeros().toPlainString())
            is String -> string(out, value)
            is Map<*, *> -> {
                out.append('{')
                value.entries.map { it.key as String to it.value }.sortedWith { a, b -> a.first.compareTo(b.first) }
                    .forEachIndexed { i, (k, v) ->
                        if (i > 0) out.append(',')
                        string(out, k)
                        out.append(':')
                        append(out, v)
                    }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                value.forEachIndexed { i, v ->
                    if (i > 0) out.append(',')
                    append(out, v)
                }
                out.append(']')
            }
            else -> throw IllegalArgumentException("unsupported JSON value")
        }
    }

    private fun string(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
            }
        }
        out.append('"')
    }
}
