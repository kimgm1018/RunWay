package com.runway.watchdemo

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import android.content.Context
import com.runway.watchdemo.presentation.WatchApp
import com.runway.watchdemo.session.*
import org.junit.Rule
import org.junit.Test
import org.junit.After
import java.util.UUID

class ReviewUiTest {
    @get:Rule val compose = createComposeRule()
    private fun prepare() {
        WatchRuntime.initialize(ApplicationProvider.getApplicationContext<Context>())
        WatchRuntime.feedback.value = ""
        WatchRuntime.state.value = RecordingSnapshot()
    }
    @After fun resetRuntime() {
        compose.runOnIdle {
            WatchRuntime.state.value = RecordingSnapshot()
            WatchRuntime.feedback.value = ""
        }
        compose.waitForIdle()
    }
    @Test fun failedMeasurementExplainsItsCause() {
        prepare()
        WatchRuntime.state.value = RecordingSnapshot("failed", SessionState.FAILED, message = "측정 연결 실패 테스트")
        compose.setContent { WatchApp({}, {}, {}) }
        compose.onNodeWithText("측정 연결 실패 테스트", substring = true).assertIsDisplayed()
    }
    @Test fun selectedSavedParticipantIsVisibleInBothRecordAndUpload() {
        prepare()
        val record = SessionRecord(UUID.randomUUID().toString(), "previous_runner", 1700000000000, 1000,
            SessionState.COMPLETED, 2000, "user")
        WatchRuntime.store.create(record)
        WatchRuntime.refresh()
        compose.setContent { WatchApp({}, {}, {}) }
        compose.onNodeWithText("기록", useUnmergedTree = true).performClick()
        compose.onNodeWithText("previous_runner", substring = true).assertIsDisplayed()
        compose.onNodeWithText("전송", useUnmergedTree = true).performClick()
        compose.onNodeWithText("previous_runner", substring = true).assertIsDisplayed()
    }
    @Test fun deniedHeartRateExplainsMissingValue() {
        prepare()
        WatchRuntime.state.value = RecordingSnapshot("active", SessionState.RUNNING,
            support = mapOf("HEART_RATE.support" to "permission_denied"))
        compose.setContent { WatchApp({}, {}, {}) }
        compose.waitForIdle()
        compose.onNodeWithText("권한 필요", substring = true).assertIsDisplayed()
        // Keep the visual artifact outside app storage, which Gradle removes after instrumentation.
        val automation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("screencap -p /data/local/tmp/runway-review-live.png")
        ).use { it.readBytes() }
        compose.onNodeWithText("상태", useUnmergedTree = true).assertIsDisplayed().performClick()
        compose.onNodeWithText("심박: 권한 필요").assertIsDisplayed()
        compose.onNodeWithText("뒤로").assertIsDisplayed().performClick()
    }
}
