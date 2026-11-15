package com.runway.watch.session

import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.GoalEvaluation
import com.runway.watch.run.HeartRate
import com.runway.watch.run.RunSummary
import com.runway.watch.run.BpmChange
import com.runway.watch.run.BpmChangeStatus
import com.runway.watch.run.Coaching
import com.runway.watch.run.ControlProblem
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.CoachingGuide
import com.runway.watch.run.RhythmBpm
import com.runway.watch.run.RunIntent
import com.runway.watch.run.SaveStatus
import com.runway.watch.run.RunState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The watch screens read the controller through the existing RunControl (S15P31E105-256 [D] part 2). */
class SessionRunControlTest {

    private class Recorder : SessionSender {
        val types = mutableListOf<String>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            val json = JSONObject(String(bytes, Charsets.UTF_8))
            types += json.getString("type") + (json.getJSONObject("payload").optString("action").let { if (it.isEmpty()) "" else ":$it" })
            return true
        }
    }

    private object NoopGateway : ExerciseGateway {
        override suspend fun start() = Unit
        override suspend fun pause() = Unit
        override suspend fun resume() = Unit
        override suspend fun end() = Unit
        override suspend fun reattach() = true
    }

    private val sender = Recorder()
    private val controller = WatchSessionController(InMemorySessionStore(), NoopGateway, sender, sleep = {}, jitter = { 0 })
    private val control = SessionRunControl(controller, CoroutineScope(Dispatchers.Unconfined))

    private fun message(type: String, payload: String) = decodeSessionMessage(
        """{"protocolVersion":1,"type":"$type","messageId":"p:1","replyTo":null,"senderDeviceId":null,"sessionId":201,"payload":$payload}""".toByteArray(),
    )!!

    @Test
    fun `before the phone prepares a session the watch shows nothing to start`() {
        assertNull(control.snapshot.value.state)
        assertFalse(control.snapshot.value.pendingCommand)
    }

    @Test
    fun `the snapshot follows the confirmed state and shows a request in flight`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        assertEquals(RunState.READY, control.snapshot.value.state)

        control.send(RunIntent.START)
        assertTrue(control.snapshot.value.pendingCommand)
        assertEquals(RunIntent.START, control.snapshot.value.pendingIntent)
        assertEquals("시작 확인 중", control.snapshot.value.notice)
        assertEquals(RunState.READY, control.snapshot.value.state)

        controller.onMessage(message("START_AUTHORIZED", """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""))
        controller.onMessage(message("COMMAND_RECEIVED", """{"commandId":501,"persisted":true,"stateVersion":2}"""))
        assertEquals(RunState.RUNNING, control.snapshot.value.state)
        assertFalse(control.snapshot.value.pendingCommand)
        assertNull(control.snapshot.value.notice)
    }

    @Test
    fun `watch buttons become requests to the phone`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        control.send(RunIntent.CANCEL)

        assertEquals(listOf("SESSION_PREPARED", "STATE_QUERY", "COMMAND_REQUEST:CANCEL"), sender.types)
    }

    @Test
    fun `a cancel in flight is reported as a cancel, not a start`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        control.send(RunIntent.CANCEL)

        assertTrue(control.snapshot.value.pendingCommand)
        assertEquals(RunIntent.CANCEL, control.snapshot.value.pendingIntent)
        assertEquals("취소 확인 중", control.snapshot.value.notice)
        assertEquals(RunState.READY, control.snapshot.value.state)

        controller.onMessage(message("ERROR", """{"code":"COMMAND_PENDING","retryable":false,"failedType":"COMMAND_REQUEST"}"""))
        assertFalse(control.snapshot.value.pendingCommand)
        assertNull(control.snapshot.value.pendingIntent)
        assertEquals("휴대폰에서 처리하지 못했어요", control.snapshot.value.notice)
        // The screens also get which request the phone refused (S15P31E105-613).
        assertEquals(ControlProblem(ControlProblemKind.REFUSED, RunIntent.CANCEL), control.snapshot.value.problem)
        assertEquals(
            ControlProblem(ControlProblemKind.UNCONFIRMED, RunIntent.PAUSE),
            SessionRunControl.problem(WatchSessionState(problem = WatchProblem.Unconfirmed("PAUSE"))),
        )
        assertEquals(
            ControlProblem(ControlProblemKind.REJECTED, RunIntent.START),
            SessionRunControl.problem(WatchSessionState(problem = WatchProblem.Rejected("START", null))),
        )
        assertNull(SessionRunControl.problem(WatchSessionState(problem = WatchProblem.PhoneUnreachable)))
        assertEquals(RunState.READY, control.snapshot.value.state)

        control.send(RunIntent.CANCEL)
        assertEquals(RunIntent.CANCEL, control.snapshot.value.pendingIntent)
        controller.onMessage(message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"WATCH","state":"CANCELLED","stateVersion":2,"currentBpm":null}"""))
        assertEquals(RunState.CANCELLED, control.snapshot.value.state)
        assertFalse(control.snapshot.value.pendingCommand)
        assertNull(control.snapshot.value.pendingIntent)
    }

    @Test
    fun `problems become notices the runner can read`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        control.send(RunIntent.CANCEL)
        controller.onMessage(message("ERROR", """{"code":"COMMAND_PENDING","retryable":false,"failedType":"COMMAND_REQUEST"}"""))

        assertEquals("휴대폰에서 처리하지 못했어요", control.snapshot.value.notice)
        assertEquals(
            "시작 여부를 확인할 수 없어요",
            SessionRunControl.notice(WatchSessionState(pending = null, problem = WatchProblem.Unconfirmed("START"))),
        )
        assertEquals(
            "워치가 일시정지하지 못했어요",
            SessionRunControl.notice(WatchSessionState(problem = WatchProblem.Rejected("PAUSE", "INVALID_STATE"))),
        )
        assertEquals(
            "휴대폰 연결이 없어요",
            SessionRunControl.notice(WatchSessionState(problem = WatchProblem.PhoneUnreachable)),
        )
    }

    @Test
    fun aServerSavedEndShowsSavedWithTheAnalysisPending() {
        val snapshot = SessionRunControl.toSnapshot(WatchSessionState(sessionId = "201", confirmed = RunState.COMPLETED, stateVersion = 4))
        assertEquals(SaveStatus.SAVED, snapshot.result?.save)
        assertEquals(AnalysisStatus.PENDING, snapshot.result?.analysis)
    }

    @Test
    fun anUnconfirmedEndShowsTheSaveAsUnconfirmed() {
        val snapshot = SessionRunControl.toSnapshot(
            WatchSessionState(sessionId = "201", confirmed = RunState.PAUSED, stateVersion = 3, problem = WatchProblem.Unconfirmed("END")),
        )
        assertEquals(SaveStatus.UNCONFIRMED, snapshot.result?.save)
    }

    @Test
    fun aRunningSessionHasNoResult() {
        val snapshot = SessionRunControl.toSnapshot(WatchSessionState(sessionId = "201", confirmed = RunState.RUNNING, stateVersion = 2))
        assertNull(snapshot.result)
    }

    @Test
    fun theSnapshotCarriesBpmCoachingAndTheServerLink() {
        val snapshot = SessionRunControl.toSnapshot(WatchSessionState(
            sessionId = "201", confirmed = RunState.RUNNING, stateVersion = 3, currentBpm = 165,
            bpmRequest = BpmRequest(166, BpmRequestStatus.REJECTED),
            coaching = AppliedCoaching("601", "701", 165, 360, previousBpm = 170),
            serverLinkLost = true,
        ))
        assertEquals(RhythmBpm(165), snapshot.metrics.rhythm)
        assertEquals(360, snapshot.metrics.guidePaceSecondsPerKm)
        assertEquals(BpmChange(RhythmBpm(166), BpmChangeStatus.REJECTED), snapshot.bpmChange)
        assertEquals(CoachingGuide(360, RhythmBpm(165), "리듬 BPM 165로 조정", dummy = Coaching.DUMMY_GUIDE), snapshot.coaching)
        assertTrue(snapshot.serverLinkLost)
    }

    @Test
    fun bpmButtonsAskForOneStepWithinTheLimitsAndNotWhileWaiting() {
        val running = WatchSessionState(sessionId = "201", confirmed = RunState.RUNNING, stateVersion = 2, currentBpm = 170)
        assertEquals(171, SessionRunControl.nextBpm(running, RunIntent.BPM_UP))
        assertEquals(169, SessionRunControl.nextBpm(running, RunIntent.BPM_DOWN))
        assertNull(SessionRunControl.nextBpm(running.copy(currentBpm = 220), RunIntent.BPM_UP))
        assertNull(SessionRunControl.nextBpm(running.copy(currentBpm = 60), RunIntent.BPM_DOWN))
        assertNull(SessionRunControl.nextBpm(running.copy(pending = PendingCommand("COACHING", "601", PendingStage.AWAITING_SAVE)), RunIntent.BPM_UP))
        assertNull(SessionRunControl.nextBpm(running.copy(currentBpm = null), RunIntent.BPM_UP))
        assertEquals(166, SessionRunControl.nextBpm(running.copy(currentBpm = null, coaching = AppliedCoaching("601", "701", 165, 360, null)), RunIntent.BPM_UP))
    }

    @Test
    fun aBpmButtonBecomesASetBpmRequest() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":170}"""))
        control.send(RunIntent.BPM_UP)

        assertEquals(listOf("SESSION_PREPARED", "STATE_QUERY", "COMMAND_REQUEST:SET_BPM"), sender.types)
        assertEquals(BpmChange(RhythmBpm(171), BpmChangeStatus.REQUESTING), control.snapshot.value.bpmChange)
        assertEquals("BPM 변경 확인 중", control.snapshot.value.notice)
        assertEquals(RhythmBpm(170), control.snapshot.value.metrics.rhythm)
    }

    private suspend fun runningWith(comparison: String, version: Long = 2) {
        controller.onMessage(
            message(
                "STATE_RESULT",
                """{"scope":"SERVER","recordingMode":"WATCH","state":"RUNNING","stateVersion":$version,"currentBpm":null,"comparison":$comparison}""",
            ),
        )
    }

    private suspend fun startedRun() {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{"comparisonSessionId":77},"initialBpm":null}"""))
        control.send(RunIntent.START)
        controller.onMessage(message("START_AUTHORIZED", """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""))
        controller.onMessage(message("COMMAND_RECEIVED", """{"commandId":501,"persisted":true,"stateVersion":2}"""))
    }

    @Test
    fun `the server record comparison reaches the comparison page as it is (S15P31E105-422)`() = runBlocking {
        startedRun()
        // 한국시간 10월 21일 08:00에 시작한 기록. 1000m에 지금 280초, 지난번 300초.
        runningWith("""{"status":"AVAILABLE","targetStartedAt":"2026-10-20T23:00:00Z","distanceM":1000,"currentElapsedSec":280,"pastElapsedSec":300}""")

        assertEquals(RecordComparison.Result(1000.0, 280_000, 300_000, targetLabel = "10.21"), control.snapshot.value.comparison)
    }

    @Test
    fun `each server comparison status maps to the existing watch states`() = runBlocking {
        startedRun()
        runningWith("""{"status":"WAITING","targetStartedAt":"2026-10-20T23:00:00Z","distanceM":null,"currentElapsedSec":null,"pastElapsedSec":null}""")
        assertEquals(RecordComparison.Waiting, control.snapshot.value.comparison)
        runningWith("""{"status":"NO_RECORD","targetStartedAt":"2026-10-20T23:00:00Z","distanceM":null,"currentElapsedSec":null,"pastElapsedSec":null}""")
        assertEquals(RecordComparison.NoRecord, control.snapshot.value.comparison)
        runningWith("""{"status":"UNAVAILABLE","targetStartedAt":null,"distanceM":null,"currentElapsedSec":null,"pastElapsedSec":null}""")
        assertEquals(RecordComparison.Unavailable, control.snapshot.value.comparison)
        // 값이 빠진 결과나 모르는 상태는 만든 숫자 대신 대기로 보인다.
        runningWith("""{"status":"AVAILABLE","targetStartedAt":"2026-10-20T23:00:00Z","distanceM":1000,"currentElapsedSec":null,"pastElapsedSec":300}""")
        assertEquals(RecordComparison.Waiting, control.snapshot.value.comparison)
        runningWith("""{"status":"LATER","targetStartedAt":null}""")
        assertEquals(RecordComparison.Waiting, control.snapshot.value.comparison)
        runningWith("null")
        assertEquals(RecordComparison.NotSelected, control.snapshot.value.comparison)
    }

    @Test
    fun `an older server snapshot does not roll the comparison back`() = runBlocking {
        startedRun()
        runningWith("""{"status":"AVAILABLE","targetStartedAt":"2026-10-20T23:00:00Z","distanceM":1000,"currentElapsedSec":280,"pastElapsedSec":300}""")
        runningWith("""{"status":"WAITING","targetStartedAt":"2026-10-20T23:00:00Z"}""", version = 1)

        assertEquals(RecordComparison.Result(1000.0, 280_000, 300_000, targetLabel = "10.21"), control.snapshot.value.comparison)
    }

    @Test
    fun `a run without a chosen record has no comparison`() = runBlocking {
        startedRun()
        controller.onMessage(message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"WATCH","state":"RUNNING","stateVersion":2,"currentBpm":null}"""))
        assertEquals(RecordComparison.NotSelected, control.snapshot.value.comparison)
    }

    // ── S15P31E105-663: 종료 뒤 서버 분석 상태·요약이 결과 화면에 그대로 반영된다.
    private suspend fun endedRun() {
        startedRun()
        control.send(RunIntent.END)
        controller.onMessage(message("COMMAND_REQUEST", """{"phase":"APPLY","commandId":502,"action":"END","expectedVersion":2,"targetBpm":null,"coachingId":null}"""))
        controller.onMessage(message("COMMAND_RECEIVED", """{"commandId":502,"persisted":true,"stateVersion":3}"""))
    }

    private suspend fun completedWith(analysis: String?, version: Long = 3) {
        val field = if (analysis == null) "" else ""","analysis":$analysis"""
        controller.onMessage(
            message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"WATCH","state":"COMPLETED","stateVersion":$version,"currentBpm":null$field}"""),
        )
    }

    @Test
    fun `an ended run waits for analysis until the server says otherwise, with no values`() = runBlocking {
        endedRun()
        val result = control.snapshot.value.result!!
        assertEquals(SaveStatus.SAVED, result.save)
        assertEquals(AnalysisStatus.PENDING, result.analysis)
        assertNull(result.summary)
    }

    @Test
    fun `the analysis status follows the server and READY brings the H02 summary (S15P31E105-663)`() = runBlocking {
        endedRun()
        completedWith("""{"status":"PROCESSING","summary":null}""")
        assertEquals(AnalysisStatus.PROCESSING, control.snapshot.value.result!!.analysis)
        assertNull(control.snapshot.value.result!!.summary)

        // 같은 stateVersion으로 다시 와도 갱신한다.
        completedWith(
            """{"status":"READY","summary":{"distanceM":5012.5,"movingDurationSec":1800,"averagePaceSecPerKm":358.6,"averageHeartRate":151,"goalAchieved":true}}""",
        )
        val result = control.snapshot.value.result!!
        assertEquals(AnalysisStatus.READY, result.analysis)
        assertEquals(
            RunSummary(distanceMeters = 5012.5, elapsedMs = 1_800_000, averagePaceSecondsPerKm = 359, averageHeartRate = HeartRate(151)),
            result.summary,
        )
        assertEquals(GoalEvaluation(true), result.goal)
    }

    @Test
    fun `a failed analysis shows as failed and READY without values keeps them missing`() = runBlocking {
        endedRun()
        completedWith("""{"status":"FAILED","summary":null}""")
        assertEquals(AnalysisStatus.FAILED, control.snapshot.value.result!!.analysis)

        completedWith("""{"status":"READY","summary":null}""")
        val result = control.snapshot.value.result!!
        assertEquals(AnalysisStatus.READY, result.analysis)
        assertNull(result.summary)
        assertNull(result.goal)
    }

    @Test
    fun `missing or invalid summary values stay missing instead of being made up`() = runBlocking {
        endedRun()
        completedWith(
            """{"status":"READY","summary":{"distanceM":-3,"movingDurationSec":null,"averagePaceSecPerKm":0,"averageHeartRate":null,"goalAchieved":null}}""",
        )
        val result = control.snapshot.value.result!!
        assertEquals(RunSummary(), result.summary)
        assertNull(result.goal)
    }

    @Test
    fun `an unknown or legacy analysis status is no analysis, and a snapshot without the field keeps what was known`() = runBlocking {
        endedRun()
        completedWith("""{"status":"READY","summary":{"distanceM":1000,"movingDurationSec":300,"averagePaceSecPerKm":300,"averageHeartRate":140,"goalAchieved":false}}""")
        // 필드가 없는 스냅샷(이전 폰)은 알던 값을 지우지 않는다.
        completedWith(null)
        assertEquals(AnalysisStatus.READY, control.snapshot.value.result!!.analysis)

        // 모르는 상태나 LEGACY는 분석 상태 없음으로 보지만 이미 받은 값은 그대로 둔다.
        completedWith("""{"status":"LEGACY","summary":null}""")
        completedWith("""{"status":"LATER","summary":null}""")
        assertEquals(AnalysisStatus.READY, control.snapshot.value.result!!.analysis)
    }
}
