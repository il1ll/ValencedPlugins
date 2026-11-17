@file:JvmName("MotionBlur")

package com.coder.motionblur

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Rect
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inspector.WindowInspector
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import java.lang.ref.WeakReference
import java.lang.reflect.Method
import java.util.Arrays
import java.util.Collections
import java.util.IdentityHashMap
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val DEFAULT_STRENGTH = 45
private const val MAX_LEVEL = 32
private const val LEVEL_STEP = 0.625f
private const val CROSS_RATIO = 0.08f
private const val MIN_CROSS_RADIUS = 0.1f
private const val MAX_TARGET = 20f
private const val MIN_VELOCITY = 0.015f
private const val STRENGTH_SCALE = 0.32f
private const val RISE_MS = 24f
private const val FALL_MS = 55f
private const val SETTLE = 0.2f
private const val VELOCITY_MS = 70f
private const val ON_LEVEL = 3
private const val ON_DELAY_MS = 40L
private const val MAX_GAP_MS = 200L
private const val MAX_STEP_MS = 64L
private const val SCAN_INTERVAL_MS = 250L
private const val WINDOW_INTERVAL_MS = 250L
private const val SCROLL_IDLE_MS = 300L
private const val FAST_SCAN_MS = 100L
private const val MAX_DEPTH = 512
private const val MAX_NODES = 60_000
private const val MAX_WRAPPERS = 3
private const val MOVE_HOLD_MS = 160L
private const val MIN_ROW_MOVE_PX = 3
private const val FOLLOW_RATIO = 0.5f
private const val MAX_OVERFLOW = 0.15f
private const val OVERFLOW_DEPTH = 4
private const val OVERFLOW_NODES = 300

private val TARGET_NAMES = setOf(
    "RecyclerView",
    "ScrollView",
    "HorizontalScrollView",
    "NestedScrollView",
    "AbsListView",
    "ViewPager",
)

private val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

private object Config {
    @Volatile
    var enabled = true

    @Volatile
    var strength = DEFAULT_STRENGTH
}

private val verticalOffset: Method? = runCatching {
    View::class.java.getDeclaredMethod("computeVerticalScrollOffset").apply { isAccessible = true }
}.getOrNull()

private val horizontalOffset: Method? = runCatching {
    View::class.java.getDeclaredMethod("computeHorizontalScrollOffset").apply { isAccessible = true }
}.getOrNull()

private fun offset(method: Method?, view: View, fallback: Int): Float =
    ((method?.let { runCatching { it.invoke(view) as? Int }.getOrNull() }) ?: fallback).toFloat()

private fun isTarget(view: View): Boolean {
    var type: Class<*>? = view.javaClass
    while (type != null && type != View::class.java) {
        if (type.simpleName in TARGET_NAMES) return true
        type = type.superclass
    }
    return false
}

private class Signal {
    var x = 0f
        private set
    var y = 0f
        private set
    private var initialized = false
    private var last = 0L
    private var speedX = 0f
    private var speedY = 0f
    private var active = false
    private var aboveSince = -1L

    fun step(dx: Float, dy: Float, now: Long, density: Float, strength: Int) {
        if (!initialized) {
            initialized = true
            last = now
            return
        }
        val dt = now - last
        last = now
        if (dt <= 0) return
        if (dt > MAX_GAP_MS || strength <= 0) {
            x = 0f
            y = 0f
            speedX = 0f
            speedY = 0f
            active = false
            aboveSince = -1L
            return
        }
        val stepMs = min(MAX_STEP_MS, dt).toFloat()
        val scale = max(0.5f, density)
        val gain = strength.coerceIn(0, 100) * STRENGTH_SCALE
        val smoothing = 1f - exp(-stepMs / VELOCITY_MS)
        speedX += (abs(dx) / scale / dt - speedX) * smoothing
        speedY += (abs(dy) / scale / dt - speedY) * smoothing
        val vx = speedX
        val vy = speedY
        val tx = if (vx < MIN_VELOCITY) 0f else min(MAX_TARGET, vx * gain)
        val ty = if (vy < MIN_VELOCITY) 0f else min(MAX_TARGET, vy * gain)
        val ax = 1f - exp(-stepMs / (if (tx > x) RISE_MS else FALL_MS))
        val ay = 1f - exp(-stepMs / (if (ty > y) RISE_MS else FALL_MS))
        x += (tx - x) * ax
        y += (ty - y) * ay
        if (x < SETTLE) x = 0f
        if (y < SETTLE) y = 0f
    }

    fun level(now: Long): Int {
        val raw = min(MAX_LEVEL, (max(x, y) / LEVEL_STEP).roundToInt())
        if (raw >= ON_LEVEL) {
            if (aboveSince < 0) aboveSince = now
            if (now - aboveSince >= ON_DELAY_MS) active = true
        } else {
            aboveSince = -1L
        }
        if (raw == 0) active = false
        return if (active) raw else 0
    }

    fun horizontal(): Boolean = x > y

    fun reset() {
        x = 0f
        y = 0f
        speedX = 0f
        speedY = 0f
        active = false
        aboveSince = -1L
        initialized = false
        last = 0L
    }
}

private class Row(var anchor: Int) {
    var movedAt = 0L
    var applied: RenderEffect? = null
}

private class Overflow {
    private var left = 0f
    private var top = 0f
    private var right = 0f
    private var bottom = 0f
    private var nodes = 0

    fun ratio(view: View): Float {
        val width = view.width.toFloat()
        val height = view.height.toFloat()
        if (width <= 0f || height <= 0f) return 1f
        left = 0f
        top = 0f
        right = width
        bottom = height
        nodes = 0
        visit(view, 0f, 0f, 0)
        val spillX = (right - left - width) / (right - left)
        val spillY = (bottom - top - height) / (bottom - top)
        return max(spillX, spillY)
    }

    private fun visit(view: View, offsetX: Float, offsetY: Float, depth: Int) {
        if (view !is ViewGroup || depth >= OVERFLOW_DEPTH) return
        for (index in 0 until view.childCount) {
            if (++nodes > OVERFLOW_NODES) return
            val child = view.getChildAt(index) ?: continue
            if (child.visibility != View.VISIBLE || child.width <= 0 || child.height <= 0 || child.alpha == 0f) continue
            val x = offsetX + child.left + child.translationX - view.scrollX
            val y = offsetY + child.top + child.translationY - view.scrollY
            left = min(left, x)
            top = min(top, y)
            right = max(right, x + child.width)
            bottom = max(bottom, y + child.height)
            visit(child, x, y, depth + 1)
        }
    }
}

private class Target(val view: View) {
    private val signal = Signal()
    private val visible = Rect()
    private val location = IntArray(2)
    private val cache = Array(2) { arrayOfNulls<RenderEffect>(MAX_LEVEL + 1) }
    private val wholeCache = Array(2) { arrayOfNulls<RenderEffect>(MAX_LEVEL + 1) }
    private var wholeApplied: RenderEffect? = null
    private val rows = IdentityHashMap<View, Row>()
    private val seen = IdentityHashMap<View, Boolean>()
    private val overflow = Overflow()
    private val moving = Collections.newSetFromMap(IdentityHashMap<View, Boolean>())
    private val positions = IdentityHashMap<View, IntArray>()
    private val present = IdentityHashMap<View, Boolean>()
    private var shiftsX = FloatArray(16)
    private var shiftsY = FloatArray(16)
    private var shiftCount = 0
    private var ready = false
    private var lastX = 0f
    private var lastY = 0f
    var level = 0
        private set

    fun frame(now: Long) {
        if (!Config.enabled || !view.isAttachedToWindow || !view.isShown ||
            !view.isHardwareAccelerated || !view.getGlobalVisibleRect(visible)
        ) {
            clear()
            return
        }
        val x = offset(horizontalOffset, view, view.scrollX)
        val y = offset(verticalOffset, view, view.scrollY)
        val measured = measureShift()
        val dx = if (measured) median(shiftsX) else if (ready) x - lastX else 0f
        val dy = if (measured) median(shiftsY) else if (ready) y - lastY else 0f
        lastX = x
        lastY = y
        ready = true

        val density = view.resources.displayMetrics.density
        signal.step(dx, dy, now, density, Config.strength)
        level = signal.level(now)
        if (level == 0) {
            clearRows()
            setWhole(null)
            return
        }
        val horizontal = signal.horizontal()
        val axis = if (horizontal) 0 else 1
        val effect = cache[axis][level] ?: run {
            val main = level * LEVEL_STEP * density
            val cross = max(MIN_CROSS_RADIUS, main * CROSS_RATIO)
            RenderEffect.createBlurEffect(
                if (horizontal) main else cross,
                if (horizontal) cross else main,
                Shader.TileMode.DECAL,
            ).also { cache[axis][level] = it }
        }
        val whole = updateRows(horizontal, effect, now, if (horizontal) dx else dy)
        setWhole(if (whole) wholeEffect(horizontal, axis, density) else null)
    }

    private fun measureShift(): Boolean {
        val group = container()
        shiftCount = 0
        present.clear()
        if (group != null) {
            for (index in 0 until group.childCount) {
                val child = group.getChildAt(index) ?: continue
                if (child.visibility != View.VISIBLE || child.width <= 0 || child.height <= 0) continue
                child.getLocationInWindow(location)
                present[child] = true
                val previous = positions[child]
                if (previous == null) {
                    positions[child] = intArrayOf(location[0], location[1])
                    continue
                }
                if (shiftCount == shiftsX.size) {
                    shiftsX = shiftsX.copyOf(shiftCount * 2)
                    shiftsY = shiftsY.copyOf(shiftCount * 2)
                }
                shiftsX[shiftCount] = (location[0] - previous[0]).toFloat()
                shiftsY[shiftCount] = (location[1] - previous[1]).toFloat()
                shiftCount++
                previous[0] = location[0]
                previous[1] = location[1]
            }
        }
        val iterator = positions.keys.iterator()
        while (iterator.hasNext()) if (!present.containsKey(iterator.next())) iterator.remove()
        return shiftCount > 0
    }

    private fun median(values: FloatArray): Float {
        Arrays.sort(values, 0, shiftCount)
        return values[shiftCount / 2]
    }

    private fun wholeEffect(horizontal: Boolean, axis: Int, density: Float): RenderEffect =
        wholeCache[axis][level] ?: run {
            val main = level * LEVEL_STEP * density
            val cross = max(MIN_CROSS_RADIUS, main * CROSS_RATIO)
            RenderEffect.createBlurEffect(
                if (horizontal) main else cross,
                if (horizontal) cross else main,
                Shader.TileMode.CLAMP,
            ).also { wholeCache[axis][level] = it }
        }

    private fun setWhole(effect: RenderEffect?) {
        if (wholeApplied === effect) return
        view.setRenderEffect(effect)
        wholeApplied = effect
    }

    private fun container(): ViewGroup? {
        var group = view as? ViewGroup ?: return null
        var depth = 0
        while (depth < MAX_WRAPPERS && group.childCount == 1) {
            group = group.getChildAt(0) as? ViewGroup ?: break
            depth++
        }
        return group
    }

    private fun updateRows(horizontal: Boolean, effect: RenderEffect, now: Long, scrolled: Float): Boolean {
        val follow = max(MIN_ROW_MOVE_PX.toFloat(), abs(scrolled) * FOLLOW_RATIO)
        val group = container() ?: return true
        seen.clear()
        moving.clear()

        for (index in 0 until group.childCount) {
            val child = group.getChildAt(index) ?: continue
            if (child.visibility != View.VISIBLE || child.width <= 0 || child.height <= 0) continue
            child.getLocationInWindow(location)
            val position = if (horizontal) location[0] else location[1]
            val row = rows[child] ?: Row(position).also { rows[child] = it }
            if (abs(position - row.anchor) >= follow) {
                row.movedAt = now
                row.anchor = position
            }
            seen[child] = true
            if (now - row.movedAt > MOVE_HOLD_MS) continue
            if (overflow.ratio(child) > MAX_OVERFLOW) continue
            moving += child
        }
        val whole = seen.isEmpty()
        val iterator = rows.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            val child = entry.key
            val row = entry.value
            if (!seen.containsKey(child)) {
                if (row.applied != null) child.setRenderEffect(null)
                iterator.remove()
                continue
            }
            val wanted = if (!whole && child in moving) effect else null
            if (row.applied !== wanted) {
                child.setRenderEffect(wanted)
                row.applied = wanted
            }
        }
        return whole
    }

    private fun clearRows() {
        for ((child, row) in rows) if (row.applied != null) child.setRenderEffect(null)
        rows.clear()
    }

    fun clear() {
        positions.clear()
        clearRows()
        setWhole(null)
        level = 0
        ready = false
        signal.reset()
    }
}

private class Watch(val root: View) {
    private val targets = IdentityHashMap<View, Target>()
    private var dirty = true
    private var lastScan = 0L
    private var lastScroll = 0L
    private var closed = false

    private val scrollListener = ViewTreeObserver.OnScrollChangedListener {
        if (!closed) scrolled()
    }

    private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { dirty = true }

    private val drawListener = ViewTreeObserver.OnPreDrawListener {
        if (!closed) draw()
        true
    }

    init {
        root.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
        root.viewTreeObserver.addOnPreDrawListener(drawListener)
        root.viewTreeObserver.addOnScrollChangedListener(scrollListener)
    }

    private fun scrolled() {
        val now = SystemClock.uptimeMillis()
        val idle = now - lastScroll > SCROLL_IDLE_MS
        lastScroll = now
        if (idle || (dirty && now - lastScan >= FAST_SCAN_MS)) scan(now)
        root.postInvalidateOnAnimation()
    }

    private fun draw() {
        val now = SystemClock.uptimeMillis()
        if (dirty && now - lastScan >= SCAN_INTERVAL_MS) scan(now)
        var moving = false
        for (target in targets.values) {
            target.frame(now)
            if (target.level > 0) moving = true
        }
        if (moving) root.postInvalidateOnAnimation()
    }

    private fun scan(now: Long) {
        dirty = false
        lastScan = now
        val found = IdentityHashMap<View, Boolean>()
        val views = ArrayDeque<View>()
        val depths = ArrayDeque<Int>()
        views.addLast(root)
        depths.addLast(0)
        var visited = 0
        while (views.isNotEmpty() && visited < MAX_NODES) {
            val view = views.removeLast()
            val depth = depths.removeLast()
            visited++
            if (view.visibility != View.VISIBLE || view.alpha == 0f) continue
            if (isTarget(view)) found[view] = true
            if (view !is ViewGroup || depth >= MAX_DEPTH) continue
            for (index in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(index) ?: continue
                views.addLast(child)
                depths.addLast(depth + 1)
            }
        }

        val iterator = targets.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (found.remove(entry.key) == null) {
                entry.value.clear()
                iterator.remove()
            }
        }
        for (view in found.keys) targets[view] = Target(view)
    }

    fun refresh() {
        dirty = true
        lastScan = 0L
        root.postInvalidateOnAnimation()
    }

    fun clearEffects() {
        for (target in targets.values) target.clear()
    }

    fun close() {
        if (closed) return
        closed = true
        clearEffects()
        targets.clear()
        val observer = root.viewTreeObserver
        if (observer.isAlive) {
            observer.removeOnGlobalLayoutListener(layoutListener)
            observer.removeOnPreDrawListener(drawListener)
            observer.removeOnScrollChangedListener(scrollListener)
        }
    }
}

private class Engine(private val app: Application) {
    private val handler = Handler(Looper.getMainLooper())
    private val watches = IdentityHashMap<View, Watch>()
    private var activity: WeakReference<Activity>? = null
    private var running = false

    private val discover = object : Runnable {
        override fun run() {
            if (!running) return
            discoverWindows()
            handler.postDelayed(this, WINDOW_INTERVAL_MS)
        }
    }

    private val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) = resume(activity)
        override fun onActivityPaused(activity: Activity) = pause(activity)
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {}
        override fun onActivityStopped(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }

    fun start() {
        app.registerActivityLifecycleCallbacks(callbacks)
    }

    fun attach(current: Activity) {
        if (!current.isFinishing && !current.isDestroyed) resume(current)
    }

    private fun resume(current: Activity) {
        activity = WeakReference(current)
        if (!running) {
            running = true
            handler.post(discover)
        } else {
            discoverWindows()
        }
    }

    private fun pause(current: Activity) {
        if (activity?.get() !== current) return
        running = false
        handler.removeCallbacks(discover)
        closeAll()
    }

    private fun discoverWindows() {
        val current = activity?.get() ?: return
        val roots = LinkedHashSet<View>()
        current.window?.decorView?.let { roots += it }
        runCatching { WindowInspector.getGlobalWindowViews() }.getOrNull()?.forEach { view ->
            if (view.isAttachedToWindow && view.isShown) roots += view
        }
        val iterator = watches.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (entry.key !in roots || !entry.key.isAttachedToWindow) {
                entry.value.close()
                iterator.remove()
            }
        }
        for (root in roots) if (!watches.containsKey(root)) watches[root] = Watch(root)
    }

    fun configChanged() {
        handler.post {
            if (Config.enabled) {
                for (watch in watches.values) watch.refresh()
            } else {
                for (watch in watches.values) watch.clearEffects()
            }
        }
    }

    private fun closeAll() {
        for (watch in watches.values) watch.close()
        watches.clear()
    }

    fun stop() {
        handler.post {
            running = false
            handler.removeCallbacks(discover)
            app.unregisterActivityLifecycleCallbacks(callbacks)
            closeAll()
        }
    }
}

private var engine: Engine? = null

private fun currentApplication(): Application? =
    try {
        Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as? Application
    } catch (_: Throwable) {
        null
    }

private fun ensureEngine(context: Context? = null): Engine? {
    engine?.let { return it }
    if (!supported) return null
    val app = (context?.applicationContext as? Application) ?: currentApplication() ?: return null
    return Engine(app).also {
        it.start()
        engine = it
    }
}

@Suppress("UNUSED")
val motionBlur = plugin {
    start {
        ensureEngine()
        withAppContext { context -> ensureEngine(context) }
        withAppActivity { activity ->
            activity.runOnUiThread { ensureEngine(activity)?.attach(activity) }
        }

        registerNativeAsyncMethod("com.coder.motionblur.configure") { args ->
            Config.enabled = args.getOrNull(0) as? Boolean ?: true
            Config.strength = ((args.getOrNull(1) as? Number)?.toInt() ?: DEFAULT_STRENGTH).coerceIn(0, 100)
            engine?.configChanged()
            supported
        }

        registerNativeAsyncMethod("com.coder.motionblur.isSupported") { supported }
    }

    stop {
        engine?.stop()
        engine = null
    }
}
