package com.runway.watchdemo.session

import android.content.Context
import com.runway.watchdemo.settings.WatchSettings
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.concurrent.Executors

/** Process-scoped store and observable state; rotating an Activity never recreates a workout. */
object WatchRuntime {
    // Network waits must never occupy the executor that records sensor and BPM events.
    val uploads = CoroutineScope(SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)
    val state = MutableStateFlow(RecordingSnapshot())
    val history = MutableStateFlow<List<SessionRecord>>(emptyList())
    val feedback = MutableStateFlow("")
    val io = CoroutineScope(SupervisorJob() + Executors.newSingleThreadExecutor().asCoroutineDispatcher())
    lateinit var store: SqliteSessionStore
        private set
    lateinit var settings: WatchSettings
        private set
    @Synchronized fun initialize(context: Context) {
        if (::store.isInitialized) return
        store = SqliteSessionStore(context.applicationContext)
        settings = WatchSettings(context.applicationContext)
        state.value = state.value.copy(cue = settings.cue())
        io.launch {
            try { store.recoverInterrupted(); refresh() }
            catch (_: Exception) { feedback.value = "기록 저장소를 열지 못했습니다. 저장 공간을 확인하세요" }
        }
    }
    fun refresh() { history.value = store.list() }
}
