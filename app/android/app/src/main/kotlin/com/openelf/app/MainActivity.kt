package com.openelf.app

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.alipay.sdk.app.EnvUtils
import com.alipay.sdk.app.PayTask
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
    }
}
