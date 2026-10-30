package com.runway.watchdemo.exercise

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

object Permissions {
    fun heartRate(sdk: Int) = if (sdk >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
    fun requested(sdk: Int): Array<String> = buildList {
        add(Manifest.permission.ACTIVITY_RECOGNITION); add(heartRate(sdk))
        add(Manifest.permission.ACCESS_COARSE_LOCATION); add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (sdk >= 33) add("android.permission.POST_NOTIFICATIONS")
    }.toTypedArray()
    fun granted(context: Context, name: String) = context.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED
    fun activity(context: Context) = granted(context, Manifest.permission.ACTIVITY_RECOGNITION)
    fun heart(context: Context) = granted(context, heartRate(Build.VERSION.SDK_INT))
    fun gps(context: Context) = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)
}
