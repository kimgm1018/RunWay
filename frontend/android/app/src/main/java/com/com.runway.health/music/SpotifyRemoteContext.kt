package com.runway.health.music

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build

/** SDK 0.8.0 binds via applicationContext without Android 14's consent activity opt-in. */
internal class SpotifyRemoteContext(context: Context, private val interactive: Boolean) :
  ContextWrapper(context.applicationContext) {
  override fun getApplicationContext(): Context = this

  override fun bindService(service: Intent, connection: ServiceConnection, flags: Int): Boolean =
    super.bindService(service, connection, SpotifyRemotePolicy.bindFlags(
      Build.VERSION.SDK_INT, interactive, service.`package`, flags,
    ))
}
