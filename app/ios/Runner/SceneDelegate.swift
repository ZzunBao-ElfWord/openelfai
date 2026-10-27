import Flutter
import UIKit
import openelf_douyin_share
import openelf_wechat_share

class SceneDelegate: FlutterSceneDelegate {
  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      if OpenElfWechatSharePlugin.handleOpenURL(context.url) { return }
      if OpenElfDouyinSharePlugin.handleOpenURL(context.url) { return }
    }
    super.scene(scene, openURLContexts: URLContexts)
  }
  override func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    if OpenElfWechatSharePlugin.handleUniversalLink(userActivity) { return }
    super.scene(scene, continue: userActivity)
  }
}
