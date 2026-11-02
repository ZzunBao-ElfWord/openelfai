import Flutter
import UIKit
import StoreKit
import Photos

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "OpenElfPoster") {
      let channel = FlutterMethodChannel(name: "openelf/poster", binaryMessenger: registrar.messenger())
      var saving = false
      channel.setMethodCallHandler { call, result in
        guard call.method == "save" else { result(FlutterMethodNotImplemented); return }
        guard let args = call.arguments as? [String: Any],
              let bytes = args["png"] as? FlutterStandardTypedData,
              bytes.data.count >= 8, bytes.data.count <= 10 * 1024 * 1024,
              bytes.data.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]),
              UIImage(data: bytes.data) != nil else {
          result(FlutterError(code: "INVALID_IMAGE", message: "分享图片无效", details: nil))
          return
        }
        guard !saving else {
          result(FlutterError(code: "SAVE_BUSY", message: "图片正在保存", details: nil)); return
        }
        saving = true
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
          guard status == .authorized || status == .limited else {
            DispatchQueue.main.async {
              saving = false
              result(FlutterError(code: "PHOTO_PERMISSION_DENIED", message: "未获得添加照片权限", details: nil))
            }
            return
          }
          PHPhotoLibrary.shared().performChanges({
            let options = PHAssetResourceCreationOptions()
            options.originalFilename = "OpenElf_\(UUID().uuidString).png"
            PHAssetCreationRequest.forAsset().addResource(with: .photo, data: bytes.data, options: options)
          }) { success, _ in
            DispatchQueue.main.async {
              saving = false
              if success { result("gallery") }
              else { result(FlutterError(code: "SAVE_FAILED", message: "海报保存失败", details: nil)) }
            }
          }
        }
      }
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "OpenElfPayments") {
      let channel = FlutterMethodChannel(name: "openelf/payments", binaryMessenger: registrar.messenger())
      channel.setMethodCallHandler { call, result in
        guard call.method == "getEnvironment", Bundle.main.bundleIdentifier == "com.ai.openelf" else {
          result(FlutterMethodNotImplemented)
          return
        }
        Task { @MainActor in
          if #available(iOS 16.0, *) {
            do {
              if case .verified(let transaction) = try await AppTransaction.shared {
                switch transaction.environment {
                case .production: result("Production")
                case .sandbox: result("Sandbox")
                case .xcode: result("Xcode")
                default: result(FlutterError(code: "UNKNOWN_STORE", message: "Unknown App Store environment", details: nil))
                }
                return
              }
            } catch { /* Development builds may not have an app transaction yet. */ }
          }
          let receipt = Bundle.main.appStoreReceiptURL
          if receipt?.lastPathComponent == "sandboxReceipt" {
            result("Sandbox")
          } else if let receipt = receipt, FileManager.default.fileExists(atPath: receipt.path) {
            result("Production")
          } else {
            #if DEBUG
            result("Sandbox")
            #else
            result(FlutterError(code: "UNKNOWN_STORE", message: "App Store environment is unavailable", details: nil))
            #endif
          }
        }
      }
    }
  }
}
