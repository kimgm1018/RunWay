package com.runway.watch.ui

import androidx.compose.runtime.Composable
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.RunwayColors

/** Handle while paused: ■ opens the end confirmation; locked while a request waits; gone once the phone has the run. */
private fun stopHandle(snapshot: RunSnapshot, onEnd: () -> Unit): HandleSpec? = when {
    snapshot.phoneRecording -> null
    snapshot.pendingCommand -> HandleSpec(HandleIcon.BUSY, "요청 확인 중", false, onEnd)
    else -> HandleSpec(HandleIcon.STOP, "러닝 종료", true, onEnd)
}

private fun pausedRim(snapshot: RunSnapshot) = RimValues(tl = RunStatusDisplay.from(snapshot).ringProgress, dim = true)

/**
 * 9.3 일시정지됨 / 9.3c 재개 요청 중. Shown only once the watch really stopped. Resume is the bottom button, ending is the
 * ■ handle → 9.3b. The rim is dimmed and frozen (not live). While resuming, nothing reads as resumed until confirmed.
 */
@Composable
internal fun PausedScreen(snapshot: RunSnapshot, onEnd: () -> Unit, onResume: () -> Unit) {
    val m = snapshot.metrics
    val resuming = snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.RESUME
    // 폰으로 넘긴 운동은 폰에서만 재개·종료한다(S15P31E105-464).
    val controllable = !snapshot.pendingCommand && !snapshot.phoneRecording
    WatchFace(
        rim = pausedRim(snapshot),
        handle = stopHandle(snapshot, onEnd),
        bottomButton = {
            if (resuming) BottomButton("요청 중", onResume, busy = true)
            else BottomButton("재개", onResume, enabled = controllable)
        },
    ) {
        if (resuming) StatusChip("재개 요청 중", ChipLead.BUSY) else StatusChip("일시정지됨")
        HeroMetric(MetricFormat.distance(m.distanceMeters), HeroSize.SHORT)
        val time = MetricFormat.duration(m.elapsedMs)
        val pace = MetricFormat.pace(m.paceSecondsPerKm)
        BodyText("${time.value} · ${pace.value}", RunwayColors.ContentSecondary)
        snapshot.notice?.takeUnless { snapshot.pendingCommand }?.let { BodyText(it) }
    }
}

/** 9.3a: the pause is asked for; nothing says paused until the watch stopped. The handle is locked meanwhile. */
@Composable
internal fun PauseRequestScreen(snapshot: RunSnapshot) {
    val view = RunStatusDisplay.from(snapshot)
    WatchFace(rim = RunStatusDisplay.rim(view), handle = HandleSpec(HandleIcon.BUSY, "일시정지 요청 중", false) {}) {
        StatusChip("일시정지 요청 중", ChipLead.BUSY)
        HeroMetric(view.pace.text, HeroSize.PACE, unit = null, dim = view.pace.delayed)
        StepIndicator(listOf(Step("요청", StepState.DONE), Step("서버 확인", StepState.ACTIVE), Step("워치 정지", StepState.WAITING)))
    }
}

/** 9.3b: back is the same as 취소 and neither resumes nor ends. */
@Composable
internal fun EndConfirmScreen(snapshot: RunSnapshot, onCancel: () -> Unit, onEnd: () -> Unit) {
    WatchFace(
        rim = pausedRim(snapshot),
        bottomButton = {
            ConfirmButtons("취소", onCancel, "종료", onEnd, rightEnabled = !snapshot.pendingCommand && !snapshot.phoneRecording)
        },
    ) {
        Title("러닝을 종료할까요?")
        snapshot.notice?.let { BodyText(it) }
    }
}

/** 9.3d: ending is in progress; the record is not said to be saved until the server confirms (9.4a). */
@Composable
internal fun EndRequestScreen(snapshot: RunSnapshot) {
    WatchFace(rim = pausedRim(snapshot)) {
        Title("종료하는 중", announce = true)
        StepIndicator(listOf(Step("종료 요청", StepState.DONE), Step("측정 중지", StepState.ACTIVE), Step("기록 전송", StepState.WAITING)))
    }
}

/**
 * 9.1e / 9.3e: the result of the runner's own request is unknown, so it is shown as neither success nor failure.
 * 다시 확인 goes back to the last confirmed state; a state re-query is not in the contract yet (unconfirmed.md).
 * A start that is not confirmed offers no hand-over to the phone.
 */
@Composable
internal fun ControlUnknownScreen(snapshot: RunSnapshot, intent: RunIntent?, onAcknowledge: () -> Unit) {
    val live = snapshot.state == RunState.RUNNING
    WatchFace(
        rim = if (live) RunStatusDisplay.rim(RunStatusDisplay.from(snapshot)) else pausedRim(snapshot),
        bottomButton = { BottomButton("다시 확인", onAcknowledge) },
    ) {
        when (intent) {
            RunIntent.START -> {
                Title("시작 확인 안 됨", announce = true)
                StepIndicator(listOf(Step("요청", StepState.DONE), Step("서버 확인", StepState.UNKNOWN), Step("기기 실행", StepState.WAITING)))
            }
            RunIntent.PAUSE -> {
                Title("일시정지 확인 안 됨", announce = true)
                BodyText("기록이 계속되고 있을 수 있어요")
            }
            RunIntent.RESUME -> {
                Title("재개 확인 안 됨", announce = true)
                BodyText("기록이 멈춰 있을 수 있어요")
            }
            else -> {
                Title("종료 확인 안 됨", announce = true)
                BodyText("러닝이 계속되고 있을 수 있어요")
            }
        }
    }
}

/**
 * 9.3f: the run was handed to the phone (S08, after the server confirmed it), or the watch lost its measurement after
 * a restart and the phone is the way on (S15P31E105-445). 닫기 only leaves the app; it does not cancel the run.
 */
@Composable
internal fun PhoneRecordingScreen(snapshot: RunSnapshot, onClose: () -> Unit) {
    WatchFace(bottomButton = { BottomButton("닫기", onClose) }) {
        if (snapshot.phoneRecording) {
            Title("휴대폰에서 기록 중", announce = true)
            BodyText("워치 측정·리듬·제어를 멈췄어요")
            BodyText("일시정지·종료는 휴대폰에서")
        } else {
            StatusIcons(listOf(StatusItem(StatusKind.PHONE, StatusLevel.CHECKING, "휴대폰에서 이어가기")))
            Title("워치 측정이 끊겼어요", announce = true)
            BodyText("휴대폰에서 이어가세요")
        }
    }
}

/**
 * 9.7b: the server's end notice, this runner's measurement stop and the save are shown apart. Whether the watch stops
 * by itself on a group end is not agreed (unconfirmed.md), so the personal end path stays on the handle.
 * TODO(S15P31E105-613): drop the handle once the auto-stop on a group end is confirmed.
 */
@Composable
internal fun GroupEndedScreen(snapshot: RunSnapshot, onPause: () -> Unit, onEnd: () -> Unit) {
    val stopping = snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.END
    val handle = when (snapshot.state) {
        RunState.RUNNING -> pauseHandle(RunStatusDisplay.from(snapshot), onPause)
        RunState.PAUSED -> stopHandle(snapshot, onEnd)
        else -> null
    }
    WatchFace(rim = pausedRim(snapshot), handle = handle) {
        Title(if (snapshot.group?.phase == GroupPhase.FORCE_FINISHED) "그룹장이 그룹런을\n종료했어요" else "그룹런이 끝났어요", announce = true)
        StepIndicator(listOf(
            Step("종료 알림", StepState.DONE),
            Step("측정 중지", if (stopping) StepState.ACTIVE else StepState.WAITING),
            Step("저장 확인", StepState.WAITING),
        ))
    }
}
