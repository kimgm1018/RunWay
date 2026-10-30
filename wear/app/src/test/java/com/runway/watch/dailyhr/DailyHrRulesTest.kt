package com.runway.watch.dailyhr

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyHrRulesTest {
    @Test
    fun validateAcceptsHighAndMediumAccuracyInRange() {
        assertNull(validate(80.0, HrAccuracy.HIGH))
        assertNull(validate(80.0, HrAccuracy.MEDIUM))
    }

    @Test
    fun validateDropsLowAccuracy() {
        assertEquals(DropReason.ACCURACY, validate(80.0, HrAccuracy.LOW))
        assertEquals(DropReason.ACCURACY, validate(80.0, HrAccuracy.NO_CONTACT))
        assertEquals(DropReason.ACCURACY, validate(80.0, HrAccuracy.UNRELIABLE))
        assertEquals(DropReason.ACCURACY, validate(80.0, HrAccuracy.UNKNOWN))
    }

    @Test
    fun validateDropsMissingAccuracy() {
        assertEquals(DropReason.MISSING_ACCURACY, validate(80.0, null))
    }

    @Test
    fun validateEnforcesBpmRange() {
        assertEquals(DropReason.OUT_OF_RANGE, validate(29.9, HrAccuracy.HIGH))
        assertNull(validate(30.0, HrAccuracy.HIGH))
        assertNull(validate(220.0, HrAccuracy.HIGH))
        assertEquals(DropReason.OUT_OF_RANGE, validate(220.1, HrAccuracy.HIGH))
        assertEquals(DropReason.OUT_OF_RANGE, validate(Double.NaN, HrAccuracy.HIGH))
    }

    @Test
    fun estimateWindowNeedsMinimumMinutes() {
        assertNull(estimateWindow(List(239) { 60.0 + it }))
        assertEquals(240, MIN_MINUTES)
        assertEquals("ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2", METHOD)
    }

    @Test
    fun estimateWindowAveragesLowest24Of240() {
        // 60..299 -> k = 24 -> mean(60..83) = 71.5
        assertEquals(71.5, estimateWindow(List(240) { 60.0 + it })!!, 0.0)
    }

    @Test
    fun estimateWindowRoundsHalfUpToOneDecimal() {
        // 241 minutes -> k = ceil(24.1) = 25 -> (24 * 60.0 + 61.9) / 25 = 60.076 -> 60.1
        val values = List(216) { 100.0 } + List(24) { 60.0 } + listOf(61.9)
        assertEquals(60.1, estimateWindow(values)!!, 0.0)
        // 240 minutes -> k = 24 -> (23 * 60.0 + 61.2) / 24 = 60.05 -> 60.1 (half-up, not banker's)
        val half = List(216) { 100.0 } + List(23) { 60.0 } + listOf(61.2)
        assertEquals(60.1, estimateWindow(half)!!, 0.0)
    }

    @Test
    fun estimateWindowIgnoresInputOrder() {
        val ordered = List(240) { 60.0 + it }
        assertEquals(71.5, estimateWindow(ordered.reversed())!!, 0.0)
        assertEquals(71.5, estimateWindow(ordered.shuffled(java.util.Random(7)))!!, 0.0)
    }

    @Test
    fun exerciseMinuteDropsPartiallyOverlappingMinute() {
        val exercise = listOf(130_000L..200_000L)
        assertTrue(overlapsExercise(120_000L, exercise)) // minute 120_000..179_999 partly overlaps
        assertTrue(overlapsExercise(180_000L, exercise)) // minute 180_000..239_999 overlaps at its start
        assertFalse(overlapsExercise(60_000L, exercise)) // minute ends at 119_999
        assertFalse(overlapsExercise(240_000L, exercise))
        assertTrue(overlapsExercise(0L, listOf(59_999L..59_999L)))
        assertFalse(overlapsExercise(0L, emptyList()))
    }

    @Test
    fun exerciseIntervalsClosesAtNextNonExerciseTransition() {
        val result = exerciseIntervals(
            listOf(ActivityTransition(100, true), ActivityTransition(200, false)),
            untilMs = 500,
        )
        assertEquals(listOf(100L..199L), result)
    }

    @Test
    fun exerciseIntervalsOpenIntervalEndsAtUntil() {
        val result = exerciseIntervals(listOf(ActivityTransition(100, true)), untilMs = 500)
        assertEquals(listOf(100L..500L), result)
    }

    @Test
    fun exerciseIntervalsIgnoresLeadingFalseAndDuplicateTrue() {
        val result = exerciseIntervals(
            listOf(
                ActivityTransition(50, false),
                ActivityTransition(100, true),
                ActivityTransition(150, true),
                ActivityTransition(200, false),
                ActivityTransition(250, false),
            ),
            untilMs = 500,
        )
        assertEquals(listOf(100L..199L), result)
    }

    @Test
    fun exerciseIntervalsSortsTransitionsAndSupportsMultipleIntervals() {
        val result = exerciseIntervals(
            listOf(
                ActivityTransition(400, false),
                ActivityTransition(100, true),
                ActivityTransition(300, true),
                ActivityTransition(200, false),
            ),
            untilMs = 500,
        )
        assertEquals(listOf(100L..199L, 300L..399L), result)
    }

    @Test
    fun localDateUsesZoneBoundary() {
        val seoul = ZoneId.of("Asia/Seoul")
        assertEquals(
            LocalDate.of(2026, 10, 30),
            localDate(Instant.parse("2026-10-30T14:59:59.999Z").toEpochMilli(), seoul),
        )
        assertEquals(
            LocalDate.of(2026, 10, 31),
            localDate(Instant.parse("2026-10-30T15:00:00Z").toEpochMilli(), seoul),
        )
    }
}
