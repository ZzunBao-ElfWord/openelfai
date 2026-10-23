import Flutter
import UIKit
import WebKit

public final class OpenElfAliCaptchaPlugin: NSObject, FlutterPlugin {
    private var pendingResult: FlutterResult?
    private weak var captchaController: CaptchaViewController?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(
            name: "openelf_ali_captcha",
            binaryMessenger: registrar.messenger()
        )
        registrar.addMethodCallDelegate(OpenElfAliCaptchaPlugin(), channel: channel)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        guard call.method == "verifyCaptcha" else {
            result(FlutterMethodNotImplemented)
            return
        }
        guard let arguments = call.arguments as? [String: Any],
              let captchaId = arguments["captchaId"] as? String,
              !captchaId.isEmpty else {
            result(FlutterError(code: "PARAM_ERROR", message: "图形验证方案未配置", details: nil))
            return
        }
        guard captchaId.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            result(FlutterError(code: "PARAM_ERROR", message: "图形验证方案格式错误", details: nil))
            return
        }
        guard pendingResult == nil else {
            result(FlutterError(code: "CAPTCHA_BUSY", message: "已有进行中的验证", details: nil))
            return
        }
        guard let presenter = topViewController() else {
            result(FlutterError(code: "NO_ACTIVITY", message: "当前无法打开安全验证", details: nil))
            return
        }

        pendingResult = result
        let controller = CaptchaViewController(captchaId: captchaId)
        controller.onSuccess = { [weak self] proof in self?.finish(proof) }
        controller.onCancel = { [weak self] in self?.finish(nil) }
        controller.onError = { [weak self] message in
            self?.finish(error: FlutterError(code: "CAPTCHA_ERROR", message: message, details: nil))
        }
        captchaController = controller
        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .formSheet
        presenter.present(navigation, animated: true)
    }

    private func finish(_ proof: String?) {
        let result = pendingResult
        pendingResult = nil
        captchaController?.dismiss(animated: true)
        captchaController = nil
        result?(proof)
    }

    private func finish(error: FlutterError) {
        let result = pendingResult
        pendingResult = nil
        captchaController?.dismiss(animated: true)
        captchaController = nil
        result?(error)
    }

    private func topViewController() -> UIViewController? {
        let root: UIViewController?
        if #available(iOS 13.0, *) {
            root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow }?
                .rootViewController
        } else {
            root = UIApplication.shared.delegate?.window??.rootViewController
        }
        return top(from: root)
    }

    private func top(from controller: UIViewController?) -> UIViewController? {
        guard let controller = controller else { return nil }
        if let presented = controller.presentedViewController { return top(from: presented) }
        if let navigation = controller as? UINavigationController { return top(from: navigation.visibleViewController) }
        if let tabs = controller as? UITabBarController { return top(from: tabs.selectedViewController) }
        return controller
    }
}

private final class CaptchaViewController: UIViewController,
    WKScriptMessageHandler, WKNavigationDelegate {
    private let captchaId: String
    private var webView: WKWebView!
    private var responded = false
    var onSuccess: ((String) -> Void)?
    var onCancel: (() -> Void)?
    var onError: ((String) -> Void)?

    init(captchaId: String) {
        self.captchaId = captchaId
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "安全验证"
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "取消",
            style: .plain,
            target: self,
            action: #selector(cancel)
        )

        let configuration = WKWebViewConfiguration()
        let messages = WKUserContentController()
        messages.add(self, name: "captcha")
        messages.add(self, name: "captchaError")
        configuration.userContentController = messages
        configuration.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        view = webView

        guard let loader = loadCaptchaScript() else {
            respondWithError("图形验证组件缺失，请重新安装应用")
            return
        }
        let html = """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
        <style>
          body{margin:0;background:#fff;font-family:-apple-system,sans-serif}
          #captcha{position:absolute;top:50%;left:50%;width:260px;transform:translate(-50%,-50%)}
          #loading{position:fixed;top:calc(50% - 60px);left:50%;transform:translate(-50%,-50%);color:#999;font-size:14px}
        </style></head><body>
        <div id="loading">加载中...</div><div id="captcha"></div>
        <script>\(loader)</script>
        <script>
        function postMsg(name,data){window.webkit.messageHandlers[name].postMessage(data);}
        var config={
          captchaId:'\(captchaId)',product:'bind',https:true,
          onError:function(e){
            var msg=(e&&e.msg)?e.msg:((e&&e.code)?('code '+e.code):'init_failed');
            postMsg('captchaError',msg);
          }
        };
        window.initAlicom4(config,function(captcha){
          var shown=false;
          function show(){
            if(shown)return;shown=true;
            var el=document.getElementById('loading');if(el)el.style.display='none';
            captcha.showCaptcha();
          }
          captcha.onReady(function(){if(typeof captcha.onNextReady!=='function')show();});
          if(typeof captcha.onNextReady==='function')captcha.onNextReady(show);
          captcha.onSuccess(function(){
            var proof=captcha.getValidate();
            if(proof)postMsg('captcha',JSON.stringify(proof));
            else postMsg('captchaError','验证结果为空');
          });
          captcha.onClose(function(){postMsg('captcha','cancel');});
          captcha.onError(function(e){
            var detail=e&&e.desc&&e.desc.detail?(': '+e.desc.detail):'';
            var msg=(e&&e.msg)?e.msg:((e&&e.code)?('code '+e.code):'验证失败');
            postMsg('captchaError',msg+detail);
          });
        });
        </script></body></html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://captcha.alicaptcha.com"))
    }

    private func loadCaptchaScript() -> String? {
        let bundles = [Bundle(for: CaptchaViewController.self), Bundle.main]
        for bundle in bundles {
            if let url = bundle.url(forResource: "ct4", withExtension: "js"),
               let source = try? String(contentsOf: url, encoding: .utf8) {
                return source
            }
        }
        return nil
    }

    @objc private func cancel() {
        guard !responded else { return }
        responded = true
        onCancel?()
    }

    private func respondWithError(_ message: String) {
        guard !responded else { return }
        responded = true
        onError?(message)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        respondWithError("网络加载失败: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        respondWithError("网络加载失败: \(error.localizedDescription)")
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard !responded else { return }
        let body = message.body as? String ?? ""
        responded = true
        if message.name == "captcha", body == "cancel" {
            onCancel?()
        } else if message.name == "captcha" {
            onSuccess?(body)
        } else {
            onError?(body.isEmpty ? "验证失败" : body)
        }
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "captcha")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "captchaError")
    }
}
