package com.runway.watch.dailyhr

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.ceil

const val METHOD = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2"
const val MIN_MINUTES = 240
const val MINUTE_MS = 60_000L

private const val MIN_BPM = 30.0
private const val MAX_BPM = 220.0
private const val LOWER_FRACTION = 0.10

enum class HrAccuracy { HIGH, MEDIUM, LOW, UNRELIABLE, NO_CONTACT, UNKNOWN }

enum class DropReason { ACCURACY, MISSING_ACCURACY, OUT_OF_RANGE }

data class ActivityTransition(val epochMs: Long, val exercising: Boolean)

/** Returns why a sample must be dropped, or null when it is valid. */
fun validate(bpm: Double, accuracy: HrAccuracy?): DropReason? = when {
    accuracy == null -> DropReason.MISSING_ACCURACY
    accuracy != HrAccuracy.HIGH && accuracy != HrAccuracy.MEDIUM -> DropReason.ACCURACY
    bpm.isNaN() || bpm < MIN_BPM || bpm > MAX_BPM -> DropReason.OUT_OF_RANGE
    else -> null
}

/**
 * Inclusive exercise ranges: from each exercise start to the instant before the next
 * non-exercise transition. An open interval ends at [untilMs].
 */
fun exerciseIntervals(transitions: List<ActivityTransition>, untilMs: Long): List<LongRange> {
    val result = mutableListOf<LongRange>()
    var start: Long? = null
    for (t in transitions.sortedBy { it.epochMs }) {
        if (t.exercising) {
            if (start == null) start = t.epochMs
        } else if (start != null) {
            result += start..(t.epochMs - 1)
            start = null
        }
    }
    if (start != null) result += start..untilMs
    return result
}

/** True when the minute [minuteStartMs, minuteStartMs + 59_999] touches any of [exercise]. */
fun overlapsExercise(minuteStartMs: Long, exercise: List<LongRange>): Boolean {
    val minuteEnd = minuteStartMs + MINUTE_MS - 1
    return exercise.any { minuteStartMs <= it.last && minuteEnd >= it.first }
}

/** Mean of the lowest 10% of [minuteMeans] (rounded half-up to 1 decimal), or null below [MIN_MINUTES]. */
fun estimateWindow(minuteMeans: List<Double>): Double? {
    if (minuteMeans.size < MIN_MINUTES) return null
    val k = ceil(minuteMeans.size * LOWER_FRACTION).toInt()
    val sum = minuteMeans.sorted().take(k).fold(BigDecimal.ZERO) { acc, v -> acc + BigDecimal.valueOf(v) }
    return sum.divide(BigDecimal(k), 1, RoundingMode.HALF_UP).toDouble()
}

fun localDate(epochMs: Long, zone: ZoneId): LocalDate =
    Instant.ofEpochMilli(epochMs).atZone(zone).toLocalDate()
