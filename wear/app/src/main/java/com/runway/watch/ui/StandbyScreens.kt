package com.runway.watch.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import com.runway.watch.readiness.ReadinessIssue
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.px

/** What the personal standby buttons show; [cancelLabel] is null when there is no cancel button. */
data class StandbyView(
    val startLabel: String,
    val startEnabled: Boolean,
    val startCaption: Boolean,
    val cancelLabel: String?,
    val cancelEnabled: Boolean,
)

/**
 * Standby buttons by the request in flight (S15P31E105-436): only a pending start reads 시작 확인 중, a pending
 * cancel keeps the cancel button as 취소 확인 중, and while anything is pending neither button can be pressed.
 * A refusal or error ends the pending state, so the buttons come back and the notice line explains it.
 *
 * Only a READY run can start (S15P31E105-457). 9.1 shows just the run the phone prepared and the watch has no
 * cancelled screen of its own, so a run the server cancelled (S07) goes back to the no-run prompt instead of keeping
 * its title and start button. The phone's next SESSION_PREPARE makes the new session READY, which brings the start
 * button back.
 */
object StandbyDisplay {
    /** False with no session or a finished one (CANCELLED): standby then asks for a run from the phone. */
    fun hasPreparedRun(snapshot: RunSnapshot): Boolean = snapshot.state == com.runway.watch.run.RunState.READY

    fun from(snapshot: RunSnapshot): StandbyView {
        if (!hasPreparedRun(snapshot)) return StandbyView("시작", false, false, null, false)
        // 준비된 개인 러닝은 시작 전에 취소할 수 있다(S07, 휴대폰이 서버에 요청).
        if (!snapshot.pendingCommand) {
            return StandbyView("시작", true, false, "취소", true)
        }
        return when (snapshot.pendingIntent) {
            RunIntent.CANCEL -> StandbyView("시작", false, false, "취소 확인 중", false)
            RunIntent.START -> StandbyView("시작 확인 중", false, true, null, false)
            else -> StandbyView("확인 중", false, true, null, false)
        }
    }

    /** 9.1d: the start was refused by the phone/server or the watch could not run it. */
    fun startFailed(snapshot: RunSnapshot): Boolean {
        val p = snapshot.problem ?: return false
        return hasPreparedRun(snapshot) && !snapshot.pendingCommand && p.intent == RunIntent.START &&
            (p.kind == ControlProblemKind.REJECTED || p.kind == ControlProblemKind.REFUSED)
    }
}

/** Callbacks for the fixes the watch itself can start; the rest are done on the phone. */
data class ReadinessActions(
    /** Asks for the run permissions again, or opens app settings when the OS no longer asks. */
    val requestPermission: () -> Unit = {},
    /** Reads consent, permissions and the network again, e.g. after the runner fixed them on the phone. */
    val recheck: () -> Unit = {},
)

/**
 * 9.1 personal standby, with its request states: 9.1c start requested (button locked), 9.1d start failed. The ⋮
 * handle opens the cancel confirmation for the prepared run (S07). The goal distance and the expected finish time of
 * the design are not delivered to the watch, so only the guide pace and rhythm BPM are shown
 * (TODO(S15P31E105-613): add once SESSION_PREPARE carries them).
 */
@Composable
internal fun StandbyScreen(snapshot: RunSnapshot, cancelOpen: Boolean, onMore: (Boolean) -> Unit, onCancel: () -> Unit, onStart: () -> Unit) {
    if (!StandbyDisplay.hasPreparedRun(snapshot)) {
        return WatchFace { Title("준비된 러닝이 없어요"); BodyText("휴대폰에서 러닝을 준비해 주세요") }
    }
    if (snapshot.mode == RunMode.GROUP) return GroupStandby(snapshot)
    val view = StandbyDisplay.from(snapshot)
    if (cancelOpen) return CancelConfirm(snapshot, onClose = { onMore(false) }, onCancel = onCancel)
    if (snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.START) {
        return WatchFace(bottomButton = { BottomButton("시작 확인 중", onStart, busy = true) }) {
            Title("시작 요청 중", announce = true)
            StepIndicator(listOf(Step("요청", StepState.DONE), Step("서버 확인", StepState.ACTIVE), Step("기기 실행", StepState.WAITING)))
        }
    }
    if (StandbyDisplay.startFailed(snapshot)) {
        val refused = snapshot.problem?.kind == ControlProblemKind.REFUSED
        return WatchFace(bottomButton = { BottomButton("다시 시도", onStart) }) {
            if (refused) StatusIcons(listOf(StatusItem(StatusKind.SERVER, StatusLevel.PROBLEM, "휴대폰·서버가 시작을 처리하지 못함")))
            Title("시작하지 못했어요", announce = true)
            // TODO(S15P31E105-613): per-reason wording once the failure reasons are listed in the contract.
            StepIndicator(listOf(
                Step("요청", StepState.DONE),
                Step("서버 확인", if (refused) StepState.FAILED else StepState.DONE),
                Step("기기 실행", if (refused) StepState.WAITING else StepState.FAILED),
            ))
        }
    }
    val cancelling = snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.CANCEL
    WatchFace(
        handle = HandleSpec(if (snapshot.pendingCommand) HandleIcon.BUSY else HandleIcon.MORE, "더보기", view.cancelEnabled) { onMore(true) },
        bottomButton = { BottomButton("러닝 시작", onStart, enabled = view.startEnabled, busy = snapshot.pendingCommand && !cancelling) },
    ) {
        Title(snapshot.title ?: "준비된 러닝")
        Row(horizontalArrangement = Arrangement.spacedBy(px(28)), verticalAlignment = Alignment.Bottom) {
            val pace = MetricFormat.pace(snapshot.metrics.guidePaceSecondsPerKm)
            val rhythm = MetricFormat.rhythm(snapshot.metrics.rhythm)
            ValueCell(pace.value, "안내 페이스", "안내 ${pace.description}")
            ValueCell(rhythm.value, MetricFormat.RHYTHM_LABEL, rhythm.description)
        }
        if (cancelling) StatusChip("취소 확인 중", ChipLead.BUSY)
        snapshot.notice?.takeUnless { snapshot.pendingCommand }?.let { BodyText(it) }
    }
}

/** Cancelling the prepared run asks once: back or 닫기 keeps it. The phone sends the cancel to the server (S07). */
@Composable
private fun CancelConfirm(snapshot: RunSnapshot, onClose: () -> Unit, onCancel: () -> Unit) {
    WatchFace(bottomButton = { ConfirmButtons("닫기", onClose, "러닝 취소", onCancel, rightEnabled = !snapshot.pendingCommand) }) {
        Title("준비된 러닝을\n취소할까요?")
        BodyText("휴대폰에서 다시 준비할 수 있어요")
    }
}

/**
 * A group run starts only when the leader starts it (G09), so there is no start button here. A runner who was not
 * ready when the group left is told so instead of being started late. 9.7a: the group left and this watch is starting;
 * it does not read as recording until the device runs.
 */
@Composable
private fun GroupStandby(snapshot: RunSnapshot) {
    val group = GroupRunDisplay.status(snapshot)
    if (snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.START) {
        return WatchFace(bottomButton = { BottomButton("시작 확인 중", {}, busy = true) }) {
            Title("그룹이 출발했어요", announce = true)
            StepIndicator(listOf(Step("출발 알림", StepState.DONE), Step("시작 요청", StepState.DONE), Step("기기 실행", StepState.ACTIVE)))
        }
    }
    WatchFace {
        Title(snapshot.title ?: "그룹런")
        when (group.phase) {
            // 워치는 폰에서 준비 완료한 뒤에만 그룹으로 준비된다(S15P31E105-420).
            GroupPhase.WAITING -> {
                val pace = MetricFormat.pace(group.guidePaceSecondsPerKm)
                HeroNumber(pace.value, HeroSize.PACE, "공동 ${pace.description}",
                    color = if (pace.missing) RunwayColors.ContentDim else RunwayColors.Primary)
                Caption("공동 페이스 /km")
                StatusChip("그룹장 출발을 기다려요", ChipLead.BUSY)
            }
            GroupPhase.RUNNING -> { BodyText("그룹이 이미 출발했어요", RunwayColors.Content, strong = true, announce = true); BodyText("내 기록은\n시작되지 않았어요") }
            GroupPhase.FINISHED, GroupPhase.FORCE_FINISHED -> { BodyText("그룹런이 끝났어요", RunwayColors.Content, strong = true, announce = true); BodyText("내 기록은\n시작되지 않았어요") }
        }
    }
}

/** 9.1b: the phone link. OS pairing and the app link are checked on the phone; server registration is never shown as this link. */
@Composable
internal fun ConnectionIssueScreen(pending: Boolean, onReconnect: () -> Unit) {
    WatchFace(bottomButton = { BottomButton("다시 연결", onReconnect, enabled = !pending) }) {
        StatusIcons(listOf(
            StatusItem(StatusKind.PHONE, StatusLevel.PROBLEM, "휴대폰 연결 없음"),
            StatusItem(StatusKind.SERVER, StatusLevel.CHECKING, "서버 연결 확인 불가"),
        ))
        Title("휴대폰과 연결되지\n않았어요", announce = true)
        BodyText("휴대폰 블루투스와\nRunWay 앱을 확인해 주세요")
    }
}

/**
 * 9.1b: one missing prerequisite at a time, with what the runner should do. Nothing here claims a run can go on
 * offline or that records are recovered later.
 */
@Composable
internal fun ReadinessScreen(issue: ReadinessIssue?, actions: ReadinessActions) {
    issue ?: return
    val (icon, title, body) = when (issue) {
        ReadinessIssue.CONSENT -> Triple(StatusItem(StatusKind.HEART, StatusLevel.PROBLEM, "동의 필요"), "동의가 필요해요", "휴대폰 RunWay 앱에서\n건강정보 수집에\n동의해 주세요")
        ReadinessIssue.PERMISSION -> Triple(StatusItem(StatusKind.HEART, StatusLevel.PROBLEM, "센서 권한 없음"), "센서 권한이 필요해요", "심박·활동 인식 권한을\n허용해 주세요")
        ReadinessIssue.REGISTRATION -> Triple(StatusItem(StatusKind.PHONE, StatusLevel.PROBLEM, "워치 등록 필요"), "워치 등록이 필요해요", "휴대폰 RunWay 앱에서\n워치를 등록해 주세요")
        ReadinessIssue.OFFLINE -> Triple(StatusItem(StatusKind.SERVER, StatusLevel.PROBLEM, "인터넷 연결 없음"), "인터넷 연결이 없어요", "연결 전에는 러닝을\n시작할 수 없어요")
    }
    val permission = issue == ReadinessIssue.PERMISSION
    WatchFace(bottomButton = {
        if (permission) BottomButton("권한 허용", actions.requestPermission) else BottomButton("다시 확인", actions.recheck)
    }) {
        StatusIcons(listOf(icon))
        Title(title, announce = true)
        BodyText(body)
    }
}
