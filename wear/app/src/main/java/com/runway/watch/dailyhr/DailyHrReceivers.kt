package com.runway.watch.dailyhr

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Passive registrations do not survive a reboot or app update; re-register through WorkManager. */
class DailyHrBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> enqueueRegistration(context)
        }
    }
}
