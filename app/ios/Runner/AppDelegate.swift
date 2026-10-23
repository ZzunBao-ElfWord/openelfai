import Flutter
import UIKit
import StoreKit

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
