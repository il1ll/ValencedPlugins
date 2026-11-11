@file:JvmName("ChangeDate")

package com.coder.changedate

import android.app.Activity
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import java.util.Calendar
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

private val mainHandler = Handler(Looper.getMainLooper())

private fun dialogTheme(activity: Activity): Int {
    val night = (activity.resources.configuration.uiMode and
        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    return if (night) {
        android.R.style.Theme_DeviceDefault_Dialog_Alert
    } else {
        android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
    }
}

private suspend fun pickDate(activity: Activity, calendar: Calendar): Boolean =
    suspendCoroutine { continuation ->
        mainHandler.post {
            var finished = false
            val finish = { picked: Boolean ->
                if (!finished) {
                    finished = true
                    continuation.resume(picked)
                }
            }

            val dialog = DatePickerDialog(
                activity,
                dialogTheme(activity),
                { _, year, month, day ->
                    calendar.set(year, month, day)
                    finish(true)
                },
                calendar.get(Calendar.YEAR),
                calendar.get(Calendar.MONTH),
                calendar.get(Calendar.DAY_OF_MONTH),
            )
            dialog.setOnDismissListener { finish(false) }
            dialog.show()
        }
    }

private suspend fun pickTime(
    activity: Activity,
    calendar: Calendar,
    is24Hour: Boolean,
): Boolean =
    suspendCoroutine { continuation ->
        mainHandler.post {
            var finished = false
            val finish = { picked: Boolean ->
                if (!finished) {
                    finished = true
                    continuation.resume(picked)
                }
            }

            val dialog = TimePickerDialog(
                activity,
                dialogTheme(activity),
                { _, hour, minute ->
                    calendar.set(Calendar.HOUR_OF_DAY, hour)
                    calendar.set(Calendar.MINUTE, minute)
                    calendar.set(Calendar.SECOND, 0)
                    calendar.set(Calendar.MILLISECOND, 0)
                    finish(true)
                },
                calendar.get(Calendar.HOUR_OF_DAY),
                calendar.get(Calendar.MINUTE),
                is24Hour,
            )
            dialog.setOnDismissListener { finish(false) }
            dialog.show()
        }
    }

@Suppress("UNUSED")
val changeDate = plugin {
    start {
        registerNativeAsyncMethod("com.coder.changedate.pickDateTime") { args ->
            val initial = (args.getOrNull(0) as? Number)?.toLong() ?: System.currentTimeMillis()

            val activity = suspendCoroutine<Activity> { continuation ->
                withAppActivity { continuation.resume(it) }
            }
            val is24Hour = DateFormat.is24HourFormat(activity)

            val calendar = Calendar.getInstance().apply { timeInMillis = initial }

            if (!pickDate(activity, calendar)) return@registerNativeAsyncMethod null
            if (!pickTime(activity, calendar, is24Hour)) return@registerNativeAsyncMethod null

            calendar.timeInMillis.toDouble()
        }

        registerNativeAsyncMethod("com.coder.changedate.is24Hour") {
            val activity = suspendCoroutine<Activity> { continuation ->
                withAppActivity { continuation.resume(it) }
            }
            DateFormat.is24HourFormat(activity)
        }
    }
}
