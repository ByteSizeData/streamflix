import SwiftUI

// Play on TV (TvRemote.swift): the button that opens it, and the sheet with the TVs to pick from,
// which becomes that TV's remote once one is picked.

/// In Home's top bar: lit while a TV is chosen
struct TvButton: View {
    @Binding var open: Bool

    var body: some View {
        let remote = TvRemote.shared
        Button { open = true } label: {
            Image(systemName: remote.tv != nil ? "tv.fill" : "tv")
                .foregroundStyle(remote.tv != nil ? Dx.accent : Color.white)
        }
        .accessibilityLabel(remote.tv.map { "Playing on \($0.name)" } ?? "Play on TV")
    }
}

struct TvSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var typing = false
    @State private var address = ""
    /// While the knob is held it stays under the finger, not where the TV last said it was
    @State private var held: Double?

    var body: some View {
        let remote = TvRemote.shared
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let tv = remote.tv {
                        remoteView(remote, tv)
                    } else {
                        chooser(remote)
                    }
                    if let problem = remote.problem {
                        Text(problem).font(.subheadline).foregroundStyle(Dx.accent)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Dx.gutter)
            }
            .navigationTitle(remote.tv?.name ?? "Play on TV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if remote.tv != nil { Button("Disconnect") { remote.disconnect() } }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(.white)
        .task { if TvRemote.shared.tv == nil { TvRemote.shared.search() } }
        // (the TV player's settings, asked for again every few seconds: the tracks change with the
        // episode, and the TV's own remote may change the rest)
        .task {
            while !Task.isCancelled {
                if TvRemote.shared.tv != nil { TvRemote.shared.loadOptions() }
                try? await Task.sleep(for: .seconds(4))
            }
        }
        // (the TV is asked where it is every second while this is open)
        .onAppear { TvRemote.shared.sheet = true }
        .onDisappear { TvRemote.shared.sheet = false }
    }

    // MARK: - Picking a TV

    @ViewBuilder
    private func chooser(_ remote: TvRemote) -> some View {
        Text("Open dx.bi on your TV, then pick it here. What you play goes to the TV, and this becomes its remote.")
            .font(.subheadline)
            .foregroundStyle(Dx.muted)
        if let name = remote.connecting {
            HStack(spacing: 12) {
                ProgressView()
                Text("Look at \(name): the first time, it asks there whether to let this in. Pick Allow.")
                    .font(.subheadline)
            }
        } else {
            ForEach(remote.found) { tv in
                Button { remote.connect(tv) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "tv").font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tv.name).font(.headline)
                            Text(tv.host).font(.caption).foregroundStyle(Dx.faint)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(Dx.raised, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
            if remote.searching {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Looking for TVs on your Wi-Fi\u{2026}").font(.subheadline).foregroundStyle(Dx.muted)
                }
            } else if remote.found.isEmpty {
                Text("No TV found. The app has to be open on the TV's screen, and this has to be on the same Wi-Fi as the TV.")
                    .font(.subheadline)
                    .foregroundStyle(Dx.muted)
            }
            HStack(spacing: 22) {
                if !remote.searching {
                    Button("Look Again") { remote.search() }.font(.subheadline.weight(.bold))
                }
                if !typing {
                    Button("Type the TV's Address") { typing = true }.font(.subheadline.weight(.bold))
                }
            }
            if typing {
                Text("It's in the TV's own Settings, under Network: four numbers with dots.")
                    .font(.caption)
                    .foregroundStyle(Dx.muted)
                HStack(spacing: 10) {
                    TextField("192.168.1.20", text: $address)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Dx.raised, in: RoundedRectangle(cornerRadius: 10))
                        .onSubmit { remote.connect(address: address) }
                    Button("Connect") { remote.connect(address: address) }
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Color.black)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    // MARK: - The chosen TV's remote

    @ViewBuilder
    private func remoteView(_ remote: TvRemote, _ tv: TvRemote.Tv) -> some View {
        if remote.lost {
            Text("\(tv.name) isn't answering. Is the app still open on the TV?")
                .font(.subheadline)
                .foregroundStyle(Dx.muted)
        } else if let now = remote.status {
            if now.open {
                playing(remote, now)
            } else {
                Text("Nothing is playing on the TV. Pick a film or an episode here and press Play: it opens on \(tv.name).")
                    .font(.subheadline)
                    .foregroundStyle(Dx.muted)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(20)
        }
        pad(remote)
    }

    @ViewBuilder
    private func playing(_ remote: TvRemote, _ now: TvRemote.Status) -> some View {
        let length = max(now.durationMs, 0)
        let at = held ?? (length > 0 ? min(max(now.positionMs / length, 0), 1) : 0)
        VStack(alignment: .leading, spacing: 4) {
            Text(now.title.isEmpty ? "Playing" : now.title).font(.title3.weight(.bold)).lineLimit(2)
            if !now.subtitle.isEmpty { Text(now.subtitle).font(.subheadline).foregroundStyle(Dx.muted).lineLimit(1) }
        }
        Slider(
            value: Binding(get: { at }, set: { held = $0 }),
            in: 0...1,
            onEditingChanged: { editing in
                if !editing {
                    if let to = held, length > 0 { remote.control("seek", ms: to * length) }
                    held = nil
                }
            }
        )
        .tint(Dx.accent)
        .disabled(length <= 0)
        HStack {
            Text(Self.clock(at * length)).font(.caption).foregroundStyle(Dx.muted)
            Spacer()
            Text(now.buffering ? "Loading\u{2026}" : Self.clock(length)).font(.caption).foregroundStyle(Dx.muted)
        }
        HStack {
            Spacer()
            round("gobackward.10", "Back 10 seconds") { remote.control("seekBy", ms: -10_000) }
            Spacer()
            round(now.paused ? "play.fill" : "pause.fill", now.paused ? "Play" : "Pause", big: true) { remote.control("toggle") }
            Spacer()
            round("goforward.10", "Forward 10 seconds") { remote.control("seekBy", ms: 10_000) }
            Spacer()
            round("stop.fill", "Stop") { remote.control("close") }
            Spacer()
        }
        settings(remote)
    }

    /// The TV player's own settings, the ones its remote's menus have. Chosen here, they change on the TV.
    @ViewBuilder
    private func settings(_ remote: TvRemote) -> some View {
        if let o = remote.options {
            Text("Video settings").font(.headline).padding(.top, 6)
            chips("Audio", o.audio) { remote.setOption("audio", $0) }
            chips("Subtitles", o.subtitles) { remote.setOption("subtitles", $0) }
            if o.subtitles.contains(where: { $0.on && $0.id != "off" }) {
                let moved = o.subtitleDelayMs == 0 ? "on time" : String(format: "%+.2f s", o.subtitleDelayMs / 1000)
                chips("Subtitle timing · \(moved)", [
                    TvRemote.Choice(id: "-250", name: "Earlier", on: false),
                    TvRemote.Choice(id: "250", name: "Later", on: false),
                    TvRemote.Choice(id: "0", name: "Reset", on: o.subtitleDelayMs == 0),
                ]) { remote.setOption("subtitleDelay", $0) }
            }
            chips("Volume boost", o.boost) { remote.setOption("boost", $0) }
            chips("Sound", o.sound) { remote.setOption("sound", $0) }
            chips("Speed", o.speed) { remote.setOption("speed", $0) }
            chips("Picture", o.picture) { remote.setOption("picture", $0) }
            chips("Zoom", o.zoom) { remote.setOption("zoom", $0) }
        }
    }

    /// One setting: its name, then what there is to choose from in a row that slides sideways
    @ViewBuilder
    private func chips(_ label: String, _ choices: [TvRemote.Choice], pick: @escaping (String) -> Void) -> some View {
        if !choices.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(label).font(.caption).foregroundStyle(Dx.faint)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(choices) { c in
                            Button { pick(c.id) } label: {
                                Text(c.name)
                                    .font(.subheadline.weight(c.on ? .bold : .medium))
                                    .lineLimit(1)
                                    .foregroundStyle(c.on ? Color.black : Color.white)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 9)
                                    .background(c.on ? Color.white : Dx.raised, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    /// The TV remote's arrows, for the TV's own screens: its menus, a question it asks
    @ViewBuilder
    private func pad(_ remote: TvRemote) -> some View {
        Text("TV remote").font(.caption).foregroundStyle(Dx.faint)
        HStack(alignment: .center) {
            Spacer()
            VStack(spacing: 12) {
                round("arrow.uturn.backward", "Back") { remote.press("back") }
                round("speaker.wave.1.fill", "Volume down") { remote.press("voldown") }
            }
            Spacer()
            VStack(spacing: 8) {
                round("chevron.up", "Up") { remote.press("up") }
                HStack(spacing: 8) {
                    round("chevron.left", "Left") { remote.press("left") }
                    Button { remote.press("ok") } label: {
                        Text("OK").font(.headline.weight(.black)).foregroundStyle(Color.black)
                            .frame(width: 64, height: 64)
                            .background(Color.white, in: Circle())
                    }
                    .buttonStyle(.plain)
                    round("chevron.right", "Right") { remote.press("right") }
                }
                round("chevron.down", "Down") { remote.press("down") }
            }
            Spacer()
            VStack(spacing: 12) {
                Color.clear.frame(width: 52, height: 52)
                round("speaker.wave.3.fill", "Volume up") { remote.press("volup") }
            }
            Spacer()
        }
    }

    private func round(_ symbol: String, _ label: String, big: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(big ? .title.weight(.bold) : .title3.weight(.semibold))
                .foregroundStyle(big ? Color.black : Color.white)
                .frame(width: big ? 68 : 52, height: big ? 68 : 52)
                .background(big ? Color.white : Dx.raised, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private static func clock(_ ms: Double) -> String {
        let s = max(Int(ms / 1000), 0)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}
