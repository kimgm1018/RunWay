package com.runway.watchdemo.presentation

import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WearTextInputTest {
    @Test fun systemKeyboardResultIsReturnedWithoutDependingOnAnInlineTextField() {
        val request = WearTextInput.intent("참가자 ID", "")
        assertNotNull(request.action)
        val result = Intent()
        RemoteInput.addResultsToIntent(arrayOf(RemoteInput.Builder(WearTextInput.KEY).build()), result,
            Bundle().apply { putCharSequence(WearTextInput.KEY, "emulator_demo") })
        assertEquals("emulator_demo", WearTextInput.result(result, 40))
        assertEquals("emu", WearTextInput.result(result, 3))
    }
    @Test fun cancelledOrMissingKeyboardResultDoesNotEraseTheCurrentValue() {
        assertNull(WearTextInput.result(null, 40))
        assertNull(WearTextInput.result(Intent(), 40))
    }
}
