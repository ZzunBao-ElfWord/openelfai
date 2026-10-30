package com.openelf.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/** Own image writes only; no READ_MEDIA_IMAGES or storage permissions. */
class PosterSaver(private val activity: Activity, messenger: BinaryMessenger) {
    private var pending: MethodChannel.Result? = null
    private var pendingBytes: ByteArray? = null
    private val requestCode = 5817

    init {
        MethodChannel(messenger, "openelf/poster").setMethodCallHandler { call, result ->
            if (call.method != "save") { result.notImplemented(); return@setMethodCallHandler }
            val bytes = call.argument<ByteArray>("png")
            val signature = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)
            if (bytes == null || bytes.size !in 8..(10 * 1024 * 1024) ||
                !bytes.copyOfRange(0, 8).contentEquals(signature)) {
                result.error("INVALID_IMAGE", "分享图片无效", null)
                return@setMethodCallHandler
            }
            if (pending != null) {
                result.error("SAVE_BUSY", "图片正在保存", null)
                return@setMethodCallHandler
            }
            pending = result
            val filename = "OpenElf_${System.currentTimeMillis()}.png"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Thread {
                    val resolver = activity.contentResolver
                    var uri: android.net.Uri? = null
                    try {
                        val values = ContentValues().apply {
                            put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/OpenElf")
                            put(MediaStore.Images.Media.IS_PENDING, 1)
                        }
                        uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                            ?: throw IllegalStateException()
                        (resolver.openOutputStream(uri) ?: throw IllegalStateException()).use { it.write(bytes) }
                        val published = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
                        check(resolver.update(uri, published, null, null) == 1)
                        activity.runOnUiThread { finish("gallery") }
                    } catch (_: Exception) {
                        uri?.let { try { resolver.delete(it, null, null) } catch (_: Exception) {} }
                        activity.runOnUiThread { fail() }
                    }
                }.start()
            } else {
                pendingBytes = bytes
                try {
                    activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/png"
                        putExtra(Intent.EXTRA_TITLE, filename)
                    }, requestCode)
                } catch (_: Exception) { fail() }
            }
        }
    }

    fun handleActivityResult(code: Int, resultCode: Int, data: Intent?) {
        if (code != requestCode || pending == null) return
        val bytes = pendingBytes
        pendingBytes = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) { finish("cancelled"); return }
        if (bytes == null) { fail(); return }
        Thread {
            try {
                (activity.contentResolver.openOutputStream(uri) ?: throw IllegalStateException()).use { it.write(bytes) }
                activity.runOnUiThread { finish("file") }
            } catch (_: Exception) { activity.runOnUiThread { fail() } }
        }.start()
    }

    private fun finish(value: String) {
        val result = pending
        pending = null
        pendingBytes = null
        result?.success(value)
    }

    private fun fail() {
        val result = pending
        pending = null
        pendingBytes = null
        result?.error("SAVE_FAILED", "海报保存失败", null)
    }
}
