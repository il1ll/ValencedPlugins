@file:JvmName("StreamButton")

package com.coder.streambutton

import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.media.projection.MediaProjectionManager
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.reflect.Modifier
import java.util.Locale
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull

private const val SERVICE_CLASS = "com.discord.foreground_service.ForegroundService"
private const val MEDIA_ENGINE_MODULE_CLASS = "com.discord.media.engine.MediaEngineModule"
private const val HOST_COMPONENT = "com.google.android.play.core.common.PlayCoreDialogWrapperActivity"
private const val ACTIVITY_EVENT_LISTENER_CLASS = "com.facebook.react.bridge.ActivityEventListener"

private const val EXTRA_HOST = "com.coder.streambutton.HOST"
private const val EXTRA_CONFIRMATION = "confirmation_intent"
private const val EXTRA_PERMISSION_TYPE = "permissionType"
private const val EXTRA_STOP = "com.coder.streambutton.STOP"

private const val VOICE_NOTIFICATION_ID = 8761
private const val TYPE_VOICE_CALL = 1
private const val TYPE_SCREEN_SHARE = 2
private const val SCREENSHARE_REQUEST_CODE = 420

private const val COMMAND_STOP = "stop"
private const val COMMAND_SHUTDOWN = "shutdown"

private const val LABEL_SHARE = "Share Screen"
private const val LABEL_STOP = "Stop Sharing"

private val REPLACED_LABELS = setOf("deafen", "undeafen")

private const val START_REQUEST_CODE = 0x60_1200
private const val STOP_REQUEST_CODE = 0x60_1201
private const val CAPTURE_REQUEST_CODE = 0x60_1202
private const val WAIT_MS = 25_000L

private class StreamButtonController(private val context: Context) {
    val actions = Channel<String>(Channel.UNLIMITED)
    private val unhooks = mutableListOf<XC_MethodHook.Unhook>()

    @Volatile
    private var notificationId: Int? = null

    @Volatile
    private var sharing = false

    @Volatile
    private var mediaEngineModule: Any? = null


    private fun deliverResult(activity: Activity, resultCode: Int, data: Intent?) {
        val module = mediaEngineModule ?: return
        runCatching {
            val field = module.javaClass.getDeclaredField("activityEventListener").apply { isAccessible = true }
            val listener = field.get(module) ?: return@runCatching
            val listenerClass = context.classLoader.loadClass(ACTIVITY_EVENT_LISTENER_CLASS)
            val method = listenerClass.getMethod(
                "onActivityResult",
                Activity::class.java,
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                Intent::class.java,
            )
            method.invoke(listener, activity, SCREENSHARE_REQUEST_CODE, resultCode, data)
        }
    }

    private fun captureIntent(): PendingIntent? {
        val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager ?: return null
        return runCatching {
            PendingIntent.getActivity(
                context,
                CAPTURE_REQUEST_CODE,
                manager.createScreenCaptureIntent(),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }.getOrNull()
    }

    private fun startIntent(): PendingIntent? {
        val capture = captureIntent() ?: return null
        val intent = hostIntent(EXTRA_HOST) { putExtra(EXTRA_CONFIRMATION, capture) }
        return runCatching {
            PendingIntent.getActivity(
                context,
                START_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }.getOrNull()
    }

    private fun hostIntent(extra: String, configure: Intent.() -> Unit = {}): Intent =
        Intent().apply {
            setClassName(context.packageName, HOST_COMPONENT)
            putExtra(extra, true)
            configure()
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION,
            )
        }

    private fun stopIntent(): PendingIntent? =
        runCatching {
            PendingIntent.getActivity(
                context,
                STOP_REQUEST_CODE,
                hostIntent(EXTRA_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }.getOrNull()

    private fun actionFor(streaming: Boolean): Notification.Action? {
        val pendingIntent = (if (streaming) stopIntent() else startIntent()) ?: return null
        val icon = if (streaming) android.R.drawable.ic_media_pause else android.R.drawable.ic_menu_slideshow
        val label = if (streaming) LABEL_STOP else LABEL_SHARE
        return Notification.Action.Builder(Icon.createWithResource("android", icon), label, pendingIntent).build()
    }

    private fun Notification.Action.isOurs(): Boolean {
        val title = title?.toString() ?: return false
        return title == LABEL_SHARE || title == LABEL_STOP
    }

    private fun addButton(notification: Notification) {
        runCatching {
            val current = notification.actions ?: return
            if (current.isEmpty()) return

            val type = notification.extras?.getInt(EXTRA_PERMISSION_TYPE, -1) ?: -1
            when (type) {
                TYPE_VOICE_CALL -> sharing = false
                TYPE_SCREEN_SHARE -> sharing = true
            }

            val existing = current.indexOfFirst { it.isOurs() }
            if (existing < 0 && type != TYPE_VOICE_CALL && type != TYPE_SCREEN_SHARE) {
                val last = current.last().title?.toString()?.trim()?.lowercase(Locale.ROOT)
                if (last !in REPLACED_LABELS) return
            }

            val action = actionFor(sharing) ?: return
            val index = if (existing >= 0) existing else current.lastIndex
            notification.actions = current.copyOf().also { it[index] = action }
        }
    }

    fun install() {
        unhooks += XposedBridge.hookAllMethods(
            Service::class.java,
            "startForeground",
            object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    if (param.thisObject?.javaClass?.name != SERVICE_CLASS) return
                    val id = param.args.getOrNull(0) as? Int
                    val notification = param.args.getOrNull(1) as? Notification ?: return
                    if (id != null) notificationId = id
                    addButton(notification)
                }
            },
        )

        unhooks += XposedBridge.hookAllMethods(
            NotificationManager::class.java,
            "notify",
            object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    val args = param.args
                    val id = args.firstOrNull { it is Int } as? Int ?: return
                    if (id != (notificationId ?: VOICE_NOTIFICATION_ID)) return
                    val notification = args.firstOrNull { it is Notification } as? Notification ?: return
                    addButton(notification)
                }
            },
        )

        runCatching {
            val hostClass = context.classLoader.loadClass(HOST_COMPONENT)
            unhooks += XposedBridge.hookAllMethods(
                hostClass,
                "onCreate",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val activity = param.thisObject as? Activity ?: return
                        if (activity.intent?.getBooleanExtra(EXTRA_STOP, false) != true) return
                        sharing = false
                        actions.trySend(COMMAND_STOP)
                    }

                    override fun afterHookedMethod(param: MethodHookParam) {
                        val activity = param.thisObject as? Activity ?: return
                        if (activity.intent?.getBooleanExtra(EXTRA_STOP, false) != true) return
                        activity.finishAndRemoveTask()
                    }
                },
            )
            unhooks += XposedBridge.hookAllMethods(
                hostClass,
                "onActivityResult",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val activity = param.thisObject as? Activity ?: return
                        if (activity.intent?.getBooleanExtra(EXTRA_HOST, false) != true) return
                        val resultCode = param.args.getOrNull(1) as? Int ?: return
                        val data = param.args.getOrNull(2) as? Intent
                        param.result = null
                        deliverResult(activity, resultCode, data)
                        activity.finishAndRemoveTask()
                    }
                },
            )
        }

        runCatching {
            val moduleClass = context.classLoader.loadClass(MEDIA_ENGINE_MODULE_CLASS)
            val capture = object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    param.thisObject?.let { mediaEngineModule = it }
                }
            }
            for (method in moduleClass.declaredMethods) {
                if (Modifier.isStatic(method.modifiers) || Modifier.isAbstract(method.modifiers)) continue
                runCatching { unhooks += XposedBridge.hookMethod(method, capture) }
            }
        }
    }

    fun uninstall() {
        for (unhook in unhooks) unhook.unhook()
        unhooks.clear()
        actions.trySend(COMMAND_SHUTDOWN)
    }
}

private var controller: StreamButtonController? = null

private fun currentApplication(): Context? =
    try {
        Class.forName("android.app.ActivityThread").getMethod("currentApplication").invoke(null) as? Context
    } catch (_: Throwable) {
        null
    }

private fun ensureController(context: Context? = null): StreamButtonController? {
    controller?.let { return it }
    val appContext = (context ?: currentApplication())?.applicationContext ?: return null
    return StreamButtonController(appContext).also {
        it.install()
        controller = it
    }
}

@Suppress("UNUSED")
val streamButton = plugin {
    start {
        ensureController()
        withAppContext { context -> ensureController(context) }

        registerNativeAsyncMethod("com.coder.streambutton.nextAction") {
            val current = ensureController() ?: return@registerNativeAsyncMethod "none"
            withTimeoutOrNull(WAIT_MS) { current.actions.receive() } ?: "none"
        }
    }

    stop {
        controller?.uninstall()
        controller = null
    }
}
