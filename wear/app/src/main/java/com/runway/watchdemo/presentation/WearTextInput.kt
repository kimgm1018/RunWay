package com.runway.watchdemo.presentation

import android.app.RemoteInput
import android.content.Intent
import androidx.wear.input.RemoteInputIntentHelper

/** Wear OS keyboards return a result Intent instead of editing an inline phone-style field. */
object WearTextInput {
    const val KEY = "runway_text"
    fun intent(label: String, current: String): Intent {
        val input = RemoteInput.Builder(KEY).setLabel(label).setAllowFreeFormInput(true)
            .apply { if (current.isNotEmpty()) setChoices(arrayOf(current)) }.build()
        return RemoteInputIntentHelper.createActionRemoteInputIntent().also {
            RemoteInputIntentHelper.putRemoteInputsExtra(it, listOf(input))
            RemoteInputIntentHelper.putTitleExtra(it, label)
            RemoteInputIntentHelper.putConfirmLabelExtra(it, "완료")
        }
    }
    fun result(intent: Intent?, limit: Int): String? = intent?.let {
        RemoteInput.getResultsFromIntent(it)?.getCharSequence(KEY)?.toString()?.take(limit)
    }
}
