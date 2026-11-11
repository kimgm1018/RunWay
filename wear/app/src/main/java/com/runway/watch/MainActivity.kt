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
import androidx.wear.ambient.AmbientLifecycleObserver
import com.runway.watch.dailyhr.DailyHrStore
import com.runway.watch.dailyhr.canStore
import com.runway.watch.dailyhr.enqueueRegistration
import com.runway.watch.dailyhr.nextPermissionRequest
import com.runway.watch.dailyhr.refreshConsentFromDataLayer
import com.runway.watch.dailyhr.requiredPermissions
import com.runway.watch.readiness.CheckState
import com.runway.watch.readiness.DeviceReadiness
import com.runway.watch.readiness.BACKGROUND_LOCATION
import com.runway.watch.readiness.LOCATION_PERMISSIONS
import com.runway.watch.readiness.backgroundLocationRequest
import com.runway.watch.readiness.locationPermissionRequest
import com.runway.watch.readiness.notificationPermissionRequest
import com.runway.watch.readiness.POST_NOTIFICATIONS
import com.runway.watch.readiness.runPermissions
import com.runway.watch.readiness.runnerPermissionRequest
import com.runway.watch.run.RunControls
import com.runway.watch.ui.AmbientMode
import com.runway.watch.ui.ReadinessActions
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var readiness: DeviceReadiness

    /** Set when the runner tapped "권한 허용", so a silent denial can fall back to app settings. */
    private var askedByRunner = false

    /** Location for the run route is asked once per launch; a denial leaves runs without GPS (S15P31E105-549). */
    private var locationAsked = false

    /** Background location ("항상 허용") is asked once per launch, after fine location (S15P31E105-549). */
    private var backgroundAsked = false

    /** Notifications for the run's Ongoing Activity are asked once per launch (S15P31E105-617). */
    private var notificationAsked = false

    /**
     * S15P31E105-617: the app stays on screen in ambient (always-on) instead of going to the watch face, with a
     * low-power screen updated about once a minute. Null while interactive.
     */
    private val ambient = MutableStateFlow<AmbientMode?>(null)

    private val ambientObserver = AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            ambient.value = AmbientMode(ambientDetails.burnInProtectionRequired, ambientDetails.deviceHasLowBitAmbient)
        }

        override fun onUpdateAmbient() {
            ambient.value = ambient.value?.let { it.copy(tick = it.tick + 1) }
        }

        override fun onExitAmbient() {
            ambient.value = null
        }
    })

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
        lifecycle.addObserver(ambientObserver)
        readiness = DeviceReadiness(this)
        val control = RunControls.create(this)
        val actions = ReadinessActions(requestPermission = ::requestByRunner, recheck = ::recheck)
        setContent { WatchApp(control, readiness.readiness, actions, onExit = ::finish, ambient = ambient) }
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
        val granted = grantedPermissions()
        val run = runnerPermissionRequest(Build.VERSION.SDK_INT, granted) ?: return readiness.refreshPermissions()
        // 경로용 위치 권한과 러닝 알림(Ongoing Activity) 권한도 함께 묻는다. 거절해도 러닝 준비는 막지 않는다.
        val next = run + locationPermissionRequest(granted).orEmpty() +
            notificationPermissionRequest(Build.VERSION.SDK_INT, granted).orEmpty()
        askedByRunner = true
        permissionLauncher.launch(next.toTypedArray())
    }

    private fun grantedPermissions(): Set<String> =
        (requiredPermissions(Build.VERSION.SDK_INT) + LOCATION_PERMISSIONS + BACKGROUND_LOCATION + POST_NOTIFICATIONS).filter {
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
        val granted = grantedPermissions()
        val next = nextPermissionRequest(Build.VERSION.SDK_INT, granted)
            ?: locationPermissionRequest(granted)?.takeIf { !locationAsked }?.also { locationAsked = true }
            ?: notificationPermissionRequest(Build.VERSION.SDK_INT, granted)?.takeIf { !notificationAsked }?.also { notificationAsked = true }
            ?: backgroundLocationRequest(granted)?.takeIf { !backgroundAsked }?.also { backgroundAsked = true }
        if (next == null) enqueueRegistration(this) else permissionLauncher.launch(next.toTypedArray())
    }
}
