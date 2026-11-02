package com.openelf.app

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.alipay.sdk.app.EnvUtils
import com.alipay.sdk.app.PayTask
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : FlutterActivity() {
    private val paying = AtomicBoolean(false)
    private var posterSaver: PosterSaver? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        posterSaver = PosterSaver(this, flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "openelf/alipay").setMethodCallHandler { call, result ->
            if (call.method != "pay") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val order = call.argument<String>("orderString")
            val sandbox = call.argument<Boolean>("sandbox") ?: false
            if (order.isNullOrBlank() || order.length > 65536) {
                result.error("INVALID_ORDER", "支付订单无效", null)
                return@setMethodCallHandler
            }
            if (!paying.compareAndSet(false, true)) {
                result.error("PAYMENT_BUSY", "已有支付正在进行", null)
                return@setMethodCallHandler
            }
            Thread {
                try {
                    EnvUtils.setEnv(if (sandbox) EnvUtils.EnvEnum.SANDBOX else EnvUtils.EnvEnum.ONLINE)
                    val response = PayTask(this).payV2(order, true)
                    runOnUiThread { result.success(mapOf("resultStatus" to response["resultStatus"])) }
                } catch (_: Exception) {
                    runOnUiThread { result.error("ALIPAY_UNAVAILABLE", "支付宝暂不可用，请刷新确认订单", null) }
                } finally { paying.set(false) }
            }.start()
        }
        // 交接用户选择的卡片/作品素材，不代表第三方账号授权或发布成功。
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "openelf/share").setMethodCallHandler { call, result ->
            if (call.method != "shareToApp") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            result.success(
                shareToPackage(
                    pkg = call.argument<String>("package"),
                    text = call.argument<String>("text"),
                    title = call.argument<String>("title") ?: "分享",
                    imageBytes = call.argument<ByteArray>("image"),
                    workBytes = call.argument<ByteArray>("media"),
                    workMime = call.argument<String>("mime"),
                )
            )
        }
    }

    /// 返回 ok / not_installed / no_receiver / error，由 Flutter 侧决定是否回退系统分享。
    private fun shareToPackage(pkg: String?, text: String?, title: String, imageBytes: ByteArray?, workBytes: ByteArray?, workMime: String?): String {
        if (pkg.isNullOrBlank() || text.isNullOrBlank()) return "error"
        if (pkg !in setOf("com.ss.android.ugc.aweme", "com.smile.gifmaker", "com.tencent.mm", "tv.danmaku.bili")) return "error"
        val bytes = workBytes ?: imageBytes
        val mime = if (workBytes != null) workMime else "image/png"
        if (bytes != null && (bytes.isEmpty() || bytes.size > 50 * 1024 * 1024 || mime !in setOf("video/mp4", "image/png", "image/jpeg", "image/webp"))) return "error"
        val pm = packageManager
        val installed = try {
            pm.getPackageInfo(pkg, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
        if (!installed) return "not_installed"

        // 以真实素材 MIME 交接，是否接收由目标客户端决定。
        val imageUri = bytes?.takeIf { it.isNotEmpty() }?.let { content ->
            try {
                val dir = File(cacheDir, "stage_share").apply { mkdirs() }
                // Never remove a file a previously opened publisher may still read.
                val extension = when (mime) { "video/mp4" -> "mp4"; "image/jpeg" -> "jpg"; "image/webp" -> "webp"; else -> "png" }
                val file = File(dir, "openelf_${java.util.UUID.randomUUID()}.$extension")
                file.writeBytes(content)
                FileProvider.getUriForFile(this, "$packageName.openelf.fileprovider", file)
            } catch (_: Exception) {
                null
            }
        }
        if (bytes != null && imageUri == null) return "error"
        if (imageUri != null) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mime
                setPackage(pkg)
                putExtra(Intent.EXTRA_STREAM, imageUri)
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TITLE, title)
                // 部分厂商 App 只认 ClipData 里的 URI 授权，需与 EXTRA_STREAM 同时给出
                clipData = ClipData.newUri(contentResolver, "OpenElf", imageUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            if (intent.resolveActivity(pm) != null) {
                try {
                    startActivity(intent)
                    return "ok"
                } catch (_: Exception) {
                    return "error"
                }
            }
            return "no_receiver" // Do not silently replace a video with text.
        }

        val textIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            setPackage(pkg)
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(Intent.EXTRA_TITLE, title)
        }
        if (textIntent.resolveActivity(pm) == null) return "no_receiver"
        return try {
            startActivity(textIntent)
            "ok"
        } catch (_: Exception) {
            "error"
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        posterSaver?.handleActivityResult(requestCode, resultCode, data)
    }
}
