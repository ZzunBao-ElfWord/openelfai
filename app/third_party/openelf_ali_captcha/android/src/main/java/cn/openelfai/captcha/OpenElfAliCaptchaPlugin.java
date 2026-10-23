package cn.openelfai.captcha;

import android.app.Activity;
import android.text.TextUtils;

import androidx.annotation.NonNull;

import com.alicom.gtcaptcha4.AlicomCaptcha4Client;
import com.alicom.gtcaptcha4.AlicomCaptcha4Config;

import java.util.Map;

import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.embedding.engine.plugins.activity.ActivityAware;
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/** Minimal Flutter bridge for Alibaba Cloud PNVS Captcha4. */
public final class OpenElfAliCaptchaPlugin implements FlutterPlugin,
        MethodChannel.MethodCallHandler, ActivityAware {
    private MethodChannel channel;
    private Activity activity;
    private AlicomCaptcha4Client captchaClient;
    private MethodChannel.Result pendingResult;

    @Override
    public void onAttachedToEngine(@NonNull FlutterPluginBinding binding) {
        channel = new MethodChannel(binding.getBinaryMessenger(), "openelf_ali_captcha");
        channel.setMethodCallHandler(this);
    }

    @Override
    public void onMethodCall(@NonNull MethodCall call, @NonNull MethodChannel.Result result) {
        if (!"verifyCaptcha".equals(call.method)) {
            result.notImplemented();
            return;
        }
        verifyCaptcha(call.arguments, result);
    }

    private synchronized void verifyCaptcha(Object arguments, MethodChannel.Result result) {
        if (pendingResult != null) {
            result.error("CAPTCHA_BUSY", "已有进行中的验证", null);
            return;
        }
        if (activity == null) {
            result.error("NO_ACTIVITY", "当前无法打开安全验证，请重启应用后重试", null);
            return;
        }

        String captchaId = null;
        if (arguments instanceof Map) {
            Object value = ((Map<?, ?>) arguments).get("captchaId");
            if (value instanceof String) captchaId = (String) value;
        }
        if (TextUtils.isEmpty(captchaId)) {
            result.error("PARAM_ERROR", "图形验证方案未配置", null);
            return;
        }

        pendingResult = result;
        try {
            AlicomCaptcha4Config config = new AlicomCaptcha4Config.Builder()
                    .setDebug(false)
                    .setTimeOut(10000)
                    .setCanceledOnTouchOutside(true)
                    .build();
            captchaClient = AlicomCaptcha4Client.getClient(activity);
            captchaClient.setLogEnable(false);
            captchaClient.init(captchaId, config)
                    .addOnSuccessListener((status, response) -> {
                        // status=false means the SDK refreshed the challenge for another attempt.
                        if (status) finishSuccess(response);
                    })
                    .addOnFailureListener(error -> {
                        if (error != null && error.contains("-14460")) {
                            finishSuccess(null);
                        } else {
                            finishError("CAPTCHA_ERROR", error == null ? "图形验证失败" : error);
                        }
                    })
                    .verifyWithCaptcha();
        } catch (Exception error) {
            finishError("CAPTCHA_ERROR", "图形验证调起失败: " + error.getMessage());
        }
    }

    private synchronized void finishSuccess(String response) {
        MethodChannel.Result result = pendingResult;
        pendingResult = null;
        destroyClient();
        if (result != null) result.success(response);
    }

    private synchronized void finishError(String code, String message) {
        MethodChannel.Result result = pendingResult;
        pendingResult = null;
        destroyClient();
        if (result != null) result.error(code, message, null);
    }

    private void destroyClient() {
        if (captchaClient == null) return;
        try {
            captchaClient.destroy();
        } catch (Exception ignored) {
            // Best-effort cleanup from the vendor SDK.
        }
        captchaClient = null;
    }

    @Override
    public void onAttachedToActivity(@NonNull ActivityPluginBinding binding) {
        activity = binding.getActivity();
    }

    @Override
    public void onDetachedFromActivityForConfigChanges() {
        activity = null;
    }

    @Override
    public void onReattachedToActivityForConfigChanges(@NonNull ActivityPluginBinding binding) {
        activity = binding.getActivity();
    }

    @Override
    public void onDetachedFromActivity() {
        activity = null;
        destroyClient();
    }

    @Override
    public void onDetachedFromEngine(@NonNull FlutterPluginBinding binding) {
        if (channel != null) channel.setMethodCallHandler(null);
        channel = null;
        destroyClient();
    }
}
