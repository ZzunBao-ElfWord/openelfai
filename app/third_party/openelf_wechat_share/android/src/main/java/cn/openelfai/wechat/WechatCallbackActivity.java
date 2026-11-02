package cn.openelfai.wechat;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import com.tencent.mm.opensdk.modelbase.BaseReq;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler;

public final class WechatCallbackActivity extends Activity implements IWXAPIEventHandler {
    @Override public void onCreate(Bundle state) { super.onCreate(state); handle(getIntent()); }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handle(intent); }
    private void handle(Intent intent) {
        try { if (OpenElfWechatSharePlugin.hasPending()) OpenElfWechatSharePlugin.instance.api.handleIntent(intent, this); }
        catch (RuntimeException ignored) { /* Do not log callback data. */ }
        finally { finish(); }
    }
    @Override public void onReq(BaseReq req) {}
    @Override public void onResp(BaseResp resp) { OpenElfWechatSharePlugin.receive(resp); }
}
