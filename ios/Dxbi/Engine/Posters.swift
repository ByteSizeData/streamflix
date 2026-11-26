import SwiftUI

/**
 * What a poster carries beside its art, wherever one is drawn: the ratings on it (dx.bi settings →
 * Ratings on posters) and how big posters are (Poster size). Stremio fills both in: the look from
 * dx.bi's settings, the scores as posters come into view (window.__dxbi.phone.scores, a batch at a time).
 */
@MainActor
@Observable
final class Posters {
    static let shared = Posters()

    /** A title's scores: IMDb's ("7.9"), Rotten Tomatoes' Tomatometer (93), or an anime site's */
    struct Scores: Hashable {
        var imdb: String?
        var rt: Int?
        var anime: ScoreBadge?

        init(_ o: JSON?) {
            imdb = o?.text("imdb")
            rt = (o?.isNull("rt") ?? true) ? nil : o?.int("rt")
            anime = o?.object("anime").flatMap { a in a.text("value").map { ScoreBadge(label: a.string("label"), value: $0) } }
        }
    }

    var ratings = true
    var size = "large"
    /** By "type:id" */
    var scores: [String: Scores] = [:]

    /** Asks for a title's scores (set by Stremio) */
    @ObservationIgnored var asker: ((Title) -> Void)?

    func want(_ title: Title) { asker?(title) }

    /** A poster's width in rows: iPad (regular width) or iPhone */
    func width(regular: Bool) -> CGFloat {
        switch size {
        case "standard": regular ? 150 : 110
        case "larger": regular ? 215 : 155
        case "huge": regular ? 260 : 185
        default: regular ? 180 : 132
        }
    }

    /** The narrowest a poster gets in a grid (as many to a line as fit) */
    func gridWidth(regular: Bool) -> CGFloat { width(regular: regular) * 0.85 }
}

/** One score on a poster: the site's tag and the score, on dark glass */
struct ScoreChip: View {
    var badge: ScoreBadge
    var small = false

    private var colours: (Color, Color) {
        switch badge.label {
        case "IMDb": (Color(red: 0.96, green: 0.77, blue: 0.09), .black)
        case "RT": (Int(badge.value.trimmingCharacters(in: CharacterSet(charactersIn: "%"))) ?? 0) >= 60
            ? (Color(red: 0.98, green: 0.2, blue: 0.04), .white) : (Color(red: 0.04, green: 0.78, blue: 0.33), .black)
        case "MAL": (Color(red: 0.18, green: 0.32, blue: 0.64), .white)
        case "AniList": (Color(red: 0.01, green: 0.66, blue: 1.0), .white)
        case "Kitsu": (Color(red: 0.97, green: 0.32, blue: 0.22), .white)
        default: (Color(red: 0.24, green: 0.71, blue: 0.95), .white)
        }
    }

    var body: some View {
        let (tag, ink) = colours
        HStack(spacing: 4) {
            Text(badge.label)
                .font(.system(size: small ? 8 : 9, weight: .black))
                .foregroundStyle(ink)
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(tag, in: .rect(cornerRadius: 2))
            Text(badge.value)
                .font(.system(size: small ? 10 : 12, weight: .bold))
                .foregroundStyle(.white)
        }
        .padding(.leading, 2)
        .padding(.trailing, 5)
        .padding(.vertical, 2)
        .background(.black.opacity(0.72), in: .rect(cornerRadius: 4))
    }
}

/**
 * The ratings in a poster's corner: IMDb and Rotten Tomatoes (an anime's site score when neither), or
 * what the list brought (Discover anime). Asked for as the poster comes into view.
 */
struct PosterBadges: View {
    var title: Title
    var width: CGFloat
    private var posters: Posters { .shared }

    var body: some View {
        let chips = badges
        Group {
            if posters.ratings, !chips.isEmpty {
                let layout = width >= 140 || chips.count == 1 ? AnyLayout(HStackLayout(spacing: 4)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
                layout {
                    ForEach(chips, id: \.self) { ScoreChip(badge: $0, small: width < 130) }
                }
                .padding(6)
            }
        }
        .task(id: title.id) { if title.badges.isEmpty, posters.ratings { posters.want(title) } }
    }

    private var badges: [ScoreBadge] {
        if !title.badges.isEmpty { return Array(title.badges.prefix(2)) }
        let s = posters.scores["\(title.type):\(title.id)"]
        var out: [ScoreBadge] = []
        if let imdb = s?.imdb ?? title.imdb { out.append(ScoreBadge(label: "IMDb", value: imdb)) }
        if let rt = s?.rt { out.append(ScoreBadge(label: "RT", value: "\(rt)%")) }
        if out.isEmpty, let anime = s?.anime { out.append(anime) }
        return out
    }
}
