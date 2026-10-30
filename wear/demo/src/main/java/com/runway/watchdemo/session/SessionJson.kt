package com.runway.watchdemo.session

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

object SessionJson {
    private fun device(info: DeviceInfo) = JSONObject().apply {
        put("model", info.model); put("api", info.api ?: JSONObject.NULL); put("appVersion", info.appVersion)
        put("bootCount", info.bootCount ?: JSONObject.NULL); put("synthetic", info.synthetic ?: JSONObject.NULL)
    }
    private fun device(json: JSONObject, version: Int): DeviceInfo {
        fun integer(key: String): Int? {
            if (json.isNull(key)) return null
            val value = json.get(key)
            return if (version == 1) (value as String).toInt() else {
                require(value is Number && value.toDouble() == value.toInt().toDouble()) { "$key must be an integer" }
                value.toInt()
            }
        }
        val synthetic = if (json.isNull("synthetic")) null else if (version == 1) {
            when (json.getString("synthetic")) {
                "true" -> true
                "false" -> false
                else -> error("Invalid legacy synthetic value")
            }
        } else json.get("synthetic").let { value ->
            require(value is Boolean) { "synthetic must be a boolean" }; value
        }
        val bootCount = integer("bootCount")?.let { value ->
            if (version == 1 && value == -1) null else {
                require(value >= 0) { "bootCount must be nonnegative" }; value
            }
        }
        val api = integer("api")?.also { require(it > 0) { "api must be positive" } }
        return DeviceInfo(json.optString("model", ""), api, json.optString("appVersion", ""), bootCount, synthetic)
    }
    fun sample(s: MetricSample): JSONObject = JSONObject().apply {
        put("metric", s.kind.name); put("startElapsedMs", s.startElapsedMs); put("endElapsedMs", s.endElapsedMs)
        put("value", s.value?.takeIf { it.isFinite() } ?: JSONObject.NULL)
        put("unit", s.unit); put("source", s.source); put("quality", s.quality)
    }
    fun sample(j: JSONObject) = MetricSample(MetricKind.valueOf(j.getString("metric")),
        j.getLong("startElapsedMs"), j.getLong("endElapsedMs"),
        if (j.isNull("value")) null else j.getDouble("value"), j.getString("unit"), j.getString("source"), j.getString("quality"))
    fun event(e: BpmEvent): JSONObject = JSONObject().apply {
        put("requestedElapsedMs", e.requestedElapsedMs); put("appliedElapsedMs", e.appliedElapsedMs)
        put("targetBpm", e.targetBpm); put("soundEnabled", e.soundEnabled); put("vibrationEnabled", e.vibrationEnabled)
    }
    fun event(j: JSONObject) = BpmEvent(j.getLong("requestedElapsedMs"), j.getLong("appliedElapsedMs"),
        j.getInt("targetBpm"), j.getBoolean("soundEnabled"), j.getBoolean("vibrationEnabled"))
    fun encode(s: SessionRecord): String = JSONObject().apply {
        put("schemaVersion", 2); put("sessionId", s.id); put("participantId", s.participantId)
        put("startedAtEpochMs", s.startedAtEpochMs); put("startedElapsedMs", s.startedElapsedMs)
        put("startedAt", Instant.ofEpochMilli(s.startedAtEpochMs).toString())
        put("endedElapsedMs", s.endedElapsedMs ?: JSONObject.NULL)
        put("endedAt", s.endedElapsedMs?.let { Instant.ofEpochMilli(s.startedAtEpochMs + it - s.startedElapsedMs).toString() } ?: JSONObject.NULL)
        put("state", s.state.name); put("endReason", s.endReason); put("uploadState", s.uploadState.name)
        put("device", device(s.device)); put("capabilities", JSONObject(s.capabilities))
        put("bpmEvents", JSONArray(s.events.map { event(it) }))
        put("samples", JSONArray(s.samples.map { point -> sample(point).apply {
            put("measuredAt", Instant.ofEpochMilli(s.startedAtEpochMs + point.endElapsedMs - s.startedElapsedMs).toString())
            put("sessionElapsedMs", point.endElapsedMs - s.startedElapsedMs)
            // This is a temporal association, not a claim that a whole interval had one BPM.
            put("targetBpmAtEnd", MetricMath.bpmAt(s.events, point.endElapsedMs) ?: JSONObject.NULL)
        } }))
    }.toString()
    fun decode(text: String): SessionRecord {
        val j = JSONObject(text)
        val version = j.getInt("schemaVersion")
        require(version in 1..2) { "Unsupported session schema version: $version" }
        fun map(key: String): Map<String, String> = j.getJSONObject(key).let { obj -> obj.keys().asSequence().associateWith { obj.getString(it) } }
        val events = j.getJSONArray("bpmEvents")
        val samples = j.getJSONArray("samples")
        return SessionRecord(j.getString("sessionId"), j.getString("participantId"), j.getLong("startedAtEpochMs"),
            j.getLong("startedElapsedMs"), SessionState.valueOf(j.getString("state")),
            if (j.isNull("endedElapsedMs")) null else j.getLong("endedElapsedMs"), j.getString("endReason"),
            device(j.getJSONObject("device"), version), map("capabilities"), (0 until events.length()).map { event(events.getJSONObject(it)) },
            (0 until samples.length()).map { sample(samples.getJSONObject(it)) }, UploadState.valueOf(j.getString("uploadState")))
    }
}
