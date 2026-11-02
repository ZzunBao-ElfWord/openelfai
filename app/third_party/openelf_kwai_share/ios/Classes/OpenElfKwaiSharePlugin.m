#import "OpenElfKwaiSharePlugin.h"
#import <KwaiSDK/KSApi.h>
#import <Photos/Photos.h>
#include <string.h>
static __weak OpenElfKwaiSharePlugin *sharedPlugin;
@interface OpenElfKwaiSharePlugin()<KSApiDelegate>
@property(nonatomic,copy) FlutterResult pending;
@property(nonatomic,copy) NSString *state;
@property(nonatomic,copy) NSString *registeredAppID;
@end
@implementation OpenElfKwaiSharePlugin
+(void)registerWithRegistrar:(NSObject<FlutterPluginRegistrar> *)registrar {
    OpenElfKwaiSharePlugin *p=[OpenElfKwaiSharePlugin new];sharedPlugin=p;
    FlutterMethodChannel *channel=[FlutterMethodChannel methodChannelWithName:@"openelf/kwai_share" binaryMessenger:registrar.messenger];
    [registrar addMethodCallDelegate:p channel:channel];[registrar addApplicationDelegate:p];
}
+(BOOL)handleOpenURL:(NSURL *)url {
    if(!sharedPlugin.pending||![url.scheme isEqual:sharedPlugin.registeredAppID])return NO;
    return [KSApi handleOpenURL:url];
}
+(BOOL)handleUniversalLink:(NSUserActivity *)activity {
    NSURL *url=activity.webpageURL;
    if(!sharedPlugin.pending||![url.scheme isEqual:@"https"]||![url.host isEqual:@"openelfai.com"]||![url.path hasPrefix:@"/app/"])return NO;
    return [KSApi handleOpenUniversalLink:activity];
}
-(BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options{return [OpenElfKwaiSharePlugin handleOpenURL:url];}
-(BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)activity restorationHandler:(void (^)(NSArray *))handler{return [OpenElfKwaiSharePlugin handleUniversalLink:activity];}
-(BOOL)configured:(NSString *)appID link:(NSString *)link {
    if(![appID isKindOfClass:NSString.class]||![link isEqual:@"https://openelfai.com/app/"])return NO;
    NSRegularExpression *pattern=[NSRegularExpression regularExpressionWithPattern:@"^ks[0-9]+$" options:0 error:nil];
    if([pattern numberOfMatchesInString:appID options:0 range:NSMakeRange(0,appID.length)]!=1)return NO;
    if(![[NSBundle.mainBundle objectForInfoDictionaryKey:@"KwaiShareAppID"] isEqual:appID])return NO;
    for(NSDictionary *type in [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleURLTypes"]){if([type[@"CFBundleURLSchemes"] containsObject:appID])return YES;}
    return NO;
}
-(void)handleMethodCall:(FlutterMethodCall *)call result:(FlutterResult)result {
    if(![call.method isEqual:@"availability"]&&![call.method isEqual:@"shareImage"]){result(FlutterMethodNotImplemented);return;}
    NSDictionary *args=[call.arguments isKindOfClass:NSDictionary.class]?call.arguments:@{};NSString *appID=args[@"appId"];
    if(![self configured:appID link:args[@"universalLink"]]){result(@"integrationPending");return;}
    BOOL installed=[UIApplication.sharedApplication canOpenURL:[NSURL URLWithString:@"kwai://"]];
    if([call.method isEqual:@"availability"]){result(installed?@"ready":@"notInstalled");return;}
    if(self.pending||!installed){result(@"failed");return;}
    FlutterStandardTypedData *typed=[args[@"png"] isKindOfClass:FlutterStandardTypedData.class]?args[@"png"]:nil;NSData *png=typed.data;
    const unsigned char signature[]={137,80,78,71,13,10,26,10};
    if(![args[@"privacyConsent"] isEqual:@YES]||png.length<8||png.length>8*1024*1024||memcmp(png.bytes,signature,8)!=0){result(@"failed");return;}
    UIImage *image=[UIImage imageWithData:png];if(!image||image.size.width>4096||image.size.height>4096){result(@"failed");return;}
    if(![self.registeredAppID isEqual:appID]){
        if(![KSApi registerApp:appID universalLink:args[@"universalLink"] delegate:self]){result(@"failed");return;}
        self.registeredAppID=appID;
    }
    self.pending=result;self.state=NSUUID.UUID.UUIDString;NSString *expected=self.state;__weak typeof(self) weakSelf=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,180*NSEC_PER_SEC),dispatch_get_main_queue(),^{if([weakSelf.state isEqual:expected])[weakSelf finish:@"failed"];});
    [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite handler:^(PHAuthorizationStatus status){dispatch_async(dispatch_get_main_queue(),^{
        if(![weakSelf.state isEqual:expected])return;
        if(status!=PHAuthorizationStatusAuthorized&&status!=PHAuthorizationStatusLimited){[weakSelf finish:@"failed"];return;}
        __block NSString *identifier;
        [PHPhotoLibrary.sharedPhotoLibrary performChanges:^{identifier=[PHAssetChangeRequest creationRequestForAssetFromImage:image].placeholderForCreatedAsset.localIdentifier;} completionHandler:^(BOOL success,NSError *error){dispatch_async(dispatch_get_main_queue(),^{
            if(![weakSelf.state isEqual:expected])return;
            if(!success||!identifier){[weakSelf finish:@"failed"];return;}
            KSShareMediaObject *object=[KSShareMediaObject new];object.disableFallback=YES;
            object.multipartAssets=@[[KSShareMediaAsset assetForPhotoLibrary:identifier isImage:YES]];
            KSShareMediaRequest *request=[KSShareMediaRequest new];request.state=expected;
            request.mediaFeature=KSShareMediaFeature_PictureEdit;request.mediaObject=object;
            [KSApi sendRequest:request completion:^(BOOL accepted){dispatch_async(dispatch_get_main_queue(),^{if(!accepted&&[weakSelf.state isEqual:expected])[weakSelf finish:@"failed"];});}];
        });}];
    });}];
}
-(void)ksApiDidReceiveResponse:(__kindof KSBaseResponse *)response {
    if(!self.pending||![response isKindOfClass:KSShareMediaResponse.class]||![response.state isEqual:self.state])return;
    [self finish:response.error.code==KSErrorCodeSuccess?@"handedOff":response.error.code==KSErrorCodeCancelled?@"cancelled":@"failed"];
}
-(void)finish:(NSString *)outcome{FlutterResult result=self.pending;self.pending=nil;self.state=nil;if(result)result(outcome);}
@end
