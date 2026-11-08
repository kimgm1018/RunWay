package com.runway.watch.ui.format

import com.runway.watch.run.HeartRate
import com.runway.watch.run.RhythmBpm

/**
 * One displayable metric. [unit] is kept even when the value is missing so layouts do not shift.
 * [description] is what TalkBack reads; it always names the metric.
 */
data class MetricText(
    val value: String,
    val unit: String? = null,
    val symbol: String? = null,
    val description: String,
    val missing: Boolean = false,
)

object MetricFormat {
    /** Same "no value" marker as the phone screens. */
    const val MISSING = "– –"

    /** Visible labels that keep heart rate and rhythm BPM apart on the face (D-10). */
    const val HEART_LABEL = "심박"
    const val RHYTHM_LABEL = "리듬 BPM"

    private const val MAX_PACE_SECONDS = 3599

    fun pace(secondsPerKm: Int?): MetricText {
        if (secondsPerKm == null || secondsPerKm !in 1..MAX_PACE_SECONDS) return missing(description = "페이스 측정값 없음")
        val text = "%d′%02d″".format(secondsPerKm / 60, secondsPerKm % 60)
        return MetricText(text, description = "페이스 킬로미터당 ${secondsPerKm / 60}분 ${secondsPerKm % 60}초")
    }

    fun distance(meters: Double?): MetricText {
        if (meters == null || meters.isNaN() || meters < 0) return missing("km", description = "거리 측정값 없음")
        // Truncate, so 2.389km never reads as 2.39km before the runner gets there.
        val hundredths = (meters / 10).toLong()
        val text = "%d.%02d".format(hundredths / 100, hundredths % 100)
        return MetricText(text, "km", description = "거리 $text 킬로미터")
    }

    fun duration(ms: Long?): MetricText {
        if (ms == null || ms < 0) return missing(description = "경과 시간 없음")
        val total = ms / 1000
        val (h, m, s) = Triple(total / 3600, total / 60 % 60, total % 60)
        val text = if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        return MetricText(text, description = "경과 시간 " + (if (h > 0) "${h}시간 " else "") + "${m}분 ${s}초")
    }

    fun heartRate(rate: HeartRate?): MetricText {
        if (rate == null || rate.bpm !in 1..250) return missing(symbol = "♥", description = "심박수 측정값 없음")
        return MetricText(rate.bpm.toString(), symbol = "♥", description = "심박수 ${rate.bpm}")
    }

    fun rhythm(rhythm: RhythmBpm?): MetricText {
        if (rhythm == null || rhythm.beatsPerMinute <= 0) return missing("BPM", "♪", "리듬 BPM 없음")
        return MetricText(rhythm.beatsPerMinute.toString(), "BPM", "♪", "리듬 ${rhythm.beatsPerMinute} BPM")
    }

    fun cadence(spm: Int?): MetricText {
        if (spm == null || spm <= 0) return missing("spm", description = "케이던스 측정값 없음")
        return MetricText(spm.toString(), "spm", description = "케이던스 분당 ${spm}걸음")
    }

    private fun missing(unit: String? = null, symbol: String? = null, description: String) =
        MetricText(MISSING, unit, symbol, description, missing = true)
}
