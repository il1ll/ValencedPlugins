@file:JvmName("FilePreview")

package com.coder.filepreview

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipException
import java.util.zip.ZipFile

private const val MAX_ZIP_BYTES = 50L * 1024 * 1024
private const val MAX_ENTRIES = 1000
private const val MAX_PREVIEW_BYTES = 10L * 1024 * 1024
private const val MAX_TEXT_CHARS = 200_000
private const val BUFFER_SIZE = 64 * 1024
private const val TIMEOUT_MS = 20_000
private const val MAX_REDIRECTS = 3
private const val CACHE_FOLDER = "com.coder.filepreview"
private const val SAVE_FOLDER = "Discord"

private val attachmentHosts = setOf("cdn.discordapp.com", "media.discordapp.net")
private val keyPattern = Regex("^[0-9a-f]{64}$")
private val imageExtensions = setOf("png", "jpg", "jpeg", "gif", "webp", "avif", "bmp")
private val textExtensions = setOf(
    "asm", "bash", "bat", "c", "cc", "cfg", "cjs", "clj", "cmake", "conf", "cpp", "cs", "css", "csv", "cxx",
    "dart", "diff", "env", "erl", "ex", "exs", "fish", "fs", "go", "gradle", "graphql", "groovy", "h", "hpp",
    "hs", "htm", "html", "ini", "java", "jl", "js", "json", "json5", "jsonc", "jsx", "kt", "kts", "less", "lisp",
    "log", "lua", "m", "makefile", "md", "mjs", "ml", "nim", "nix", "patch", "php", "pl", "properties", "ps1",
    "py", "pyw", "r", "rb", "rs", "rst", "sass", "scala", "scss", "sh", "sql", "svelte", "svg", "swift", "tex",
    "toml", "ts", "tsv", "tsx", "txt", "vb", "vue", "xml", "yaml", "yml", "zig", "zsh",
)

private class PreviewError(message: String) : Exception(message)

private fun normalize(path: String) = path.replace('\\', '/').trimStart('/')

private fun fileName(path: String) = path.substringAfterLast('/').ifEmpty { path }

private fun extension(path: String): String {
    val name = fileName(path)
    val dot = name.lastIndexOf('.')
    return if (dot == -1) "" else name.substring(dot + 1).lowercase()
}

private fun kindOf(extension: String, size: Long): String = when {
    size > MAX_PREVIEW_BYTES -> "unsupported"
    extension in imageExtensions -> "image"
    extension in textExtensions -> "text"
    else -> "unsupported"
}

private fun sha256(value: String): String =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

private fun attachmentPath(url: String): String {
    val uri = runCatching { URI(url) }.getOrNull() ?: throw PreviewError("Invalid attachment link.")
    if (uri.scheme != "https" || uri.host !in attachmentHosts) throw PreviewError("Only Discord attachments can be previewed.")
    val path = uri.rawPath ?: throw PreviewError("Invalid attachment link.")
    if (!path.startsWith("/attachments/") || path.contains("..") || path.contains('\\')) {
        throw PreviewError("Only Discord attachments can be previewed.")
    }
    val parts = path.removePrefix("/attachments/").split('/')
    val valid = parts.size >= 3 &&
        parts[0].all(Char::isDigit) && parts[0].isNotEmpty() &&
        parts[1].all(Char::isDigit) && parts[1].isNotEmpty() &&
        parts.drop(2).all { it.isNotEmpty() }
    if (!valid) throw PreviewError("Invalid attachment link.")
    return path
}

private fun copyLimited(input: InputStream, output: OutputStream, limit: Long, message: String): Long {
    val buffer = ByteArray(BUFFER_SIZE)
    var total = 0L
    while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        total += read
        if (total > limit) throw PreviewError(message)
        output.write(buffer, 0, read)
    }
    return total
}

private class Archives(private val root: File) {
    private val locks = HashMap<String, Any>()

    private fun lockFor(key: String) = synchronized(locks) { locks.getOrPut(key) { Any() } }

    private fun archive(key: String): File {
        if (!keyPattern.matches(key)) throw PreviewError("Invalid preview.")
        val file = File(root, "$key.zip")
        if (!file.isFile) throw PreviewError("This preview expired. Open the ZIP again.")
        return file
    }

    fun clear() {
        root.deleteRecursively()
        root.mkdirs()
    }

    fun download(url: String): String {
        val key = sha256(attachmentPath(url))
        synchronized(lockFor(key)) {
            val file = File(root, "$key.zip")
            if (file.isFile) return key
            root.mkdirs()
            val temp = File(root, "$key.part")
            val connection = connect(url)
            try {
                val status = connection.responseCode
                if (status !in 200..299) throw PreviewError("Could not fetch ZIP ($status).")
                if (connection.contentLengthLong > MAX_ZIP_BYTES) throw PreviewError("ZIP is too large to preview.")
                connection.inputStream.use { input ->
                    temp.outputStream().use { output ->
                        copyLimited(input, output, MAX_ZIP_BYTES, "ZIP is too large to preview.")
                    }
                }
                if (!temp.renameTo(file)) throw PreviewError("Could not store ZIP.")
            } finally {
                connection.disconnect()
                temp.delete()
            }
            return key
        }
    }

    private fun connect(url: String): HttpURLConnection {
        var current = url
        repeat(MAX_REDIRECTS + 1) {
            attachmentPath(current)
            val connection = URL(current).openConnection() as HttpURLConnection
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            val status = connection.responseCode
            if (status !in 300..399) return connection
            val location = connection.getHeaderField("Location")
            connection.disconnect()
            current = URL(URL(current), location ?: throw PreviewError("Could not fetch ZIP ($status).")).toString()
        }
        throw PreviewError("Too many redirects.")
    }

    fun fetchText(url: String): Map<String, Any> {
        val connection = connect(url)
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw PreviewError("Could not fetch file ($status).")
            if (connection.contentLengthLong > MAX_PREVIEW_BYTES) throw PreviewError("File is too large to preview.")
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                copyLimited(input, output, MAX_PREVIEW_BYTES, "File is too large to preview.")
                output.toByteArray()
            }
            val text = String(bytes, Charsets.UTF_8)
            val truncated = text.length > MAX_TEXT_CHARS
            return mapOf("text" to if (truncated) text.substring(0, MAX_TEXT_CHARS) else text, "truncated" to truncated)
        } finally {
            connection.disconnect()
        }
    }

    fun saveUrl(context: Context, url: String, requestedName: String): String {
        val path = attachmentPath(url)
        val name = fileName(requestedName.replace('\\', '/')).ifBlank { fileName(path) }
        val connection = connect(url)
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw PreviewError("Could not fetch file ($status).")
            return connection.inputStream.use { input -> writeDownload(context, name, input) }
        } finally {
            connection.disconnect()
        }
    }

    private fun writeDownload(context: Context, name: String, input: InputStream): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw PreviewError("Saving needs Android 10 or newer.")
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension(name)) ?: "application/octet-stream"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$SAVE_FOLDER")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw PreviewError("Could not save file.")
        try {
            val output = resolver.openOutputStream(uri) ?: throw PreviewError("Could not save file.")
            output.use { input.copyTo(it, BUFFER_SIZE) }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (error: Throwable) {
            resolver.delete(uri, null, null)
            throw error
        }
        return "${Environment.DIRECTORY_DOWNLOADS}/$SAVE_FOLDER/$name"
    }

    private inline fun <T> withZip(key: String, block: (ZipFile) -> T): T {
        val file = archive(key)
        val zip = try {
            ZipFile(file, Charsets.UTF_8)
        } catch (_: ZipException) {
            runCatching { ZipFile(file, Charset.forName("IBM437")) }.getOrNull()
                ?: throw PreviewError("This file is not a valid ZIP.")
        }
        return zip.use(block)
    }

    fun list(key: String): Map<String, Any> = withZip(key) { zip ->
        val files = zip.entries().asSequence()
            .filter { !it.isDirectory && normalize(it.name).isNotEmpty() }
            .map { normalize(it.name) to it }
            .sortedBy { it.first }
            .toList()
        val entries = files.take(MAX_ENTRIES).map { (path, entry) ->
            val size = entry.size.coerceAtLeast(0L)
            val ext = extension(path)
            mapOf(
                "path" to path,
                "name" to fileName(path),
                "size" to size.toDouble(),
                "extension" to ext,
                "kind" to kindOf(ext, size),
            )
        }
        mapOf("key" to key, "entries" to entries, "truncated" to (files.size > MAX_ENTRIES))
    }

    private fun find(zip: ZipFile, path: String): ZipEntry =
        zip.entries().asSequence().firstOrNull { !it.isDirectory && normalize(it.name) == path }
            ?: throw PreviewError("File not found in ZIP.")

    fun text(key: String, path: String): Map<String, Any> = withZip(key) { zip ->
        val entry = find(zip, path)
        val bytes = zip.getInputStream(entry).use { input ->
            val output = java.io.ByteArrayOutputStream()
            copyLimited(input, output, MAX_PREVIEW_BYTES, "File is too large to preview.")
            output.toByteArray()
        }
        val text = String(bytes, Charsets.UTF_8)
        val truncated = text.length > MAX_TEXT_CHARS
        mapOf("text" to if (truncated) text.substring(0, MAX_TEXT_CHARS) else text, "truncated" to truncated)
    }

    fun image(key: String, path: String): String = withZip(key) { zip ->
        val entry = find(zip, path)
        val folder = File(root, "images").apply { mkdirs() }
        val target = File(folder, "${sha256("$key/$path")}.${extension(path)}")
        if (!target.isFile) {
            val temp = File(folder, "${target.name}.part")
            zip.getInputStream(entry).use { input ->
                temp.outputStream().use { output ->
                    copyLimited(input, output, MAX_PREVIEW_BYTES, "Image is too large to preview.")
                }
            }
            if (!temp.renameTo(target)) {
                temp.delete()
                throw PreviewError("Could not open image.")
            }
        }
        "file://${target.absolutePath}"
    }

    fun save(context: Context, key: String, path: String): String = withZip(key) { zip ->
        val entry = find(zip, path)
        zip.getInputStream(entry).use { writeDownload(context, fileName(path), it) }
    }
}

private var archives: Archives? = null
private var appContext: Context? = null

private fun requireArchives(): Archives = archives ?: throw PreviewError("File Preview is not ready yet.")

private fun string(args: List<Any?>, index: Int): String =
    args.getOrNull(index) as? String ?: throw PreviewError("Invalid request.")

@Suppress("UNUSED")
val filePreview = plugin {
    start {
        withAppContext { context ->
            appContext = context.applicationContext
            archives = Archives(File(context.cacheDir, CACHE_FOLDER)).also { it.clear() }
        }

        registerNativeAsyncMethod("com.coder.filepreview.open") { args ->
            val store = requireArchives()
            store.list(store.download(string(args, 0)))
        }

        registerNativeAsyncMethod("com.coder.filepreview.text") { args ->
            requireArchives().text(string(args, 0), string(args, 1))
        }

        registerNativeAsyncMethod("com.coder.filepreview.image") { args ->
            requireArchives().image(string(args, 0), string(args, 1))
        }

        registerNativeAsyncMethod("com.coder.filepreview.fetchText") { args ->
            requireArchives().fetchText(string(args, 0))
        }

        registerNativeAsyncMethod("com.coder.filepreview.saveUrl") { args ->
            val context = appContext ?: throw PreviewError("File Preview is not ready yet.")
            requireArchives().saveUrl(context, string(args, 0), string(args, 1))
        }

        registerNativeAsyncMethod("com.coder.filepreview.save") { args ->
            val context = appContext ?: throw PreviewError("File Preview is not ready yet.")
            requireArchives().save(context, string(args, 0), string(args, 1))
        }
    }

    stop {
        archives?.clear()
        archives = null
        appContext = null
    }
}
