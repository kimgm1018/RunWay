package com.runway.watchdemo.session

import org.junit.Assert.*
import org.junit.Test

class MeasurementSupportTest {
    @Test fun knownSupportValuesHaveTypedMeaningAndKeepTheirJsonContract() {
        val cases = listOf(
            Triple("supported", SupportStatus.SUPPORTED, "측정 대기"),
            Triple("unsupported", SupportStatus.UNSUPPORTED, "미지원"),
            Triple("permission_denied", SupportStatus.PERMISSION_DENIED, "권한 필요"),
        )
        for ((wireValue, status, label) in cases) {
            val values = mapOf("HEART_RATE.support" to wireValue, "HEART_RATE.availability" to "SDK_FUTURE_STATE")
            assertEquals(status, MeasurementSupport.status(values, MetricKind.HEART_RATE))
            assertEquals(wireValue, status.wireValue)
            assertEquals(label, com.runway.watchdemo.presentation.MetricDisplay.missingReason(values, MetricKind.HEART_RATE))
            val json = org.json.JSONObject(SessionJson.encode(SessionRecord("support", "runner01", 0, 0, capabilities = values)))
            assertEquals(wireValue, json.getJSONObject("capabilities").getString("HEART_RATE.support"))
            val decoded = SessionJson.decode(json.toString())
            assertEquals(status, MeasurementSupport.status(decoded.capabilities, MetricKind.HEART_RATE))
            assertEquals("SDK_FUTURE_STATE", decoded.capabilities["HEART_RATE.availability"])
        }
    }

    @Test fun sdkAvailabilityIsNotAValidCanonicalSupportValue() {
        val values = mapOf("HEART_RATE.support" to "AVAILABLE", "HeartRate" to "supported")
        assertNull(MeasurementSupport.status(values, MetricKind.HEART_RATE))
        assertFalse(MeasurementSupport.isSupported(values, MetricKind.HEART_RATE))
    }

    @Test fun unknownCanonicalSupportDoesNotFallBackToOlderSupportedValue() {
        val values = mapOf("STEP_LENGTH.support" to "future_status", "Stride Length" to "supported")
        assertNull(MeasurementSupport.status(values, MetricKind.STEP_LENGTH))
        assertFalse(MeasurementSupport.isSupported(values, MetricKind.STEP_LENGTH))
    }

    @Test fun legacyAvailabilityIsCompatibleWithoutTurningUnavailableIntoUnsupported() {
        assertTrue(MeasurementSupport.isSupported(mapOf("HeartRate" to "AVAILABLE"), MetricKind.HEART_RATE))
        assertNull(MeasurementSupport.status(mapOf("HeartRate" to "UNAVAILABLE"), MetricKind.HEART_RATE))
        assertNull(MeasurementSupport.status(mapOf("HEART_RATE.availability" to "AVAILABLE"), MetricKind.HEART_RATE))
    }
}
