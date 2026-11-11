package com.runway.watch.run

import java.time.Duration
import java.time.Instant

/**
 * 현재 페이스 공통 규칙(S15P31E105-549, 사용자 결정 2안). 폰(frontend/src/watch/paceRule.ts)과 같은 규칙·값을 쓴다.
 * 순간 속도 하나가 아니라 측정 시각 기준 최근 구간의 누적 거리 변화로 계산해, 같은 데이터면 워치와 폰이 같은 값을 낸다.
 *  1. 가장 최근 속도가 [MIN_MOVING_MPS] 미만이면 서 있다고 보고 null.
 *  2. 마지막 거리 표본 기준 [WINDOW] 안의 표본을 쓴다. 표본이 2개 미만이거나 구간이 [MIN_SPAN] 미만이면 마지막 표본과
 *     그 이전 [FALLBACK] 안의 가장 가까운 표본을 쓴다(화면이 꺼지면 워치가 거리를 몰아서 준다).
 *  3. 페이스 = 걸린 시간 ÷ 이동 거리. 평균 속도가 [MIN_MOVING_MPS] 미만이면 null.
 *  4. 거리로 계산할 수 없으면 최근 속도([MIN_MOVING_MPS] 이상)로 계산한다.
 */
object PaceRule {
    const val MIN_MOVING_MPS = 0.3
    val WINDOW: Duration = Duration.ofSeconds(15)
    val MIN_SPAN: Duration = Duration.ofSeconds(5)
    val FALLBACK: Duration = Duration.ofSeconds(60)

    data class DistanceSample(val at: Instant, val metres: Double)
    data class SpeedSample(val at: Instant, val mps: Double)

    /** Seconds per km, or null while standing or with nothing to go on. */
    fun currentPace(samples: List<DistanceSample>, latestSpeed: SpeedSample?): Double? {
        if (latestSpeed != null && latestSpeed.mps < MIN_MOVING_MPS) return null
        val sorted = samples.sortedBy { it.at }
        val fromDistance = paceOf(sorted)
        if (fromDistance != null) return fromDistance.value
        return latestSpeed?.let { 1000 / it.mps }
    }

    private class Result(val value: Double?)

    /** null: cannot tell from distance. Result(null): moving too slowly to count. */
    private fun paceOf(sorted: List<DistanceSample>): Result? {
        if (sorted.size < 2) return null
        val last = sorted.last()
        val inWindow = sorted.filter { !it.at.isBefore(last.at.minus(WINDOW)) }
        var first = inWindow.first()
        if (inWindow.size < 2 || Duration.between(first.at, last.at) < MIN_SPAN) {
            first = sorted.lastOrNull {
                !it.at.isAfter(last.at.minus(MIN_SPAN)) && !it.at.isBefore(last.at.minus(FALLBACK))
            } ?: return null
        }
        val seconds = Duration.between(first.at, last.at).toMillis() / 1000.0
        val metres = last.metres - first.metres
        if (seconds <= 0 || metres < 0) return null
        val mps = metres / seconds
        return Result(if (mps < MIN_MOVING_MPS) null else 1000 / mps)
    }
}
