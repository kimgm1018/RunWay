package com.runway.watch

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.platform.app.InstrumentationRegistry
import com.runway.watch.navigation.RunDetail
import com.runway.watch.readiness.ReadinessIssue
import com.runway.watch.run.*
import com.runway.watch.ui.*
import com.runway.watch.ui.screen.ResultScreen
import com.runway.watch.ui.theme.RunwayWatchTheme
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * Renders every state of the confirmed watch design (docs/design/watch-handoff/screens) from mock snapshots and
 * saves one PNG per state, for comparing with the handoff screens folder on each screen size and font size (S15P31E105-613).
 * Opt-in, so a normal connected test run skips it:
 * `-Pandroid.testInstrumentationRunnerArguments.gallery=true`; files land in the app's external files dir/gallery.
 */
class ScreenGalleryTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val metrics = RunMetrics(
        distanceMeters = 3420.0, elapsedMs = 1_214_000, paceSecondsPerKm = 355, guidePaceSecondsPerKm = 360,
        heartRate = HeartRate(152), cadenceSpm = 172, rhythm = RhythmBpm(172), goalProgress = .68f,
    )
    private val run = RunSnapshot(
        RunState.RUNNING, metrics = metrics,
        comparison = RecordComparison.Result(3420.0, 1_214_000, 1_232_000, "10.15"),
        coaching = CoachingGuide(360, RhythmBpm(172), "현재 페이스·리듬 유지"),
    )
    private val group = run.copy(
        mode = RunMode.GROUP, comparison = RecordComparison.NotSelected, coaching = null,
        group = GroupStatus(GroupPhase.RUNNING, 370, GroupPosition.Known(GroupStanding(3, 2, 5, 45.0, 30.0)), rankedCount = 8),
    )
    private val ready = RunSnapshot(RunState.READY, metrics = RunMetrics(guidePaceSecondsPerKm = 360, rhythm = RhythmBpm(172)))
    private val summary = RunSummary(5010.0, 1_780_000, 355, HeartRate(151))
    private fun result(result: RunResult, state: RunState = RunState.COMPLETED) = RunSnapshot(state, result = result)
    private fun position(p: GroupPosition, ranked: Int? = 8) = group.copy(group = group.group!!.copy(position = p, rankedCount = ranked))
    private fun bpm(status: BpmChangeStatus) = run.copy(bpmChange = BpmChange(RhythmBpm(174), status))

    private val cases: List<Pair<String, @Composable () -> Unit>> = listOf(
        "9.1_Standby" to { StandbyScreen(ready, false, {}, {}, {}) },
        "9.1_StandbyEmpty" to { StandbyScreen(RunSnapshot(), false, {}, {}, {}) },
        "9.1_StandbyGroup" to { StandbyScreen(ready.copy(mode = RunMode.GROUP, group = GroupStatus(GroupPhase.WAITING, 370)), false, {}, {}, {}) },
        "9.1_CancelConfirm" to { StandbyScreen(ready, true, {}, {}, {}) },
        "9.1b_ConnectionIssue" to { ConnectionIssueScreen(false) {} },
        "9.1b_NotReady" to { ReadinessScreen(ReadinessIssue.PERMISSION, ReadinessActions()) },
        "9.1c_StartRequest" to { StandbyScreen(ready.copy(pendingCommand = true, pendingIntent = RunIntent.START), false, {}, {}, {}) },
        "9.1d_StartFailed" to { StandbyScreen(ready.copy(problem = ControlProblem(ControlProblemKind.REFUSED, RunIntent.START)), false, {}, {}, {}) },
        "9.1e_StartUnknown" to { ControlUnknownScreen(ready, RunIntent.START) {} },
        "9.2_RunStatus" to { RunStatusPage(run, 3, 0, true, {}) },
        "9.2a_RunStatusFree" to { RunStatusPage(run.copy(metrics = metrics.copy(goalProgress = null), comparison = RecordComparison.NotSelected), 2, 0, true, {}) },
        "9.2b_RunStatusDegraded" to { RunStatusPage(run.copy(metrics = metrics.copy(feeds = MetricFeeds(FeedStatus.DELAYED, FeedStatus.NO_SIGNAL))), 3, 0, true, {}) },
        "9.2c_RunStatusRange" to { RunStatusPage(run.copy(metrics = metrics.copy(paceSecondsPerKm = 520)), 3, 0, true, {}) },
        "9.2d_RunPhoneLost" to { RunStatusPage(run.copy(phoneConnected = false), 3, 0, true, {}) },
        "9.2e_RunServerDelay" to { RunStatusPage(run.copy(serverLinkLost = true), 3, 0, true, {}) },
        "9.2-1_MetricPace" to { RunDetailScreen(run, RunDetail.PACE) {} },
        "9.2-2_MetricDistance" to { RunDetailScreen(run, RunDetail.DISTANCE) {} },
        "9.2-3_MetricTime" to { RunDetailScreen(run, RunDetail.TIME) {} },
        "9.2-4_MetricBody" to { RunDetailScreen(run, RunDetail.BODY) {} },
        "9.3a_PauseRequest" to { PauseRequestScreen(run.copy(pendingCommand = true, pendingIntent = RunIntent.PAUSE)) },
        "9.3_Paused" to { PausedScreen(run.copy(state = RunState.PAUSED), {}, {}) },
        "9.3c_ResumeRequest" to { PausedScreen(run.copy(state = RunState.PAUSED, pendingCommand = true, pendingIntent = RunIntent.RESUME), {}, {}) },
        "9.3b_EndConfirm" to { EndConfirmScreen(run.copy(state = RunState.PAUSED), {}, {}) },
        "9.3d_EndRequest" to { EndRequestScreen(run.copy(state = RunState.PAUSED)) },
        "9.3e_ControlUnknown" to { ControlUnknownScreen(run, RunIntent.PAUSE) {} },
        "9.3f_TakeOverPhone" to { PhoneRecordingScreen(run.copy(phoneRecording = true)) {} },
        "9.4a_Saving" to { ResultScreen(RunSnapshot(RunState.INTERRUPTED, metrics = metrics)) },
        "9.4b_Analyzing" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING))) },
        "9.4_ResultReady" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(true)))) },
        "9.4c_ResultMissed" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary.copy(distanceMeters = 4200.0, averagePaceSecondsPerKm = 372), GoalEvaluation(false)))) },
        "9.4d_ResultNoGoal" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, null))) },
        "9.4e_ResultGoalUnknown" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(null)))) },
        "9.4f_ResultPartial" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary.copy(averageHeartRate = null), GoalEvaluation(true)))) },
        "9.4g_ResultAnalysisFailed" to { ResultScreen(result(RunResult(SaveStatus.SAVED, AnalysisStatus.FAILED))) },
        "9.4_ResultUnconfirmed" to { ResultScreen(result(RunResult(SaveStatus.UNCONFIRMED))) },
        "9.5_PaceCoaching" to { PaceCoachingPage(run, 3, 1, true, {}, {}) },
        "9.5_PaceCoachingAdjust" to { PaceCoachingPage(run.copy(coaching = CoachingGuide(350, RhythmBpm(176), Coaching.cue(176, 172))), 3, 1, true, {}, {}) },
        "9.5_PaceCoachingManualApplied" to { PaceCoachingPage(bpm(BpmChangeStatus.APPLIED).copy(metrics = metrics.copy(rhythm = RhythmBpm(174))), 3, 1, true, {}, {}) },
        "9.5_PaceCoachingRequesting" to { PaceCoachingPage(bpm(BpmChangeStatus.REQUESTING), 3, 1, true, {}, {}) },
        "9.5_PaceCoachingServerLost" to { PaceCoachingPage(run.copy(serverLinkLost = true), 3, 1, true, {}, {}) },
        "9.5b_CoachingManual" to { RhythmManualScreen(run, {}, {}) },
        "9.5d_CoachingRequest" to { RhythmManualScreen(bpm(BpmChangeStatus.REQUESTING).copy(pendingCommand = true), {}, {}) },
        "9.5e_CoachingRejected" to { RhythmManualScreen(bpm(BpmChangeStatus.REJECTED), {}, {}) },
        "9.5g_CoachingUnknown" to { RhythmManualScreen(bpm(BpmChangeStatus.UNKNOWN), {}, {}) },
        "9.6_RecordCompare" to { RecordComparePage(run, 3, 2, true) },
        "9.6b_RecordCompareWaiting" to { RecordComparePage(run.copy(comparison = RecordComparison.Waiting), 3, 2, true) },
        "9.7_GroupPace" to { GroupPacePage(group.copy(group = group.group!!.copy(notice = GroupNotice.PaceChanged(380, 370))), 3, 1, true) },
        "9.7a_GroupStartRequest" to { StandbyScreen(ready.copy(mode = RunMode.GROUP, group = GroupStatus(GroupPhase.RUNNING, 370), pendingCommand = true, pendingIntent = RunIntent.START), false, {}, {}, {}) },
        "9.7b_GroupEnded" to { GroupEndedScreen(group.copy(group = group.group!!.copy(phase = GroupPhase.FORCE_FINISHED)), {}, {}) },
        "9.8_GroupPosition" to { GroupPositionPage(group, 3, 2, true) },
        "9.8b_GroupOrderTie" to { GroupPositionPage(position(GroupPosition.Known(GroupStanding(3, 2, 4, 45.0, 30.0))), 3, 2, true) },
        "9.8c_GroupOrderStale" to { GroupPositionPage(position(GroupPosition.Known(GroupStanding(3, 2, 5, 45.0, 30.0), delayed = true)), 3, 2, true) },
        "9.8d_GroupOrderUnavailable" to { GroupPositionPage(position(GroupPosition.Unavailable), 3, 2, true) },
        "9.8e_GroupOrderNoMe" to { GroupPositionPage(group.copy(metrics = metrics.copy(feeds = MetricFeeds(location = FeedStatus.NO_SIGNAL))), 3, 2, true) },
    )

    @Test fun captureEveryDesignState() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("gallery") == "true")
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(target.getExternalFilesDir(null), "gallery/${args.getString("galleryTag") ?: "default"}").apply { mkdirs() }
        // galleryOnly=<prefix> renders just the states whose name starts with it (e.g. 9.5_).
        val selected = args.getString("galleryOnly")?.let { prefix -> cases.filter { it.first.startsWith(prefix) } } ?: cases
        var current by mutableStateOf(selected.first())
        compose.setContent { RunwayWatchTheme { Box(Modifier.fillMaxSize()) { current.second() } } }
        for (case in selected) {
            current = case
            compose.waitForIdle()
            val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
            File(dir, "${case.first}.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
}
