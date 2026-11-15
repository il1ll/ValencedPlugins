package com.coder.textanimation

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.icu.text.BreakIterator
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.Layout
import android.text.Spanned
import android.text.TextPaint
import android.text.method.PasswordTransformationMethod
import android.text.style.CharacterStyle
import android.text.style.ReplacementSpan
import android.text.style.UpdateAppearance
import android.view.Gravity
import android.widget.EditText
import android.widget.TextView
import java.util.WeakHashMap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

internal class HideSpan : CharacterStyle(), UpdateAppearance {
	override fun updateDrawState(tp: TextPaint) {
		tp.color = Color.TRANSPARENT
		tp.clearShadowLayer()
	}
}

internal class Glyph(var start: Int, var end: Int, val born: Long) {
	val span = HideSpan()
}

internal class Bit(
	val text: String?,
	var x: Float,
	var y: Float,
	var vx: Float,
	var vy: Float,
	var angle: Float,
	val spin: Float,
	val size: Float,
	val born: Long,
	val life: Long,
	val color: Int,
	val gravity: Float,
)

internal class FieldState {
	var prev: String? = null
	val glyphs = ArrayList<Glyph>()
	val bits = ArrayList<Bit>()
	var lastFrame = 0L

	var curX = Float.NaN
	var curTop = 0f
	var curBottom = 0f
	var trailX = 0f
	var targetX = Float.NaN
	var targetTop = Float.NaN
	var lastMove = 0L
	var direction = 0

	var blank: Drawable? = null
	var original: Drawable? = null
	var cursorColor = 0
}

internal object TypingFx {
	private val states = WeakHashMap<TextView, FieldState>()
	private val breaks: BreakIterator = BreakIterator.getCharacterInstance()
	private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
	private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
	private val rect = RectF()
	private val box = RectF()
	private val path = Path()
	private val blurs = HashMap<Int, BlurMaskFilter>()

	private const val MAX_ANIMATED = 150
	private const val MAX_CLEAR_EFFECT = 3
	private const val MAX_BITS = 220

	@Volatile var chatInputClass: Class<*>? = null

	fun handles(view: TextView): Boolean {
		if (view !is EditText) return false
		if (!Settings.typing && !Settings.cursor && Settings.deleteFx == "off") return false
		if (view.transformationMethod is PasswordTransformationMethod) return false
		val variation = view.inputType and InputType.TYPE_MASK_VARIATION
		if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
			variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
			variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
			variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
		) return false
		return view.javaClass === chatInputClass || Settings.everywhere || Settings.preview
	}

	fun release(view: TextView) {
		val st = states.remove(view) ?: return
		reset(view, st)
	}

	fun releaseAll() {
		for ((view, st) in states.entries.toList()) reset(view, st)
		states.clear()
	}

	fun invalidateAll() {
		for (view in states.keys.toList()) view.invalidate()
	}

	private fun reset(view: TextView, st: FieldState) {
		(view.text as? Editable)?.let { text -> st.glyphs.forEach { text.removeSpan(it.span) } }
		st.glyphs.clear()
		st.bits.clear()
		restoreCursor(view, st)
		view.invalidate()
	}

	fun beforeDraw(view: TextView) {
		val st = states.getOrPut(view) { FieldState() }
		val text = view.text as? Editable ?: return
		val layout = view.layout ?: return
		val now = SystemClock.uptimeMillis()

		updateCursorDrawable(view, st)

		val current = text.toString()
		val old = st.prev
		st.prev = current
		if (old != null && old != current) onEdit(view, st, layout, old, current, now)

		syncSpans(text, st)
	}

	private fun onEdit(view: TextView, st: FieldState, layout: Layout, old: String, now: String, time: Long) {
		var start = 0
		val shared = min(old.length, now.length)
		while (start < shared && old[start] == now[start]) start++
		var tail = 0
		while (tail < old.length - start && tail < now.length - start &&
			old[old.length - 1 - tail] == now[now.length - 1 - tail]
		) tail++

		breaks.setText(now)
		var insEnd = now.length - tail
		if (start > 0 && start < now.length && !breaks.isBoundary(start)) start = max(0, breaks.preceding(start))
		if (insEnd < now.length && !breaks.isBoundary(insEnd)) {
			val next = breaks.following(insEnd)
			if (next != BreakIterator.DONE) insEnd = next
		}
		val delEnd = old.length - (now.length - insEnd)
		val delta = (insEnd - start) - (delEnd - start)

		val text = view.text as Editable
		val iter = st.glyphs.iterator()
		while (iter.hasNext()) {
			val g = iter.next()
			when {
				g.end <= start -> Unit
				g.start >= delEnd -> { g.start += delta; g.end += delta }
				else -> { text.removeSpan(g.span); iter.remove() }
			}
		}

		if (delEnd > start && Settings.deleteFx != "off" && !(now.isEmpty() && delEnd - start > MAX_CLEAR_EFFECT)) {
			spawnDeleted(view, st, layout, start, old.substring(start, delEnd), time)
		}

		if (insEnd > start && Settings.typing) {
			val clusters = ArrayList<IntArray>()
			var at = start
			while (at < insEnd && clusters.size <= MAX_ANIMATED) {
				val next = breaks.following(at).let { if (it == BreakIterator.DONE || it > insEnd) insEnd else it }
				if (!now.substring(at, next).isBlank()) clusters += intArrayOf(at, next)
				at = next
			}
			if (clusters.size in 1..MAX_ANIMATED) {
				val stagger = if (clusters.size > 1) min(32L, 520L / clusters.size) else 0L
				clusters.forEachIndexed { n, (s, e) -> st.glyphs += Glyph(s, e, time + stagger * n) }
			}
		}
	}

	private fun syncSpans(text: Editable, st: FieldState) {
		val iter = st.glyphs.iterator()
		while (iter.hasNext()) {
			val g = iter.next()
			if (g.end > text.length || g.start >= g.end) {
				text.removeSpan(g.span)
				iter.remove()
				continue
			}
			if (text.getSpans(g.start, g.end, ReplacementSpan::class.java).isNotEmpty()) {
				text.removeSpan(g.span)
				iter.remove()
				continue
			}
			val placed = text.getSpanStart(g.span) == g.start && text.getSpanEnd(g.span) == g.end
			val last = !placed || text.getSpans(g.start, g.end, CharacterStyle::class.java)
				.lastOrNull { text.getSpanStart(it) <= g.start && text.getSpanEnd(it) >= g.end } === g.span
			if (!placed || !last) {
				text.removeSpan(g.span)
				text.setSpan(g.span, g.start, g.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
			}
		}
	}

	private fun spawnDeleted(view: TextView, st: FieldState, layout: Layout, at: Int, gone: String, time: Long) {
		val ox = view.compoundPaddingLeft.toFloat()
		val oy = (view.extendedPaddingTop + verticalOffset(view, layout)).toFloat()
		val line = layout.getLineForOffset(at.coerceAtMost(view.text.length))
		var x = ox + layout.getPrimaryHorizontal(at.coerceAtMost(view.text.length))
		val baseline = oy + layout.getLineBaseline(line)
		val dp = view.resources.displayMetrics.density
		val color = view.currentTextColor
		paint.set(view.paint)

		val rtl = isRtl(gone)
		breaks.setText(gone)
		var from = 0
		var clusters = 0
		while (from < gone.length && clusters < 24) {
			val to = breaks.following(from).let { if (it == BreakIterator.DONE) gone.length else it }
			val piece = gone.substring(from, to)
			from = to
			if (piece.contains('\n')) break
			val w = paint.measureText(piece)
			if (rtl) x -= w
			if (!piece.isBlank()) {
				clusters++
				if (Settings.deleteFx == "drop") {
					st.bits += Bit(
						text = piece, x = x, y = baseline,
						vx = Random.nextFloat() * 70f * dp - 35f * dp,
						vy = -(40f + Random.nextFloat() * 70f) * dp,
						angle = 0f, spin = Random.nextFloat() * 360f - 180f,
						size = 0f, born = time, life = 620L, color = color, gravity = 900f * dp,
					)
				} else {
					val cx = x + w / 2
					val cy = baseline - paint.textSize * 0.35f
					repeat(7) {
						val a = Random.nextFloat() * 2 * PI.toFloat()
						val speed = (35f + Random.nextFloat() * 110f) * dp
						st.bits += Bit(
							text = null,
							x = cx + (Random.nextFloat() - 0.5f) * w,
							y = cy + (Random.nextFloat() - 0.5f) * paint.textSize * 0.5f,
							vx = cos(a) * speed, vy = kotlin.math.sin(a) * speed - 40f * dp,
							angle = 0f, spin = 0f, size = (1.2f + Random.nextFloat() * 1.8f) * dp,
							born = time, life = 380L + Random.nextLong(220L), color = color, gravity = -60f * dp,
						)
					}
				}
			}
			if (!rtl) x += w
		}
		while (st.bits.size > MAX_BITS) st.bits.removeAt(0)
	}

	fun afterDraw(view: TextView, canvas: Canvas) {
		val st = states[view] ?: return
		val layout = view.layout ?: return
		val text = view.text as? Editable ?: return
		val now = SystemClock.uptimeMillis()
		val dt = if (st.lastFrame == 0L) 16f else (now - st.lastFrame).coerceIn(1L, 50L).toFloat()
		st.lastFrame = now

		val ox = view.compoundPaddingLeft.toFloat()
		val oy = (view.extendedPaddingTop + verticalOffset(view, layout)).toFloat()
		val dp = view.resources.displayMetrics.density

		val save = canvas.save()
		canvas.clipRect(
			(view.scrollX + view.compoundPaddingLeft).toFloat(),
			(view.scrollY + view.extendedPaddingTop).toFloat(),
			(view.scrollX + view.width - view.compoundPaddingRight).toFloat(),
			(view.scrollY + view.height - view.extendedPaddingBottom).toFloat(),
		)
		val waiting = drawGlyphs(view, st, text, layout, canvas, ox, oy, dp, now)
		val caretMoving = drawCursor(view, st, layout, canvas, ox, oy, dp, now, dt)
		canvas.restoreToCount(save)
		drawBits(st, canvas, now, dt)

		when {
			waiting || st.bits.isNotEmpty() || caretMoving -> view.postInvalidateOnAnimation()
			cursorShown(view) -> view.postInvalidateDelayed(40)
		}
	}

	private fun drawGlyphs(
		view: TextView, st: FieldState, text: Editable, layout: Layout,
		canvas: Canvas, ox: Float, oy: Float, dp: Float, now: Long,
	): Boolean {
		if (st.glyphs.isEmpty()) return false
		val duration = Settings.duration.toFloat()
		val iter = st.glyphs.iterator()
		while (iter.hasNext()) {
			val g = iter.next()
			val age = now - g.born
			if (age < 0) continue
			val p = (age / duration).coerceIn(0f, 1f)
			if (g.end > text.length) { iter.remove(); continue }

			paint.set(view.paint)
			paint.color = view.currentTextColor
			for (span in text.getSpans(g.start, g.end, CharacterStyle::class.java)) {
				if (span is HideSpan) continue
				runCatching { span.updateDrawState(paint) }
			}
			val e = 1f - (1f - p).pow(3)
			val moves = Settings.pop || Settings.tilt
			val f = if (moves) 1f - (1f - min(1f, p * 2.5f)).pow(3) else e
			paint.alpha = (paint.alpha * f).toInt().coerceIn(0, 255)
			paint.maskFilter = if (Settings.blur) blur((8f * dp * (1f - f)).toInt()) else null

			val line = layout.getLineForOffset(g.start)
			val baseline = oy + layout.getLineBaseline(line)
			val rtl = layout.isRtlCharAt(g.start)
			val contextStart = min(g.start, layout.getLineStart(line))
			val contextEnd = max(g.end, layout.getLineEnd(line)).coerceAtMost(text.length)
			val w = paint.getRunAdvance(text, g.start, g.end, contextStart, contextEnd, rtl, g.end)
			val x = ox + glyphLeft(layout, g.start, g.end, rtl, w)
			val cx = x + w / 2
			val cy = baseline - paint.textSize * 0.33f

			canvas.save()
			if (Settings.tilt) {
				val angle = -40f * (Settings.tiltAmount / 100f) * (1f - p).pow(1.2f) * cos(p * 3.5f * PI.toFloat())
				canvas.rotate(angle, cx, baseline)
			}
			if (Settings.pop) {
				val k = Settings.popAmount / 100f
				val from = max(0.02f, 1f - 0.9f * k)
				val s = from + (1f - from) * backOut(p, 4f * k)
				canvas.scale(s, s, cx, cy)
			}
			val dy = if (Settings.slide) Settings.slideDp * dp * (1f - e) else 0f
			canvas.drawTextRun(text, g.start, g.end, contextStart, contextEnd, x, baseline + dy, rtl, paint)
			canvas.restore()
			paint.maskFilter = null

			if (p >= 1f) {
				text.removeSpan(g.span)
				iter.remove()
			}
		}
		return st.glyphs.isNotEmpty()
	}

	private fun drawBits(st: FieldState, canvas: Canvas, now: Long, dt: Float) {
		if (st.bits.isEmpty()) return
		val seconds = dt / 1000f
		val iter = st.bits.iterator()
		while (iter.hasNext()) {
			val b = iter.next()
			val t = (now - b.born).toFloat() / b.life
			if (t >= 1f) { iter.remove(); continue }
			b.vy += b.gravity * seconds
			b.x += b.vx * seconds
			b.y += b.vy * seconds
			b.angle += b.spin * seconds
			val alpha = ((1f - t * t) * Color.alpha(b.color)).toInt().coerceIn(0, 255)
			if (b.text != null) {
				paint.color = b.color
				paint.alpha = alpha
				val w = paint.measureText(b.text)
				canvas.save()
				canvas.rotate(b.angle, b.x + w / 2, b.y - paint.textSize * 0.33f)
				canvas.drawText(b.text, b.x, b.y, paint)
				canvas.restore()
			} else {
				dotPaint.color = b.color
				dotPaint.alpha = alpha
				canvas.drawCircle(b.x, b.y, b.size * (1f - t * 0.5f), dotPaint)
			}
		}
	}

	private fun cursorShown(view: TextView) =
		Settings.cursor && Build.VERSION.SDK_INT >= 29 && view.isFocused &&
			view.selectionStart >= 0 && view.selectionStart == view.selectionEnd

	private fun updateCursorDrawable(view: TextView, st: FieldState) {
		if (Build.VERSION.SDK_INT < 29) return
		if (!Settings.cursor) {
			restoreCursor(view, st)
			return
		}
		val current = view.textCursorDrawable
		if (current != null && current === st.blank) return
		st.original = current
		st.cursorColor = (current as? GradientDrawable)?.color?.defaultColor ?: view.currentTextColor
		val width = current?.intrinsicWidth?.takeIf { it > 0 } ?: (2 * view.resources.displayMetrics.density).toInt()
		val blank = GradientDrawable().apply {
			setColor(Color.TRANSPARENT)
			setSize(width, 1)
		}
		st.blank = blank
		view.setTextCursorDrawable(blank)
	}

	private fun restoreCursor(view: TextView, st: FieldState) {
		if (Build.VERSION.SDK_INT < 29) return
		val blank = st.blank ?: return
		if (view.textCursorDrawable === blank) view.setTextCursorDrawable(st.original)
		st.blank = null
		st.original = null
		st.curX = Float.NaN
	}

	private fun drawCursor(
		view: TextView, st: FieldState, layout: Layout,
		canvas: Canvas, ox: Float, oy: Float, dp: Float, now: Long, dt: Float,
	): Boolean {
		if (!cursorShown(view) || st.blank == null) {
			st.curX = Float.NaN
			return false
		}
		val sel = view.selectionStart.coerceAtMost(view.text.length)
		val line = layout.getLineForOffset(sel)
		val baseline = oy + layout.getLineBaseline(line)
		val fm = view.paint.fontMetrics
		val tx = ox + layout.getPrimaryHorizontal(sel)
		val top = baseline + fm.ascent
		val bottom = baseline + fm.descent

		if (tx != st.targetX || top != st.targetTop) {
			st.targetX = tx
			st.targetTop = top
			st.lastMove = now
		}
		val direction = layout.getParagraphDirection(line)
		if (direction != st.direction) {
			st.direction = direction
			st.curX = Float.NaN
		}
		if (st.curX.isNaN()) {
			st.curX = tx; st.trailX = tx; st.curTop = top; st.curBottom = bottom
			st.lastMove = now
		}

		val rate = Settings.cursorSpeed.toFloat()
		val k = 1f - exp(-rate * dt / 1000f)
		st.curX += (tx - st.curX) * k
		st.curTop += (top - st.curTop) * k
		st.curBottom += (bottom - st.curBottom) * k
		st.trailX = if (Settings.cursorTrail) st.trailX + (st.curX - st.trailX) * (1f - exp(-rate * 0.4f * dt / 1000f)) else st.curX

		val since = now - st.lastMove
		val alpha = if (since < 500) 1f else (0.5f + 0.5f * cos(2 * PI * (since - 500) / 1100.0).toFloat())

		val half = max(1f, dp)
		val stretch = abs(st.curX - st.trailX)
		val height = st.curBottom - st.curTop
		val squash = min(stretch / (height * 4f), 0.3f) * height
		rect.set(
			min(st.curX, st.trailX) - half,
			st.curTop + squash / 2,
			max(st.curX, st.trailX) + half,
			st.curBottom - squash / 2,
		)
		dotPaint.color = st.cursorColor
		dotPaint.alpha = (Color.alpha(st.cursorColor) * alpha).toInt().coerceIn(0, 255)
		canvas.drawRoundRect(rect, half, half, dotPaint)

		return abs(tx - st.curX) > 0.3f || abs(top - st.curTop) > 0.3f || stretch > 0.3f
	}

	private fun glyphLeft(layout: Layout, start: Int, end: Int, rtl: Boolean, width: Float): Float {
		path.reset()
		layout.getSelectionPath(start, end, path)
		path.computeBounds(box, true)
		if (box.width() > 0f) return box.left
		val edge = layout.getPrimaryHorizontal(start)
		return if (rtl) edge - width else edge
	}

	private fun isRtl(text: String): Boolean {
		for (char in text) {
			when (Character.getDirectionality(char)) {
				Character.DIRECTIONALITY_RIGHT_TO_LEFT,
				Character.DIRECTIONALITY_RIGHT_TO_LEFT_ARABIC -> return true
				Character.DIRECTIONALITY_LEFT_TO_RIGHT -> return false
			}
		}
		return false
	}

	private fun verticalOffset(view: TextView, layout: Layout): Int {
		val gravity = view.gravity and Gravity.VERTICAL_GRAVITY_MASK
		if (gravity == Gravity.TOP) return 0
		val box = view.measuredHeight - view.extendedPaddingTop - view.extendedPaddingBottom
		val height = layout.height
		if (height >= box) return 0
		return if (gravity == Gravity.BOTTOM) box - height else (box - height) / 2
	}

	private fun blur(radius: Int): BlurMaskFilter? =
		if (radius < 1) null else blurs.getOrPut(radius) { BlurMaskFilter(radius.toFloat(), BlurMaskFilter.Blur.NORMAL) }

	private fun backOut(t: Float, c: Float): Float {
		val u = t - 1f
		return 1f + (c + 1f) * u * u * u + c * u * u
	}
}
