package com.runway.watch

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
import com.runway.watch.readiness.CheckState
import com.runway.watch.readiness.DeviceReadiness
import com.runway.watch.readiness.runPermissions
import com.runway.watch.readiness.runnerPermissionRequest
import com.runway.watch.run.RunControls
import com.runway.watch.ui.ReadinessActions
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var readiness: DeviceReadiness

    /** Set when the runner tapped "권한 허용", so a silent denial can fall back to app settings. */
    private var askedByRunner = false

    // Foreground permissions are asked first, then the background one; a denial ends the sequence for this launch.
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
        readiness.refreshPermissions()
        val denied = results.filterValues { !it }.keys
        if (results.isNotEmpty() && denied.isEmpty()) {
            // A runner's request ends with the run permissions; the daily background one is left to the launch sequence.
            if (!askedByRunner) return@registerForActivityResult requestNextOrRegister()
            askedByRunner = false
            return@registerForActivityResult enqueueRegistration(this)
        }
        enqueueRegistration(this)
        // The OS stops showing the dialog after repeated denials; only settings can grant it then.
        // A denied background permission only affects daily heart rate, so it does not open settings.
        val runDenied = denied.intersect(runPermissions(Build.VERSION.SDK_INT).toSet())
        if (askedByRunner && runDenied.isNotEmpty() && runDenied.none(::shouldShowRequestPermissionRationale)) openAppSettings()
        askedByRunner = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        readiness = DeviceReadiness(this)
        val control = RunControls.create(this)
        val actions = ReadinessActions(requestPermission = ::requestByRunner, recheck = ::recheck)
        setContent { WatchApp(control, readiness.readiness, actions, onExit = ::finish) }
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
                    readiness.refreshConsent()
                    canStore(store.consent())
                }
                if (agreed) requestNextOrRegister()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        readiness.startWatchingNetwork()
    }

    // Consent and permissions can change while the app is away (phone app, watch settings).
    override fun onResume() {
        super.onResume()
        readiness.refreshPermissions()
        lifecycleScope.launch(Dispatchers.IO) { readiness.refreshConsent() }
    }

    override fun onStop() {
        readiness.stopWatchingNetwork()
        super.onStop()
    }

    /** Asks only the missing run permissions, and never before consent is confirmed. */
    private fun requestByRunner() {
        if (readiness.readiness.value.consent != CheckState.OK) return
        val next = runnerPermissionRequest(Build.VERSION.SDK_INT, grantedPermissions()) ?: return readiness.refreshPermissions()
        askedByRunner = true
        permissionLauncher.launch(next.toTypedArray())
    }

    private fun grantedPermissions(): Set<String> =
        requiredPermissions(Build.VERSION.SDK_INT).filter {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }.toSet()

    /** Pulls the phone's consent again as well, since a change there may not have reached the store. */
    private fun recheck() {
        readiness.refreshPermissions()
        lifecycleScope.launch(Dispatchers.IO) {
            refreshConsentFromDataLayer(applicationContext, DailyHrStore.get(applicationContext))
            readiness.refreshConsent()
        }
    }

    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
        runCatching { startActivity(intent) }
    }

    private fun requestNextOrRegister() {
        val next = nextPermissionRequest(Build.VERSION.SDK_INT, grantedPermissions())
        if (next == null) enqueueRegistration(this) else permissionLauncher.launch(next.toTypedArray())
    }
}
