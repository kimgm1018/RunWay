package com.runway.watch.ui.format

import com.runway.watch.run.HeartRate
import com.runway.watch.run.RhythmBpm
import org.junit.Assert.*
import org.junit.Test

class MetricFormatTest {
    @Test fun paceUsesPrimeMarks() {
        assertEquals("5′56″", MetricFormat.pace(356).value)
        assertEquals("10′05″", MetricFormat.pace(605).value)
        assertNull(MetricFormat.pace(356).unit)
    }

    @Test fun distanceIsTruncatedSoProgressIsNeverOverstated() {
        val text = MetricFormat.distance(2389.9)
        assertEquals("2.38", text.value)
        assertEquals("km", text.unit)
    }

    @Test fun durationSwitchesToHoursOnlyWhenNeeded() {
        assertEquals("14:12", MetricFormat.duration(852_000).value)
        assertEquals("1:02:03", MetricFormat.duration(3_723_000).value)
    }

    @Test fun missingOrInvalidValuesShareOneMarker() {
        val missing = listOf(
            MetricFormat.pace(null), MetricFormat.pace(0), MetricFormat.pace(3600),
            MetricFormat.distance(null), MetricFormat.distance(-1.0), MetricFormat.distance(Double.NaN),
            MetricFormat.duration(null), MetricFormat.duration(-1),
            MetricFormat.heartRate(null), MetricFormat.heartRate(HeartRate(0)),
            MetricFormat.rhythm(null), MetricFormat.cadence(null), MetricFormat.cadence(-3),
        )
        for (text in missing) {
            assertTrue(text.missing)
            assertEquals(MetricFormat.MISSING, text.value)
        }
    }

    @Test fun missingKeepsUnitSoTheLayoutDoesNotJump() {
        assertEquals("km", MetricFormat.distance(null).unit)
        assertEquals("BPM", MetricFormat.rhythm(null).unit)
    }

    @Test fun heartRateAndRhythmAreVisiblyAndAudiblyDistinct() {
        val heart = MetricFormat.heartRate(HeartRate(172))
        val rhythm = MetricFormat.rhythm(RhythmBpm(172))
        assertEquals("172", heart.value)
        assertEquals("172", rhythm.value)
        assertEquals("♥", heart.symbol)
        assertEquals("♪", rhythm.symbol)
        assertNull(heart.unit)
        assertEquals("BPM", rhythm.unit)
        assertEquals("심박수 172", heart.description)
        assertEquals("리듬 172 BPM", rhythm.description)
        assertNotEquals(heart.description, rhythm.description)
    }

    @Test fun missingDescriptionsStillNameTheMetric() {
        assertEquals("심박수 측정값 없음", MetricFormat.heartRate(null).description)
        assertEquals("리듬 BPM 없음", MetricFormat.rhythm(null).description)
    }
}
