package com.runway.watch.run

/** STA-002 delivery state of one measurement source. Only [LIVE] values are shown as current. */
enum class FeedStatus {
    LIVE,
    /** Values still arrive but late; the last value is kept and marked, never shown as current. */
    DELAYED,
    /** Nothing has arrived for the source (sensor not ready, no GPS fix). */
    NO_SIGNAL,
    /** Collection stopped (permission revoked, sensor or phone link lost). */
    STOPPED,
}

/** Per-source state behind [RunMetrics]. Distance and pace both come from location. */
data class MetricFeeds(
    val location: FeedStatus = FeedStatus.LIVE,
    val heartRate: FeedStatus = FeedStatus.LIVE,
    val cadence: FeedStatus = FeedStatus.LIVE,
)
