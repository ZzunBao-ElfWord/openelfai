#import "OpenElfWechatSharePlugin.h"
#import <UIKit/UIKit.h>
#import "WXApi.h"
#import "WXApiObject.h"
#include <string.h>

static __weak OpenElfWechatSharePlugin *sharedPlugin;
@interface OpenElfWechatSharePlugin () <WXApiDelegate>
@property(nonatomic,copy) FlutterResult pending;
@property(nonatomic,copy) NSString *requestID;
@property(nonatomic,copy) NSString *registeredAppID;
@end
@implementation OpenElfWechatSharePlugin
+ (void)registerWithRegistrar:(NSObject<FlutterPluginRegistrar> *)registrar {
    OpenElfWechatSharePlugin *plugin = [OpenElfWechatSharePlugin new]; sharedPlugin = plugin;
    FlutterMethodChannel *channel = [FlutterMethodChannel methodChannelWithName:@"openelf/wechat_share" binaryMessenger:registrar.messenger];
    [registrar addMethodCallDelegate:plugin channel:channel];
    [registrar addApplicationDelegate:plugin];
}
+ (BOOL)handleOpenURL:(NSURL *)url {
    if (!sharedPlugin.pending || ![url.scheme isEqual:sharedPlugin.registeredAppID]) return NO;
    return [WXApi handleOpenURL:url delegate:sharedPlugin];
}
+ (BOOL)handleUniversalLink:(NSUserActivity *)activity {
    NSURL *url = activity.webpageURL;
    if (!sharedPlugin.pending || ![url.scheme isEqual:@"https"] || ![url.host isEqual:@"openelfai.com"] || ![url.path hasPrefix:@"/app/"]) return NO;
    return [WXApi handleOpenUniversalLink:activity delegate:sharedPlugin];
}
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
    return [OpenElfWechatSharePlugin handleOpenURL:url];
}
- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)activity restorationHandler:(void (^)(NSArray *))restorationHandler {
    return [OpenElfWechatSharePlugin handleUniversalLink:activity];
}
- (BOOL)configured:(NSString *)appID link:(NSString *)link {
    if (![appID isKindOfClass:NSString.class] || ![link isEqual:@"https://openelfai.com/app/"]) return NO;
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^wx[0-9a-fA-F]{16}$" options:0 error:nil];
    if ([pattern numberOfMatchesInString:appID options:0 range:NSMakeRange(0,appID.length)] != 1) return NO;
    if (![[NSBundle.mainBundle objectForInfoDictionaryKey:@"WechatShareAppID"] isEqual:appID]) return NO;
    for (NSDictionary *type in [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleURLTypes"]) {
        if ([type[@"CFBundleURLSchemes"] containsObject:appID]) return YES;
    }
    return NO;
}
- (void)handleMethodCall:(FlutterMethodCall *)call result:(FlutterResult)result {
    if (![call.method isEqual:@"availability"] && ![call.method isEqual:@"shareImage"]) { result(FlutterMethodNotImplemented); return; }
    NSDictionary *args = [call.arguments isKindOfClass:NSDictionary.class] ? call.arguments : @{};
    NSString *appID = args[@"appId"];
    if (![self configured:appID link:args[@"universalLink"]]) { result(@"integrationPending"); return; }
    BOOL installed = [UIApplication.sharedApplication canOpenURL:[NSURL URLWithString:@"weixin://"]];
    if ([call.method isEqual:@"availability"]) { result(installed ? @"ready" : @"notInstalled"); return; }
    if (self.pending || !installed) { result(@"failed"); return; }
    FlutterStandardTypedData *typed = [args[@"png"] isKindOfClass:FlutterStandardTypedData.class] ? args[@"png"] : nil;
    NSData *png = typed.data; NSString *scene = args[@"scene"];
    const unsigned char signature[] = {137,80,78,71,13,10,26,10};
    if (![args[@"privacyConsent"] isEqual:@YES] || png.length < 8 || png.length > 8*1024*1024 ||
        memcmp(png.bytes,signature,8) != 0 || !([scene isEqual:@"session"] || [scene isEqual:@"timeline"])) { result(@"failed"); return; }
    UIImage *image = [UIImage imageWithData:png];
    if (!image || image.size.width > 4096 || image.size.height > 4096) { result(@"failed"); return; }
    // Registration only after explicit user consent. No auth/pay or Photos API.
    if (![self.registeredAppID isEqual:appID]) {
        if (![WXApi registerApp:appID universalLink:args[@"universalLink"]]) { result(@"failed"); return; }
        self.registeredAppID = appID;
    }
    self.pending = result; self.requestID = NSUUID.UUID.UUIDString;
    NSString *expected = self.requestID;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,180*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        if ([weakSelf.requestID isEqual:expected]) [weakSelf finish:@"failed"];
    });
    WXImageObject *object = [WXImageObject object]; object.imageData = png;
    WXMediaMessage *message = [WXMediaMessage message]; message.mediaObject = object;
    CGFloat scale = MIN(1.0,96.0/MAX(image.size.width,image.size.height));
    UIGraphicsBeginImageContextWithOptions(CGSizeMake(image.size.width*scale,image.size.height*scale),YES,1);
    [image drawInRect:CGRectMake(0,0,image.size.width*scale,image.size.height*scale)];
    UIImage *thumbnail = UIGraphicsGetImageFromCurrentImageContext(); UIGraphicsEndImageContext();
    NSData *thumbData = UIImageJPEGRepresentation(thumbnail,0.65);
    if (thumbData.length <= 32*1024) message.thumbData = thumbData;
    SendMessageToWXReq *request = [SendMessageToWXReq new]; request.bText = NO; request.message = message;
    request.scene = [scene isEqual:@"timeline"] ? WXSceneTimeline : WXSceneSession;
    [WXApi sendReq:request completion:^(BOOL accepted) {
        dispatch_async(dispatch_get_main_queue(),^{
            if (!accepted && [weakSelf.requestID isEqual:expected]) [weakSelf finish:@"failed"];
        });
    }];
}
- (void)onReq:(BaseReq *)req {}
- (void)onResp:(BaseResp *)resp {
    // iOS share responses have no request transaction field. Single-flight only;
    // this is an SDK signal, NEVER proof of publication or entitlement/reward.
    if (!self.pending || ![resp isKindOfClass:SendMessageToWXResp.class]) return;
    [self finish:resp.errCode == 0 ? @"handedOff" : resp.errCode == -2 ? @"cancelled" : @"failed"];
}
- (void)finish:(NSString *)outcome {
    FlutterResult callback = self.pending; self.pending = nil; self.requestID = nil;
    if (callback) callback(outcome);
}
@end
