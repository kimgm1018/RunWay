package com.runway.watch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.runway.watch.run.RunControls
import com.runway.watch.ui.WatchApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val control = RunControls.create()
        setContent { WatchApp(control, onExit = ::finish) }
    }
}
