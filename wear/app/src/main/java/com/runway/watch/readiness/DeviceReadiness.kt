package com.runway.watch.readiness

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.content.ContextCompat
import com.runway.watch.dailyhr.DailyHrStore
import com.runway.watch.dailyhr.canStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Readiness the watch can read by itself: stored consent, granted permissions and the default
 * network. Server registration stays [CheckState.UNKNOWN] until a delivery path to the watch is
 * agreed; it is never inferred from the phone link.
 */
class DeviceReadiness(context: Context) {
    private val app = context.applicationContext
    private val connectivity = app.getSystemService(ConnectivityManager::class.java)
    private val state = MutableStateFlow(Readiness())
    val readiness: StateFlow<Readiness> = state
    private var watching = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
            setOnline(networkState(hasNetwork = true, validated = caps.validated()))

        override fun onLost(network: Network) = setOnline(CheckState.MISSING)
    }

    /** Reads consent from the store, so call it off the main thread. */
    fun refreshConsent() {
        val consent = if (canStore(DailyHrStore.get(app).consent())) CheckState.OK else CheckState.MISSING
        state.update { it.copy(consent = consent) }
    }

    fun refreshPermissions() {
        val granted = runPermissions(Build.VERSION.SDK_INT)
            .filter { ContextCompat.checkSelfPermission(app, it) == PackageManager.PERMISSION_GRANTED }.toSet()
        state.update { it.copy(permission = permissionState(Build.VERSION.SDK_INT, granted)) }
    }

    /** Follows the default network while the screen is visible; pair with [stopWatchingNetwork]. */
    fun startWatchingNetwork() {
        if (watching || connectivity == null) return
        val caps = connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities)
        setOnline(networkState(hasNetwork = caps != null, validated = caps?.validated() == true))
        connectivity.registerDefaultNetworkCallback(networkCallback)
        watching = true
    }

    fun stopWatchingNetwork() {
        if (!watching) return
        connectivity?.unregisterNetworkCallback(networkCallback)
        watching = false
    }

    private fun setOnline(online: CheckState) = state.update { it.copy(online = online) }

    private fun NetworkCapabilities.validated() =
        hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
