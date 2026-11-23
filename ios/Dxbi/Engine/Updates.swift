import Foundation
import UIKit

/**
 * A new StreamFlix for iPhone release, offered once: the app looks at the GitHub releases of the
 * repository it was built from (as the Android apps do) and, when there's a newer one with a
 * streamflix.ipa, offers to open its page (an IPA is installed with SideStore, AltStore or Sideloadly,
 * which can't be done from inside the app).
 */
@MainActor
enum Updates {
    struct Release: Identifiable {
        var version: String
        var page: URL
        var id: String { version }
    }

    /** The repository it was built from (the Info.plist's, set by the build) */
    static let repo: String = Bundle.main.object(forInfoDictionaryKey: "DxbiUpdateRepo") as? String ?? "ByteSizeData/streamflix"
    private static let asset = "streamflix.ipa"
    private static let recheck: TimeInterval = 6 * 60 * 60
    private static var lastCheck: Date = .distantPast
    private static let defaults = UserDefaults.standard

    /** A newer release to offer, or nil (none, offline, or skipped) */
    static func check() async -> Release? {
        guard Date().timeIntervalSince(lastCheck) > recheck, !repo.isEmpty, repo.contains("/") else { return nil }
        lastCheck = Date()
        var found = await fromApi()
        if found == nil { found = await fromPage() }
        guard let found else { return nil }
        guard isNewer(found.version, than: Page.version), defaults.string(forKey: "update.skipped") != found.version else { return nil }
        return found
    }

    static func skip(_ release: Release) { defaults.set(release.version, forKey: "update.skipped") }

    /** GitHub's API: the latest release, if it has the IPA (fully uploaded) */
    private static func fromApi() async -> Release? {
        guard let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("dxbi-ios", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let o = (try? JSONSerialization.jsonObject(with: data)) as? JSON,
              o.objects("assets").contains(where: { $0.string("name") == asset && ($0.text("state") ?? "uploaded") == "uploaded" }),
              let page = URL(string: o.string("html_url")) else { return nil }
        return Release(version: o.string("tag_name").replacingOccurrences(of: "v", with: ""), page: page)
    }

    /** GitHub's API allows few checks per connection; the releases page redirects to the latest tag without a limit */
    private static func fromPage() async -> Release? {
        guard let latest = URL(string: "https://github.com/\(repo)/releases/latest") else { return nil }
        var head = URLRequest(url: latest)
        head.httpMethod = "HEAD"
        guard let (_, response) = try? await URLSession.shared.data(for: head), let page = response.url,
              let tag = page.pathComponents.last, tag.hasPrefix("v"),
              let file = URL(string: "https://github.com/\(repo)/releases/download/\(tag)/\(asset)") else { return nil }
        var probe = URLRequest(url: file)
        probe.httpMethod = "HEAD"
        guard let (_, fileResponse) = try? await URLSession.shared.data(for: probe), (fileResponse as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return Release(version: String(tag.dropFirst()), page: page)
    }

    // MARK: - The plugin, between app releases

    // An IPA can only be put on the device by the app that signs it, so a new app release is a
    // trip through that app. Most of what changes from release to release is the plugin, though,
    // and that the app can fetch itself, as the Android apps do: a newer one from the latest
    // release is kept and used from the next start.
    private static let pluginName = "dxbi.plugin.js"
    private static var fetchedPlugin: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent(pluginName)
    }

    /** The plugin to run: the one the app came with, or a newer one fetched since */
    static func plugin(bundled: String) -> String {
        guard let file = fetchedPlugin, let fetched = try? String(contentsOf: file, encoding: .utf8) else { return bundled }
        if isNewer(pluginVersion(fetched), than: pluginVersion(bundled)) { return fetched }
        try? FileManager.default.removeItem(at: file) // the app itself has caught up
        return bundled
    }

    private static var lastPluginCheck: Date = .distantPast

    /** Looks in the latest release for a plugin newer than the one running, and keeps it for the next start */
    static func checkPlugin() async {
        guard Date().timeIntervalSince(lastPluginCheck) > recheck else { return }
        lastPluginCheck = Date()
        guard !repo.isEmpty, repo.contains("/"), let file = fetchedPlugin,
              let own = Bundle.main.url(forResource: pluginName, withExtension: nil),
              let bundled = try? String(contentsOf: own, encoding: .utf8),
              let url = URL(string: "https://github.com/\(repo)/releases/latest/download/\(pluginName)") else { return }
        let running = plugin(bundled: bundled)
        var request = URLRequest(url: url)
        request.setValue("dxbi-ios", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let text = String(data: data, encoding: .utf8),
              // (a whole plugin, not an error page or half a download)
              text.contains("@name "), text.contains("PLUGIN_VERSION"), text.count > bundled.count / 2,
              isNewer(pluginVersion(text), than: pluginVersion(running)) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        // (written whole or not at all: half a plugin would carry its new version and never be fetched again)
        try? data.write(to: file, options: .atomic)
    }

    /** The number after "@version" in a plugin's header */
    static func pluginVersion(_ source: String) -> String {
        guard let at = source.range(of: "@version") else { return "0" }
        let rest = source[at.upperBound...].drop(while: { $0 == " " || $0 == "\t" })
        return String(rest.prefix(while: { $0.isNumber || $0 == "." }))
    }

    static func isNewer(_ candidate: String, than current: String) -> Bool {
        let a = candidate.split(separator: ".").map { Int($0) ?? 0 }
        let b = current.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
