package com.runway.watchdemo

import android.os.Build
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.rule.GrantPermissionRule
import com.runway.watchdemo.exercise.Permissions
import com.runway.watchdemo.presentation.MainActivity
import com.runway.watchdemo.session.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import org.junit.After
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import android.app.RemoteInput
import android.app.Instrumentation.ActivityResult
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.runway.watchdemo.presentation.WearTextInput

/** Acceptance test against the emulator's real Health Services adapter (synthetic data). */
class WatchFlowTest {
    @get:Rule(order = 0) val permissions = GrantPermissionRule.grant(*Permissions.requested(Build.VERSION.SDK_INT))
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()

    @Before fun prepareKeyboardResult() {
        Intents.init()
        val result = Intent()
        RemoteInput.addResultsToIntent(arrayOf(RemoteInput.Builder(WearTextInput.KEY).build()), result,
            Bundle().apply { putCharSequence(WearTextInput.KEY, "emulator_test") })
        intending(hasAction(WearTextInput.intent("참가자 ID", "").action))
            .respondWith(ActivityResult(Activity.RESULT_OK, result))
    }
    @After fun releaseKeyboardInterceptor() = Intents.release()

    @Test fun settingsBpmRecordingRecreationAndExport() {
        compose.onNodeWithContentDescription("참가자 변경", useUnmergedTree = true).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("입력하기").performClick()
        compose.onNodeWithText("emulator_test").assertExists()
        compose.onNodeWithText("저장").performClick()
        compose.onAllNodes(hasScrollAction()).assertCountEquals(0)
        compose.onNodeWithText("한 박자마다 한 걸음").assertIsDisplayed()
        compose.onNode(hasText("120") and hasClickAction()).performClick()
        compose.runOnIdle { assertEquals(120, WatchRuntime.state.value.cue.bpm) }
        compose.onNodeWithText("+5", useUnmergedTree = true).performClick()
        compose.runOnIdle { assertEquals(125, WatchRuntime.state.value.cue.bpm) }
        compose.onNodeWithText("−5", useUnmergedTree = true).performClick()
        compose.runOnIdle { assertEquals(120, WatchRuntime.state.value.cue.bpm) }
        compose.onNodeWithText("140", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("180", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("160", useUnmergedTree = true).performClick()
        compose.onNodeWithText("기록 시작").assertIsDisplayed().performClick()
        compose.waitUntil(60000) { WatchRuntime.state.value.state in setOf(SessionState.RUNNING, SessionState.FAILED) }
        assertEquals(WatchRuntime.state.value.message, SessionState.RUNNING, WatchRuntime.state.value.state)
        val id = WatchRuntime.state.value.sessionId!!
        compose.onNodeWithText("BPM", useUnmergedTree = true).performClick()
        compose.onNodeWithText("140", useUnmergedTree = true).performClick()
        compose.waitUntil(15000) { WatchRuntime.store.load(id).events.any { it.targetBpm == 140 } }
        compose.activityRule.scenario.recreate()
        compose.waitForIdle()
        assertEquals(id, WatchRuntime.state.value.sessionId)
        assertEquals(SessionState.RUNNING, WatchRuntime.state.value.state)
        compose.waitUntil(30000) { WatchRuntime.store.load(id).samples.isNotEmpty() }
        compose.onNodeWithText("기록", useUnmergedTree = true).performClick()
        compose.onAllNodes(hasScrollAction()).assertCountEquals(0)
        compose.onNodeWithText("종료").assertIsDisplayed().performClick()
        compose.waitUntil(30000) { WatchRuntime.store.load(id).isFinal }
        val saved = WatchRuntime.store.load(id)
        assertEquals(SessionState.COMPLETED, saved.state)
        assertEquals(true, saved.device.synthetic)
        assertTrue(saved.events.any { it.targetBpm == 160 })
        assertTrue(saved.events.any { it.targetBpm == 140 })
        val exported = WatchRuntime.store.export(id)
        assertEquals(id, SessionJson.decode(exported.readText()).id)
        compose.onNodeWithText("전송", useUnmergedTree = true).performClick()
        compose.onAllNodes(hasScrollAction()).assertCountEquals(0)
        compose.onNodeWithText("서버 전송").assertIsDisplayed().performClick()
        compose.waitUntil(15000) { WatchRuntime.store.load(id).uploadState == UploadState.FAILED }
        assertEquals(saved.samples, WatchRuntime.store.load(id).samples)
    }
}
