package com.runway.watch.session

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log

/**
 * 러닝 중에만 가속도 센서를 직접 읽어 걸음을 센다(S15P31E105-549). 이 워치는 화면이 꺼지면 Health Services의 거리·속도·
 * 케이던스와 걸음 수 센서 값을 센서 허브에 모아 두지만 가속도는 계속 온다(실기기 확인). 화면 표시와 코칭용 속도 추정
 * ([StepEstimate])은 가속도 걸음([AccelSteps])으로 한다. 러닝 중에는 RunForegroundService가 CPU를 깨워 둔다.
 * 센서가 없으면 아무것도 하지 않는다. 값은 로그에 남기지 않는다.
 */
class AccelStepSource(
    context: Context,
    private val onSteps: (atNanos: Long, total: Long) -> Unit,
) {
    private val manager = context.getSystemService(SensorManager::class.java)
    private val accel: Sensor? = manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val steps = AccelSteps()
    private var listening = false

    private val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            if (steps.offer(event.timestamp, event.values[0], event.values[1], event.values[2])) {
                onSteps(event.timestamp, steps.count)
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    @Synchronized
    fun start() {
        if (listening || manager == null || accel == null) return
        listening = try {
            manager.registerListener(listener, accel, SensorManager.SENSOR_DELAY_GAME, 0)
        } catch (e: Exception) {
            Log.w("RunSession", "accelerometer refused: ${e.javaClass.simpleName}")
            false
        }
    }

    @Synchronized
    fun stop() {
        if (!listening) return
        try { manager?.unregisterListener(listener) } catch (_: Exception) { }
        listening = false
    }
}
