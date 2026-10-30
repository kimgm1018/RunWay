package com.runway.watch

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.runway.watch.dailyhr.DailyHrStore
import com.runway.watch.dailyhr.canStore
import com.runway.watch.dailyhr.enqueueRegistration
import com.runway.watch.dailyhr.nextPermissionRequest
import com.runway.watch.dailyhr.refreshConsentFromDataLayer
import com.runway.watch.dailyhr.requiredPermissions
import com.runway.watch.run.RunControls
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    // Foreground permissions are asked first, then the background one; a denial ends the sequence for this launch.
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        if (results.isNotEmpty() && results.values.all { it }) requestNextOrRegister() else enqueueRegistration(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val control = RunControls.create()
        setContent { WatchApp(control, onExit = ::finish) }
        // Without consent nothing is requested; the phone triggers registration when consent arrives.
        // Recreation (rotation, process death) keeps the in-flight sequence alive through the launcher callback.
        if (savedInstanceState != null) return
        val store = DailyHrStore.get(this)
        if (canStore(store.consent())) {
            requestNextOrRegister()
        } else {
            // A fresh install has not seen the consent DataItem the phone may already have published.
            lifecycleScope.launch {
                val agreed = withContext(Dispatchers.IO) {
                    refreshConsentFromDataLayer(applicationContext, store)
                    canStore(store.consent())
                }
                if (agreed) requestNextOrRegister()
            }
        }
    }

    private fun requestNextOrRegister() {
        val granted = Build.VERSION.SDK_INT.let { sdk ->
            requiredPermissions(sdk).filter {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }.toSet()
        }
        val next = nextPermissionRequest(Build.VERSION.SDK_INT, granted)
        if (next == null) enqueueRegistration(this) else permissionLauncher.launch(next.toTypedArray())
    }
}
