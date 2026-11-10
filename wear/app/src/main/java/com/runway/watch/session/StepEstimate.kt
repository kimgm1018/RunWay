package com.runway.watch.session

import com.runway.watch.run.PaceRule

/**
 * 화면이 꺼진 동안의 추정값(S15P31E105-549). 워치 화면이 꺼지면 Health Services가 거리·속도·케이던스를 모아 늦게
 * 준다. 그동안 앱이 가속도로 센 걸음([AccelSteps])으로 케이던스를 내고, 걸음 수 × 보폭으로 거리·페이스를 추정한다. 보폭은 Health
 * Services 누적 거리가 올 때마다 그 거리와 같은 시각까지의 걸음 수로 다시 맞춘다. 화면 표시에 쓰고, 보폭을 맞춘 뒤에는 Health
 * Services 속도가 늦는 동안 코칭용 속도로 심박 표본에 넣는다(사용자 결정, 통합 설계 9.3 BATCH_DATA).
 *
 * 시각은 모두 부팅 기준 나노초(SystemClock.elapsedRealtimeNanos, 센서 이벤트 timestamp와 같은 기준)다. 일시정지 동안의
 * 걸음은 세지 않는다([pause] 뒤 첫 이벤트를 새 기준으로 삼는다). 값은 로그에 남기지 않는다.
 */
class StepEstimate {
    data class Value(val cadenceSpm: Int?, val distanceM: Double?, val paceSecPerKm: Int?)

    private data class Sample(val atNanos: Long, val steps: Long)

    /** 일시정지를 뺀 이번 러닝 걸음 수 표본(시각 순, 최근 것만). */
    private var samples = listOf<Sample>()
    private var counted = 0L
    private var segmentBase: Long? = null

    /** Health Services 누적 거리 기준점: 그 측정 시각의 걸음 수와 거리. */
    private var anchor: Pair<Long, Double>? = null
    private var firstAnchor: Pair<Long, Double>? = null
    var strideM = DEFAULT_STRIDE_M
        private set

    /** Health Services 거리로 보폭을 한 번이라도 맞췄는지. 맞추기 전 속도는 기본 보폭이라 코칭 입력에는 쓰지 않는다. */
    var calibrated = false
        private set

    /** 센 걸음 1번이 실제 몇 걸음인지(가속도로 한 팔 흔들기에 한 번만 세면 2). Health Services 케이던스로 맞춘다. */
    var cadenceFactor = 1.0
        private set

    @Synchronized
    fun onSteps(atNanos: Long, sensorTotal: Long) {
        val base = segmentBase
        if (base == null || sensorTotal < base) {
            // 재개 뒤(또는 센서 재시작 뒤) 첫 값: 여기서부터 센다.
            segmentBase = sensorTotal
            add(atNanos)
            return
        }
        counted += sensorTotal - base
        segmentBase = sensorTotal
        add(atNanos)
    }

    private fun add(atNanos: Long) {
        samples = (samples + Sample(atNanos, counted)).takeLast(MAX_SAMPLES)
    }

    /** 일시정지·인계: 다음 걸음 이벤트를 새 기준으로 삼는다. */
    @Synchronized
    fun pause() {
        segmentBase = null
    }

    @Synchronized
    fun reset() {
        samples = emptyList()
        counted = 0
        segmentBase = null
        anchor = null
        firstAnchor = null
        strideM = DEFAULT_STRIDE_M
        calibrated = false
        cadenceFactor = 1.0
    }

    /** Health Services 케이던스(측정 시각 기준). 그 시각 직전 15초에 센 걸음과 비교해 배율(1 또는 2)을 맞춘다. */
    @Synchronized
    fun onCadence(atNanos: Long, spm: Double) {
        val counted = stepsAt(atNanos) ?: return
        val before = stepsAt(atNanos - WINDOW_NANOS) ?: return
        if (samples.first().atNanos > atNanos - WINDOW_NANOS) return
        val ours = (counted - before) * 60.0 * 1_000_000_000.0 / WINDOW_NANOS
        if (ours < MIN_CALIBRATION_SPM || spm < MIN_CALIBRATION_SPM) return
        val ratio = spm / ours
        cadenceFactor = when {
            ratio in 0.6..1.5 -> 1.0
            ratio in 1.5..2.6 -> 2.0
            else -> cadenceFactor
        }
    }

    /** Health Services 누적 거리(측정 시각 기준). 그 시각의 걸음 수로 보폭을 다시 맞춘다. */
    @Synchronized
    fun onDistance(atNanos: Long, totalDistanceM: Double) {
        val steps = stepsAt(atNanos) ?: return
        val first = firstAnchor
        if (first == null) {
            firstAnchor = steps to totalDistanceM
        } else {
            val stepDelta = steps - first.first
            val metres = totalDistanceM - first.second
            if (stepDelta >= MIN_CALIBRATION_STEPS && metres > 0) {
                val stride = metres / stepDelta
                if (stride in MIN_STRIDE_M..MAX_STRIDE_M) {
                    strideM = stride
                    calibrated = true
                }
            }
        }
        val last = anchor
        if (last == null || steps >= last.first) anchor = steps to totalDistanceM
    }

    /**
     * [nowNanos](센서와 같은 부팅 기준 나노초) 시점에 보일 추정값. 걸음 표본이 없으면 null. 걸음은 셀 때만 표본이 생기므로,
     * 마지막 걸음이 [STILL_NANOS]보다 오래되면 서 있는 것으로 보고 케이던스 0·페이스 없음으로 둔다.
     */
    @Synchronized
    fun estimate(nowNanos: Long): Value? {
        val last = samples.lastOrNull() ?: return null
        val distance = distanceNow()
        if (nowNanos - last.atNanos > STILL_NANOS) return Value(0, distance, null)
        val inWindow = samples.filter { it.atNanos >= last.atNanos - WINDOW_NANOS }
        val first = inWindow.first()
        val spanNanos = last.atNanos - first.atNanos
        val cadence = if (inWindow.size >= 2 && spanNanos >= MIN_SPAN_NANOS) {
            (last.steps - first.steps) * 60.0 * 1_000_000_000.0 / spanNanos
        } else {
            null
        }
        val mps = cadence?.let { it / 60.0 * strideM }
        val pace = if (mps == null || mps < PaceRule.MIN_MOVING_MPS) null else (1000.0 / mps).toInt()
        return Value(cadence?.let { (it * cadenceFactor).toInt() }, distance, pace)
    }

    private fun distanceNow(): Double {
        val base = anchor ?: return counted * strideM
        return base.second + (counted - base.first).coerceAtLeast(0) * strideM
    }

    /** 그 시각의 걸음 수(이웃 표본 사이 선형 보간). 표본 범위 밖이면 가장 가까운 끝값, 표본이 없으면 null. */
    private fun stepsAt(atNanos: Long): Long? {
        if (samples.isEmpty()) return null
        if (atNanos <= samples.first().atNanos) return samples.first().steps
        if (atNanos >= samples.last().atNanos) return samples.last().steps
        val after = samples.indexOfFirst { it.atNanos >= atNanos }
        val a = samples[after - 1]
        val b = samples[after]
        val ratio = (atNanos - a.atNanos).toDouble() / (b.atNanos - a.atNanos)
        return a.steps + ((b.steps - a.steps) * ratio).toLong()
    }

    companion object {
        const val DEFAULT_STRIDE_M = 0.8
        const val MIN_STRIDE_M = 0.3
        /** 센 걸음 1번당 거리. 한 팔 흔들기에 한 번만 세면 실제 보폭의 두 배까지 된다. */
        const val MAX_STRIDE_M = 4.0
        const val MIN_CALIBRATION_SPM = 40.0
        const val MIN_CALIBRATION_STEPS = 20L
        const val WINDOW_NANOS = 15_000_000_000L
        const val MIN_SPAN_NANOS = 5_000_000_000L
        /** 마지막 걸음 뒤 이 시간이 지나면 서 있다고 본다(약 20 spm보다 느린 걸음은 걸음으로 보지 않는다). */
        const val STILL_NANOS = 3_000_000_000L

        /** 보정용 보간에 Health Services가 늦게(최대 몇 분) 준 거리의 시각까지 덮도록 넉넉히 둔다. */
        const val MAX_SAMPLES = 2_000
    }
}
