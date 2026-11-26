import SwiftUI

/**
 * Anime Kitsu is there: the addon that opens titles by their Kitsu id (their episodes, their art).
 * Anime Catalogs can too, but its server often doesn't answer (it timed out all of November 2026).
 */
func hasAnimeAddon(_ names: [String]) -> Bool {
    names.contains { $0.localizedCaseInsensitiveContains("kitsu") }
}

let animeKitsuAddon = "https://anime-kitsu.strem.fun/manifest.json"

/** An anime: by type, or by an anime site's id (Kitsu, MyAnimeList…) */
func isAnime(_ t: Title) -> Bool {
    t.type == "anime" || ["kitsu:", "mal:", "anilist:", "anidb:"].contains { t.id.hasPrefix($0) }
}

/** A Home row of anime: by type, by the addon that makes it, or by what's in it */
func isAnimeRow(_ r: Row) -> Bool {
    r.type == "anime" || r.addon.localizedCaseInsensitiveContains("anime") || r.addon.localizedCaseInsensitiveContains("kitsu")
        || (!r.items.isEmpty && r.items.filter(isAnime).count * 2 > r.items.count)
}

/**
 * Discover anime: the lists of the big anime sites (AniList, MyAnimeList, Kitsu), with each site's
 * scores on the posters. Titles open through the anime addons, by their Kitsu id.
 */
struct AnimeView: View {
    @Environment(Stremio.self) private var stremio
    @State var source: String
    @State var list: String
    @State private var sources = AnimeSource.all
    @State private var items: [Title] = []
    @State private var page = 0
    @State private var more = false
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                pills(sources.map { ($0.id, $0.name) }, selected: source) { id in
                    guard id != source else { return }
                    source = id
                    if let s = sources.first(where: { $0.id == id }), !s.lists.contains(where: { $0.id == list }) { list = s.lists.first?.id ?? "trending" }
                }
                pills((sources.first { $0.id == source }?.lists ?? []).map { ($0.id, $0.name) }, selected: list) { list = $0 }
                if !stremio.installedAddons.isEmpty, !hasAnimeAddon(stremio.installedAddons.map(\.name)) { AddAnimeAddon().padding(.horizontal, 16) }
                if let error, items.isEmpty, !loading {
                    Text(error).font(.subheadline).foregroundStyle(Dx.muted).padding(16)
                } else {
                    PosterGrid(items: items) { if more, !loading, page > 0 { load(page + 1) } }
                    if loading { ProgressView().frame(maxWidth: .infinity).padding(24) }
                }
            }
            .padding(.bottom, 40)
        }
        .screenBackground()
        .navigationTitle("Discover Anime")
        .task { let got = await stremio.animeSources(); if !got.isEmpty { sources = got } }
        .task(id: "\(source)/\(list)") {
            items = []
            page = 0
            error = nil
            loading = false
            load(1)
        }
    }

    private func pills(_ options: [(String, String)], selected: String, pick: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(options.map { AnimeSource.AnimeList(id: $0.0, name: $0.1) }) { option in
                    Button { pick(option.id) } label: {
                        Text(option.name).font(.subheadline.weight(.semibold)).padding(.horizontal, 6)
                    }
                    .dxGlassButton()
                    .tint(option.id == selected ? .white : nil)
                    .opacity(option.id == selected ? 1 : 0.75)
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
    }

    private func load(_ next: Int) {
        guard !loading else { return }
        loading = true
        let want = (source, list)
        Task {
            let got = await stremio.anime(want.0, want.1, page: next)
            // (another list was picked meanwhile)
            guard want == (source, list) else { return }
            var seen = Set<String>()
            items = (next == 1 ? got.items : items + got.items).filter { seen.insert($0.id).inserted }
            page = next
            more = got.more && !got.items.isEmpty
            error = items.isEmpty ? (got.error ?? "Nothing here right now.") : nil
            loading = false
        }
    }
}

/** Without an anime addon nothing could open these titles: one tap adds Anime Kitsu */
struct AddAnimeAddon: View {
    @Environment(Stremio.self) private var stremio
    @State private var busy = false
    @State private var said: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(said ?? "Anime open through the Anime Kitsu addon (their episodes and details), and it isn't added yet. It's free and needs no account.")
                .font(.footnote)
                .foregroundStyle(Dx.muted)
            if said == nil {
                Button(busy ? "Adding\u{2026}" : "Add Anime Kitsu") {
                    guard !busy else { return }
                    busy = true
                    Task {
                        let problem = await stremio.install(link: animeKitsuAddon)
                        said = problem ?? "Anime Kitsu is added."
                        busy = false
                    }
                }
                .dxGlassButton()
            }
        }
    }
}
