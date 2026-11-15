@file:JvmName("TextAnimationPlugin")

package com.coder.textanimation

import android.graphics.Canvas
import android.widget.EditText
import android.widget.TextView
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeMethod
import org.json.JSONObject
import java.io.File

internal object Settings {
	@Volatile var typing = true
	@Volatile var duration = 320
	@Volatile var slide = true
	@Volatile var slideDp = 10
	@Volatile var blur = true
	@Volatile var pop = false
	@Volatile var tilt = false
	@Volatile var popAmount = 100
	@Volatile var tiltAmount = 100
	@Volatile var deleteFx = "drop"
	@Volatile var cursor = true
	@Volatile var cursorTrail = true
	@Volatile var cursorSpeed = 18
	@Volatile var everywhere = false
	@Volatile var preview = false
}

private const val SETTINGS_FILE = "settings.json"
private const val CHAT_INPUT = "com.discord.chat.input.views.DCDChatInput"
private val DELETE_FX = setOf("off", "drop", "dust")
private val unhooks = mutableListOf<XC_MethodHook.Unhook>()
private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

private fun settingsMap() = mapOf(
	"cursorSupported" to (android.os.Build.VERSION.SDK_INT >= 29),
	"typing" to Settings.typing,
	"duration" to Settings.duration,
	"slide" to Settings.slide,
	"slideDp" to Settings.slideDp,
	"blur" to Settings.blur,
	"pop" to Settings.pop,
	"tilt" to Settings.tilt,
	"popAmount" to Settings.popAmount,
	"tiltAmount" to Settings.tiltAmount,
	"deleteFx" to Settings.deleteFx,
	"cursor" to Settings.cursor,
	"cursorTrail" to Settings.cursorTrail,
	"cursorSpeed" to Settings.cursorSpeed,
	"everywhere" to Settings.everywhere,
)

private fun applySettings(get: (String) -> Any?) {
	(get("typing") as? Boolean)?.let { Settings.typing = it }
	(get("duration") as? Number)?.let { Settings.duration = it.toInt().coerceIn(120, 900) }
	(get("slide") as? Boolean)?.let { Settings.slide = it }
	(get("slideDp") as? Number)?.let { Settings.slideDp = it.toInt().coerceIn(2, 30) }
	(get("blur") as? Boolean)?.let { Settings.blur = it }
	(get("pop") as? Boolean)?.let { Settings.pop = it }
	(get("tilt") as? Boolean)?.let { Settings.tilt = it }
	(get("popAmount") as? Number)?.let { Settings.popAmount = it.toInt().coerceIn(25, 200) }
	(get("tiltAmount") as? Number)?.let { Settings.tiltAmount = it.toInt().coerceIn(25, 200) }
	(get("deleteFx") as? String)?.takeIf { it in DELETE_FX }?.let { Settings.deleteFx = it }
	(get("cursor") as? Boolean)?.let { Settings.cursor = it }
	(get("cursorTrail") as? Boolean)?.let { Settings.cursorTrail = it }
	(get("cursorSpeed") as? Number)?.let { Settings.cursorSpeed = it.toInt().coerceIn(6, 40) }
	(get("everywhere") as? Boolean)?.let { Settings.everywhere = it }
}

private val drawHook = object : XC_MethodHook() {
	override fun beforeHookedMethod(param: MethodHookParam) {
		val view = param.thisObject as? EditText ?: return
		runCatching {
			if (TypingFx.handles(view)) TypingFx.beforeDraw(view) else TypingFx.release(view)
		}.onFailure { XposedBridge.log("[TextAnimation] before draw failed: $it") }
	}

	override fun afterHookedMethod(param: MethodHookParam) {
		val view = param.thisObject as? EditText ?: return
		val canvas = param.args[0] as? Canvas ?: return
		runCatching { if (TypingFx.handles(view)) TypingFx.afterDraw(view, canvas) }
			.onFailure { XposedBridge.log("[TextAnimation] after draw failed: $it") }
	}
}

val textAnimationPlugin = plugin {
	start {
		val file = File(storageDir, SETTINGS_FILE)
		if (file.exists()) {
			runCatching {
				val json = JSONObject(file.readText())
				applySettings { key -> if (json.has(key)) json.get(key) else null }
			}.onFailure { log.w("could not read settings: ${it.message}") }
		}

		fun save() = runCatching {
			val json = JSONObject()
			for ((key, value) in settingsMap()) if (key != "cursorSupported") json.put(key, value)
			file.writeText(json.toString())
		}.onFailure { log.w("could not save settings: ${it.message}") }

		TypingFx.chatInputClass = runCatching { classLoader.loadClass(CHAT_INPUT) }
			.onFailure { log.w("$CHAT_INPUT not found; only 'every text field' will animate") }
			.getOrNull()

		runCatching {
			val onDraw = TextView::class.java.getDeclaredMethod("onDraw", Canvas::class.java)
			unhooks += XposedBridge.hookMethod(onDraw, drawHook)
		}.onFailure {
			log.e("could not hook TextView.onDraw", it)
			errors.tryEmit(it)
		}

		registerNativeMethod("${manifest.id}.getSettings") { _ -> settingsMap() }
		registerNativeMethod("${manifest.id}.setSettings") { args ->
			val patch = args.firstOrNull() as? Map<*, *> ?: emptyMap<Any, Any>()
			applySettings { patch[it] }
			save()
			mainHandler.post { runCatching { TypingFx.invalidateAll() } }
			settingsMap()
		}
		registerNativeMethod("${manifest.id}.setPreview") { args ->
			Settings.preview = args.firstOrNull() as? Boolean ?: false
			true
		}
	}

	stop {
		unhooks.forEach { it.unhook() }
		unhooks.clear()
		Settings.preview = false
		mainHandler.post { runCatching { TypingFx.releaseAll() } }
	}
}
