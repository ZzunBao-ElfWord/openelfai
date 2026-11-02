package cn.openelfai.wechat;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.modelmsg.SendMessageToWX;
import com.tencent.mm.opensdk.modelmsg.WXImageObject;
import com.tencent.mm.opensdk.modelmsg.WXMediaMessage;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

public final class OpenElfWechatSharePlugin implements FlutterPlugin, MethodChannel.MethodCallHandler {
    static OpenElfWechatSharePlugin instance;
    IWXAPI api;
    private Context context;
    private MethodChannel channel;
    private MethodChannel.Result pending;
    private String transaction;
    private String registeredAppId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    @Override public void onAttachedToEngine(FlutterPluginBinding binding) {
        context = binding.getApplicationContext(); instance = this;
        channel = new MethodChannel(binding.getBinaryMessenger(), "openelf/wechat_share");
        channel.setMethodCallHandler(this);
    }
    @Override public void onDetachedFromEngine(FlutterPluginBinding binding) {
        finish("failed"); channel.setMethodCallHandler(null);
        if (api != null) api.detach();
        if (instance == this) instance = null;
    }
    private boolean installed() {
        try { context.getPackageManager().getPackageInfo("com.tencent.mm", 0); return true; }
        catch (Exception ignored) { return false; }
    }
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        if (!call.method.equals("availability") && !call.method.equals("shareImage")) { result.notImplemented(); return; }
        String appId = call.argument("appId");
        if (appId == null || appId.isEmpty()) { result.success("notConfigured"); return; }
        if (!appId.matches("wx[0-9a-fA-F]{16}")) { result.success("integrationPending"); return; }
        if (call.method.equals("availability")) { result.success(installed() ? "ready" : "notInstalled"); return; }
        byte[] png = call.argument("png"); String scene = call.argument("scene");
        if (!Boolean.TRUE.equals(call.argument("privacyConsent")) || png == null || png.length < 8 || png.length > 8*1024*1024
            || !("session".equals(scene) || "timeline".equals(scene))) { result.error("INVALID_SHARE", "素材或同意状态无效", null); return; }
        final int[] signature = {137,80,78,71,13,10,26,10};
        for (int i=0;i<8;i++) if ((png[i]&255) != signature[i]) { result.error("INVALID_SHARE", "PNG格式无效", null); return; }
        if (pending != null) { result.error("SHARE_BUSY", "分享正在进行", null); return; }
        if (!installed()) { result.error("NOT_INSTALLED", "请先安装微信", null); return; }
        pending = result; transaction = UUID.randomUUID().toString();
        final String expected = transaction;
        handler.postDelayed(() -> { if (expected.equals(transaction)) finish("failed"); }, 180000);
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(png,0,png.length,bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 4096 || bounds.outHeight > 4096) { finish("failed"); return; }
            if (api == null || !appId.equals(registeredAppId)) {
                if (api != null) api.detach();
                api = WXAPIFactory.createWXAPI(context, appId, true); // Verify WeChat signature.
                if (!api.registerApp(appId)) { finish("failed"); return; }
                registeredAppId = appId;
            }
            WXImageObject image = new WXImageObject(); image.imageData = png;
            WXMediaMessage message = new WXMediaMessage(image);
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
            while (Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize > 192) options.inSampleSize *= 2;
            Bitmap thumb = BitmapFactory.decodeByteArray(png,0,png.length,options);
            if (thumb == null) { finish("failed"); return; }
            try {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                thumb.compress(Bitmap.CompressFormat.JPEG,65,output);
                if (output.size() <= 32*1024) message.thumbData = output.toByteArray();
            } finally { thumb.recycle(); }
            SendMessageToWX.Req request = new SendMessageToWX.Req();
            request.transaction = transaction; request.message = message;
            request.scene = "timeline".equals(scene) ? SendMessageToWX.Req.WXSceneTimeline : SendMessageToWX.Req.WXSceneSession;
            if (!request.checkArgs() || !api.sendReq(request)) finish("failed");
        } catch (RuntimeException ignored) { finish("failed"); }
    }
    static boolean hasPending() { return instance != null && instance.pending != null && instance.api != null; }
    static void receive(BaseResp response) {
        if (!hasPending() || !(response instanceof SendMessageToWX.Resp) || !instance.transaction.equals(response.transaction)) return;
        instance.finish(response.errCode == 0 ? "handedOff" : response.errCode == -2 ? "cancelled" : "failed");
    }
    private void finish(String outcome) {
        MethodChannel.Result callback = pending; pending = null; transaction = null;
        if (callback != null) callback.success(outcome);
    }
}
