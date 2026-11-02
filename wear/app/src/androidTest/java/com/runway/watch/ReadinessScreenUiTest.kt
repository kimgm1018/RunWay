package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.readiness.CheckState.*
import com.runway.watch.readiness.Readiness
import com.runway.watch.run.*
import com.runway.watch.ui.ReadinessActions
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Readiness screens (9.1b) with synthetic states; no phone, server or OS permission is involved. */
class ReadinessScreenUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val ready = Readiness(consent = OK, permission = OK, registration = OK, online = OK)

    private fun launch(readiness: Readiness, snapshot: RunSnapshot = RunSnapshot(state = RunState.READY)): MutableStateFlow<Readiness> {
        val flow = MutableStateFlow(readiness)
        compose.setContent { WatchApp(SimulatedRunControl(snapshot), flow) }
        return flow
    }

    @Test fun eachMissingItemHasItsOwnGuidance() {
        val flow = launch(ready.copy(consent = MISSING))
        compose.onNodeWithText("동의가 필요해요").assertIsDisplayed()
        compose.onNodeWithContentDescription("시작").assertDoesNotExist()

        flow.value = ready.copy(permission = MISSING)
        compose.onNodeWithText("센서 권한이 필요해요").assertIsDisplayed()

        flow.value = ready.copy(registration = MISSING)
        compose.onNodeWithText("워치 등록이 필요해요").assertIsDisplayed()

        flow.value = ready.copy(online = MISSING)
        compose.onNodeWithText("인터넷 연결이 없어요").assertIsDisplayed()
        compose.onNodeWithText("연결 전에는 러닝을\n시작할 수 없어요").assertIsDisplayed()

        flow.value = ready
        compose.onNodeWithContentDescription("시작").assertIsEnabled()
    }

    @Test fun permissionButtonAsksAgainAndRecheckRereads() {
        var asked = 0
        var rechecked = 0
        val flow = MutableStateFlow(ready.copy(permission = MISSING))
        compose.setContent {
            WatchApp(SimulatedRunControl(RunSnapshot(state = RunState.READY)), flow,
                ReadinessActions(requestPermission = { asked++ }, recheck = { rechecked++ }))
        }
        compose.onNodeWithText("권한 허용").performClick()
        flow.value = ready.copy(online = MISSING)
        compose.onNodeWithText("다시 확인").performClick()
        compose.runOnIdle {
            assertEquals(1, asked)
            assertEquals(1, rechecked)
        }
    }

    @Test fun registeredWatchWithoutThePhoneIsNotShownAsConnected() {
        launch(ready, RunSnapshot(state = RunState.READY, phoneConnected = false))
        compose.onNodeWithText("휴대폰 연결이 없어요").assertIsDisplayed()
        compose.onNodeWithText("휴대폰 연결됨").assertDoesNotExist()
    }

    @Test fun standbyNamesTheInternetOnlyWhenKnown() {
        val flow = launch(ready.copy(online = CHECKING))
        compose.onNodeWithText("● 인터넷 확인 중").assertIsDisplayed()
        flow.value = ready
        compose.onNodeWithText("● 인터넷").assertIsDisplayed()
        flow.value = ready.copy(online = UNKNOWN)
        compose.onNodeWithText("● 휴대폰 연결됨").assertIsDisplayed()
        compose.onNodeWithText("● 인터넷", substring = true).assertDoesNotExist()
    }

    @Test fun losingTheInternetMidRunKeepsTheRunAndSaysSavingIsUnconfirmed() {
        launch(ready.copy(online = MISSING), RunSnapshot(state = RunState.RUNNING))
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()
        compose.onNodeWithText("● 오프라인 · 저장 미확인").assertIsDisplayed()
    }
}
