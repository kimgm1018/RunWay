package com.runway.watch.session

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.runway.watch.batch.BatchUploader
import com.runway.watch.batch.FileBatchStore
import com.runway.watch.cue.HapticQuiet
import com.runway.watch.cue.WatchGroupPaceAlert
import com.runway.watch.cue.WatchRhythmPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import kotlin.math.roundToInt

/**
 * One controller per process, shared by the screens and the Data Layer listener so a command that arrives while the
 * screen is closed still runs once and is remembered (S15P31E105-256).
 */
class RunSessions private constructor(context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store = PrefsSessionStore(context)
    private val sender = MessageClientSessionSender(context)

    /** The latest measured values for the watch screen (S15P31E105-420). */
    private val live = LiveReadings()

    /**
     * S15P31E105-549: 화면이 꺼진 동안 Health Services가 거리·케이던스를 모아 주므로, 가속도 걸음으로 추정값을 만든다. 화면
     * 표시에 쓰고, 보폭을 맞춘 뒤에는 Health Services 속도가 늦는 동안 코칭용 속도로 심박 표본에 넣는다([withLiveSpeed]).
     */
    private val stepEstimate = StepEstimate()
    private val stepTick = MutableStateFlow(0L)
    private val steps = AccelStepSource(context) { at, total ->
        stepEstimate.onSteps(at, total)
        stepTick.value = at
    }

    /** 걸음 추정 페이스를 Health Services 페이스에 맞추는 배율(LIVE 루프가 손목을 든 동안 갱신한다). */
    @Volatile private var paceScale = 1.0

    /**
     * S15P31E105-549: 손목을 내려 화면이 꺼지면 Health Services가 속도를 1분쯤 모아서 준다. 서버 코칭은 12초 이내 속도가
     * 있어야 판단하므로(INPUT_STALE), 그동안 5초마다 오는 심박 표본에 가속도 걸음 추정 속도를 함께 넣는다. Health Services
     * 속도가 오면 그 값만 쓴다.
     */
    private fun withLiveSpeed(readings: List<com.runway.watch.batch.Reading>): List<com.runway.watch.batch.Reading> {
        // 워치가 기록 중인 RUNNING에서만 넣는다(일시정지·종료 직후 늦게 온 심박, 폰 인계 뒤에는 넣지 않는다).
        val session = controller.state.value
        if (session.confirmed != com.runway.watch.run.RunState.RUNNING || session.phoneRecording) return readings
        val hsSpeed = live.latest.value.pace
        val stale = hsSpeed == null || liveNowMs() - hsSpeed.receivedMs > HS_FRESH_MS
        if (!stale) return readings
        val speed = liveSpeedMps() ?: return readings
        return readings.map { r ->
            if (r.heartRateBpm != null && r.speedMps == null) {
                r.copy(speedMps = speed)
            } else {
                r
            }
        }
    }

    /** 지금 워치가 아는 속도(m/s, 걸음 추정). 서 있으면 0, 보폭을 아직 맞추지 못했거나 알 수 없으면 null. */
    private fun liveSpeedMps(): Double? {
        if (!stepEstimate.calibrated) return null
        val estimate = stepEstimate.estimate(SystemClock.elapsedRealtimeNanos()) ?: return null
        return estimate.paceSecPerKm?.let { 1000.0 / (it * paceScale) } ?: 0.0
    }


    /** [LiveReadings]가 받은 시각을 찍는 시계(System.nanoTime 기준, 워치 화면 표시와 같음). */
    private fun liveNowMs(): Long = System.nanoTime() / 1_000_000


    /** The group pace alert holds the vibrator from the rhythm beat while it plays (S15P31E105-604). */
    private val haptics = HapticQuiet(SystemClock::elapsedRealtime)

    /** Measurement batches of the run (S15P31E105-311); its own loop closes and resends them. */
    val uploader = BatchUploader(
        store = FileBatchStore(context),
        sender = sender,
        nextMessageId = store::nextMessageId,
        clock = SystemClock::elapsedRealtime,
    )
    val controller = WatchSessionController(
        store = store,
        gateway = HealthServicesExerciseGateway(context, onReadings = { readings ->
            // 같은 측정값을 화면에도 보인다(S15P31E105-420). 업로드 본문은 바꾸지 않는다.
            live.offer(readings)
            // 걸음 추정의 보폭을 Health Services 누적 거리로 맞춘다(같은 측정 시각의 걸음 수 기준).
            val boot = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
            readings.forEach { r ->
                val at = Duration.between(boot, r.measuredAt).toNanos()
                r.totalDistanceM?.let { stepEstimate.onDistance(at, it) }
                r.cadenceSpm?.let { stepEstimate.onCadence(at, it) }
            }
            scope.launch { uploader.offer(withLiveSpeed(readings)) }
        }),
        sender = sender,
        uploads = uploader,
        keepAlive = ServiceKeepAlive(context),
        // S15P31E105-257: the approved rhythm BPM plays as a click and vibration while running (D-4).
        player = WatchRhythmPlayer(context, haptics),
        log = { Log.i(TAG, it) },
        // S15P31E105-604: one buzz when the phone relays a shared pace change.
        paceAlert = WatchGroupPaceAlert(context, haptics),
        // S15P31E105-864: 권한 없는 시작을 준비·시작 단계에서 거절하고, 원격 시작 GPS 가능 여부를 폰에 알린다.
        capability = DeviceRunCapability(context),
    )
    val control = SessionRunControl(controller, scope, uploader.state, live)

    /**
     * Controller messages run one at a time in arrival order, off the listener thread: an END waits up to 90 s for the
     * batch save ACKs, which arrive on that same listener thread (S15P31E105-311).
     */
    private val inbox = Channel<SessionEnvelope>(Channel.UNLIMITED)

    init {
        scope.launch { uploader.run() }
        // S15P31E105-549: 걸음 센서는 워치가 기록하는 RUNNING 동안만 듣는다. 일시정지 동안의 걸음은 세지 않고, 세션이 바뀌면
        // 추정을 비운다.
        scope.launch {
            var forSession: String? = null
            controller.state.collect { session ->
                if (session.sessionId != forSession) {
                    forSession = session.sessionId
                    stepEstimate.reset()
                }
                if (session.sessionId != null && session.confirmed == com.runway.watch.run.RunState.RUNNING &&
                    !session.phoneRecording
                ) {
                    steps.start()
                } else {
                    steps.stop()
                    stepEstimate.pause()
                }
            }
        }
        // S15P31E105-549 LIVE_METRICS: while the watch records a running session, the values its screen shows go to the
        // phone as soon as they change (at most one message per LIVE_GAP_MS). While Health Services holds back the
        // distance and cadence (screen off), the step estimate fills them. Display only; the batches stay the record.
        // Nothing is stored and a lost message is simply replaced by the next one.
        scope.launch {
            var seq = 0L
            var sentAt = 0L
            // 걸음 추정 페이스를 Health Services 페이스에 맞추는 배율. 손목을 들어 두 값이 함께 있을 때마다 다시 맞춰, 손목을
            // 내린 동안에도 워치 화면에 마지막으로 보인 페이스와 크게 어긋나지 않게 한다. 세션이 바뀌면 1로 돌린다.
            var scaleFor: String? = null
            // 세션별로 보낸 가장 큰 거리와 마지막으로 보낸 값. 거리는 줄지 않게 하고, 값이 같으면 다시 보내지 않는다(걸음마다
            // 다시 계산해도 화면 값이 그대로면 Bluetooth로 보내지 않는다).
            var sentDistance: Double? = null
            var sentValues: List<Any?>? = null
            combine(live.latest, stepTick) { _, _ -> Unit }.collect {
                try {
                    val wait = LIVE_GAP_MS - (SystemClock.elapsedRealtime() - sentAt)
                    if (wait > 0) delay(wait)
                    val session = controller.state.value
                    val sessionId = session.sessionId
                    val latest = live.latest.value
                    if (sessionId != null && session.confirmed == com.runway.watch.run.RunState.RUNNING &&
                        !session.phoneRecording
                    ) {
                        val now = SystemClock.elapsedRealtime()
                        // LiveReadings의 받은 시각과 같은 시계로 비교한다(elapsedRealtime과 기준이 달라 늘 오래된 값으로 보였다).
                        val liveNow = liveNowMs()
                        val fresh = { v: LiveReadings.Value<*>? -> v != null && liveNow - v.receivedMs <= HS_FRESH_MS }
                        val located = fresh(latest.pace ?: latest.distanceMeters)
                        val estimate = stepEstimate.estimate(SystemClock.elapsedRealtimeNanos())
                        // Health Services 값이 늦으면(화면 꺼짐) 걸음 추정을 보인다.
                        val useSteps = estimate != null && !located
                        if (scaleFor != sessionId) {
                            scaleFor = sessionId
                            paceScale = 1.0
                            sentDistance = null
                            sentValues = null
                        }
                        val hsPace = latest.pace?.value
                        val estPace = estimate?.paceSecPerKm
                        if (located && hsPace != null && estPace != null) {
                            val ratio = (hsPace.toDouble() / estPace).coerceIn(0.5, 2.0)
                            paceScale = paceScale * 0.7 + ratio * 0.3
                        }
                        val hsDistance = latest.distanceMeters?.value
                        val measured = when {
                            !useSteps -> hsDistance
                            hsDistance == null -> estimate?.distanceM
                            else -> maxOf(hsDistance, estimate?.distanceM ?: hsDistance)
                        }
                        val distance = listOfNotNull(measured, sentDistance).maxOrNull()
                        sentDistance = distance
                        val pace = if (useSteps) estPace?.let { (it * paceScale).toInt() } else hsPace
                        val cadence =
                            if (fresh(latest.cadence) || estimate == null) latest.cadence?.value else estimate.cadenceSpm
                        val values = listOf(pace, latest.heartRate?.value, cadence, distance?.roundToInt(), latest.activeSec?.value)
                        // 표시값은 "지금 워치 화면에 보이는 값"이다. 보낸 시각으로 찍어야 걸음 추정(지금)에서 Health Services 값
                        // (1~2초 전 측정)으로 바뀔 때 폰이 더 오래된 값으로 보고 버리지 않는다.
                        val measuredAt = if (useSteps || latest.measuredAt != null) Instant.now() else null
                        if (measuredAt != null && values != sentValues) {
                            sentValues = values
                            sentAt = now
                            sender.send(
                                SessionPaths.LIVE_METRICS,
                                SessionMessages.liveMetrics(
                                    "live:${++seq}", sessionId, measuredAt,
                                    pace,
                                    latest.heartRate?.value,
                                    cadence,
                                    distance,
                                    latest.activeSec?.value,
                                ),
                            )
                        }
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // 표시용이라 다음 변경 때 새 값으로 다시 보낸다.
                }
            }
        }
        scope.launch {
            while (true) {
                delay(TICK_MS)
                try { controller.tick() } catch (_: Exception) { /* next tick tries again */ }
            }
        }
        scope.launch {
            for (message in inbox) {
                try { controller.onMessage(message) } catch (_: Exception) { /* storage error: the phone resends */ }
            }
        }
    }

    /** Handles a message from the listener service; malformed or foreign messages are ignored. Returns at once. */
    suspend fun receive(bytes: ByteArray) {
        val message = decodeSessionMessage(bytes) ?: return
        when {
            message.type == "BATCH_RECEIVED" && message.payload.optString("status") == "RECEIVED" -> message.batchId()?.let { uploader.onReceived(it) }
            message.type == "BATCH_COMMITTED" && message.payload.optString("status") == "COMMITTED" -> message.batchId()?.let { id ->
                uploader.onCommitted(id, message.payload.optInt("acceptedCount", -1))
            }
            message.type.startsWith("BATCH_") -> Unit
            message.type == "ERROR" && message.payload.optString("failedType") == "BATCH_DATA" ->
                message.replyTo?.let { uploader.onError(it, message.payload.optBoolean("retryable", false)) }
            else -> inbox.send(message)
        }
    }

    companion object {
        private const val TICK_MS = 5_000L
        private const val LIVE_GAP_MS = 250L
        /** Health Services 거리·속도·케이던스가 이 시간 안에 왔으면 그 값을 보이고, 아니면 걸음 추정을 보인다. */
        private const val HS_FRESH_MS = 10_000L
        private const val TAG = "RunSession"

        @Volatile private var instance: RunSessions? = null

        fun get(context: Context): RunSessions =
            instance ?: synchronized(this) { instance ?: RunSessions(context.applicationContext).also { instance = it } }
    }
}
