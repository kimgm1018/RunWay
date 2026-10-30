package com.runway.watchdemo.session

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SessionJsonTest {
    private fun legacyRecord(device: String) = """{
        "schemaVersion":1,"sessionId":"legacy-1","participantId":"runner01",
        "startedAtEpochMs":1792378800000,"startedElapsedMs":1000,
        "endedElapsedMs":5000,"state":"COMPLETED","endReason":"user",
        "uploadState":"PENDING","device":$device,"capabilities":{"STEPS.support":"supported"},
        "bpmEvents":[],"samples":[]
    }"""

    @Test fun legacyStringDeviceExportsAsTypedV2WithoutChangingIdentity() {
        for (synthetic in listOf(true, false)) {
            val saved = legacyRecord("""{"model":"Watch7","api":"34","appVersion":"1.0",
                "bootCount":"4","synthetic":"$synthetic"}""")
            val exported = JSONObject(SessionJson.encode(SessionJson.decode(saved)))
            val device = exported.getJSONObject("device")
            assertEquals(2, exported.getInt("schemaVersion"))
            assertEquals("legacy-1", exported.getString("sessionId"))
            assertEquals(34, device.get("api"))
            assertEquals(4, device.get("bootCount"))
            assertEquals(synthetic, device.get("synthetic"))
            assertEquals("Watch7", device.get("model"))
            assertEquals("1.0", device.get("appVersion"))
            assertEquals("supported", exported.getJSONObject("capabilities").get("STEPS.support"))
            assertEquals(SessionJson.decode(saved), SessionJson.decode(exported.toString()))
        }
    }

    @Test fun legacyUnknownBootCountBecomesNullRatherThanNegativeCount() {
        val saved = legacyRecord("""{"model":"Watch7","api":"34","appVersion":"1.0",
            "bootCount":"-1","synthetic":"false"}""")
        val device = JSONObject(SessionJson.encode(SessionJson.decode(saved))).getJSONObject("device")
        assertTrue(device.isNull("bootCount"))
        assertEquals(false, device.get("synthetic"))
    }

    @Test fun typedV2DeviceSurvivesReadAndWriteWithUnknownMetadataPreserved() {
        val saved = JSONObject(legacyRecord("""{"model":"Watch7","api":37,"appVersion":"1.0",
            "bootCount":null,"synthetic":true}""")).put("schemaVersion", 2)
        val device = JSONObject(SessionJson.encode(SessionJson.decode(saved.toString()))).getJSONObject("device")
        assertEquals(37, device.get("api"))
        assertEquals(true, device.get("synthetic"))
        assertTrue(device.isNull("bootCount"))
        assertEquals(SessionJson.decode(saved.toString()), SessionJson.decode(SessionJson.encode(SessionJson.decode(saved.toString()))))
    }

    @Test fun absentLegacyMetadataDoesNotClaimPhysicalDeviceOrZeroBootCount() {
        val device = JSONObject(SessionJson.encode(SessionJson.decode(legacyRecord("{}")))).getJSONObject("device")
        assertTrue(device.isNull("api"))
        assertTrue(device.isNull("bootCount"))
        assertTrue(device.isNull("synthetic"))
    }

    @Test fun v2RejectsStringTypesAndInvalidCountsInsteadOfSilentlyCoercingThem() {
        val invalidDevices = listOf(
            """{"api":"37","synthetic":false}""",
            """{"api":37,"synthetic":"false"}""",
            """{"api":37,"bootCount":-1,"synthetic":false}""",
            """{"api":37.5,"synthetic":false}""",
        )
        for (device in invalidDevices) {
            val saved = JSONObject(legacyRecord(device)).put("schemaVersion", 2)
            assertTrue("Invalid device must be rejected: $device", runCatching { SessionJson.decode(saved.toString()) }.isFailure)
        }
    }

    @Test fun futureSchemaCannotBeSilentlyReadAsTheCurrentFormat() {
        val saved = JSONObject(legacyRecord("{}")).put("schemaVersion", 3)
        assertTrue(runCatching { SessionJson.decode(saved.toString()) }.isFailure)
    }

    @Test fun exportedSamplesKeepTheirOriginalTimeNullQualityAndAppliedBpm() {
        val session = SessionRecord("run-1", "runner01", 1792378800000, 1000,
            state = SessionState.COMPLETED, endedElapsedMs = 5000,
            events = listOf(BpmEvent(2900, 3000, 168, false, true), BpmEvent(1000, 1100, 164)),
            samples = listOf(MetricSample(MetricKind.SPEED, 2500, 2500, null, "m/s", quality = "unreliable"),
                MetricSample(MetricKind.STEP_LENGTH, 3000, 4000, 1.2, "m/step", "estimated_distance_div_steps:health_services", "estimated")))
        val encoded = SessionJson.encode(session)
        val json = JSONObject(encoded)
        assertEquals(2, json.getInt("schemaVersion"))
        assertEquals("2026-10-19T03:00:04Z", json.getString("endedAt"))
        val missing = json.getJSONArray("samples").getJSONObject(0)
        assertTrue(missing.isNull("value"))
        assertEquals("unreliable", missing.getString("quality"))
        assertEquals("2026-10-19T03:00:01.500Z", missing.getString("measuredAt"))
        assertEquals(164, missing.getInt("targetBpmAtEnd"))
        assertEquals(168, json.getJSONArray("samples").getJSONObject(1).getInt("targetBpmAtEnd"))
        assertEquals(session, SessionJson.decode(encoded))
    }
}
