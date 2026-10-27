import Flutter
import UIKit
import openelf_douyin_share

class SceneDelegate: FlutterSceneDelegate {
  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      if OpenElfDouyinSharePlugin.handleOpenURL(context.url) { return }
    }
    super.scene(scene, openURLContexts: URLContexts)
  }
}
