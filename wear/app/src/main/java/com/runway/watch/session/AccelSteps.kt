package com.runway.watch.session

import kotlin.math.sqrt

/**
 * 가속도로 걸음을 센다(S15P31E105-549). 이 워치는 화면이 꺼지면 걸음 수 센서와 Health Services 거리·케이던스를 센서 허브에
 * 모아 두지만, 가속도 센서는 CPU가 깨어 있는 동안 계속 온다(실기기 확인: 화면 꺼짐에서 약 50 Hz). 화면 표시용 추정에만 쓴다.
 *
 * 크기(|a|)를 짧게 평활한 값에서 느린 평균을 빼, 그 값이 [THRESHOLD]를 넘어 올라갈 때를 한 걸음으로 본다. 다시 세려면
 * 절반 아래로 내려와야 하고(흔들림 중복 방지), 두 걸음 사이는 [MIN_GAP_NANOS] 이상이어야 한다. 손목 위치에 따라 한 팔
 * 흔들기에 한 번만 셀 수 있으므로, 케이던스 배율은 Health Services 케이던스와 비교해 [StepEstimate]가 맞춘다.
 */
class AccelSteps {
    var count = 0L
        private set
    private var fast: Double? = null
    private var slow: Double? = null
    private var armed = true
    private var lastStepNanos: Long? = null

    /** 한 표본을 넣고, 이 표본에서 걸음을 셌으면 true. */
    fun offer(atNanos: Long, x: Float, y: Float, z: Float): Boolean {
        val magnitude = sqrt((x * x + y * y + z * z).toDouble())
        val f = fast?.let { it + FAST_ALPHA * (magnitude - it) } ?: magnitude
        val s = slow?.let { it + SLOW_ALPHA * (magnitude - it) } ?: magnitude
        fast = f
        slow = s
        val signal = f - s
        if (signal < THRESHOLD / 2) {
            armed = true
            return false
        }
        val last = lastStepNanos
        if (!armed || signal < THRESHOLD || (last != null && atNanos - last < MIN_GAP_NANOS)) return false
        armed = false
        lastStepNanos = atNanos
        count++
        return true
    }

    companion object {
        const val FAST_ALPHA = 0.3
        const val SLOW_ALPHA = 0.02
        /** m/s². 걷기·달리기 손목 가속도 변화보다 작고 책상 위 잡음보다 크다. */
        const val THRESHOLD = 1.2
        /** 240 spm보다 빠른 걸음은 세지 않는다. */
        const val MIN_GAP_NANOS = 250_000_000L
    }
}
