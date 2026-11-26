import Foundation
import Observation
import UIKit

/// The port a TV with the app listens on (TvReceiver.kt in the Android app)
private let tvPort = 47821

/**
 * Play on TV, this device's side: finds TVs on the home network that have the app open (the Android
 * TV app's TvReceiver.kt is what answers), sends the chosen stream there instead of playing it here,
 * and works that TV's player. While a TV is chosen, Play goes to it.
 *
 * The TV plays the stream itself (it's sent Stremio's link to it), so the TV keeps the watch
 * progress and carries on to the next episode whether or not this device stays awake.
 */
@MainActor
@Observable
final class TvRemote {
    static let shared = TvRemote()

    struct Tv: Hashable, Identifiable {
        var name: String
        var host: String
        var port: Int
        var id: String { "\(host):\(port)" }
    }

    struct Status {
        var open = false
        var title = ""
        var subtitle = ""
        var positionMs: Double = 0
        var durationMs: Double = 0
        var paused = false
        var buffering = false

        init(_ o: [String: Any]) {
            open = (o["open"] as? NSNumber)?.boolValue ?? false
            title = o["title"] as? String ?? ""
            subtitle = o["subtitle"] as? String ?? ""
            positionMs = (o["positionMs"] as? NSNumber)?.doubleValue ?? 0
            durationMs = (o["durationMs"] as? NSNumber)?.doubleValue ?? 0
            paused = (o["paused"] as? NSNumber)?.boolValue ?? false
            buffering = (o["buffering"] as? NSNumber)?.boolValue ?? false
        }
    }

    /// One thing to choose in the TV player's settings, and whether it is the one chosen
    struct Choice: Identifiable, Hashable {
        var id: String
        var name: String
        var on: Bool
    }

    /// The TV player's settings (PlayerOptions.kt on the TV): each a list to choose from
    struct Options {
        var audio: [Choice] = []
        var subtitles: [Choice] = []
        var subtitleDelayMs: Double = 0
        var speed: [Choice] = []
        var picture: [Choice] = []
        var zoom: [Choice] = []
        var sound: [Choice] = []
        var boost: [Choice] = []

        init(_ o: [String: Any]) {
            func list(_ name: String) -> [Choice] {
                let raw = o[name] as? [[String: Any]] ?? []
                return raw.map { Choice(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "", on: ($0["on"] as? NSNumber)?.boolValue ?? false) }
            }
            audio = list("audio")
            subtitles = list("subtitles")
            subtitleDelayMs = (o["subtitleDelayMs"] as? NSNumber)?.doubleValue ?? 0
            speed = list("speed")
            picture = list("picture")
            zoom = list("zoom")
            sound = list("sound")
            boost = list("boost")
        }
    }

    /// The TV player's settings, once asked for; nil when nothing plays or the TV app is an older one
    var options: Options?

    /// The TV that Play goes to (none: this device plays)
    var tv: Tv?
    /// TVs found on the network, the last one used first
    var found: [Tv] = []
    var searching = false
    /// A TV being asked to let this device in (its name), while the TV shows its question
    var connecting: String?
    /// What the TV is playing; nil until it has answered
    var status: Status?
    /// The chosen TV has stopped answering (asleep, or the app closed there)
    var lost = false
    /// Something to tell the viewer, shown in the sheet until the next thing happens
    var problem: String?
    /// The sheet with the TVs, or the remote, is open
    var sheet = false
    /// The app's own ask to show that sheet, wherever the viewer is (RootView presents it)
    var showRemote = false
    /// When Play was sent and the TV's player isn't up yet (nil: nothing on its way): the remote says it's starting
    var starting: Date?
    /// What the TV was playing when Play was sent ("title|subtitle"), so that isn't taken for the new one
    @ObservationIgnored private var playingBefore: String?
    /// "Play on This Device": the next Play stays here although a TV is chosen
    @ObservationIgnored var hereOnce = false

    @ObservationIgnored private var poll: Task<Void, Never>?
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private let quick = TvRemote.session(seconds: 4)
    /// (the TV's question waits for someone to reach its remote)
    @ObservationIgnored private let patient = TvRemote.session(seconds: 70)

    nonisolated private static func session(seconds: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = seconds
        config.timeoutIntervalForResource = seconds + 5
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config)
    }

    /// The page, to tell which TV can fetch torrents for this device (Stremio sets it)
    @ObservationIgnored weak var page: Page?

    /// Tells the page the chosen TV, which fetches torrents for this device when it has no streaming
    /// server (dxbi-tv.js; the TV's TvReceiver.kt passes them on): to play here or to download
    func shareTorrents() {
        var value = "null"
        if let tv { value = Json.encode(["base": "http://\(tv.host):\(tv.port)", "key": key]) }
        page?.js("window.__dxbiIos && (window.__dxbiIos.tvTorrents = \(value))")
    }

    /// This device's key: made once, and only ever sent to a TV the viewer picked
    private var key: String {
        if let saved = defaults.string(forKey: "tvRemote.key"), saved.count == 64 { return saved }
        let made = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        defaults.set(made, forKey: "tvRemote.key")
        return made
    }

    private var deviceName: String {
        let name = UIDevice.current.name
        return name.isEmpty ? "iPad" : name
    }

    /// The TV used last time, offered first (it isn't connected to until it's picked)
    private var last: Tv? {
        guard let saved = defaults.dictionary(forKey: "tvRemote.last"),
              let name = saved["name"] as? String, let host = saved["host"] as? String else { return nil }
        return Tv(name: name, host: host, port: saved["port"] as? Int ?? tvPort)
    }

    /// Whether Play goes to the TV this time (and uses up "Play on This Device")
    func takesPlay() -> Bool {
        if hereOnce {
            hereOnce = false
            return false
        }
        return tv != nil
    }

    // MARK: - Talking to a TV

    private struct Reply {
        var code: Int
        var json: [String: Any]
        var ok: Bool { code == 200 && ((json["ok"] as? NSNumber)?.boolValue ?? false) }
        var error: String { json["error"] as? String ?? "" }
    }

    private func call(_ tv: Tv, _ method: String, _ path: String, body: [String: Any]? = nil, keyed: Bool = false, wait: TimeInterval = 4) async -> Reply? {
        guard let url = URL(string: "http://\(tv.host):\(tv.port)/streamflix/\(path)") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = wait
        request.setValue("1", forHTTPHeaderField: "X-StreamFlix")
        if keyed { request.setValue(key, forHTTPHeaderField: "X-StreamFlix-Key") }
        if let body, let data = try? JSONSerialization.data(withJSONObject: body) {
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let session = wait > 10 ? patient : quick
        guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse else { return nil }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return Reply(code: http.statusCode, json: json)
    }

    /// As `call`, with this device's key; a TV that no longer knows the device asks its viewer again, once
    private func asked(_ tv: Tv, _ path: String, _ body: [String: Any], wait: TimeInterval = 4) async -> Reply? {
        let first = await call(tv, "POST", path, body: body, keyed: true, wait: wait)
        guard let first, first.code == 401 else { return first }
        let again = await call(tv, "POST", "pair", body: ["name": deviceName, "key": key], wait: 65)
        guard let again, again.ok else { return again }
        return await call(tv, "POST", path, body: body, keyed: true, wait: wait)
    }

    private func explain(_ reply: Reply?, _ tv: Tv) -> String {
        guard let reply else { return "\(tv.name) isn't answering. Is the app open on the TV?" }
        switch reply.error {
        case "background": return "Open the app on \(tv.name) first: it has to be on the TV's screen."
        case "declined": return "\(tv.name) said no to this device."
        case "unanswered": return "Nobody answered on \(tv.name). Pick Allow on the TV's screen."
        case "busy": return "\(tv.name) is asking about another device. Try again in a moment."
        case "nothing playing": return "Nothing is playing on \(tv.name)."
        default: return "\(tv.name) couldn't do that."
        }
    }

    // MARK: - Finding TVs

    /// This device's own IPv4 addresses on Wi-Fi or Ethernet
    nonisolated private static func ownAddresses() -> [String] {
        var result: [String] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        var item: UnsafeMutablePointer<ifaddrs>? = first
        while let current = item {
            let entry = current.pointee
            item = entry.ifa_next
            guard let address = entry.ifa_addr, address.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let flags = Int32(entry.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            guard String(cString: entry.ifa_name).hasPrefix("en") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let text = String(cString: host)
                if text.hasPrefix("192.168.") || text.hasPrefix("10.") || text.hasPrefix("172.") { result.append(text) }
            }
        }
        return result
    }

    /// Whether the app answers at an address: the TV's name, or nil
    private func probe(_ host: String, _ port: Int) async -> Tv? {
        guard let reply = await call(Tv(name: host, host: host, port: port), "GET", "info", wait: 1.2), reply.ok,
              reply.json["app"] as? String == "StreamFlix" else { return nil }
        let name = reply.json["name"] as? String ?? ""
        return Tv(name: name.isEmpty ? host : name, host: host, port: port)
    }

    /// Looks over this device's own network (the 254 addresses beside its own) for TVs with the app open
    func search() {
        guard !searching else { return }
        searching = true
        problem = nil
        let remembered = last
        Task {
            let own = TvRemote.ownAddresses()
            var hosts: [(String, Int)] = []
            if let remembered { hosts.append((remembered.host, remembered.port)) }
            for prefix in Set(own.compactMap { $0.split(separator: ".").count == 4 ? $0.split(separator: ".").dropLast().joined(separator: ".") : nil }) {
                for i in 1...254 {
                    let host = "\(prefix).\(i)"
                    if !own.contains(host), host != remembered?.host { hosts.append((host, tvPort)) }
                }
            }
            var tvs: [Tv] = []
            // (forty at a time: an address with nothing there takes a second to give up on)
            var next = 0
            while next < hosts.count {
                let batch = Array(hosts[next..<min(next + 40, hosts.count)])
                next += 40
                await withTaskGroup(of: Tv?.self) { group in
                    for (host, port) in batch { group.addTask { await self.probe(host, port) } }
                    for await tv in group {
                        if let tv, !tvs.contains(where: { $0.host == tv.host }) {
                            tvs.append(tv)
                            self.found = self.sorted(tvs, remembered)
                        }
                    }
                }
            }
            found = sorted(tvs, remembered)
            searching = false
        }
    }

    private func sorted(_ tvs: [Tv], _ remembered: Tv?) -> [Tv] {
        tvs.sorted { a, b in
            if (a.host == remembered?.host) != (b.host == remembered?.host) { return a.host == remembered?.host }
            return a.name.lowercased() < b.name.lowercased()
        }
    }

    // MARK: - Choosing one

    /// What the viewer typed: "192.168.1.20", or with ":port"
    func connect(address: String) {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("http://") { text.removeFirst(7) }
        while text.hasSuffix("/") { text.removeLast() }
        let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
        let host = parts.first ?? ""
        let port = parts.count > 1 ? Int(parts[1]) ?? tvPort : tvPort
        let allowed = host.allSatisfy { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }
        guard !host.isEmpty, allowed else {
            problem = "That doesn't look like an address. It's four numbers with dots, like 192.168.1.20."
            return
        }
        connect(Tv(name: host, host: host, port: port))
    }

    /// The TV asks its viewer, the first time, whether to let this device in: then Play goes there
    func connect(_ to: Tv) {
        guard connecting == nil else { return }
        problem = nil
        connecting = to.name
        Task {
            var named = to
            let info = await call(to, "GET", "info", wait: 2.5)
            var reply = info
            if let info, info.ok {
                if let name = info.json["name"] as? String, !name.isEmpty { named.name = name }
                reply = await call(named, "POST", "pair", body: ["name": deviceName, "key": key], wait: 65)
            }
            connecting = nil
            guard let reply, reply.ok else {
                problem = explain(reply, named)
                return
            }
            let remembered: [String: Any] = ["name": named.name, "host": named.host, "port": named.port]
            defaults.set(remembered, forKey: "tvRemote.last")
            status = nil
            lost = false
            tv = named
            shareTorrents()
            watch(named)
        }
    }

    func disconnect() {
        poll?.cancel()
        poll = nil
        tv = nil
        shareTorrents()
        status = nil
        options = nil
        lost = false
        problem = nil
        starting = nil
    }

    /// Keeps `status` current while a TV is chosen: every second while it plays or the remote is open
    private func watch(_ on: Tv) {
        poll?.cancel()
        poll = Task {
            var failures = 0
            while !Task.isCancelled, tv == on {
                let reply = await call(on, "GET", "status", keyed: true, wait: 2.5)
                if Task.isCancelled || tv != on { break }
                if let reply, reply.ok {
                    failures = 0
                    lost = false
                    status = Status(reply.json)
                    // (the player is up with the new film: its own buttons take over. A torrent can take
                    // a minute to start; the film already playing when Play was sent isn't it, unless
                    // it was the same one again)
                    if let since = starting {
                        let waited = Date().timeIntervalSince(since)
                        let now = status.map { "\($0.title)|\($0.subtitle)" }
                        if (status?.open == true && (now != playingBefore || waited > 25)) || waited > 120 { starting = nil }
                    }
                } else {
                    failures += 1
                    if failures >= 4 {
                        lost = true
                        status = nil
                    }
                }
                let busy = sheet || (status?.open ?? false) || starting != nil
                try? await Task.sleep(for: .seconds(busy ? 1 : 4))
            }
        }
    }

    // MARK: - What the screens ask of the chosen TV

    /// Sends Stremio's link to a stream (#/player/…) to the TV. What to tell the viewer about it
    func play(link: String) async -> String {
        guard let on = tv else { return "No TV is chosen." }
        guard link.hasPrefix("#/player/") else { return "That one can't be sent to the TV." }
        problem = nil
        // The remote comes up at once, wherever the viewer is, saying the film is starting, then with
        // the player's buttons (pause, subtitles…) as soon as the TV's player is up; or with why it
        // didn't play. (After a moment: the stream list's own sheet is still going away.)
        playingBefore = status.flatMap { $0.open ? "\($0.title)|\($0.subtitle)" : nil }
        starting = Date()
        requestRemote()
        let reply = await asked(on, "play", ["link": link], wait: 8)
        if let reply, reply.ok { return "Playing on \(on.name)" }
        starting = nil
        let why = explain(reply, on)
        problem = why
        return why
    }

    /// Shows the remote once nothing else is on screen or on its way (the stream list's sheet closing,
    /// or still opening when Just press Play closes it at once): a sheet asked for over another one
    /// doesn't come up. Gives up after about six seconds (the TV bar still opens it), and an ask that
    /// never came up is forgotten, so the bar and the TV button work again.
    func requestRemote() {
        Task {
            for _ in 0..<20 {
                let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
                if root?.presentedViewController == nil, root?.transitionCoordinator == nil {
                    showRemote = true
                    break
                }
                try? await Task.sleep(for: .milliseconds(300))
            }
            try? await Task.sleep(for: .seconds(1.5))
            if showRemote, !sheet { showRemote = false }
        }
    }

    func control(_ cmd: String, ms: Double = 0) {
        guard let on = tv else { return }
        Task {
            let reply = await asked(on, "control", ["cmd": cmd, "ms": Int(ms)])
            if let reply, reply.ok {
                status = Status(reply.json)
            } else if let reply, reply.error != "nothing playing" {
                problem = explain(reply, on)
            }
        }
    }

    /// Asks the TV for its player's settings (the remote does, every few seconds while it shows them)
    func loadOptions() {
        guard let on = tv else { return }
        Task {
            let reply = await call(on, "GET", "options", keyed: true)
            guard tv == on else { return }
            if let reply, reply.ok { options = Options(reply.json) } else { options = nil }
        }
    }

    /// Changes one of the TV player's settings (audio, subtitles, subtitleDelay, speed, picture, zoom, sound, boost)
    func setOption(_ name: String, _ value: String) {
        guard let on = tv else { return }
        Task {
            let reply = await asked(on, "option", ["name": name, "value": value])
            if let reply, reply.ok {
                options = Options(reply.json)
            } else if let reply, reply.error != "nothing playing" {
                problem = explain(reply, on)
            }
        }
    }

    func press(_ name: String) {
        guard let on = tv else { return }
        Task {
            let reply = await asked(on, "key", ["key": name])
            if reply?.ok != true { problem = explain(reply, on) }
        }
    }
}
