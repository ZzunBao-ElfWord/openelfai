package cn.openelfai.sharing;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import com.bytedance.sdk.open.aweme.common.handler.IApiEventHandler;
import com.bytedance.sdk.open.aweme.common.model.BaseReq;
import com.bytedance.sdk.open.aweme.common.model.BaseResp;
import com.bytedance.sdk.open.douyin.DouYinOpenApiFactory;

public final class DouyinCallbackActivity extends Activity implements IApiEventHandler {
    @Override public void onCreate(Bundle savedInstanceState) { super.onCreate(savedInstanceState); handle(getIntent()); }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handle(intent); }
    private void handle(Intent intent) {
        try { if (OpenElfDouyinSharePlugin.hasPending()) DouYinOpenApiFactory.create(this).handleIntent(intent, this); }
        catch (Exception ignored) { /* No credential or image logging. */ }
        finally { finish(); }
    }
    @Override public void onReq(BaseReq request) {}
    @Override public void onResp(BaseResp response) { OpenElfDouyinSharePlugin.receive(response); }
    @Override public void onErrorIntent(Intent intent) {}
}
