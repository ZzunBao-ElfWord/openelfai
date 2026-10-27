package cn.openelfai.kwai;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.FileProvider;
import com.kwai.opensdk.sdk.openapi.KwaiOpenAPI;
import com.kwai.opensdk.sdk.model.base.BaseResp;
import com.kwai.opensdk.sdk.model.base.OpenSdkConfig;
import com.kwai.opensdk.sdk.model.postshare.SinglePictureEdit;
import com.kwai.opensdk.sdk.model.postshare.PostShareMediaInfo;
import com.kwai.opensdk.sdk.constants.KwaiPlatform;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.embedding.engine.plugins.activity.ActivityAware;
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.UUID;
public final class OpenElfKwaiSharePlugin implements FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler {
    private Context context; private Activity activity; private MethodChannel channel;
    private KwaiOpenAPI api; private MethodChannel.Result pending;
    private String transaction,session; private Uri uri; private File file;
    private final Handler handler=new Handler(Looper.getMainLooper());
    @Override public void onAttachedToEngine(FlutterPluginBinding b){context=b.getApplicationContext();channel=new MethodChannel(b.getBinaryMessenger(),"openelf/kwai_share");channel.setMethodCallHandler(this);}
    @Override public void onDetachedFromEngine(FlutterPluginBinding b){finish("failed");if(api!=null)api.removeKwaiAPIEventListerer();channel.setMethodCallHandler(null);}
    @Override public void onAttachedToActivity(ActivityPluginBinding b){activity=b.getActivity();}
    @Override public void onReattachedToActivityForConfigChanges(ActivityPluginBinding b){activity=b.getActivity();}
    @Override public void onDetachedFromActivity(){activity=null;}
    @Override public void onDetachedFromActivityForConfigChanges(){activity=null;}
    private boolean installed(){try{context.getPackageManager().getPackageInfo("com.smile.gifmaker",0);return true;}catch(Exception e){return false;}}
    private boolean configured(String id){try{return id!=null&&id.matches("ks[0-9]+")&&id.equals(context.getPackageManager().getApplicationInfo(context.getPackageName(),PackageManager.GET_META_DATA).metaData.getString("APP_ID"));}catch(Exception e){return false;}}
    @Override public void onMethodCall(MethodCall call,MethodChannel.Result result){
        if(!call.method.equals("availability")&&!call.method.equals("shareImage")){result.notImplemented();return;}
        String id=call.argument("appId");
        if(!configured(id)){result.success("integrationPending");return;}
        if(call.method.equals("availability")){result.success(installed()?"ready":"notInstalled");return;}
        byte[] png=call.argument("png");
        if(!Boolean.TRUE.equals(call.argument("privacyConsent"))||png==null||png.length<8||png.length>8*1024*1024){result.success("failed");return;}
        int[] signature={137,80,78,71,13,10,26,10};for(int i=0;i<8;i++)if((png[i]&255)!=signature[i]){result.success("failed");return;}
        if(pending!=null||activity==null||!installed()){result.success("failed");return;}
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(png,0,png.length,bounds);
        if(bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>4096||bounds.outHeight>4096){result.success("failed");return;}
        pending=result;transaction=UUID.randomUUID().toString();final String expected=transaction;
        handler.postDelayed(()->{if(expected.equals(transaction))finish("failed");},180000);
        try{
            if(api==null){api=new KwaiOpenAPI(context);
                api.setOpenSdkConfig(new OpenSdkConfig.Builder().setGoToMargetAppNotInstall(false).setGoToMargetAppVersionNotSupport(false).setSetNewTaskFlag(false).setSetClearTaskFlag(false).setShowDefaultLoading(false).build());
                api.addKwaiAPIEventListerer(this::receive);
            }
            api.updateKwaiAppId(id);
            SinglePictureEdit.Req request=new SinglePictureEdit.Req();
            request.sessionId=api.getOpenAPISessionId();session=request.sessionId;request.transaction=transaction;
            request.setPlatformArray(new String[]{KwaiPlatform.Platform.KWAI_APP});
            if(!api.isAppSupportUri(context,request)){finish("failed");return;}
            File dir=new File(context.getCacheDir(),"kwai-share");if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException();
            file=new File(dir,transaction+".png");try(FileOutputStream output=new FileOutputStream(file)){output.write(png);}
            uri=FileProvider.getUriForFile(context,context.getPackageName()+".kwai.share.files",file);
            context.grantUriPermission("com.smile.gifmaker",uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            request.mediaInfo=new PostShareMediaInfo();request.mediaInfo.mDisableFallback=true;
            request.mediaInfo.mMultiMediaAssets=new ArrayList<>();request.mediaInfo.mMultiMediaAssets.add(uri.toString());
            if(!request.checkArgs()||!api.sendReq(request,activity))finish("failed");
        }catch(Exception e){finish("failed");}
    }
    private void receive(BaseResp response){
        if(pending==null||!(response instanceof SinglePictureEdit.Resp)||!transaction.equals(response.transaction)||session==null||!session.equals(response.sessionId))return;
        finish(response.errorCode==1?"handedOff":response.errorCode==-1?"cancelled":"failed");
    }
    private void finish(String outcome){
        MethodChannel.Result result=pending;pending=null;transaction=null;session=null;
        if(uri!=null){try{context.revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(RuntimeException ignored){}uri=null;}
        if(file!=null){file.delete();file=null;}
        if(result!=null)result.success(outcome);
    }
}
