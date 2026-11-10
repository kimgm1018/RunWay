package com.runway.watch.session

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.runway.watch.MainActivity
import com.runway.watch.R
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState

/**
 * S15P31E105-617: what the run notification shows as a Wear OS Ongoing Activity. Only a run this watch records
 * (RUNNING·PAUSED, not handed to the phone, measurement not lost) is ongoing, so turning the screen on returns to the
 * run screen and the watch face and recents show it. Anything else is [NONE] and the app behaves like any other.
 */
enum class OngoingRun(val status: String?) {
    NONE(null), RUNNING("러닝 중"), PAUSED("일시정지");

    companion object {
        fun of(snapshot: RunSnapshot): OngoingRun = when {
            snapshot.phoneRecording || snapshot.measurementLost -> NONE
            snapshot.state == RunState.RUNNING -> RUNNING
            snapshot.state == RunState.PAUSED -> PAUSED
            else -> NONE
        }
    }
}

/**
 * The run service's notification. With an ongoing run it carries the Ongoing Activity; without one it is posted again
 * without it, which takes the ongoing indicator away while the service still finishes its work (last batches).
 */
internal object RunNotification {
    const val CHANNEL_ID = "run_session"
    const val ID = 3110

    fun build(context: Context, run: OngoingRun): Notification {
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL_ID, "러닝 기록", NotificationManager.IMPORTANCE_LOW))
        // SINGLE_TOP: a running app comes back as it is, on the page last seen.
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_run_ongoing)
            .setContentTitle(run.status ?: "러닝 기록")
            .setContentText("기록을 휴대폰으로 보내고 있어요")
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
        val status = run.status ?: return builder.build()
        OngoingActivity.Builder(context, ID, builder)
            .setStaticIcon(R.drawable.ic_run_ongoing)
            .setTouchIntent(open)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setStatus(Status.Builder().addTemplate("#state#").addPart("state", Status.TextPart(status)).build())
            .build()
            .apply(context)
        return builder.build()
    }
}
