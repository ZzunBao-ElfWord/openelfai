#import "OpenElfDouyinSharePlugin.h"
#import <Photos/Photos.h>
#import <UIKit/UIKit.h>
#import <DouyinOpenSDK/DouyinOpenSDKApplicationDelegate.h>
#import <DouyinOpenSDK/DouyinOpenSDKShare.h>

static NSString * const ClientKey = @"awf8w18qtnqq1kum";
static __weak OpenElfDouyinSharePlugin *sharedPlugin;

@interface OpenElfDouyinSharePlugin ()
@property(nonatomic, copy) FlutterResult pending;
@property(nonatomic, copy) NSString *requestState;
@property(nonatomic, strong) DouyinOpenSDKShareRequest *request;
@property(nonatomic, assign) BOOL initialized;
@end

@implementation OpenElfDouyinSharePlugin
+ (void)registerWithRegistrar:(NSObject<FlutterPluginRegistrar> *)registrar {
    OpenElfDouyinSharePlugin *plugin = [OpenElfDouyinSharePlugin new];
    sharedPlugin = plugin;
    FlutterMethodChannel *channel = [FlutterMethodChannel methodChannelWithName:@"openelf/douyin_share" binaryMessenger:registrar.messenger];
    [registrar addMethodCallDelegate:plugin channel:channel];
    [registrar addApplicationDelegate:plugin];
}
+ (BOOL)handleOpenURL:(NSURL *)url {
    if (!sharedPlugin.initialized || ![url.scheme isEqualToString:ClientKey]) return NO;
    return [[DouyinOpenSDKApplicationDelegate sharedInstance] application:UIApplication.sharedApplication openURL:url sourceApplication:nil annotation:nil];
}
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
    return [OpenElfDouyinSharePlugin handleOpenURL:url];
}
- (BOOL)installed {
    return [UIApplication.sharedApplication canOpenURL:[NSURL URLWithString:@"douyinsharesdk://"]]
        || [UIApplication.sharedApplication canOpenURL:[NSURL URLWithString:@"snssdk1128://"]];
}
- (void)handleMethodCall:(FlutterMethodCall *)call result:(FlutterResult)result {
    if ([call.method isEqualToString:@"availability"]) {
        BOOL configured = [[NSBundle.mainBundle objectForInfoDictionaryKey:@"DouyinAppID"] isEqualToString:ClientKey];
        result(!configured ? @"integrationPending" : [self installed] ? @"ready" : @"notInstalled"); return;
    }
    if (![call.method isEqualToString:@"shareImage"]) { result(FlutterMethodNotImplemented); return; }
    NSDictionary *args = [call.arguments isKindOfClass:NSDictionary.class] ? call.arguments : @{};
    FlutterStandardTypedData *typed = [args[@"png"] isKindOfClass:FlutterStandardTypedData.class] ? args[@"png"] : nil;
    NSData *png = typed.data;
    NSString *scene = args[@"scene"];
    UIImage *image = png.length <= 8 * 1024 * 1024 ? [UIImage imageWithData:png] : nil;
    if (![args[@"clientKey"] isEqual:ClientKey] || ![args[@"privacyConsent"] isEqual:@YES] || !image
        || !([scene isEqual:@"contacts"] || [scene isEqual:@"story"])) {
        result([FlutterError errorWithCode:@"INVALID_SHARE" message:@"分享素材或授权无效" details:nil]); return;
    }
    if (self.pending) { result([FlutterError errorWithCode:@"SHARE_BUSY" message:@"分享正在进行" details:nil]); return; }
    if (![self installed]) { result([FlutterError errorWithCode:@"DOUYIN_UNAVAILABLE" message:@"请先安装或更新抖音" details:nil]); return; }
    self.pending = result; self.requestState = NSUUID.UUID.UUIDString;
    NSString *state = self.requestState;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 180 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if ([weakSelf.requestState isEqual:state]) [weakSelf finish:@"failed"];
    });
    // Consent is requested by Flutter on every share, before SDK initialization.
    if (!self.initialized) {
        DouyinOpenSDKApplicationDelegate *sdk = [DouyinOpenSDKApplicationDelegate sharedInstance];
        if (![sdk registerAppId:ClientKey]) { [self finish:@"failed"]; return; }
        sdk.openAutoTracker = NO;
        [sdk application:UIApplication.sharedApplication didFinishLaunchingWithOptions:nil];
        self.initialized = YES;
    }
    [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite handler:^(PHAuthorizationStatus status) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (![weakSelf.requestState isEqual:state]) return;
            if (status != PHAuthorizationStatusAuthorized && status != PHAuthorizationStatusLimited) {
                [weakSelf finish:@"failed"]; return;
            }
            __block NSString *identifier;
            [PHPhotoLibrary.sharedPhotoLibrary performChanges:^{
                PHAssetChangeRequest *creation = [PHAssetChangeRequest creationRequestForAssetFromImage:image];
                identifier = creation.placeholderForCreatedAsset.localIdentifier;
            } completionHandler:^(BOOL success, NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (![weakSelf.requestState isEqual:state]) return;
                    if (!success || !identifier) { [weakSelf finish:@"failed"]; return; }
                    // The user was told a new share image stays in the photo library.
                    DouyinOpenSDKShareRequest *request = [DouyinOpenSDKShareRequest new];
                    request.localIdentifiers = @[identifier];
                    request.mediaType = DouyinOpenSDKShareMediaTypeImage;
                    request.state = state;
                    request.shareAction = [scene isEqual:@"contacts"] ? DouyinOpenSDKShareTypeShareContentToIM : DouyinOpenSDKShareTypePublishMedia;
                    if ([scene isEqual:@"story"]) { request.publishStory = YES; request.useNewShareAbility = YES; }
                    weakSelf.request = request;
                    BOOL accepted = [request sendShareRequestWithCompleteBlock:^(DouyinOpenSDKShareResponse *response) {
                        dispatch_async(dispatch_get_main_queue(), ^{
                            if (![weakSelf.requestState isEqual:state]) return;
                            if (![response.state isEqual:state]) { [weakSelf finish:@"failed"]; return; }
                            BOOL cancelled = response.errCode == DouyinOpenSDKErrorCodeUserCanceled || response.shareState == DouyinOpenSDKShareRespStateCancel;
                            [weakSelf finish:cancelled ? @"cancelled" : response.isSucceed ? @"handedOff" : @"failed"];
                        });
                    }];
                    if (!accepted) [weakSelf finish:@"failed"];
                });
            }];
        });
    }];
}
- (void)finish:(NSString *)outcome {
    FlutterResult callback = self.pending;
    self.pending = nil; self.request = nil; self.requestState = nil;
    if (callback) callback(outcome);
}
@end
