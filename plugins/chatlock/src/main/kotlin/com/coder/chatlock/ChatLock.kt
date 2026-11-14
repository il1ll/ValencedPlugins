@file:JvmName("ChatLock")

package com.coder.chatlock

import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Base64
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.io.File
import java.lang.reflect.Method
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import java.util.Properties
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

private const val LEGACY_PREFS = "com.coder.chatlock"
private const val SECRETS_FILE = "secrets.properties"
private const val KEY_SALT = "salt"
private const val KEY_HASH = "hash"
private const val KEY_ITERATIONS = "iterations"
private const val KEY_RECOVERY_SALT = "recoverySalt"
private const val KEY_RECOVERY_HASH = "recoveryHash"
private const val KEY_RECOVERY_ITERATIONS = "recoveryIterations"
private const val ITERATIONS = 120_000
private const val KEY_BITS = 256
private const val SALT_BYTES = 16
private const val MIN_LENGTH = 4
private const val MIN_ANSWER = 1
private const val DEVICE_REQUEST_CODE = 0x4C43
private const val NOTIFICATIONS_FILE = "notifications.properties"
private const val KEY_ENABLED = "enabled"
private const val KEY_LOCKED = "locked"
private const val KEY_HIDDEN = "hidden"
private const val LOCKED_TITLE = "Locked Chat"
private const val LOCKED_TEXT = "New message"

private val mainHandler = Handler(Looper.getMainLooper())

private class SecretStore(private val file: File) {
    private val lock = Any()

    private fun load(): Properties = Properties().also { properties ->
        if (file.isFile) file.inputStream().use { properties.load(it) }
    }

    private fun write(properties: Properties): Boolean = runCatching {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.outputStream().use { properties.store(it, null) }
        if (!temp.renameTo(file)) {
            file.delete()
            check(temp.renameTo(file))
        }
    }.isSuccess

    fun migrate(context: Context) = synchronized(lock) {
        val prefs = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
        if (prefs.all.isEmpty()) return@synchronized
        val properties = load()
        val salt = prefs.getString(KEY_SALT, null)
        val hash = prefs.getString(KEY_HASH, null)
        if (!properties.containsKey(KEY_HASH) && salt != null && hash != null) {
            properties.setProperty(KEY_SALT, salt)
            properties.setProperty(KEY_HASH, hash)
            properties.setProperty(KEY_ITERATIONS, prefs.getInt(KEY_ITERATIONS, ITERATIONS).toString())
            if (!write(properties)) return@synchronized
        }
        prefs.edit().clear().commit()
    }

    fun hasPassword(): Boolean = synchronized(lock) { load().containsKey(KEY_HASH) }

    fun hasRecovery(): Boolean = synchronized(lock) { load().containsKey(KEY_RECOVERY_HASH) }

    fun savePassword(password: String): Boolean = synchronized(lock) {
        if (password.length < MIN_LENGTH) return@synchronized false
        val properties = load()
        put(properties, password, KEY_SALT, KEY_HASH, KEY_ITERATIONS)
        write(properties)
    }

    fun verifyPassword(password: String): Boolean = synchronized(lock) {
        matches(load(), password, KEY_SALT, KEY_HASH, KEY_ITERATIONS)
    }

    fun saveRecovery(answer: String): Boolean = synchronized(lock) {
        val normalized = normalize(answer)
        if (normalized.length < MIN_ANSWER) return@synchronized false
        val properties = load()
        put(properties, normalized, KEY_RECOVERY_SALT, KEY_RECOVERY_HASH, KEY_RECOVERY_ITERATIONS)
        write(properties)
    }

    fun verifyRecovery(answer: String): Boolean = synchronized(lock) {
        matches(load(), normalize(answer), KEY_RECOVERY_SALT, KEY_RECOVERY_HASH, KEY_RECOVERY_ITERATIONS)
    }

    fun clearRecovery(): Boolean = synchronized(lock) {
        val properties = load()
        properties.remove(KEY_RECOVERY_SALT)
        properties.remove(KEY_RECOVERY_HASH)
        properties.remove(KEY_RECOVERY_ITERATIONS)
        write(properties)
    }

    private fun normalize(answer: String) =
        answer.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

    private fun put(properties: Properties, secret: String, saltKey: String, hashKey: String, iterationsKey: String) {
        val salt = ByteArray(SALT_BYTES).also { SecureRandom().nextBytes(it) }
        val hash = derive(secret.toCharArray(), salt, ITERATIONS)
        properties.setProperty(saltKey, Base64.encodeToString(salt, Base64.NO_WRAP))
        properties.setProperty(hashKey, Base64.encodeToString(hash, Base64.NO_WRAP))
        properties.setProperty(iterationsKey, ITERATIONS.toString())
    }

    private fun matches(properties: Properties, secret: String, saltKey: String, hashKey: String, iterationsKey: String): Boolean {
        val salt = properties.getProperty(saltKey) ?: return false
        val hash = properties.getProperty(hashKey) ?: return false
        val iterations = properties.getProperty(iterationsKey)?.toIntOrNull() ?: ITERATIONS
        val expected = Base64.decode(hash, Base64.NO_WRAP)
        val actual = derive(secret.toCharArray(), Base64.decode(salt, Base64.NO_WRAP), iterations)
        return MessageDigest.isEqual(expected, actual)
    }

    private fun derive(secret: CharArray, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(secret, salt, iterations, KEY_BITS)
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
            secret.fill('\u0000')
        }
    }
}

private object DeviceAuth {
    private val hooked = HashSet<Method>()
    private var pending: Continuation<Boolean>? = null

    private fun ensureHook(activity: Activity) {
        val method = runCatching {
            activity.javaClass.getMethod(
                "onActivityResult",
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                Intent::class.java,
            )
        }.getOrNull() ?: return
        if (!hooked.add(method)) return
        XposedBridge.hookMethod(
            method,
            object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    if (param.args.getOrNull(0) != DEVICE_REQUEST_CODE) return
                    val resultCode = param.args.getOrNull(1) as? Int
                    param.result = null
                    val continuation = pending ?: return
                    pending = null
                    continuation.resume(resultCode == Activity.RESULT_OK)
                }
            },
        )
    }

    fun available(context: Context): Boolean =
        (context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isDeviceSecure == true

    suspend fun confirm(activity: Activity, title: String): Boolean {
        val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return false
        if (!keyguard.isDeviceSecure) return false
        @Suppress("DEPRECATION")
        val intent = keyguard.createConfirmDeviceCredentialIntent(title, "Use your fingerprint or screen lock")
            ?: return false
        return suspendCoroutine { continuation ->
            mainHandler.post {
                ensureHook(activity)
                pending?.resume(false)
                pending = continuation
                val started = runCatching {
                    @Suppress("DEPRECATION")
                    activity.startActivityForResult(intent, DEVICE_REQUEST_CODE)
                }.isSuccess
                if (!started && pending === continuation) {
                    pending = null
                    continuation.resume(false)
                }
            }
        }
    }
}

private object NotificationFilter {
    private val tagPattern = Regex("^(MESSAGE_CREATE|FORUM_THREAD_CREATED|CALL_RING_END|CALL_RING)(\\d+)")
    private val messageKinds = setOf("MESSAGE_CREATE", "FORUM_THREAD_CREATED")
    private val contentExtras = listOf(
        "android.messages",
        "android.messages.historic",
        "android.template",
        "android.bigText",
        "android.textLines",
        "android.summaryText",
        "android.infoText",
        "android.subText",
        "android.selfDisplayName",
        "android.messagingUser",
        "android.messagingStyleUser",
        "android.conversationTitle",
        "android.hiddenConversationTitle",
        "android.isGroupConversation",
        "android.picture",
        "android.pictureIcon",
    )

    @Volatile private var enabled = true
    @Volatile private var locked: Set<String> = emptySet()
    @Volatile private var hidden: Set<String> = emptySet()
    private var file: File? = null
    private var unhook: XC_MethodHook.Unhook? = null

    private fun split(value: String?) =
        value.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

    fun load(target: File) = synchronized(this) {
        file = target
        if (!target.isFile) return@synchronized
        val properties = Properties()
        runCatching { target.inputStream().use { properties.load(it) } }
        enabled = properties.getProperty(KEY_ENABLED) != "false"
        locked = split(properties.getProperty(KEY_LOCKED))
        hidden = split(properties.getProperty(KEY_HIDDEN))
    }

    fun update(nextEnabled: Boolean, nextLocked: String?, nextHidden: String?): Boolean = synchronized(this) {
        enabled = nextEnabled
        locked = split(nextLocked)
        hidden = split(nextHidden)
        val target = file ?: return@synchronized false
        val properties = Properties()
        properties.setProperty(KEY_ENABLED, enabled.toString())
        properties.setProperty(KEY_LOCKED, locked.joinToString(","))
        properties.setProperty(KEY_HIDDEN, hidden.joinToString(","))
        runCatching {
            target.parentFile?.mkdirs()
            val temp = File(target.parentFile, "${target.name}.tmp")
            temp.outputStream().use { properties.store(it, null) }
            if (!temp.renameTo(target)) {
                target.delete()
                check(temp.renameTo(target))
            }
        }.isSuccess
    }

    private fun redact(notification: Notification) {
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)
            ?: extras.getCharSequence("android.conversationTitle")
        contentExtras.forEach(extras::remove)
        extras.putCharSequence(Notification.EXTRA_TITLE, title ?: LOCKED_TITLE)
        extras.putCharSequence(Notification.EXTRA_TEXT, LOCKED_TEXT)
        notification.tickerText = null
        notification.publicVersion = null
        @Suppress("DEPRECATION")
        run {
            notification.contentView = null
            notification.bigContentView = null
            notification.headsUpContentView = null
        }
    }

    fun install() = synchronized(this) {
        if (unhook != null) return@synchronized
        val method = NotificationManager::class.java.getMethod(
            "notify",
            String::class.java,
            Int::class.javaPrimitiveType,
            Notification::class.java,
        )
        unhook = XposedBridge.hookMethod(
            method,
            object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    if (!enabled) return
                    val tag = param.args.getOrNull(0) as? String ?: return
                    val match = tagPattern.find(tag) ?: return
                    val kind = match.groupValues[1]
                    val channelId = match.groupValues[2]
                    if (channelId in hidden) {
                        param.result = null
                        return
                    }
                    if (channelId in locked && kind in messageKinds) {
                        val notification = param.args.getOrNull(2) as? Notification ?: return
                        runCatching { redact(notification) }
                    }
                }
            },
        )
    }

    fun uninstall() = synchronized(this) {
        unhook?.unhook()
        unhook = null
    }
}

@Suppress("UNUSED")
val chatLock = plugin {
    start {
        val secrets = SecretStore(File(storageDir, SECRETS_FILE))
        withAppContext { secrets.migrate(it.applicationContext) }
        NotificationFilter.load(File(storageDir, NOTIFICATIONS_FILE))
        NotificationFilter.install()

        suspend fun activity(): Activity = suspendCoroutine { continuation ->
            withAppActivity { continuation.resume(it) }
        }

        fun string(args: List<Any?>, index: Int) = args.getOrNull(index) as? String

        registerNativeAsyncMethod("com.coder.chatlock.syncNotifications") { args ->
            val enabled = args.getOrNull(0) as? Boolean ?: true
            NotificationFilter.update(enabled, string(args, 1), string(args, 2))
        }

        registerNativeAsyncMethod("com.coder.chatlock.hasPassword") {
            secrets.hasPassword()
        }

        registerNativeAsyncMethod("com.coder.chatlock.verifyPassword") { args ->
            val password = string(args, 0) ?: return@registerNativeAsyncMethod false
            secrets.verifyPassword(password)
        }

        registerNativeAsyncMethod("com.coder.chatlock.savePassword") { args ->
            val password = string(args, 0) ?: return@registerNativeAsyncMethod false
            val current = string(args, 1)
            if (secrets.hasPassword() && (current == null || !secrets.verifyPassword(current))) {
                return@registerNativeAsyncMethod false
            }
            secrets.savePassword(password)
        }

        registerNativeAsyncMethod("com.coder.chatlock.hasRecovery") {
            secrets.hasRecovery()
        }

        registerNativeAsyncMethod("com.coder.chatlock.saveRecovery") { args ->
            val answer = string(args, 0) ?: return@registerNativeAsyncMethod false
            secrets.saveRecovery(answer)
        }

        registerNativeAsyncMethod("com.coder.chatlock.clearRecovery") {
            secrets.clearRecovery()
        }

        registerNativeAsyncMethod("com.coder.chatlock.verifyRecovery") { args ->
            val answer = string(args, 0) ?: return@registerNativeAsyncMethod false
            secrets.verifyRecovery(answer)
        }

        registerNativeAsyncMethod("com.coder.chatlock.resetPassword") { args ->
            val password = string(args, 0) ?: return@registerNativeAsyncMethod false
            val answer = string(args, 1) ?: return@registerNativeAsyncMethod false
            if (!secrets.verifyRecovery(answer)) return@registerNativeAsyncMethod false
            secrets.savePassword(password)
        }

        registerNativeAsyncMethod("com.coder.chatlock.deviceAvailable") {
            DeviceAuth.available(activity())
        }

        registerNativeAsyncMethod("com.coder.chatlock.confirmDevice") { args ->
            val title = string(args, 0) ?: "Unlock Chat"
            DeviceAuth.confirm(activity(), title)
        }
    }

    stop {
        NotificationFilter.uninstall()
    }
}
