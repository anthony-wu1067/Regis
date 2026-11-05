import SwiftUI

@main
struct RegisApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .background(Color(red: 0.043, green: 0.039, blue: 0.071).ignoresSafeArea())
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    @State private var address = RegisAddress.current
    @State private var draft = ""
    var body: some View {
        if let url = address {
            RegisWebView(url: url)
        } else {
            VStack(spacing: 16) {
                Text("Regis").font(.largeTitle.bold()).foregroundColor(.white)
                Text("Enter the address of your Regis site (it looks like https://yourname.github.io/regis/).")
                    .multilineTextAlignment(.center).foregroundColor(.gray).padding(.horizontal)
                TextField("https://…", text: $draft)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    .padding(12).background(Color.white.opacity(0.1)).cornerRadius(10).foregroundColor(.white).padding(.horizontal)
                Button("Open Regis") {
                    if let u = RegisAddress.normalize(draft) { UserDefaults.standard.set(u.absoluteString, forKey: "regis_url"); address = u }
                }.buttonStyle(.borderedProminent)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding()
        }
    }
}

enum RegisAddress {
    /// Address saved in Settings → Regis, else the one the build put in Info.plist.
    static var current: URL? {
        if let s = UserDefaults.standard.string(forKey: "regis_url"), let u = normalize(s) { return u }
        if let s = Bundle.main.object(forInfoDictionaryKey: "RegisURL") as? String, !s.contains("__REGIS_URL__"), let u = normalize(s) { return u }
        return nil
    }
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.hasPrefix("http") { s = "https://" + s }
        if !s.hasSuffix("/") && !s.contains("?") && (URL(string: s)?.pathExtension.isEmpty ?? true) { s += "/" }
        guard let u = URL(string: s), u.scheme == "https", u.host != nil else { return nil }
        return u
    }
}
