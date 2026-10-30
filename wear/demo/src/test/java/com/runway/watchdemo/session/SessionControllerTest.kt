package com.runway.watchdemo.session

import com.runway.watchdemo.cue.CuePlayer
import com.runway.watchdemo.exercise.*
import org.junit.Assert.*
import org.junit.Test

class MemoryStore : SessionStore {
    val records = mutableMapOf<String, SessionRecord>()
    var failWrites = false
    var failStateWrites = false
    override fun create(record: SessionRecord) { records[record.id] = record }
    override fun load(id: String) = records.getValue(id)
    override fun list() = records.values.toList()
    override fun appendSamples(id: String, samples: List<MetricSample>) {
        check(!failWrites); records[id] = load(id).copy(samples = load(id).samples + samples)
    }
    override fun appendBpmEvent(id: String, event: BpmEvent) { records[id] = load(id).copy(events = load(id).events + event) }
    override fun setState(id: String, state: SessionState) { check(!failStateWrites); records[id] = load(id).copy(state = state) }
    override fun setCapabilities(id: String, values: Map<String, String>) { records[id] = load(id).copy(capabilities = values) }
    override fun finish(id: String, state: SessionState, endedElapsedMs: Long, endReason: String) {
        records[id] = load(id).copy(state = state, endedElapsedMs = endedElapsedMs, endReason = endReason)
    }
    override fun setUploadState(id: String, state: UploadState) { records[id] = load(id).copy(uploadState = state) }
    @Synchronized override fun claimUpload(id: String): SessionRecord? {
        val record = load(id)
        if (!record.isFinal || record.uploadState !in setOf(UploadState.PENDING, UploadState.FAILED)) return null
        setUploadState(id, UploadState.UPLOADING); return load(id)
    }
    override fun recoverInterrupted() {}
}
private class Source : ExerciseSource {
    var started = 0; var stopped = 0; var fail = false
    var stopFailures = 0
    var activateImmediately = true
    lateinit var samples: (List<MetricSample>) -> Unit
    lateinit var signal: (ExerciseSignal) -> Unit
    override fun start(onSamples: (List<MetricSample>) -> Unit, onState: (ExerciseSignal) -> Unit) {
        if (fail) error("다른 앱이 운동을 기록 중입니다")
        started++; samples = onSamples; signal = onState
        if (activateImmediately) onState(ExerciseSignal.Active(mapOf("HEART_RATE" to "supported", "STEP_LENGTH.support" to "unsupported")))
    }
    override fun stop() { stopped++; if (stopFailures-- > 0) error("temporary stop failure") }
    override fun close() {}
}
private class Cue : CuePlayer {
    var started = 0; var stopped = 0
    lateinit var applied: (BpmEvent) -> Unit
    override fun start(settings: CueSettings, onApplied: (BpmEvent) -> Unit, onError: (String) -> Unit) {
        applied = onApplied
        started++; onApplied(BpmEvent(1000, 1000, settings.bpm, settings.soundEnabled, settings.vibrationEnabled))
    }
    override fun update(settings: CueSettings) {}
    override fun stop() { stopped++ }
    override fun close() {}
}
class SessionControllerTest {
    @Test fun unknownStrideSupportCannotCreateEstimatedStrideBeforeActiveSignal() {
        val source = Source().apply { activateImmediately = false }; val store = MemoryStore()
        val controller = SessionController(store, source, Cue(), { 3000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        source.samples(listOf(MetricSample(MetricKind.DISTANCE, 3000, 3001, 2.4, "m"),
            MetricSample(MetricKind.STEPS, 3000, 3001, 2.0, "steps"),
            MetricSample(MetricKind.STEP_LENGTH, 3001, 3001, 1.1, "m/step")))
        assertEquals(1, store.records.values.single().samples.count { it.kind == MetricKind.STEP_LENGTH })
        assertEquals(1.1, controller.snapshot().latest[MetricKind.STEP_LENGTH]!!.value!!, 0.001)
    }
    @Test fun stateWriteFailureCannotSkipStoppingExercise() {
        val source = Source(); val cue = Cue(); val store = MemoryStore()
        val controller = SessionController(store, source, cue, { 2000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        store.failStateWrites = true
        controller.stop()
        assertTrue("DB failure must not leave Health Services running", source.stopped > 0)
        assertTrue(cue.stopped > 0)
        assertEquals(SessionState.INTERRUPTED, controller.snapshot().state)
    }
    @Test fun failedStopIsRetriedDuringFinalCleanup() {
        val source = Source(); val cue = Cue(); val store = MemoryStore()
        val controller = SessionController(store, source, cue, { 2000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        source.stopFailures = 1
        controller.stop()
        assertEquals(2, source.stopped)
        assertEquals(SessionState.INTERRUPTED, controller.snapshot().state)
    }
    @Test fun directStrideSupportDoesNotGenerateAnotherEstimatedStride() {
        val source = Source(); val store = MemoryStore()
        val controller = SessionController(store, source, Cue(), { 3000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        source.signal(ExerciseSignal.Availability(mapOf("STEP_LENGTH.support" to "supported", "STEP_LENGTH.availability" to "AVAILABLE")))
        source.samples(listOf(MetricSample(MetricKind.DISTANCE, 3000, 3000, 2.0, "m"),
            MetricSample(MetricKind.STEPS, 3000, 3000, 2.0, "steps")))
        // Use an interval with positive duration, wholly inside the active session.
        source.samples(listOf(MetricSample(MetricKind.DISTANCE, 3000, 3001, 2.0, "m"),
            MetricSample(MetricKind.STEPS, 3000, 3001, 2.0, "steps")))
        assertFalse(store.records.values.single().samples.any { it.kind == MetricKind.STEP_LENGTH })
    }
    @Test fun derivedStridePreservesSourceQualityAlongsideEstimatedMarker() {
        val source = Source(); val store = MemoryStore()
        val controller = SessionController(store, source, Cue(), { 3000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        source.samples(listOf(MetricSample(MetricKind.DISTANCE, 3000, 3001, 2.4, "m", quality = "location_accuracy"),
            MetricSample(MetricKind.STEPS, 3000, 3001, 2.0, "steps", quality = "good")))
        val derived = store.records.values.single().samples.single { it.kind == MetricKind.STEP_LENGTH }
        assertTrue(derived.quality.startsWith("estimated"))
        assertTrue(derived.quality.contains("distance=location_accuracy"))
        assertTrue(derived.quality.contains("steps=good"))
    }
    @Test fun appliedBpmQueuedBehindStopIsPreservedAndOldCallbacksCannotChangeNewSession() {
        val queue = ArrayDeque<() -> Unit>()
        fun drain() { while (queue.isNotEmpty()) queue.removeFirst()() }
        val source = Source(); val cue = Cue(); val store = MemoryStore()
        var now = 2000L
        val controller = SessionController(store, source, cue, { now }, { 1700000000000 }, dispatch = { queue.addLast(it) })
        controller.start("runner01", CueSettings()); drain()
        val oldSamples = source.samples; val oldSignal = source.signal; val oldApplied = cue.applied
        cue.applied(BpmEvent(2010, 2020, 168))
        now = 2030; controller.stop(); drain()
        source.signal(ExerciseSignal.Ended("user")); drain()
        assertEquals(168, store.records.values.single().events.last().targetBpm)
        now = 3000; controller.start("runner01", CueSettings()); drain()
        val newId = controller.snapshot().sessionId!!
        oldSamples(listOf(MetricSample(MetricKind.HEART_RATE, 3010, 3010, 150.0, "bpm")))
        oldSignal(ExerciseSignal.Ended("old")); oldApplied(BpmEvent(3001, 3002, 180)); drain()
        assertEquals(SessionState.RUNNING, controller.snapshot().state)
        assertTrue(store.load(newId).samples.isEmpty())
        assertFalse(store.load(newId).events.any { it.targetBpm == 180 })
    }
    @Test fun duplicateStartAndStoppingCannotCreateAnotherSession() {
        val source = Source(); val cue = Cue(); val store = MemoryStore()
        val controller = SessionController(store, source, cue, { 2000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        controller.start("runner01", CueSettings())
        assertEquals(1, store.records.size)
        assertEquals(1, source.started)
        controller.stop()
        assertEquals(SessionState.STOPPING, controller.snapshot().state)
        controller.start("runner01", CueSettings())
        assertEquals(1, store.records.size)
        source.samples(listOf(MetricSample(MetricKind.HEART_RATE, 2000, 2000, 150.0, "bpm")))
        source.signal(ExerciseSignal.Ended("user"))
        val saved = store.records.values.single()
        assertEquals(SessionState.COMPLETED, saved.state)
        assertEquals(1, saved.samples.size)
        assertEquals(1, cue.started)
    }
    @Test fun failedStartDoesNotLeaveCueOrSessionRunning() {
        val source = Source().apply { fail = true }; val cue = Cue(); val store = MemoryStore()
        val controller = SessionController(store, source, cue, { 2000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        assertEquals(SessionState.FAILED, controller.snapshot().state)
        assertEquals(0, cue.started)
        assertTrue(store.records.values.single().isFinal)
    }
    @Test fun diskFailureStopsMeasurementInsteadOfClaimingSuccess() {
        val source = Source(); val cue = Cue(); val store = MemoryStore()
        val controller = SessionController(store, source, cue, { 2000 }, { 1700000000000 })
        controller.start("runner01", CueSettings())
        store.failWrites = true
        source.samples(listOf(MetricSample(MetricKind.SPEED, 2000, 2000, 3.0, "m/s")))
        assertEquals(SessionState.FAILED, controller.snapshot().state)
        assertTrue(source.stopped > 0)
        assertTrue(cue.stopped > 0)
    }
}
