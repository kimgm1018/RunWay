package com.runway.watch.ui.screen

import androidx.compose.runtime.Composable
import com.runway.watch.run.GoalEvaluation
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.ResultPhase
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunResults
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.RunSummary
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.RunwayColors

/**
 * A group run says how the group stands apart from the runner's own end. A forced end names the leader and never
 * reads as a finish; whether the goal was met is only the server's evaluation. Null for a plain personal end.
 */
private fun caption(snapshot: RunSnapshot): String? {
    if (snapshot.state == RunState.INTERRUPTED) return "기록이 중단됐어요"
    if (snapshot.mode != RunMode.GROUP) return null
    return when (snapshot.group?.phase) {
        GroupPhase.FINISHED -> "그룹런 종료"
        GroupPhase.FORCE_FINISHED -> "그룹장이 그룹런을 종료"
        GroupPhase.WAITING, GroupPhase.RUNNING -> "내 러닝 종료 · 그룹 진행 중"
        null -> "내 러닝 종료"
    }
}

/**
 * 9.4 after the end, drawn from the current snapshot only, so coming back always shows the latest save and analysis
 * state: 9.4a saving → 9.4b analysis → result (9.4, 9.4c–f), or save unconfirmed (9.4) / analysis failed (9.4g). Final
 * values and the goal appear only when the analysis is READY; the goal badge is the server's evaluation only. 닫기 only
 * leaves the app; it never cancels the save or the analysis.
 */
@Composable
fun ResultScreen(snapshot: RunSnapshot, onClose: () -> Unit = {}) {
    val result = snapshot.result
    WatchFace(bottomButton = { BottomButton("닫기", onClose) }) {
        caption(snapshot)?.let { Caption(it) }
        when (RunResults.phase(result)) {
            // TODO(S15P31E105-613): the 2-minute count (0:24 / 2:00) needs the agreed start point of the 2 minutes.
            ResultPhase.ENDING -> {
                Title("저장 확인 중", announce = true)
                StepIndicator(listOf(Step("저장 확인", StepState.ACTIVE), Step("분석", StepState.WAITING), Step("결과", StepState.WAITING)))
                MeasuredCells(snapshot)
            }
            ResultPhase.SAVE_UNCONFIRMED -> {
                StepIndicator(listOf(Step("저장 확인", StepState.UNKNOWN), Step("분석", StepState.WAITING), Step("결과", StepState.WAITING)))
                BodyText("저장을 확인하지 못했어요", RunwayColors.Content, strong = true, announce = true)
                BodyText("휴대폰에서\n기록을 확인해 주세요")
            }
            ResultPhase.ANALYSIS_PENDING, ResultPhase.ANALYZING -> {
                Title("분석 중", announce = true)
                StepIndicator(listOf(Step("저장 확인", StepState.DONE), Step("분석", StepState.ACTIVE), Step("결과", StepState.WAITING)))
                BodyText("결과는 휴대폰에서도 확인할 수 있어요")
            }
            ResultPhase.ANALYSIS_FAILED -> {
                Title("분석하지 못했어요", RunwayColors.Warning, announce = true)
                BodyText("기록은 저장됐어요", RunwayColors.Content, strong = true)
            }
            ResultPhase.READY -> Ready(RunResults.finalSummary(result) ?: RunSummary(), RunResults.finalGoal(result))
        }
    }
}

/** The watch's own measurement while the save is being confirmed; only values that exist. */
@Composable
private fun MeasuredCells(snapshot: RunSnapshot) {
    val distance = MetricFormat.distance(snapshot.metrics.distanceMeters)
    val time = MetricFormat.duration(snapshot.metrics.elapsedMs)
    if (distance.missing && time.missing) return
    CellRow {
        ValueCell(distance.value, "km", distance.description)
        ValueCell(time.value, "시간", time.description)
    }
}

@Composable
private fun Ready(summary: RunSummary, goal: GoalEvaluation?) {
    when (goal?.achieved) {
        true -> StatusChip("목표 달성", ChipLead.CHECK)
        false -> StatusChip("목표 미달")
        null -> StatusChip(if (goal == null) "자유 러닝" else "목표 평가 미확인")
    }
    Caption("평균 페이스")
    HeroMetric(MetricFormat.pace(summary.averagePaceSecondsPerKm), HeroSize.PACE, unit = "/km")
    val distance = MetricFormat.distance(summary.distanceMeters)
    when {
        goal?.achieved == false && !distance.missing -> BodyText("${distance.value} km에서 종료")
        goal != null && goal.achieved == null -> BodyText("평가는 휴대폰에서 확인하세요")
    }
    // 9.4f: name what the analysis lacks instead of showing a made-up value.
    val missing = listOfNotNull(
        "거리".takeIf { distance.missing },
        "시간".takeIf { MetricFormat.duration(summary.elapsedMs).missing },
        "심박".takeIf { MetricFormat.heartRate(summary.averageHeartRate).missing },
    )
    if (missing.isNotEmpty()) BodyText("${missing.joinToString("·")} 데이터 없음", RunwayColors.Warning, strong = true)
}
