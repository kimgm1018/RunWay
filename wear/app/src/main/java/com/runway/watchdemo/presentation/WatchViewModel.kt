package com.runway.watchdemo.presentation

import com.runway.watchdemo.session.*
import java.util.Locale

object MetricDisplay {
    fun missingReason(support: Map<String, String>, kind: MetricKind): String = when (MeasurementSupport.status(support, kind)) {
        SupportStatus.PERMISSION_DENIED -> "권한 필요"
        SupportStatus.UNSUPPORTED -> "미지원"
        else -> "측정 대기"
    }
    private fun valid(s: MetricSample?) = s?.value?.let { it.isFinite() && it >= 0 && !MetricMath.unreliable(s.quality) } == true
    fun value(sample: MetricSample?, nowMs: Long): String {
        if (!valid(sample)) return "—"
        val s = sample!!
        val digits = if (s.kind in setOf(MetricKind.HEART_RATE, MetricKind.CADENCE, MetricKind.STEPS, MetricKind.STEPS_TOTAL)) 0 else 2
        val number = String.format(Locale.US, "%.${digits}f", s.value)
        val source = if (s.source.startsWith("estimated")) " · 추정" else ""
        val age = if (nowMs - s.endElapsedMs > 15000) " · 이전" else ""
        return "$number ${s.unit}$source$age"
    }
    fun pace(sample: MetricSample?, nowMs: Long): String {
        if (!valid(sample)) return "—"
        val pace = MetricMath.paceSecondsPerKm(sample?.value)?.toLong() ?: return "—"
        return "%d:%02d /km".format(pace / 60, pace % 60) + if (nowMs - sample!!.endElapsedMs > 15000) " · 이전" else ""
    }
}
