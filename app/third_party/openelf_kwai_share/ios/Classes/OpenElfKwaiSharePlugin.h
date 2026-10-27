#import <Flutter/Flutter.h>
@interface OpenElfKwaiSharePlugin:NSObject<FlutterPlugin>
+(BOOL)handleOpenURL:(NSURL *)url NS_SWIFT_NAME(handleOpenURL(_:));
+(BOOL)handleUniversalLink:(NSUserActivity *)activity NS_SWIFT_NAME(handleUniversalLink(_:));
@end
