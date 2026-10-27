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

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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
        // 站外分发：把分享卡片与文案定向交给已绑定的第三方 App（抖音 / 快手 / 微信 / 哔哩哔哩）。
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
                )
            )
        }
    }

    /// 返回 ok / not_installed / no_receiver / error，由 Flutter 侧决定是否回退系统分享。
    private fun shareToPackage(pkg: String?, text: String?, title: String, imageBytes: ByteArray?): String {
        if (pkg.isNullOrBlank() || text.isNullOrBlank()) return "error"
        val pm = packageManager
        val installed = try {
            pm.getPackageInfo(pkg, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
        if (!installed) return "not_installed"

        // 优先带图片分享：抖音 / 哔哩哔哩的分享入口支持图片，文案作为 EXTRA_TEXT 一并带上。
        val imageUri = imageBytes?.takeIf { it.isNotEmpty() }?.let { bytes ->
            try {
                val dir = File(cacheDir, "stage_share").apply { mkdirs() }
                // 只保留本次分享的卡片，避免缓存目录堆积历史图片
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "openelf_${System.currentTimeMillis()}.png")
                file.writeBytes(bytes)
                FileProvider.getUriForFile(this, "$packageName.openelf.fileprovider", file)
            } catch (_: Exception) {
                null
            }
        }
        if (imageUri != null) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
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
                    // 落到纯文本分享再试一次
                }
            }
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
}
