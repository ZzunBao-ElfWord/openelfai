package cn.openelfai.sharing;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.SparseArray;
import androidx.core.content.FileProvider;
import com.bytedance.sdk.open.aweme.adapter.okhttp.OpenNetworkOkHttpServiceImpl;
import com.bytedance.sdk.open.aweme.adapter.image.picasso.PicassoOpenImageServiceImpl;
import com.bytedance.sdk.open.aweme.base.ImageObject;
import com.bytedance.sdk.open.aweme.base.VideoObject;
import com.bytedance.sdk.open.aweme.base.MediaContent;
import com.bytedance.sdk.open.aweme.core.OpenHostInfoService;
import com.bytedance.sdk.open.aweme.init.DouYinOpenSDKConfig;
import com.bytedance.sdk.open.aweme.common.model.BaseResp;
import com.bytedance.sdk.open.aweme.share.Share;
import com.bytedance.sdk.open.douyin.DouYinOpenApiFactory;
import com.bytedance.sdk.open.douyin.ShareToContact;
import com.bytedance.sdk.open.douyin.api.DouYinOpenApi;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.embedding.engine.plugins.activity.ActivityAware;
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.UUID;

public final class OpenElfDouyinSharePlugin implements FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler {
    public static final String CLIENT_KEY = "awf8w18qtnqq1kum";
    private static final String[] PACKAGES = {"com.ss.android.ugc.aweme", "com.ss.android.ugc.aweme.lite", "com.ss.android.ugc.live"};
    static OpenElfDouyinSharePlugin instance;
    private Context context;
    private Activity activity;
    private MethodChannel channel;
    private MethodChannel.Result pending;
    private String state;
    private String scene;
    private Uri grantedUri;
    private File imageFile;
    private boolean initialized;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onAttachedToEngine(FlutterPluginBinding binding) {
        context = binding.getApplicationContext(); instance = this;
        channel = new MethodChannel(binding.getBinaryMessenger(), "openelf/douyin_share");
        channel.setMethodCallHandler(this);
    }
    @Override public void onDetachedFromEngine(FlutterPluginBinding binding) {
        finish("failed"); channel.setMethodCallHandler(null);
        if (instance == this) instance = null;
    }
    @Override public void onAttachedToActivity(ActivityPluginBinding binding) { activity = binding.getActivity(); }
    @Override public void onDetachedFromActivityForConfigChanges() { activity = null; }
    @Override public void onReattachedToActivityForConfigChanges(ActivityPluginBinding binding) { activity = binding.getActivity(); }
    @Override public void onDetachedFromActivity() { activity = null; }
    private boolean installed(String pkg) {
        try { context.getPackageManager().getPackageInfo(pkg, 0); return true; }
        catch (Exception ignored) { return false; }
    }
    private boolean anyInstalled() {
        for (String pkg : PACKAGES) if (installed(pkg)) return true;
        return false;
    }
    private void initializeAfterConsent() {
        if (initialized) return;
        DouYinOpenApiFactory.initConfig(new DouYinOpenSDKConfig.Builder()
            .context(context).clientKey(CLIENT_KEY).autoStartTracker(false)
            .networkService(new OpenNetworkOkHttpServiceImpl())
            .imageService(new PicassoOpenImageServiceImpl())
            .hostInfoService(new OpenHostInfoService() {
                public String getDeviceId() { return ""; }
                public String getInstallId() { return ""; }
                public String getChannel() { return "OpenElf"; }
                public String getAppId() { return CLIENT_KEY; }
                public String getAppName() { return "OpenElf"; }
                public String getUpdateVersionCode() { return getVersionCode(); }
                public String getVersionCode() { try { return String.valueOf(context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionCode); } catch (Exception e) { return ""; } }
                public String getVersionName() { try { return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }
                public SparseArray<String> extraInfo() { return null; }
            }).build());
        initialized = true;
    }
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        if (call.method.equals("availability")) {
            result.success(anyInstalled() ? "ready" : "notInstalled"); return;
        }
        boolean work = call.method.equals("shareWork");
        if (!call.method.equals("shareImage") && !work) { result.notImplemented(); return; }
        byte[] png = call.argument("png"); String requestedScene = call.argument("scene");
        boolean video = work && Boolean.TRUE.equals(call.argument("video"));
        boolean validMedia = png != null && (video
            ? png.length >= 12 && png.length <= 50 * 1024 * 1024 && png[4] == 'f' && png[5] == 't' && png[6] == 'y' && png[7] == 'p'
            : png.length >= 8 && png.length <= 8 * 1024 * 1024 && png[0] == (byte)137 && png[1] == 80 && png[2] == 78 && png[3] == 71);
        if (!CLIENT_KEY.equals(call.argument("clientKey")) || !Boolean.TRUE.equals(call.argument("privacyConsent"))
            || !validMedia
            || !(work ? "publish".equals(requestedScene) : ("contacts".equals(requestedScene) || "story".equals(requestedScene)))) {
            result.error("INVALID_SHARE", "分享素材或授权无效", null); return;
        }
        if (pending != null) { result.error("SHARE_BUSY", "分享正在进行", null); return; }
        if (activity == null || !(work ? installed(PACKAGES[0]) : anyInstalled())) { result.error("DOUYIN_UNAVAILABLE", "请先安装或更新抖音主版", null); return; }
        pending = result; scene = requestedScene; state = UUID.randomUUID().toString();
        final String requestState = state;
        // Editing a video may take longer than the callback window. Do not
        // revoke/delete material the publisher may still be reading on timeout.
        handler.postDelayed(() -> { if (requestState.equals(state)) finish("failed", false); }, 180000);
        try {
            initializeAfterConsent();
            DouYinOpenApi api = DouYinOpenApiFactory.create(activity);
            if (!api.isShareSupportFileProvider()) { finish("failed"); return; }
            File directory = new File(context.getCacheDir(), "douyin-share");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException();
            File[] stale = directory.listFiles();
            if (stale != null) for (File file : stale) {
                if (file.isFile() && System.currentTimeMillis() - file.lastModified() > 86400000L) file.delete();
            }
            imageFile = new File(directory, requestState + (video ? ".mp4" : ".png"));
            try (FileOutputStream output = new FileOutputStream(imageFile)) { output.write(png); }
            grantedUri = FileProvider.getUriForFile(context, context.getPackageName() + ".douyin.share.files", imageFile);
            for (String pkg : PACKAGES) if (installed(pkg)) context.grantUriPermission(pkg, grantedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ArrayList<String> paths = new ArrayList<>(); paths.add(grantedUri.toString());
            MediaContent media;
            if (video) {
                VideoObject object = new VideoObject(); object.mVideoPaths = paths;
                media = new MediaContent(object);
            } else media = new MediaContent(new ImageObject(paths));
            boolean accepted;
            if ("contacts".equals(scene)) {
                if (!api.isAppSupportShareToContacts()) { finish("failed"); return; }
                ShareToContact.Request request = new ShareToContact.Request();
                request.mState = state; request.mMediaContent = media;
                request.callerLocalEntry = DouyinCallbackActivity.class.getName();
                accepted = api.shareToContacts(request);
            } else {
                if (!api.isAppSupportShare()) { finish("failed"); return; }
                Share.Request request = new Share.Request();
                request.mState = state; request.mMediaContent = media;
                if ("story".equals(scene)) request.shareToType = 1;
                if (video && api.isAppSupportShareToPublish()) request.shareToPublish = true;
                request.callerLocalEntry = DouyinCallbackActivity.class.getName();
                accepted = api.share(request);
            }
            if (!accepted) finish("failed");
        } catch (Exception ignored) { finish("failed"); }
    }
    static boolean hasPending() { return instance != null && instance.pending != null && instance.initialized; }
    static void receive(BaseResp response) {
        if (!hasPending()) return;
        String responseState;
        if ("contacts".equals(instance.scene) && response instanceof ShareToContact.Response) responseState = ((ShareToContact.Response) response).mState;
        else if (("story".equals(instance.scene) || "publish".equals(instance.scene)) && response instanceof Share.Response) responseState = ((Share.Response) response).state;
        else return;
        if (!instance.state.equals(responseState)) return; // Ignore forged/stale callbacks.
        instance.finish(response.isCancel() ? "cancelled" : response.isSuccess() ? "handedOff" : "failed");
    }
    private void finish(String outcome) {
        finish(outcome, true);
    }
    private void finish(String outcome, boolean cleanup) {
        MethodChannel.Result callback = pending; pending = null; state = null;
        if (cleanup && grantedUri != null) {
            try { context.revokeUriPermission(grantedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (RuntimeException ignored) { /* Cleanup must not swallow the result. */ }
        }
        if (cleanup && imageFile != null) imageFile.delete();
        grantedUri = null;
        imageFile = null;
        if (callback != null) callback.success(outcome);
    }
}
