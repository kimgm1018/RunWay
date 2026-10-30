package com.runway.watch.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.run.GoalEvaluation
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.ResultPhase
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunResults
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.ui.component.Chip
import com.runway.watch.ui.component.MetricValue
import com.runway.watch.ui.component.RoundScreen
import com.runway.watch.ui.component.StatusTone
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

private data class ResultStatus(val title: String, val detail: String? = null, val tone: StatusTone = StatusTone.NORMAL)

// Korean wraps per syllable by default, so break between words explicitly.
private fun status(phase: ResultPhase) = when (phase) {
    ResultPhase.ENDING -> ResultStatus("운동 종료 처리 중", "기록을 저장하고 있어요")
    ResultPhase.SAVE_UNCONFIRMED -> ResultStatus("저장을 확인하지 못했어요", "휴대폰에서\n기록을 확인해 주세요", StatusTone.WARNING)
    ResultPhase.ANALYSIS_PENDING -> ResultStatus("저장 완료 · 분석 준비 중")
    ResultPhase.ANALYZING -> ResultStatus("저장 완료 · 분석 중")
    ResultPhase.ANALYSIS_FAILED -> ResultStatus("분석하지 못했어요", "기록은 저장됐어요", StatusTone.WARNING)
    ResultPhase.READY -> ResultStatus("분석 완료", "자세한 결과는\n휴대폰에서 확인하세요")
}

/**
 * A group run says how the group stands apart from the runner's own end. A forced end names the
 * leader and never reads as a finish; whether the goal was met is only the server's evaluation.
 */
private fun caption(snapshot: RunSnapshot): String {
    if (snapshot.state == RunState.INTERRUPTED) return "기록이 중단됐어요"
    if (snapshot.mode != RunMode.GROUP) return "러닝 종료"
    return when (snapshot.group?.phase) {
        GroupPhase.FINISHED -> "그룹런 종료"
        GroupPhase.FORCE_FINISHED -> "그룹장이 그룹런을 종료"
        GroupPhase.WAITING, GroupPhase.RUNNING -> "내 러닝 종료 · 그룹 진행 중"
        null -> "내 러닝 종료"
    }
}

/**
 * 9.4 result after the end. Drawn from the current snapshot only, so coming back to it always
 * shows the latest save and analysis state. Final values and the goal appear only when the
 * analysis is READY; before that the watch measurement is shown dimmed. Retrying the save,
 * running the analysis and the detailed result stay with the phone.
 */
@Composable
fun ResultScreen(snapshot: RunSnapshot) {
    val result = snapshot.result
    val status = status(RunResults.phase(result))
    val summary = RunResults.finalSummary(result)
    RoundScreen {
        Text(caption(snapshot), style = RunwayType.Caption, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)
        RunResults.finalGoal(result)?.let { GoalChip(it) }
        if (summary != null) {
            MetricValue(MetricFormat.distance(summary.distanceMeters), 32)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MetricValue(MetricFormat.duration(summary.elapsedMs), 12, emphasized = false)
                MetricValue(MetricFormat.pace(summary.averagePaceSecondsPerKm), 12, emphasized = false)
                MetricValue(MetricFormat.heartRate(summary.averageHeartRate), 12, emphasized = false)
            }
        } else {
            val m = snapshot.metrics
            MetricValue(MetricFormat.distance(m.distanceMeters), 32, emphasized = false)
            MetricValue(MetricFormat.duration(m.elapsedMs), 12, emphasized = false)
        }
        Text(status.title, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            style = RunwayType.Body.copy(fontWeight = FontWeight.Bold), textAlign = TextAlign.Center,
            color = if (status.tone == StatusTone.WARNING) RunwayColors.Warning else RunwayColors.Content)
        status.detail?.let { Text(it, style = RunwayType.Body, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center) }
    }
}

@Composable
private fun GoalChip(goal: GoalEvaluation) = when (goal.achieved) {
    true -> Chip("✓ 목표 달성", inverted = true)
    false -> Chip("목표 미달성")
    null -> Chip("목표 평가 없음")
}
