package com.runway.watchdemo.session

import com.runway.watchdemo.cue.CuePlayer
import com.runway.watchdemo.exercise.*
import java.util.UUID

data class RecordingSnapshot(
    val sessionId: String? = null, val state: SessionState? = null, val cue: CueSettings = CueSettings(),
    val latest: Map<MetricKind, MetricSample> = emptyMap(), val support: Map<String, String> = emptyMap(),
    val message: String = "실험 준비", val durationMs: Long = 0,
) { val busy get() = state in setOf(SessionState.STARTING, SessionState.RUNNING, SessionState.STOPPING) }

class SessionController(
    private val store: SessionStore, private val source: ExerciseSource, private val player: CuePlayer,
    private val elapsed: () -> Long, private val wall: () -> Long,
    private val device: DeviceInfo = DeviceInfo(), private val dispatch: (() -> Unit) -> Unit = { it() },
    private val onChange: (RecordingSnapshot) -> Unit = {},
) {
    private var current = RecordingSnapshot()
    private var startMs = 0L
    private var stopMs = 0L
    private var exerciseStopRequested = false
    private var stopFailure: String? = null
    private val pending = linkedMapOf<Pair<Long, Long>, MutableMap<MetricKind, MetricSample>>()
    fun snapshot(): RecordingSnapshot = current.copy(durationMs = if (current.busy) (elapsed() - startMs).coerceAtLeast(0) else current.durationMs)
    private fun publish() { onChange(snapshot()) }
    fun start(participantId: String, settings: CueSettings) {
        if (current.busy) return
        if (!participantId.matches(Regex("[A-Za-z0-9_-]{1,40}"))) {
            current = current.copy(message = "참가자 ID는 영문·숫자·_- 1~40자로 입력하세요"); publish(); return
        }
        startMs = elapsed(); pending.clear(); exerciseStopRequested = false; stopFailure = null
        val id = UUID.randomUUID().toString()
        current = RecordingSnapshot(id, SessionState.STARTING, settings.copy(bpm = MetricMath.clampBpm(settings.bpm)), message = "센서 연결 중")
        publish()
        try {
            store.create(SessionRecord(id, participantId, wall(), startMs, device = device))
            source.start({ samples -> dispatch { if (current.sessionId == id) accept(samples) } },
                { signal -> dispatch { if (current.sessionId == id) signal(signal) } })
        } catch (_: Exception) { fail("운동 시작 실패 · 권한과 기존 운동을 확인하세요") }
    }
    fun updateCue(settings: CueSettings) {
        current = current.copy(cue = settings.copy(bpm = MetricMath.clampBpm(settings.bpm)))
        if (current.state == SessionState.RUNNING) try { player.update(current.cue) } catch (_: Exception) { fail("박자 변경 실패") }
        publish()
    }
    private fun signal(signal: ExerciseSignal) {
        if (!current.busy) return
        when (signal) {
            is ExerciseSignal.Active -> if (current.state == SessionState.STARTING) {
                try {
                    val support = current.support + signal.support
                    store.setCapabilities(current.sessionId!!, support)
                    store.setState(current.sessionId!!, SessionState.RUNNING)
                    current = current.copy(state = SessionState.RUNNING, support = support, message = "측정 중")
                    val id = current.sessionId!!
                    player.start(current.cue, { event -> dispatch {
                        if (current.sessionId == id && current.state in setOf(SessionState.RUNNING, SessionState.STOPPING)) try { store.appendBpmEvent(id, event) }
                        catch (_: Exception) { fail("BPM 기록 저장 실패") }
                    } }, { reason -> dispatch { if (current.sessionId == id) fail(reason) } })
                } catch (_: Exception) { fail("운동 기록 준비 실패") }
            }
            is ExerciseSignal.Availability -> {
                current = current.copy(support = current.support + signal.values)
                try { store.setCapabilities(current.sessionId!!, current.support) } catch (_: Exception) { fail("센서 상태 저장 실패") }
            }
            is ExerciseSignal.Ended -> {
                val normal = current.state == SessionState.STOPPING && stopFailure == null
                finalize(if (normal) SessionState.COMPLETED else SessionState.INTERRUPTED,
                    if (normal) "user" else stopFailure ?: "health_services_${signal.reason}")
            }
            is ExerciseSignal.Error -> fail(signal.message)
        }
        publish()
    }
    private fun accept(values: List<MetricSample>) {
        if (!current.busy) return
        val valid = values.filter { it.endElapsedMs >= startMs && it.endElapsedMs <= elapsed() + 1000 && it.startElapsedMs <= it.endElapsedMs }
        val derived = mutableListOf<MetricSample>()
        valid.filter { it.kind in setOf(MetricKind.DISTANCE, MetricKind.STEPS) }.forEach { s ->
            val pair = pending.getOrPut(s.startElapsedMs to s.endElapsedMs) { mutableMapOf() }; pair[s.kind] = s
            val d = pair[MetricKind.DISTANCE]; val steps = pair[MetricKind.STEPS]
            if (d != null && steps != null && MeasurementSupport.status(current.support, MetricKind.STEP_LENGTH) == SupportStatus.UNSUPPORTED) {
                MetricMath.stepLength(d, steps)?.let { length -> derived.add(MetricSample(MetricKind.STEP_LENGTH,
                    d.startElapsedMs, d.endElapsedMs, length, "m/step", "estimated_distance_div_steps:${d.source}",
                    "estimated;distance=${d.quality};steps=${steps.quality}")) }
            }
            while (pending.size > 512) pending.remove(pending.keys.first())
        }
        try {
            store.appendSamples(current.sessionId!!, valid + derived)
            val latest = current.latest.toMutableMap()
            for (s in valid + derived) if ((latest[s.kind]?.endElapsedMs ?: Long.MIN_VALUE) <= s.endElapsedMs) latest[s.kind] = s
            current = current.copy(latest = latest)
        } catch (_: Exception) { fail("저장 실패 · 측정을 중단했습니다") }
        publish()
    }
    fun stop() {
        if (current.state !in setOf(SessionState.STARTING, SessionState.RUNNING)) return
        current = current.copy(state = SessionState.STOPPING, message = "마지막 기록 저장 중"); stopMs = elapsed(); publish()
        // Persistence failure must never skip device cleanup.
        runCatching { store.setState(current.sessionId!!, SessionState.STOPPING) }
            .onFailure { stopFailure = "종료 상태 저장 실패 · 기록 완성 여부를 확인하세요" }
        runCatching { player.stop() }.onFailure { stopFailure = stopFailure ?: "박자 종료 실패" }
        runCatching { source.stop(); exerciseStopRequested = true }
            .onFailure { stopFailure = stopFailure ?: "운동 종료 요청 실패" }
        stopFailure?.let { finalize(SessionState.INTERRUPTED, it) }
    }
    fun tick() {
        if (current.state == SessionState.STOPPING && elapsed() - stopMs > 20_000) finalize(SessionState.INTERRUPTED, "end_callback_timeout")
        if (current.state == SessionState.STARTING && elapsed() - startMs > 45_000) fail("센서 시작 시간 초과")
        publish()
    }
    private fun fail(reason: String) { finalize(SessionState.FAILED, reason) }
    private fun finalize(state: SessionState, reason: String) {
        if (!current.busy) return
        current = current.copy(state = state, durationMs = (elapsed() - startMs).coerceAtLeast(0), message = if (state == SessionState.COMPLETED) "저장 완료" else reason)
        runCatching { player.stop() }
        if (!exerciseStopRequested && state != SessionState.COMPLETED) {
            runCatching { source.stop(); exerciseStopRequested = true }
                .onFailure { current = current.copy(message = "운동 종료 실패 · 워치의 진행 중 운동을 확인하세요") }
        }
        runCatching { source.close() }
        try { store.finish(current.sessionId!!, state, elapsed(), reason) }
        catch (_: Exception) { current = current.copy(state = SessionState.FAILED, message = "저장 공간 오류 · 기록 완성 여부를 확인하세요") }
        publish()
    }
    fun interrupt() { if (current.busy) finalize(SessionState.INTERRUPTED, "service_destroyed") }
}
