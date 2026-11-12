@file:JvmName("MuteBubble")

package com.coder.mutebubble

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs

private const val BUBBLE_DP = 56
private const val POLL_MS = 3000L
private const val WAIT_MS = 25000L

private class BubbleView(context: Context) : View(context) {
    var muted = false
        set(value) {
            field = value
            invalidate()
        }

    private val density = resources.displayMetrics.density
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1.5f * density
        color = 0x33FFFFFF
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = (BUBBLE_DP * density).toInt()
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        val size = width.toFloat()
        val center = size / 2f
        val background = if (muted) 0xFFDA373C.toInt() else 0xFF2B2D31.toInt()

        fill.color = background
        canvas.drawCircle(center, center, center - density, fill)
        if (!muted) canvas.drawCircle(center, center, center - density, ring)

        val unit = size / 40f
        val left = center - 12f * unit
        val top = center - 12f * unit
        fun x(value: Float) = left + value * unit
        fun y(value: Float) = top + value * unit

        fill.color = 0xFFFFFFFF.toInt()
        stroke.color = 0xFFFFFFFF.toInt()
        stroke.strokeWidth = 2f * unit

        canvas.drawRoundRect(RectF(x(9f), y(2f), x(15f), y(14f)), 3f * unit, 3f * unit, fill)
        canvas.drawArc(RectF(x(5.5f), y(5f), x(18.5f), y(17f)), 0f, 180f, false, stroke)
        canvas.drawLine(x(12f), y(17f), x(12f), y(21f), stroke)
        canvas.drawLine(x(8.5f), y(21f), x(15.5f), y(21f), stroke)

        if (muted) {
            stroke.color = background
            stroke.strokeWidth = 5f * unit
            canvas.drawLine(x(4f), y(3f), x(20f), y(21f), stroke)
            stroke.color = 0xFFFFFFFF.toInt()
            stroke.strokeWidth = 2f * unit
            canvas.drawLine(x(4f), y(3f), x(20f), y(21f), stroke)
        }
    }
}

private class BubbleController(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val actions = Channel<String>(Channel.UNLIMITED)

    private val startedActivities = mutableSetOf<Activity>()
    private var reportedInCall = false
    private var muted = false
    private var bubble: BubbleView? = null
    private var params: WindowManager.LayoutParams? = null
    private var enabled = true
    private var bubbleEnabled = true
    private var savedX = -1
    private var savedY = -1

    private val poll = object : Runnable {
        override fun run() {
            refresh()
            if (bubble != null || startedActivities.isEmpty()) handler.postDelayed(this, POLL_MS)
        }
    }

    private val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityStarted(activity: Activity) {
            startedActivities.add(activity)
            refresh()
        }

        override fun onActivityStopped(activity: Activity) {
            startedActivities.remove(activity)
            refresh()
            if (startedActivities.isEmpty()) {
                handler.removeCallbacks(poll)
                handler.postDelayed(poll, POLL_MS)
            }
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityResumed(activity: Activity) {}
        override fun onActivityPaused(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {
            startedActivities.remove(activity)
        }
    }

    fun attach(activity: Activity?) {
        if (activity != null && !activity.isFinishing && isProcessForeground()) {
            startedActivities.add(activity)
        }
        (context.applicationContext as? Application)?.registerActivityLifecycleCallbacks(callbacks)
    }

    fun detach() {
        (context.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(callbacks)
        startedActivities.clear()
        handler.removeCallbacks(poll)
        enabled = false
        handler.post { hide() }
    }

    private fun isProcessForeground(): Boolean {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    fun canDraw(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    fun openPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun setState(inCall: Boolean, isMuted: Boolean, isEnabled: Boolean) {
        handler.post {
            bubbleEnabled = isEnabled
            reportedInCall = inCall
            muted = isMuted
            bubble?.muted = isMuted
            refresh()
        }
    }

    private fun inCall(): Boolean =
        reportedInCall || audio.mode == AudioManager.MODE_IN_COMMUNICATION

    private fun refresh() {
        val shouldShow = enabled && bubbleEnabled && startedActivities.isEmpty() && inCall() && canDraw()
        if (shouldShow) show() else hide()
    }

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

    @SuppressLint("ClickableViewAccessibility")
    private fun show() {
        if (bubble != null) return

        val density = context.resources.displayMetrics.density
        val layout = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (savedX >= 0) savedX else (12 * density).toInt()
            y = if (savedY >= 0) savedY else (180 * density).toInt()
        }

        val view = BubbleView(context).apply { muted = this@BubbleController.muted }
        val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false

        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = layout.x
                    startY = layout.y
                    dragging = false
                    view.alpha = 0.8f
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
                    if (dragging) {
                        layout.x = startX + dx.toInt()
                        layout.y = startY + dy.toInt()
                        try {
                            windowManager.updateViewLayout(view, layout)
                        } catch (_: Throwable) {
                        }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    view.alpha = 1f
                    if (dragging) {
                        savedX = layout.x
                        savedY = layout.y
                    } else {
                        onTap(view)
                    }
                }
                MotionEvent.ACTION_CANCEL -> view.alpha = 1f
            }
            true
        }

        try {
            windowManager.addView(view, layout)
            bubble = view
            params = layout
        } catch (_: Throwable) {
            bubble = null
            params = null
        }
    }

    private fun hide() {
        val view = bubble ?: return
        params?.let {
            savedX = it.x
            savedY = it.y
        }
        try {
            windowManager.removeView(view)
        } catch (_: Throwable) {
        }
        bubble = null
        params = null
    }

    private fun onTap(view: BubbleView) {
        vibrate()
        muted = !muted
        view.muted = muted
        actions.trySend("toggleMute")
    }

    private fun vibrate() {
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(30)
            }
        } catch (_: Throwable) {
        }
    }
}

private var controller: BubbleController? = null

@Suppress("UNUSED")
val muteBubble = plugin {
    start {
        withAppContext { context ->
            val bubble = BubbleController(context.applicationContext)
            controller = bubble
            withAppActivity { activity -> bubble.attach(activity) }
        }

        registerNativeAsyncMethod("com.coder.mutebubble.setState") { args ->
            val inCall = args.getOrNull(0) as? Boolean ?: false
            val muted = args.getOrNull(1) as? Boolean ?: false
            val enabled = args.getOrNull(2) as? Boolean ?: true
            controller?.setState(inCall, muted, enabled)
            true
        }

        registerNativeAsyncMethod("com.coder.mutebubble.nextAction") {
            val bubble = controller ?: return@registerNativeAsyncMethod "none"
            withTimeoutOrNull(WAIT_MS) { bubble.actions.receive() } ?: "none"
        }

        registerNativeAsyncMethod("com.coder.mutebubble.canDrawOverlays") {
            controller?.canDraw() ?: false
        }

        registerNativeAsyncMethod("com.coder.mutebubble.openOverlaySettings") {
            val bubble = controller ?: return@registerNativeAsyncMethod false
            Handler(Looper.getMainLooper()).post {
                try {
                    bubble.openPermissionSettings()
                } catch (_: Throwable) {
                }
            }
            true
        }
    }

    stop {
        controller?.detach()
        controller?.actions?.trySend("stop")
        controller = null
    }
}
