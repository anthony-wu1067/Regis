import SwiftUI
import WebKit
import AuthenticationServices
import WidgetKit

/// Hosts the Regis web app. The page talks to this shell through `window.webkit.messageHandlers.regis`:
///   {type:"auth", url}      -> open Google sign-in in the system sheet, answer via window.__regisAuthResult(callbackURL, error)
///   {type:"snapshot", data} -> store for the home-screen widgets
struct RegisWebView: UIViewRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(home: url) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        cfg.userContentController.add(context.coordinator, name: "regis")
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.043, green: 0.039, blue: 0.071, alpha: 1)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.scrollView.minimumZoomScale = 1
        web.scrollView.maximumZoomScale = 1
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsBackForwardNavigationGestures = false
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        if #available(iOS 16.4, *) { web.isInspectable = true }
        context.coordinator.web = web
        web.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, ASWebAuthenticationPresentationContextProviding {
        let home: URL
        weak var web: WKWebView?
        var session: ASWebAuthenticationSession?
        init(home: URL) {
            self.home = home
            super.init()
            NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
                // pick up a newly released version of the web app whenever you come back to Regis
                guard let web = self?.web, web.url == nil || web.isLoading == false else { return }
                if web.url == nil { web.load(URLRequest(url: home)) }
            }
        }

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "snapshot":
                if let data = body["data"], JSONSerialization.isValidJSONObject(data),
                   let json = try? JSONSerialization.data(withJSONObject: data), let s = String(data: json, encoding: .utf8) {
                    RegisStore.save(json: s)
                    WidgetCenter.shared.reloadAllTimelines()
                }
            case "auth":
                if let s = body["url"] as? String, let u = URL(string: s) { startAuth(u) }
            default: break
            }
        }

        private func startAuth(_ url: URL) {
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "regis") { [weak self] callback, error in
                DispatchQueue.main.async {
                    guard let web = self?.web else { return }
                    if let callback = callback {
                        let js = "window.__regisAuthResult && window.__regisAuthResult(\(Coordinator.q(callback.absoluteString)), null)"
                        web.evaluateJavaScript(js)
                    } else {
                        web.evaluateJavaScript("window.__regisAuthResult && window.__regisAuthResult(null, \(Coordinator.q(error?.localizedDescription ?? "cancelled")))")
                    }
                }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            s.start()
        }
        static func q(_ s: String) -> String {
            let d = try? JSONSerialization.data(withJSONObject: [s])
            let t = String(data: d ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
            return String(t.dropFirst().dropLast())
        }
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }

        // Links that leave Regis (Gmail, Drive, meeting links…) open in Safari / the right app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let u = action.request.url else { return decisionHandler(.allow) }
            let sameSite = u.host == home.host
            if action.navigationType == .linkActivated && !sameSite || u.scheme == "mailto" || u.scheme == "tel" {
                UIApplication.shared.open(u); return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, createWebViewWith cfg: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let u = action.request.url { UIApplication.shared.open(u) }
            return nil
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let html = "<body style='font:17px -apple-system;background:#0b0a12;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center'><div><h2>Can’t reach Regis</h2><p>Check your connection, then try again.</p><button onclick='location.href=\"\(home.absoluteString)\"' style='font-size:17px;padding:10px 20px;border-radius:10px'>Try again</button></div></body>"
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
