// node tools/quick-play-test.mjs: which stream "Just press Play" picks, and that it never starts a debrid download
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "dxbi.plugin.js"), "utf8");
const start = source.indexOf("  const FLAG_LANG = {");
const end = source.indexOf("  const streamTools = {");
assert.ok(start > 0 && end > start, "stream parser found");
const { describeStream, streamChoice, streamPrefs, streamList, NOT_LISTED, langFlag } = vm.runInNewContext(`${source.slice(start, end)}
  ({ describeStream, streamChoice, streamPrefs, streamList, NOT_LISTED, langFlag })`);

const item = (name, desc, hint = {}, torrent = false) => ({ d: describeStream(name, `${name}\n${desc}`), hint, torrent, label: desc });
const cached4k = item("[RD+] Torrentio\n4k", "Film.2160p.WEB-DL.HDR 👤 40 💾 18 GB ⚙️ RARBG");
const cachedDv = item("[RD+] Torrentio\n4k", "Film.2160p.BluRay.DV 👤 80 💾 30 GB");
const cached1080 = item("[RD+] Torrentio\n1080p", "Film.1080p.WEB-DL 👤 12 💾 4 GB");
const remux = item("[RD+] Torrentio\n4k", "Film.2160p.Remux.HDR 💾 80 GB");
const uncached = item("[RD download] Torrentio\n4k", "Film.2160p.Remux.HDR 👤 900 💾 80 GB");
const cam = item("[RD+] Torrentio\n1080p", "Film.1080p.HDCAM 💾 2 GB");
const torrent = item("Torrentio\n1080p", "Film.1080p.BluRay 👤 300 💾 9 GB", {}, true);
const pick = (items, memory, options) => streamChoice.choose(items, memory, options)?.item.label ?? null;

assert.equal(describeStream("[RD download] Torrentio", "").pending, true);
assert.equal(describeStream("[RD+] Torrentio", "").pending, false);
assert.equal(describeStream("[TB ⚡] Comet", "").instant, true);
assert.equal(describeStream("Torrentio", "").pending, false);
console.log("PASS cached, uncached and plain torrents are told apart");

// Meteor's real description, and a season pack: the file's size, not the pack's
const meteor = describeStream("[P2P] Meteor\n2160p", "📁 Show.S01E01.2160p.mkv\n📺 2160p | remux | hdr10 | h265\n💾 31.07 GiB / 295.96 GiB   👥 30 seeders   ⚙️ FGT");
assert.equal(Math.round(meteor.size / 2 ** 30), 31);
assert.equal(meteor.seeds, 30);
assert.equal(meteor.site, "FGT");
assert.equal(describeStream("Comet", "💾 700 MiB").size, 700 * 2 ** 20);
assert.equal(describeStream("Comet", "💾 1,5 GB").size, 1.5e9);
assert.equal(describeStream("Comet | TB", "Film.1080p.mkv").size, 0);
console.log("PASS sizes in GiB, MiB and GB");

assert.equal(pick([uncached, cam]), null, "nothing safe to start");
assert.equal(pick([uncached, cached1080]), cached1080.label, "never starts a debrid download");
assert.equal(pick([cam, cached1080]), cached1080.label, "never a cinema recording");
console.log("PASS never starts a debrid download or a cinema recording");

assert.equal(pick([cached1080, cached4k]), cached4k.label);
assert.equal(pick([cachedDv, cached4k]), cached4k.label, "HDR before Dolby Vision");
assert.equal(pick([remux, cached4k]), cached4k.label, "an encode before a remux");
assert.equal(pick([torrent, cached1080]), cached1080.label, "ready to play before a torrent");
console.log("PASS ready, then quality, then what keeps playing");

assert.equal(pick([cached4k, cached1080], null, { limit: 1080 }), cached1080.label);
assert.equal(pick([cached4k], null, { limit: 1080 }), cached4k.label, "better too high than nothing");
assert.equal(pick([torrent], null, { torrents: false }), null, "no torrents without a server");
console.log("PASS quality limit and torrents without a server");

const hinted = item("[RD+] Other\n1080p", "Show.S01E02.1080p", { bingeGroup: "group-a" });
assert.equal(streamChoice.choose([cached4k, hinted], { bingeGroup: "group-a" }).how, "same");
assert.equal(pick([cached4k, cached1080], { res: 1080, provider: "Torrentio", langs: [NOT_LISTED] }), cached1080.label, "stays at the chosen quality");
const italian = item("[RD+] Torrentio\n1080p", "Film.1080p.WEB 🇮🇹 💾 4 GB");
assert.equal(pick([cached4k, cached1080, italian], { res: 1080, provider: "Torrentio", langs: ["Italian"] }), italian.label, "stays in the chosen language");
console.log("PASS remembers release, quality and language");

const gone = { res: 720, provider: "Nobody", langs: [] };
assert.equal(pick([cached1080], gone, { fallback: "ask" }), null, "asked to show the list");
assert.equal(pick([cached1080], gone, { fallback: "best" }), cached1080.label);
console.log("PASS missing choice: next best, or the list");

const spareA = item("[RD+] Torrentio\n1080p", "A.1080p.WEB 💾 4 GB", { infoHash: "a" });
const spareB = item("[RD+] Torrentio\n720p", "B.720p.WEB 💾 1 GB", { infoHash: "b" });
const sameRelease = item("[RD+] Other\n4k", "A.2160p.WEB 💾 9 GB", { infoHash: "a" });
const labels = (list) => Array.from(list, (x) => x.label);
assert.deepEqual(labels(streamChoice.spares([spareA, spareB, uncached, cam], spareA)), [spareB.label], "never a download or a cam");
assert.deepEqual(labels(streamChoice.spares([spareA, sameRelease, spareB], spareA)), [spareB.label], "not the same release again");
assert.equal(streamChoice.spares([cached4k, cachedDv, cached1080, remux, spareB], cached4k).length, 2, "two tries at most");
assert.deepEqual(labels(streamChoice.spares([cached4k, cachedDv, cached1080], cached4k)), [cached1080.label, cachedDv.label], "Dolby Vision is the last resort");
assert.deepEqual(labels(streamChoice.spares([cached4k, cachedDv], cached4k)), [cachedDv.label], "but still tried when it's all there is");
console.log("PASS a failed pick moves on to a different safe release");

const upscaled = item("[RD+] Torrentio\n4k", "Breaking Bad. S01. 2008 2160P.Ai Upscaled.BluRay.60FPS.H265");
const real1080 = item("[RD+] Torrentio\n1080p", "Breaking.Bad.S01.1080p.BluRay.x265");
const threeD = item("[RD+] Torrentio\n1080p", "Film.2010.1080p.3D.HSBS.BluRay");
assert.equal(pick([upscaled, real1080]), real1080.label, "real 1080p before fake 4K");
assert.equal(pick([threeD, real1080]), real1080.label, "2D before 3D");
assert.equal(pick([upscaled]), upscaled.label, "still plays if it's all there is");
console.log("PASS upscaled and 3D copies come after real ones");

const details = describeStream("[RD+] Torrentio\n1080p", "[RD+] Torrentio\nFilm.1080p.WEB.x265\n👤 12 💾 4.2 GB ⚙️ RARBG");
assert.equal(details.seeds, 12);
assert.equal(details.site, "RARBG");
assert.equal(details.codec, "HEVC");
assert.equal(details.provider, "Torrentio");
console.log("PASS seeds, provider, site and codec are read");

const yts = item("[TB+] Torrentio\n1080p", "Film.2016.1080p.BluRay.x264-[YTS.AG] 👤 500 💾 1.6 GB ⚙️ YTS");
const dubbed = item("[TB+] Torrentio\n1080p", "Anime.S01E01.Dual-Audio.1080p.WEB 👤 50 💾 1.4 GB ⚙️ NyaaSi");
assert.equal(yts.d.yts, true);
assert.equal(describeStream("Torrentio", "Film.1080p.WEB 👤 9 💾 2 GB ⚙️ YTS").yts, true, "the site tag counts too");
assert.equal(cached1080.d.yts, false);
assert.equal(dubbed.d.dub, false, "a second track with no language named is only a guess");
assert.equal(dubbed.d.dual, true);
assert.equal(describeStream("Torrentio", "Show.S01.1080p.DUBBED.WEB").dub, true);
assert.equal(describeStream("Torrentio", "Anime.S01.1080p.Dual.Audio 🇯🇵 🇬🇧").dub, true, "an anime's dual audio is its English dub");
assert.equal(describeStream("Torrentio", "Film.1080p.English.Dub.WEB 🇯🇵").dub, true);
assert.equal(describeStream("Torrentio", "Abracadabra.1993.1080p-Dual-Lat 🇲🇽").dub, false, "a dub into another language isn't an English one");
assert.equal(describeStream("Torrentio", "Film.1080p.Hindi.Dubbed.WEB").dub, false);
assert.equal(describeStream("Torrentio", "Film.1080p.Multi.Audio 🇫🇷 🇩🇪").dub, false);
assert.equal(describeStream("Torrentio", "Film.1080p.Multi.Audio 🇫🇷 🇬🇧").dub, false, "English beside French is the French dub of an English film");
assert.equal(describeStream("Torrentio", "V.for.Vendetta.2005.2160p.Dual.Audio.DDP5.1 🇬🇧 🇮🇳").dub, false, "the Hindi dub of an English film");
assert.equal(cached1080.d.dub, false);
assert.equal(pick([cached4k, yts]), cached4k.label, "no preference: quality decides");
streamPrefs.set("yts", false);
assert.equal(pick([cached4k, yts]), yts.label, "the chosen site first");
assert.equal(pick([uncached, yts, cached4k]), yts.label, "but never a download");
streamPrefs.set("none", true);
const animeDub = item("[TB+] Torrentio\n1080p", "Anime.S01E01.Dual.Audio.1080p.WEB 🇯🇵 🇬🇧 👤 50 💾 1.4 GB");
assert.equal(pick([cached4k, dubbed]), cached4k.label, "on a film or show, dubs don't count");
assert.equal(pick([cached4k, animeDub]), cached4k.label, "not even one said outright");
streamPrefs.set("none", true, true);
assert.equal(pick([cached4k, animeDub]), animeDub.label, "on an anime's page, dubbed first");
assert.equal(pick([cached4k, dubbed]), dubbed.label, "there, an unnamed second track is the English dub");
assert.equal(pick([cached4k, cached1080]), cached4k.label, "no dub around: quality decides");
// Among an anime's English dubs: ready to play first (it has to start and keep playing), then the
// best picture, then the most seeds; a dub nobody shares doesn't lead
const dub4kMany = item("Torrentio\n4k", "Anime.S01.2160p.Dual.Audio.WEB 🇯🇵 🇬🇧 👤 300 💾 30 GB");
const dub4kFew = item("Torrentio\n4k", "Anime.S01.2160p.Dual.Audio.BluRay.HDR 🇯🇵 🇬🇧 👤 3 💾 40 GB");
const dub4kDead = item("Torrentio\n4k", "Anime.S01.2160p.Dual.Audio.BluRay 🇯🇵 🇬🇧 👤 1 💾 40 GB");
const dub1080cached = item("[TB+] Torrentio\n1080p", "Anime.S01.1080p.Dual.Audio.WEB 🇯🇵 🇬🇧 💾 9 GB");
const dub4kCached = item("[TB+] Torrentio\n4k", "Anime.S01.2160p.Dual.Audio.WEB 🇯🇵 🇬🇧 💾 31 GB");
const dub1080Many = item("Torrentio\n1080p", "Anime.S01.1080p.Dual.Audio.WEB 🇯🇵 🇬🇧 👤 900 💾 9 GB");
assert.equal(pick([cached4k, dub1080cached, dub4kFew, dub4kMany]), dub1080cached.label, "a dub ready to play before a 4K one that has to download");
assert.equal(pick([dub1080cached, dub4kCached, dub4kMany]), dub4kCached.label, "a 4K dub ready to play before a 1080p one");
assert.equal(pick([dub4kFew, dub4kMany, dub1080Many]), dub4kMany.label, "none ready: the 4K dub most people share");
assert.equal(pick([cached4k, dub1080cached]), dub1080cached.label, "a dub, ready to play, before a 4K that isn't one");
assert.equal(pick([dub4kDead, dub1080cached]), dub1080cached.label, "a dub nobody shares doesn't lead");
assert.equal(pick([dub4kDead, cached4k]), cached4k.label, "nor beats what plays");
streamPrefs.set("none", true);
streamPrefs.set("none", false);
assert.equal(pick([cached4k, yts, dubbed]), cached4k.label, "preferences off again");
console.log("PASS a chosen release site and dubs lead when asked");

// Each language keeps the flag the addon listed it with, in order; one said only in words gets its usual flag
const flagsOf = (desc) => {
  const d = describeStream("Torrentio", desc);
  return Object.fromEntries(d.langs.map((l, i) => [l, d.flags[i]]));
};
assert.deepEqual(flagsOf("Film.1080p.WEB 🇬🇧 / 🇷🇺"), { English: "GB", Russian: "RU" });
assert.deepEqual([...describeStream("Torrentio", "Film.1080p.WEB 🇷🇺 / 🇬🇧").flags], ["RU", "GB"], "in the order listed");
assert.deepEqual(flagsOf("Film.1080p.WEB 🇺🇸"), { English: "US" }, "the flag as the addon gave it");
assert.deepEqual(flagsOf("Film.1080p.WEB 🇵🇰"), { PK: "PK" }, "a flag that names no language is its own");
assert.deepEqual(flagsOf("Film.1080p.Latino.Dual.Audio.Hindi.English"), { "Dual audio": "", English: "GB", "Spanish (Latino)": "MX", Hindi: "IN" });
assert.deepEqual(flagsOf("Film.1080p.WEB"), { [NOT_LISTED]: "" }, "not listed: no flag");
assert.deepEqual(["English", "Spanish", "Spanish (Latino)", "Portuguese (Brazil)", "Japanese", "Korean", "Hindi", "Chinese", "Arabic", "Thai", "Multi audio", "Dual audio", NOT_LISTED].map(langFlag),
  ["GB", "ES", "MX", "BR", "JP", "KR", "IN", "CN", "SA", "TH", "", "", ""]);
console.log("PASS each language keeps its flag, and one said only in words gets its usual one");

// A title not in English: what its addon says of it (a language first, else the first country listed)
const titled = (meta) => { const t = streamPrefs.titleOf(meta); return t && { ...t }; };
assert.deepEqual(titled({ country: "South Korea" }), { foreign: true, tongue: "Korean" }, "Parasite, Squid Game");
assert.deepEqual(titled({ country: "United States, United Kingdom" }), { foreign: false, tongue: "" }, "V for Vendetta");
assert.deepEqual(titled({ country: "Germany, United States" }), { foreign: true, tongue: "German" }, "Dark: the first country decides");
assert.deepEqual(titled({ country: "United Kingdom, United States" }), { foreign: false, tongue: "" });
assert.deepEqual(titled({ country: "Spain", language: "Spanish, Russian, Serbian, English" }), { foreign: true, tongue: "Spanish" }, "Money Heist");
assert.deepEqual(titled({ country: "United States", original_language: "ko" }), { foreign: true, tongue: "Korean" }, "a language given wins over the countries");
assert.deepEqual(titled({ country: "Japan", language: "English" }), { foreign: false, tongue: "" });
assert.deepEqual(titled({ country: "Canada", original_language: "xx" }), { foreign: false, tongue: "" }, "no language: the country");
assert.deepEqual(titled({ country: "Iceland" }), { foreign: true, tongue: "" }, "a country not known to speak English");
assert.deepEqual(titled({ country: "India" }), { foreign: true, tongue: "" }, "RRR, K.G.F: India's films come in many of its languages");
assert.deepEqual(titled({ country: "Hong Kong, China" }), { foreign: true, tongue: "" }, "…and Hong Kong's in Cantonese and Mandarin");
assert.deepEqual(titled({ language: "en-US" }), { foreign: false, tongue: "" }, "a code with its region");
assert.deepEqual(titled({ original_language: "en_GB" }), { foreign: false, tongue: "" });
assert.deepEqual(titled({ language: "pt-BR" }), { foreign: true, tongue: "Portuguese" });
assert.deepEqual(titled({ country: "United States", original_language: "ko-KR" }), { foreign: true, tongue: "Korean" });
assert.deepEqual(titled({ language: "kor" }), { foreign: true, tongue: "Korean" }, "a code of three letters");
assert.deepEqual(titled({ language: "eng" }), { foreign: false, tongue: "" });
assert.deepEqual(titled({ languages: ["fre", "eng"] }), { foreign: true, tongue: "French" });
assert.deepEqual(titled({ language: "und-US", country: "France" }), { foreign: true, tongue: "French" }, "no language, with a region: the country");
assert.equal(titled({ name: "No details" }), null);
assert.equal(titled(null), null);
console.log("PASS a title is foreign by its language, else by the first country it is from");

// …and its English dub. Addons list subtitles among a release's languages, so English only counts where
// the release's own words leave room for it. (Parasite's and Squid Game's streams, as Torrentio lists them)
const torrentio = (desc) => describeStream("Torrentio\n1080p", `Torrentio\n1080p\n${desc}`);
const englishOf = (desc) => torrentio(desc).english;
assert.equal(englishOf("Parasite.2019.4K.HDR.DV.2160p.BDRemux Ita Eng x265-NAHOM 👤 24 💾 77.51 GB ⚙️ ilCorSaRoNeRo 🇬🇧 / 🇮🇹"), true, "English said as its sound");
assert.equal(englishOf("Squid.Game.S01.DUAL-AUDIO.KOR-ENG.1080p.10bit.WEBRip.6CH.x265.HEVC-PSA 💾 849.58 MB ⚙️ 1337x Dual Audio / 🇬🇧 / 🇰🇷"), true);
assert.equal(englishOf("Squid Game Season 1 S01 1080p Dual Audio Rip AAC5.1 10bit x265-R 💾 808.49 MB ⚙️ ThePirateBay Dual Audio / 🇬🇧"), true, "listed, and no other language said");
assert.equal(englishOf("Parasite (2019) (2160p BluRay x265 HEVC 10bit HDR AAC 7.1 Bandi) [QxR] 💾 15.75 GB ⚙️ 1337x 🇬🇧 / 🇪🇸 / 🇰🇷 / 🇨🇳 / 🇫🇷"), true);
assert.equal(englishOf("Игра в кальмара / Squid Game / Сезон: 1 [2021 WEB-DLRip 2160p SDR] Dub + MVO (LostFilm) + Eng + Original Kor + Sub Rus Eng 💾 6.75 GB ⚙️ Rutracker 🇬🇧 / 🇷🇺 / 🇰🇷"), true, "an English track beside the Russian ones");
assert.equal(englishOf("Parasite (2019) BluRay 1080p.H264 Ita Kor AC3 5.1 Sub Ita Eng MIRCrew 💾 2.88 GB ⚙️ ilCorSaRoNeRo 🇬🇧 / 🇮🇹 / 🇰🇷"), false, "English subtitles");
assert.equal(englishOf("Parasitos [BluRay 1080p HEVC X265][AC3 5.1 Castellano AC3 5.1-Coreano+Subs][ES-EN] 💾 6.54 GB ⚙️ MejorTorrent 🇬🇧 / 🇪🇸 / 🇰🇷"), false);
assert.equal(englishOf("Parasite.2019.KOREAN.1080p.WEBRip.ENG.SUBS 💾 2 GB ⚙️ 1337x 🇬🇧 / 🇰🇷"), false);
assert.equal(englishOf("Parasite.2019.KOREAN.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-RARBG 💾 11.94 GB ⚙️ TorrentGalaxy 🇬🇧 / 🇰🇷"), false, "it says it sounds Korean");
assert.equal(englishOf("Parasite 2019.MULTi.UHD.Bluray.2160p.HDR.Atmos.7.1.HEVC.(Kor Fr)-DDR 💾 20.19 GB ⚙️ TorrentGalaxy Multi Audio / 🇬🇧 / 🇰🇷 / 🇫🇷"), false);
assert.equal(englishOf("Parasitos.2019.DOBLADA.EN.CASTELLANO.DVDRip.x264.DD5.1-URBiN4HD 💾 1.79 GB ⚙️ ThePirateBay 🇬🇧 / 🇪🇸"), false, "the Spanish dub");
const rutracker = torrentio("Паразиты / Parasite / Gisaengchung [2019 UHD BDRemux 2160p HDR10] [FRA] Dub + 2x MVO + DVO+ AVO + Original (Kor) + Sub (Rus Eng) 💾 84.16 GB ⚙️ Rutracker 🇬🇧 / 🇷🇺 / 🇰🇷 / 🇫🇷");
assert.equal(rutracker.ru && !rutracker.english, true, "a Russian tracker's Dub is the Russian one");
assert.equal(englishOf("Parasite.2019.KOREAN.1080p.BluRay.x264.DTS-FGT 💾 11.99 GB ⚙️ RARBG 🇰🇷"), false);
// (English said only as subtitles, though no other language is named: Amélie's, Dark's)
assert.equal(englishOf("Amelie 2001 English subs BluRay Rip ⚙️ ThePirateBay"), false, "English subs");
assert.equal(englishOf("Dark.S01.SweSub-EngSub.1080p.x264-Justiso ⚙️ ThePirateBay 🇬🇧 / 🇸🇪"), false, "EngSub, joined");
assert.equal(englishOf("[BluRay 1080p - REPACK - SUBS: FR EN ES] Le fabuleux destin d'Amélie Poulain (2001) ⚙️ 1337x 🇬🇧 / 🇪🇸 / 🇫🇷"), false, "SUBS: FR EN ES");
assert.equal(englishOf("Amelie AKA Le Fabuleux Destin d'Amélie Poulain (2001) (EN subs EN & FR commentaries) 720p.10bit.BluRay.x265-budgetbits ⚙️ 1337x 🇬🇧 / 🇫🇷"), false);
assert.equal(englishOf("Oldboy.2003.KOR.1080p.BluRay.Eng.Hardsub.x264 ⚙️ 1337x 🇬🇧 / 🇰🇷"), false, "English burnt into the picture");
assert.equal(englishOf("[Erai-raws] Sen to Chihiro no Kamikakushi [1080p][Multiple Subtitle].mkv ⚙️ NyaaSi Multi Subs / 🇬🇧 / 🇷🇺 / 🇮🇹"), false);
// (…and English said as its sound beside its subtitles still is)
assert.equal(englishOf("Dark S01 1080p NF WEBRip English German x264 DD 5.1 MSubs - LOKi ⚙️ ThePirateBay Multi Subs / 🇬🇧 / 🇩🇪"), true, "English German, with MSubs");
assert.equal(englishOf("Spirited Away (2001) [BD 1080p] [Dub - Japanese English Arabic] [Sub - English Arabic] ⚙️ NyaaSi Dubbed / Dual Audio / 🇬🇧 / 🇸🇦"), true);
// (several tracks said, and subtitles too: a Crunchyroll release's flags are its dubs)
assert.equal(englishOf("[ToonsHub] A Silent Voice (2016) 1080p CR WEB-DL MULTi AAC2.0 H.264 (Multi-Audio Multi-Subs) 👤 30 💾 8.28 GB ⚙️ NyaaSi Dubbed / Multi Audio / Multi Subs / 🇬🇧 / 🇵🇹 / 🇲🇽 / 🇫🇷 / 🇩🇪"), true, "Multi-Audio Multi-Subs");
assert.equal(englishOf("[yolerejiju] Grave of the Fireflies AKA Hotaru no haka 1988 1080p BD AAC 2.0 x264 [Audio: Multi] [Sub: Multi] 👤 11 💾 12.34 GB ⚙️ NyaaSi Dubbed / Multi Audio / 🇬🇧 / 🇮🇹 / 🇵🇹 / 🇪🇸"), true, "[Audio: Multi] [Sub: Multi]");
// (subbed and subtitled are subtitles too)
assert.equal(englishOf("Your Name (2016) 1080p BluRay English Subbed ⚙️ 1337x 🇬🇧"), false, "English Subbed");
assert.equal(englishOf("Train.to.Busan.2016.1080p.BluRay.x264.Eng.Subbed ⚙️ 1337x 🇬🇧"), false, "Eng.Subbed");
assert.equal(englishOf("Your Name (2016) 1080p BluRay [English Subtitled] ⚙️ 1337x 🇬🇧"), false, "English Subtitled");

const korean = { foreign: true, tongue: "Korean" };
const netflixDual = torrentio("Squid.Game.S01.DUAL.1080p.WEBRip.x265-KONTRAST 💾 1.2 GB ⚙️ TorrentGalaxy Dual Audio / 🇰🇷");
const frenchMulti = torrentio("Squid Game S01 MULTi 1080p WEB AV1 E-AC-3 -Tsundere-Raws (NF) (VF FRENCH VOSTFR Multi-Audio) 💾 2.29 GB ⚙️ EXT Multi Audio / 🇫🇷");
const englishTrack = torrentio("Squid.Game.S01.DUAL-AUDIO.KOR-ENG.1080p.WEBRip 💾 849.58 MB ⚙️ 1337x Dual Audio / 🇬🇧 / 🇰🇷");
const subbed = torrentio("Parasite (2019) BluRay 1080p.H264 Ita Kor AC3 5.1 Sub Ita Eng MIRCrew 💾 2.88 GB ⚙️ ilCorSaRoNeRo 🇬🇧 / 🇮🇹 / 🇰🇷");
streamPrefs.set("none", true, false, korean);
assert.equal(streamPrefs.englishDub(englishTrack), true);
assert.equal(streamPrefs.englishDub(netflixDual), true, "a second track beside only the title's own language");
assert.equal(streamPrefs.englishDub(frenchMulti), false, "…not beside French");
assert.equal(streamPrefs.englishDub(subbed), false);
assert.equal(streamPrefs.englishDub(rutracker), false, "nor a Russian tracker's Dub");
assert.equal(streamPrefs.englishDub(dubbed.d), true, "an unnamed second track");
assert.equal(streamPrefs.englishDub(torrentio("Squid.Game.S01.COMPLETE.DUBBED.720p.NF.WEBRip.x264-GalaxyTV ⚙️ ThePirateBay")), true, "a dub said outright");
streamPrefs.set("none", true, false, { foreign: true, tongue: "" });
assert.equal(streamPrefs.englishDub(netflixDual), false, "the title's own language unknown: only an unnamed second track");
assert.equal(streamPrefs.englishDub(englishTrack), true);
// RRR and K.G.F (Cinemeta: India): their Hindi dual releases are no English dub, nor is a Hindi "Dubbed"
streamPrefs.set("yts", true, false, titled({ country: "India" }));
assert.equal(streamPrefs.englishDub(torrentio("RRR (2022) DUAL (Hindi Telugu) (1080p NF WEBRip x265 HEVC 10bit DDP Atmos 5.1 ESub) - [Musafirboy] ⚙️ 1337x Dual Audio / 🇮🇳")), false, "Hindi and Telugu");
assert.equal(streamPrefs.englishDub(torrentio("RRR.2022.2160p.WEB-DL.Dual.Audio.DDP5.1.Atmos.H265-TRF 💾 13.81 GB ⚙️ TorrentGalaxy Dual Audio / 🇮🇳")), false);
assert.equal(streamPrefs.englishDub(torrentio("KGF Chapter 1 (2018) DUAL (KAN HIN) (2160p AMZN WEBRip x265 HEVC 10bit DDP 5.1 ESub) - [Musafirboy] ⚙️ 1337x Dual Audio / 🇮🇳")), false, "Kannada and Hindi");
assert.equal(streamPrefs.englishDub(torrentio("RRR (2022) 1080p PreDVDRip Hindi Dubbed (Audio Cleaned) - QRips ⚙️ ThePirateBay 🇮🇳")), false);
assert.equal(streamPrefs.englishDub(torrentio("Spirited Away (2001) 1080p BluRay x264 Multi Audio Hindi English Japanese AC3 5.1 - MeGUiL ⚙️ 1337x Dubbed / Multi Audio / 🇬🇧 / 🇮🇳")), true, "English said beside Hindi");
// Spirited Away (Japanese): a dub in another language is that language's (Torrentio writes "Dubbed" for any)
streamPrefs.set("yts", true, false, { foreign: true, tongue: "Japanese" });
assert.equal(streamPrefs.englishDub(torrentio("A Viagem de Chihiro (2001) 720p Dual Audio pt-BR jp / Brazilian 💾 760.25 MB ⚙️ ThePirateBay Dubbed / Dual Audio / 🇵🇹")), false, "the Portuguese dub");
assert.equal(streamPrefs.englishDub(torrentio("Le Voyage de Chihiro (2001) MULTi-FRENCH/VOSTFR 1080p 10bits BluRay x265 AC3 5.1 v2 -Punisher694 (Spirited Away / Sen to Chihiro no Kamikakushi) (VF) 💾 4.28 GB ⚙️ nekoBT Dubbed / Multi Audio / 🇫🇷")), false, "the French one");
assert.equal(streamPrefs.englishDub(torrentio("[Trix] Spirited Away (2001) [Dual Audio] [Multi Subs] (BD 1080p AV1) - Sen to Chihiro no Kamikakushi - Le Voyage de Chihiro VF-VOSTFR 💾 1.92 GB ⚙️ NyaaSi Dubbed / Multi Subs / Dual Audio / 🇫🇷")), false);
assert.equal(streamPrefs.englishDub(torrentio("Spirited.Away.2001.DUBBED.1080p.BluRay.x265-RARBG 💾 1.94 GB ⚙️ RARBG Dubbed")), true, "a dub with no other language named");
assert.equal(streamPrefs.englishDub(torrentio("Spirited Away (2001) [1080p x265 HEVC 10bit BluRay Dual Audio AAC 5.1] [Prof] 💾 6.93 GB ⚙️ NyaaSi Dubbed / Dual Audio")), true);
assert.equal(streamPrefs.englishDub(torrentio("Spirited.Away.2001.1080p.BDRip.Dual.Audio.AAC5.1.10bits.x265-Rapta 💾 2.09 GB ⚙️ ThePirateBay Dual Audio / 🇯🇵")), true, "a second track beside Japanese");
streamPrefs.set("none", true, true, korean);
assert.equal(streamPrefs.englishDub(englishTrack), false, "an anime keeps its rule");
streamPrefs.set("none", true, false, null);
assert.equal(streamPrefs.englishDub(englishTrack), false, "a title in English has no dub to look for");
streamPrefs.set("none", false);
console.log("PASS on a title not in English, the English dub: said, a second track, or English it sounds in");

// --- The stream list's order and its filters' counts -------------------------------------------
// streamList works out once a stream what the list used to work out once a comparison, and counts
// the filters in one walk in place of eleven. Both are held here to the rules as they were first
// written (kept below word for word), over a few thousand made-up lists.
const SOURCE_RANK = { Remux: 4, BluRay: 3, WEB: 2, HDTV: 1, Other: 0, CAM: -10 };
const QUALITY_LABEL = { 2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "SD", 0: "Unknown" };
const isLink = (d) => !d.res && !d.size && d.source === "Other";
// What leads whatever the order. Off a title not in English, as first written: the chosen site, then an
// anime's dub (said outright, or a second track). On a title not in English (and not an anime), its
// English dub (said outright beside only its own language, an unnamed second track, English it sounds in,
// or a second track beside only its own language), then the site.
const weightAsWritten = (d) => {
  const site = streamPrefs.fromSite(d);
  if (streamPrefs.foreign && !streamPrefs.anime) {
    const own = (l) => [NOT_LISTED, "Dual audio", "Multi audio", "English"].includes(l) || l.replace(/ \(.*\)$/, "") === streamPrefs.tongue;
    const dub = (d.dub && !d.ru && d.langs.every(own)) || d.dual || d.english || (d.second && !!streamPrefs.tongue && d.langs.every(own));
    return (streamPrefs.dubbed && dub ? 2 : 0) + (site ? 1 : 0);
  }
  return (site ? 2 : 0) + (streamPrefs.dubbed && streamPrefs.anime && !!(d.dub || d.dual) ? 1 : 0);
};
const asWritten = {
  score: (d) => d.res * 10 + (d.dv ? 3 : d.hdr ? 2 : 0) + (SOURCE_RANK[d.source] || 0),
  order(list, mode, clean) {
    const ranked = list.map((d, i) => ({ d, i }));
    const by = {
      quality: (a, b) => this.score(b.d) - this.score(a.d) || (b.d.instant - a.d.instant) || b.d.seeds - a.d.seeds || b.d.size - a.d.size,
      seeds: (a, b) => b.d.seeds - a.d.seeds || this.score(b.d) - this.score(a.d),
      "size-desc": (a, b) => b.d.size - a.d.size,
      "size-asc": (a, b) => (a.d.size || Infinity) - (b.d.size || Infinity),
      "quality-size": (a, b) => (a.d.source === "CAM") - (b.d.source === "CAM") || a.d.lesser - b.d.lesser || b.d.res - a.d.res || (b.d.instant - a.d.instant) || (a.d.size || Infinity) - (b.d.size || Infinity) || b.d.seeds - a.d.seeds,
    }[mode];
    const pref = streamPrefs.on() ? (a, b) => weightAsWritten(b.d) - weightAsWritten(a.d) : null;
    const lead = !by && clean;
    const top = lead ? ranked.filter((r) => r.d.source !== "CAM" && !r.d.pending && !isLink(r.d))
      .reduce((a, r) => (!a || streamChoice.rank(r.d) > streamChoice.rank(a.d) ? r : a), null) : null;
    const led = (a, b) => isLink(a.d) - isLink(b.d) || (b === top) - (a === top);
    const sorted = by || lead || pref;
    const order = sorted ? [...ranked].sort((a, b) => (pref ? pref(a, b) : 0) || (by ? by(a, b) : lead ? led(a, b) : 0) || a.i - b.i) : ranked;
    return order.map((r) => r.i);
  },
  facets(rows) {
    const count = (key) => {
      const map = new Map();
      for (const [, d] of rows) for (const v of [].concat(d[key])) map.set(v, (map.get(v) || 0) + 1);
      return map;
    };
    const quality = count("res");
    return {
      quality: [2160, 1440, 1080, 720, 480, 0].filter((q) => quality.has(q)).map((q) => [String(q), QUALITY_LABEL[q], quality.get(q)]),
      lang: [...count("langs")].sort((a, b) => (a[0] === "Not listed (usually English)") - (b[0] === "Not listed (usually English)") || b[1] - a[1]).map(([v, n]) => [v, v, n]),
      source: Object.keys(SOURCE_RANK).map((s) => [s, s === "WEB" ? "WEB-DL / WEBRip" : s, count("source").get(s)]).filter((x) => x[2]),
      provider: [...count("provider")].sort((a, b) => b[1] - a[1]).map(([v, n]) => [v, v, n]),
      instant: rows.filter(([, d]) => d.instant).length,
      hdr: rows.filter(([, d]) => d.hdr).length,
    };
  },
};
const orderNow = (list, mode, clean) => {
  const rows = list.map((d, i) => ({ d, i }));
  return Array.from(streamList.order(rows, mode, clean, isLink) || rows, (r) => r.i);
};

// A list as addons send them: every kind of stream the rules tell apart, many of them level on most counts
let seed = 20261111;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const one = (list) => list[Math.floor(random() * list.length)];
const madeUp = () => {
  if (random() < 0.06) return describeStream(one(["Apple TV", "Prime Video", "Netflix"]), one(["Rent from $3.99", "Buy", "Watch with a subscription"]));
  const tag = one(["", "", "[RD+] ", "[TB+] ", "[RD download] ", "[AD⚡] "]);
  const name = `${tag}${one(["Torrentio", "Comet", "MediaFusion"])}\n${one(["4k", "4k DV", "1080p", "720p", "480p", ""])}`;
  const file = ["Film", one(["2160p", "1440p", "1080p", "720p", "480p", "DVDRip", ""]), one(["BluRay", "WEB-DL", "Remux", "HDTV", "HDCAM", "TS", ""]),
    one(["HDR", "DV", "HDR10+", "", "", ""]), one(["x265", "x264", "AV1", ""]), one(["AI Upscaled", "60fps", "3D", "", "", "", "", ""]),
    one(["Dual Audio", "Multi Audio", "English Dub", "Hindi Dubbed", "DUBBED", "KOREAN", "Ita Kor Sub Ita Eng", "KOR-ENG", "Паразиты Dub", "EngSub", "English subs", "DUBBED.VF", "", "", "", ""]), one(["YIFY", "[YTS.MX]", "", "", "", ""])].filter(Boolean).join(".");
  const facts = [random() < 0.8 ? `👤 ${one([0, 1, 12, 12, 50, 300, 900])}` : "", random() < 0.85 ? `💾 ${one(["700 MB", "1.6 GB", "1.6 GB", "4 GB", "4.2 GB", "18 GB", "58.4 GB"])}` : "",
    random() < 0.7 ? `⚙️ ${one(["YTS", "RARBG", "1337x", "TorrentGalaxy", "NyaaSi", "ThePirateBay"])}` : ""].filter(Boolean).join(" ");
  const flags = one(["", "", "", "🇬🇧", "🇯🇵 🇬🇧", "🇮🇹", "🇫🇷 🇩🇪", "🇬🇧 🇮🇳", "🇯🇵", "🇰🇷", "🇬🇧 / 🇰🇷", "🇲🇽", "🇮🇳", "🇬🇧 / 🇫🇷"]);
  return describeStream(name, `${name}\n${file}\n${facts}\n${flags}`);
};
const MODES = ["default", "quality", "quality-size", "seeds", "size-desc", "size-asc", "not-a-mode"];
const PREFS = [["none", false, false], ["yts", false, false], ["yts", true, false], ["yts", true, true], ["none", true, true], ["rarbg", true, true], ["nyaasi", false, true],
  // (a title not in English: in Korean, in Spanish, in a language its addon didn't say; an anime from Korea keeps the anime's rule)
  ["yts", true, false, korean], ["none", true, false, korean], ["1337x", true, false, { foreign: true, tongue: "Spanish" }], ["rarbg", true, false, { foreign: true, tongue: "" }], ["yts", true, true, korean]];
let compared = 0;
for (let n = 0; n < 240; n++) {
  const list = Array.from({ length: 1 + Math.floor(random() * (n % 12 ? 40 : 300)) }, madeUp);
  const rows = list.map((d) => [null, d]);
  assert.equal(JSON.stringify(streamList.facets(rows)), JSON.stringify(asWritten.facets(rows)), "the filters offer the same, in the same order, with the same counts");
  for (const prefs of PREFS) {
    streamPrefs.set(...prefs);
    for (const mode of MODES) {
      for (const clean of [true, false]) {
        assert.deepEqual(orderNow(list, mode, clean), asWritten.order(list, mode, clean), `the order is the same (${mode}, clean list ${clean}, ${JSON.stringify(prefs)})`);
        compared++;
      }
    }
  }
}
streamPrefs.set("none", false);
assert.equal(streamList.order(Array.from({ length: 5 }, (_, i) => ({ d: madeUp(), i })), "default", false, isLink), null, "no order asked for: the addon's own");
console.log(`PASS the list's order and its filters match the rules as written (${compared} lists compared)`);

// The order the owner settled on, spelt out: the chosen site first, then the sharpest picture in the
// smallest file, real copies before stretched ones, cinema recordings last; dubs lead on an anime only
const s4kBig = describeStream("Torrentio\n4k", "Film.2160p.BluRay.x265 👤 40 💾 58.4 GB ⚙️ RARBG");
const s4kSmall = describeStream("Torrentio\n4k", "Film.2160p.WEB-DL.x265 👤 12 💾 12 GB ⚙️ 1337x");
const s1080 = describeStream("Torrentio\n1080p", "Film.1080p.BluRay.x264 👤 300 💾 4 GB ⚙️ RARBG");
const sYts = describeStream("Torrentio\n1080p", "Film.2016.1080p.BluRay.x264-[YTS.AG] 👤 500 💾 1.6 GB ⚙️ YTS");
const sYts720 = describeStream("Torrentio\n720p", "Film.2016.720p.BluRay.x264-[YTS.AG] 👤 90 💾 800 MB ⚙️ YTS");
const sFake4k = describeStream("Torrentio\n4k", "Film.2160p.AI.Upscaled.60fps 👤 9 💾 20 GB ⚙️ 1337x");
const sCam = describeStream("Torrentio\n1080p", "Film.1080p.HDCAM 👤 2000 💾 2 GB ⚙️ 1337x");
const sDual = describeStream("Torrentio\n720p", "Anime.S01E01.720p.Dual.Audio.WEB 👤 50 💾 700 MB ⚙️ NyaaSi");
const shelf = [sCam, sFake4k, s1080, sDual, s4kBig, sYts720, s4kSmall, sYts];
const named = new Map([[sCam, "cam"], [sFake4k, "fake 4K"], [s1080, "1080p"], [sDual, "dual 720p"], [s4kBig, "4K big"], [sYts720, "YTS 720p"], [s4kSmall, "4K small"], [sYts, "YTS 1080p"]]);
const shown = (mode, clean = true) => orderNow(shelf, mode, clean).map((i) => named.get(shelf[i]));
streamPrefs.set("yts", true, false);
assert.deepEqual(shown("quality-size"), ["YTS 1080p", "YTS 720p", "4K small", "4K big", "1080p", "dual 720p", "fake 4K", "cam"], "YTS first, then resolution with the smallest file");
streamPrefs.set("yts", true, true);
assert.deepEqual(shown("quality-size"), ["YTS 1080p", "YTS 720p", "dual 720p", "4K small", "4K big", "1080p", "fake 4K", "cam"], "on an anime's page the dub comes next");
streamPrefs.set("none", false);
assert.deepEqual(shown("quality-size"), ["4K small", "4K big", "YTS 1080p", "1080p", "dual 720p", "YTS 720p", "fake 4K", "cam"], "no preference: resolution, then size");
assert.deepEqual(shown("default"), ["4K big", "cam", "fake 4K", "1080p", "dual 720p", "YTS 720p", "4K small", "YTS 1080p"], "addon order with the clean list on: the best match (the first of two as good) leads");
assert.deepEqual(shown("default", false), ["cam", "fake 4K", "1080p", "dual 720p", "4K big", "YTS 720p", "4K small", "YTS 1080p"], "addon order, plain list: as the addon sent it");
console.log("PASS the chosen site, then the sharpest picture in the smallest file; dubs on an anime only");

// A film not in English (Parasite, as Torrentio lists it): its English dubs first, then the chosen
// site, then the sharpest picture in the smallest file. In English the same streams keep the order above.
const p4kYts = describeStream("Torrentio\n4k", "Parasite (2019) [2160p] [4K] [BluRay] [5.1] [YTS] [YIFY] 👤 16 💾 5.95 GB ⚙️ 1337x");
const p1080Yts = describeStream("Torrentio\n1080p", "Parasite 2019 1080p BluRay 👤 473 💾 2.07 GB ⚙️ YTS");
const p4kKorean = describeStream("Torrentio\n4k HDR", "Parasite.2019.KOREAN.2160p.UHD.BluRay.x265.10bit.HDR.TrueHD.7.1.Atmos-RARBG 👤 6 💾 11.94 GB ⚙️ TorrentGalaxy 🇬🇧 / 🇰🇷");
const p4kEnglish = describeStream("Torrentio\n4k HDR", "Parasite (2019) (2160p BluRay x265 HEVC 10bit HDR AAC 7.1 Bandi) [QxR] 👤 69 💾 15.75 GB ⚙️ 1337x 🇬🇧 / 🇪🇸 / 🇰🇷 / 🇨🇳 / 🇫🇷");
const p1080Dual = describeStream("Torrentio\n1080p", "Parasite.2019.DUAL.1080p.WEBRip.x265-KONTRAST 👤 9 💾 1.2 GB ⚙️ TorrentGalaxy Dual Audio / 🇰🇷");
const p720Dubbed = describeStream("Torrentio\n720p", "Parasite.2019.DUBBED.720p.WEBRip.x264-GalaxyRG 👤 30 💾 900 MB ⚙️ 1337x");
const p1080Subs = describeStream("Torrentio\n1080p", "Parasite (2019) BluRay 1080p.H264 Ita Kor AC3 5.1 Sub Ita Eng MIRCrew 👤 114 💾 2.88 GB ⚙️ ilCorSaRoNeRo 🇬🇧 / 🇮🇹 / 🇰🇷");
const parasite = [p4kYts, p1080Subs, p4kKorean, p720Dubbed, p1080Yts, p4kEnglish, p1080Dual];
const pNamed = new Map([[p4kYts, "YTS 4K"], [p1080Yts, "YTS 1080p"], [p4kKorean, "Korean 4K"], [p4kEnglish, "English 4K"], [p1080Dual, "dual 1080p"], [p720Dubbed, "dubbed 720p"], [p1080Subs, "English subs 1080p"]]);
const pShown = (mode) => orderNow(parasite, mode, true).map((i) => pNamed.get(parasite[i]));
streamPrefs.set("yts", true, false, korean);
assert.deepEqual(pShown("quality-size"), ["English 4K", "dual 1080p", "dubbed 720p", "YTS 4K", "YTS 1080p", "Korean 4K", "English subs 1080p"], "on a foreign film the English dubs lead, then YTS");
const pItems = parasite.map((d) => ({ d, hint: {}, torrent: false, label: pNamed.get(d) }));
assert.equal(streamChoice.choose(pItems, null).item.label, "English 4K", "and the best match is the best of the dubs");
streamPrefs.set("yts", true, false, null);
assert.deepEqual(pShown("quality-size"), ["YTS 4K", "YTS 1080p", "Korean 4K", "English 4K", "dual 1080p", "English subs 1080p", "dubbed 720p"], "taken for a film in English: YTS, then resolution and size, as always");
streamPrefs.set("yts", false, false, null);
assert.deepEqual(pShown("quality-size"), ["YTS 4K", "YTS 1080p", "Korean 4K", "English 4K", "dual 1080p", "English subs 1080p", "dubbed 720p"], "English dub first switched off: the same");
streamPrefs.set("none", false);
console.log("PASS on a film not in English its English dubs lead, then the chosen site; in English, the order as it was");

// --- The stream list on a page: what a pass costs when nothing has changed ------------------------
// streamTools and streamRows on a stand-in for the page that counts every search of it, every reading of
// a row's words and every change made to it. A list drawn once must then cost a pass nothing.
{
  const cut = (from, to, after = 0) => {
    const a = source.indexOf(from, after);
    const b = source.indexOf(to, a + from.length);
    assert.ok(a > 0 && b > a, `found in the plugin: ${from.trim()}`);
    return source.slice(a, b);
  };
  const count = { searches: 0, readings: 0, changes: 0 };
  const watchers = [];
  const record = (r) => {
    for (const w of watchers) for (let n = r.target; n; n = n.parentNode) if (n === w.target) { w.records.push(r); break; }
  };
  class MutationObserver {
    constructor(told) { this.told = told; this.records = []; this.target = null; watchers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; this.records = []; }
    takeRecords() { return this.records.splice(0); }
  }
  // (an observer's own turn, after Stremio has changed something)
  const deliver = () => { for (const w of watchers) if (w.records.length) w.told(w.takeRecords()); };
  const simple = (text) => {
    const tests = [];
    text.replace(/\.([\w-]+)|\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/g, (m, cls, attr, op, value) => {
      if (cls) tests.push((el) => el.className.split(" ").includes(cls));
      else if (attr === "class") tests.push((el) => el.className.includes(value));
      else tests.push((el) => el.attrs.has(attr) && (op === undefined || el.attrs.get(attr) === value));
    });
    return (el) => tests.every((t) => t(el));
  };
  const find = (scope, selector) => {
    const out = [];
    const each = (el, fn) => { for (const c of el.children) { fn(c); each(c, fn); } };
    for (const part of selector.split(",").map((s) => s.trim())) {
      if (part.startsWith(":scope >")) { const is = simple(part.slice(8)); for (const c of scope.children) if (is(c)) out.push(c); continue; }
      const is = simple(part);
      each(scope, (el) => { if (is(el)) out.push(el); });
    }
    return out;
  };
  class El {
    constructor(tag, className = "", text = "") {
      Object.assign(this, { tagName: tag.toUpperCase(), nodeType: 1, className, text, attrs: new Map(), children: [], parentNode: null, hidden: false, html: "" });
      this.style = new Proxy({ order: "", display: "" }, { set: (t, k, v) => { count.changes++; t[k] = v; return true; } });
    }
    get parentElement() { return this.parentNode; }
    get firstChild() { return this.children[0] || null; }
    get isConnected() { for (let n = this; n; n = n.parentNode) if (n === page.documentElement) return true; return false; }
    get offsetParent() { return this.isConnected ? this.parentNode : null; }
    get classList() {
      const names = () => this.className.split(" ").filter(Boolean);
      const add = (c) => { count.changes++; if (!names().includes(c)) this.className = [...names(), c].join(" "); };
      const remove = (...cs) => { count.changes++; this.className = names().filter((n) => !cs.includes(n)).join(" "); };
      return { contains: (c) => names().includes(c), add, remove, toggle: (c, on) => (on ? add(c) : remove(c)) };
    }
    get textContent() { count.readings++; return this.text + this.children.map((c) => c.textContent).join(""); }
    hasAttribute(name) { return this.attrs.has(name); }
    getAttribute(name) { return name === "class" ? this.className : this.attrs.get(name) ?? null; }
    setAttribute(name, value) { count.changes++; this.attrs.set(name, String(value)); }
    removeAttribute(name) { count.changes++; this.attrs.delete(name); }
    toggleAttribute(name, on) { count.changes++; if (on) this.attrs.set(name, ""); else this.attrs.delete(name); }
    set innerHTML(html) { count.changes++; this.html = html; record({ type: "childList", target: this, addedNodes: [], removedNodes: [] }); }
    get innerHTML() { return this.html; }
    insertBefore(child, before) {
      count.changes++;
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      child.parentNode = this;
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      record({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }
    append(child) { this.insertBefore(child, null); }
    remove() {
      const parent = this.parentNode;
      if (!parent) return;
      count.changes++;
      parent.children.splice(parent.children.indexOf(this), 1);
      record({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
      this.parentNode = null;
    }
    closest(selector) { const is = simple(selector); for (let n = this; n; n = n.parentNode) if (is(n)) return n; return null; }
    matches(selector) { return simple(selector)(this); }
    contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
    querySelectorAll(selector) { count.searches++; return find(this, selector); }
    querySelector(selector) { count.searches++; return find(this, selector)[0] || null; }
    addEventListener() {}
  }
  const page = { documentElement: new El("html"), activeElement: null, createElement: (tag) => new El(tag) };
  page.querySelector = (s) => page.documentElement.querySelector(s);
  page.querySelectorAll = (s) => page.documentElement.querySelectorAll(s);
  // a title's page as Stremio builds it: the panel, its list, and a row for each stream
  const stremioRow = (name, words) => {
    const row = new El("a", "label-container-XOyzm stream-container-JPdah button-container-zVLH6");
    const info = new El("div", "info-container-TihQo");
    info.append(new El("div", "addon-name-tC8PX", name));
    row.append(info);
    row.append(new El("div", "description-container-vW_De", words));
    row.append(new El("svg", "icon-rAZvO"));
    return row;
  };
  const words = (i) => `Film.${["2160p", "1080p", "720p"][i % 3]}.${["BluRay", "WEB-DL", "HDTV"][i % 5 % 3]}.x26${4 + i % 2}${i % 7 ? "" : "-[YTS.MX]"}\n👤 ${(i * 37) % 400} 💾 ${1 + (i * 13) % 40} GB ⚙️ ${i % 7 ? "RARBG" : "YTS"}`;
  const content = new El("div", "metadetails-content-Uz5EV");
  const panel = new El("div", "streams-list-Y1lCM streams-list-container-xYMJo");
  const list = new El("div", "streams-container-bbSc4");
  page.documentElement.append(content);
  content.append(panel);
  panel.append(list);
  for (let i = 0; i < 40; i++) list.append(stremioRow("Torrentio", words(i)));
  list.append(new El("a", "install-button-container-Q60yJ button-container-zVLH6"));

  const frames = [];
  const world = vm.createContext({
    document: page, MutationObserver, IN_TV: true, destroyed: false,
    settings: { streamTools: true, streamRows: true, streamSort: "quality-size" },
    location: { hash: "#/detail/movie/tt1/tt1" },
    currentRoute: () => "detail", scheduleSync() {}, esc: (s) => String(s), ICONS: { sort: "", chevronDown: "", check: "" },
    loop: { pass: null, pressWaiting: () => false, quietly: (fn) => fn() },
    quickPlay: { row: null, btn: null },
    streamFallback: { out: new Set(), failedRow(el) { return this.out.has(el); } },
    requestAnimationFrame: (fn) => frames.push(fn), cancelAnimationFrame: (id) => { frames[id - 1] = null; },
    setTimeout: () => 0, clearTimeout() {},
  });
  const frame = () => { for (const fn of frames.splice(0)) if (fn) fn(); };
  const lf = (s) => s.replace(/\r\n/g, "\n");
  const { streamTools, streamRows, streamPrefs: prefs, streamList: orderOf, describeStream: describe } = vm.runInContext(`${lf(cut("  const FLAG_LANG = {", "  function onStreamDocClick(e) {"))}
${lf(cut("  const streamRows = {", "  // -----", source.indexOf("  // Clean stream list:")))}
  ({ streamTools, streamRows, streamPrefs, streamList, describeStream })`, world);
  // (what the bar's words become is a real page's business: here it only keeps them)
  streamTools.fill = (bar, html) => { bar.html = html; if (!bar.children.length) bar.children.push(new El("div", "dx-sb-row")); };
  prefs.set("yts", true, false);
  const rows = () => list.children.filter((el) => el.className.includes("stream-container"));
  const drawn = () => rows().filter((el) => el.attrs.has("data-dxv"));
  const waiting = () => rows().filter((el) => el.attrs.has("data-dx-hide"));
  const inOrder = () => rows().sort((a, b) => a.style.order - b.style.order);
  const wanted = () => {
    const all = rows().map((el, i) => ({ el, d: streamTools.data(el), i }));
    return Array.from(orderOf.order(all, "quality-size", true, streamRows.isLink), (r) => r.el);
  };

  // Streams arrive: before the paint, every row is in its place and the ones in sight are drawn
  streamRows.prepaint();
  assert.equal(list.className.includes("dx-sortable"), true);
  assert.deepEqual(inOrder(), wanted(), "every row is given its place at once");
  assert.equal(inOrder()[0].children.at(-1).html.includes("YTS"), true, "the chosen site leads");
  const { FIRST, SLICE } = streamRows;
  assert.equal(FIRST >= 7 && FIRST < 20 && SLICE <= 25, true, "a screen of rows first (a TV shows six), then a few to a frame");
  assert.equal(drawn().length, FIRST, "the rows in sight are drawn before the paint");
  assert.deepEqual(drawn().sort((a, b) => a.style.order - b.style.order), inOrder().slice(0, FIRST), "…and they are the first ones as shown");
  assert.equal(waiting().length, 40 - FIRST, "the others wait out of the page");
  assert.equal(drawn().every((el) => !el.attrs.has("data-dx-hide")), true);
  assert.equal(panel.children[0].className, "dx-streambar", "the bar is there from the first paint");
  assert.equal(streamTools.bar.html.includes("40 streams"), true);
  frame();
  assert.equal(drawn().length, FIRST, "the frame that paints them draws no more");
  frame();
  assert.equal(drawn().length, FIRST + SLICE, "then a slice to a frame");
  frame();
  frame();
  assert.equal(drawn().length, 40);
  assert.equal(waiting().length, 0, "and none is left out of the page");
  assert.equal(rows().every((el) => el.children.slice(0, 3).every((c) => c.style.display === "none")), true, "TV: Stremio's own parts of a drawn row are out of the page");
  assert.equal(rows().filter((el) => el.attrs.has("data-dx-best")).length, 1);
  console.log("PASS streams arriving: each in its place and the ones in sight drawn before the paint, the rest twenty to a frame");

  // A stream that wouldn't play (streamFallback) is passed over: the next best is the best match, and
  // once it is forgiven the first one is again
  const bestOf = () => rows().filter((el) => el.attrs.has("data-dx-best"));
  const first = bestOf()[0];
  world.streamFallback.out.add(first);
  streamRows.key = "";
  streamRows.ensure();
  assert.equal(bestOf().length, 1);
  assert.notEqual(bestOf()[0], first, "a stream that wouldn't play is never the best match");
  world.streamFallback.out.clear();
  streamRows.key = "";
  streamRows.ensure();
  assert.equal(bestOf()[0], first);
  frame();
  console.log("PASS a stream that wouldn't play is passed over for the best match");

  // A pass with nothing changed: no search of the page, no row read, nothing written
  deliver();
  world.loop.pass = {};
  const before = JSON.stringify(count);
  streamTools.ensure();
  streamRows.ensure();
  streamRows.prepaint();
  assert.equal(JSON.stringify(count), before, "a pass on a list that hasn't changed leaves the page alone");
  console.log("PASS a pass with nothing changed neither searches the page, reads a row nor writes to it");

  // Stremio rewrites one row's words in place: that row is read and drawn again, the others are not
  const changed = rows()[20];
  const description = changed.children[1];
  description.text = "Film.480p.DVDRip.XviD\n👤 3 💾 700 MB ⚙️ RARBG";
  record({ type: "characterData", target: { nodeType: 3, parentNode: description }, addedNodes: [], removedNodes: [] });
  const then = { ...count };
  deliver();
  assert.equal(changed.children.at(-1).html.includes("SD"), true, "the row says what it now is");
  assert.deepEqual(inOrder(), wanted(), "and is in its new place");
  assert.equal(inOrder().indexOf(changed) > 30, true);
  assert.equal(count.readings - then.readings < 12, true, `only that row is read again (${count.readings - then.readings} readings)`);
  assert.equal(waiting().length, 0);
  console.log("PASS a row rewritten in place is read and drawn again, alone");

  // Another addon answers: its rows are read, the forty already there are not
  const more = { ...count };
  for (let i = 40; i < 50; i++) list.insertBefore(stremioRow("Comet", words(i)), list.children.at(-1));
  streamRows.prepaint();
  assert.equal(rows().length, 50);
  assert.deepEqual(inOrder(), wanted());
  assert.equal(count.readings - more.readings <= 10 * 6, true, `only the new rows are read (${count.readings - more.readings} readings)`);
  assert.equal(streamTools.bar.html.includes("40 streams"), true, "before the paint a bar that is already there is left as it is");
  world.loop.pass = {};
  streamTools.ensure();
  assert.equal(streamTools.bar.html.includes("50 streams"), true, "…and told at the pass");
  frame(); frame(); frame();
  assert.equal(drawn().length, 50);
  assert.equal(waiting().length, 0);
  console.log("PASS another addon's streams: only the new rows are read");

  // An addon earlier in the order answers last: Stremio keeps its rows by place, so every row is
  // rewritten in place and the new ones go at the end. The rows already drawn stay in the page (out
  // until drawn again, the list fell to a screen of rows and lost its place); only new ones wait.
  const deep = inOrder()[25];
  page.activeElement = deep;
  for (const [i, el] of rows().entries()) {
    el.children[1].text = words(i + 100);
    record({ type: "characterData", target: { nodeType: 3, parentNode: el.children[1] }, addedNodes: [], removedNodes: [] });
  }
  const late = [];
  for (let i = 50; i < 60; i++) late.push(list.insertBefore(stremioRow("Torrentio", words(i)), list.children.at(-1)));
  streamRows.prepaint();
  deliver();
  assert.equal(rows().length, 60);
  assert.deepEqual(inOrder(), wanted(), "every row in its new place");
  assert.equal(waiting().every((el) => late.includes(el)), true, `only rows never drawn wait out of the page (${waiting().length} waiting)`);
  assert.equal(deep.attrs.has("data-dx-hide"), false);
  for (let n = 0; n < 10 && streamRows.queue.length; n++) frame();
  assert.equal(streamRows.queue.length, 0);
  assert.equal(waiting().length, 0);
  assert.equal(rows().every((el) => el.children.at(-1).html === streamRows.html(streamTools.data(el), streamTools.cache.get(el).file)), true, "and every row then says what it now is");
  page.activeElement = null;
  console.log("PASS every row rewritten by an addon answering late: the list keeps its rows in the page");

  // The title's page left for the player or Settings, where Stremio keeps it underneath: what was
  // kept of it is let go, but not the bar or the Play button while they are still on the page. One
  // switched off meanwhile is taken away on the way back (forgotten, it stayed there).
  const play = new El("button", "dxq-play");
  content.append(play);
  world.quickPlay.btn = play;
  streamTools.letGo();
  assert.equal(streamTools.list, null, "the list is let go");
  assert.equal(streamTools.bar, panel.children[0], "the bar is kept in hand");
  assert.equal(world.quickPlay.btn, play, "…and the Play button");
  world.settings.streamTools = false;
  world.loop.pass = {};
  streamTools.ensure();
  assert.equal(panel.children.some((c) => c.className === "dx-streambar"), false, "the bar switched off meanwhile is gone");
  assert.equal(list.className.includes("dx-sortable"), false);
  play.remove();
  streamTools.letGo();
  assert.equal(world.quickPlay.btn, null, "a Play button that has left the page is let go");
  world.settings.streamTools = true;
  world.loop.pass = {};
  streamTools.ensure();
  streamRows.ensure();
  assert.equal(panel.children[0].className, "dx-streambar", "switched on again, the bar is back");
  assert.deepEqual(inOrder(), wanted());
  assert.equal(waiting().length, 0);
  console.log("PASS the bar and the Play button are kept while the title's page waits underneath, so switched off there they go");

  // The clean list off, the bar off: the list as Stremio has it
  world.settings.streamRows = false;
  streamTools.ensure();
  streamRows.ensure();
  assert.equal(drawn().length, 0);
  assert.equal(rows().every((el) => el.children.length === 3 && el.children.every((c) => c.style.display === "")), true, "Stremio's own rows are back");
  assert.deepEqual(inOrder(), wanted(), "still in order");
  world.settings.streamTools = false;
  streamTools.ensure();
  assert.equal(list.className.includes("dx-sortable"), false);
  assert.equal(rows().every((el) => el.style.order === "" && !el.attrs.has("data-dx-hide")), true);
  assert.equal(panel.children.includes(streamTools.bar), false, "the bar is gone");
  console.log("PASS the clean list and the bar switched off leave the list as Stremio has it");

  // A computer: every row drawn at once, and the page asked whether the list is on show
  world.IN_TV = false;
  world.settings.streamRows = true;
  world.settings.streamTools = true;
  world.loop.pass = {};
  streamTools.ensure();
  streamRows.ensure();
  assert.equal(drawn().length, rows().length, "all at once");
  assert.equal(waiting().length, 0);
  assert.equal(rows().every((el) => el.children.slice(0, 3).every((c) => c.style.display === "")), true, "Stremio's parts stay as the theme has them");
  content.remove();
  world.loop.pass = {};
  streamTools.ensure();
  assert.equal(streamTools.list, null, "a list that has left the page is let go");
  console.log("PASS a computer draws every row at once");

  // A film opened without its video in the address (the billboard's More info): Stremio shows its
  // streams all the same, in a list that takes the place of the one it showed while loading. Its
  // rows are drawn before the paint, as on any other address.
  world.IN_TV = true;
  world.location.hash = "#/detail/movie/tt2";
  const content2 = new El("div", "metadetails-content-Uz5EV");
  const panel2 = new El("div", "streams-list-Y1lCM streams-list-container-xYMJo");
  const loading = new El("div", "streams-container-bbSc4");
  page.documentElement.append(content2);
  content2.append(panel2);
  panel2.append(loading);
  world.loop.pass = {};
  streamTools.ensure();
  streamRows.ensure();
  assert.equal(streamTools.list, loading);
  const list2 = new El("div", "streams-container-bbSc4");
  for (let i = 0; i < 12; i++) list2.append(stremioRow("Torrentio", words(i)));
  loading.remove();
  panel2.append(list2);
  streamRows.prepaint();
  assert.equal(list2.children.filter((el) => el.attrs.has("data-dxv")).length, FIRST, "the rows in sight are drawn before the paint");
  assert.equal(list2.children.filter((el) => el.attrs.has("data-dx-hide")).length, 12 - FIRST, "…and the others wait out of the page");
  console.log("PASS a film's streams without its video in the address are drawn before the paint too");

  // A row's languages behind their flags, as the addon listed them; any past the first two as flags alone.
  // The Language menu's options with their flags too.
  const flag = (emoji) => `<span class="dx-flag" aria-hidden="true">${emoji}</span>`;
  const many = streamRows.html(describe("Torrentio\n1080p", "Torrentio\n1080p\nFilm.1080p.WEB 👤 9 💾 2 GB 🇬🇧 / 🇷🇺 / 🇮🇹 / 🇫🇷 / 🇩🇪 / 🇪🇸 / 🇵🇱 / 🇯🇵 / 🇰🇷 / 🇨🇳"), "");
  assert.equal(many.includes(`9 seeds · 2.0 GB · <span class="dxv-lang">${flag("🇬🇧")}English</span> · <span class="dxv-lang">${flag("🇷🇺")}Russian</span> <span class="dxv-more">${["🇮🇹", "🇫🇷", "🇩🇪", "🇪🇸", "🇵🇱", "🇯🇵"].map(flag).join("")}+2</span></small>`), true, many);
  const worded = streamRows.html(describe("Torrentio\n1080p", "Torrentio\n1080p\nFilm.1080p.Latino.Dual.Audio 👤 9 💾 2 GB"), "");
  assert.equal(worded.includes(`<span class="dxv-lang">Dual audio</span> · <span class="dxv-lang">${flag("🇲🇽")}Spanish (Latino)</span></small>`), true, "a language said in words gets its usual flag; Dual audio none");
  assert.equal(streamRows.html(describe("Torrentio\n1080p", "Torrentio\n1080p\nFilm.1080p.WEB 👤 9 💾 2 GB"), "").includes("dx-flag"), false, "not listed: no flag, no name");
  const menu = new El("div", "dx-streambar");
  streamTools.open = "lang";
  streamTools.renderBar(menu, { quality: [], lang: [["English", "English", 3], ["Spanish (Latino)", "Spanish (Latino)", 2], ["Dual audio", "Dual audio", 1], ["Not listed (usually English)", "Not listed (usually English)", 1]], source: [], provider: [], instant: 0, hdr: 0 },
    { quality: [], lang: ["English"], source: [], provider: [] }, 3, 7);
  streamTools.open = null;
  assert.equal(menu.html.includes(`<span class="dx-sb-label">${flag("🇬🇧")}English</span>`), true, menu.html);
  assert.equal(menu.html.includes(`<span class="dx-sb-label">${flag("🇲🇽")}Spanish (Latino)</span>`), true);
  assert.equal(menu.html.includes(`<span class="dx-sb-label">Dual audio</span>`) && menu.html.includes(`<span class="dx-sb-label">Not listed (usually English)</span>`), true);
  console.log("PASS a row's languages and the Language menu's show their flags");
}

// --- What the title on the page is in: looked up once a title, and asked again when nothing answered ---
{
  const a = source.indexOf("  const titleTongue = {");
  const b = source.indexOf("  // -----", a);
  assert.ok(a > 0 && b > a, "titleTongue found");
  const timers = [];
  let route = "detail";
  let hash = "#/detail/movie/tt6751668/tt6751668";
  let clock = 0;
  let syncs = 0;
  let answer = "down"; // what the addon's address gives: "down" (no network), a status, or the title's details
  let cinemetaAnswer = null; // when set, what Cinemeta gives while another addon is the title's (else `answer`)
  let addon = "https://v3-cinemeta.strem.io/manifest.json"; // the addon the title's page came from
  const fetched = [];
  const state = (id) => ({
    metaItem: { addon: { transportUrl: addon }, content: { type: "Ready", content: { id, type: "movie", name: "A title" } } },
    selected: { metaPath: { id } },
  });
  const world = vm.createContext({
    location: { get hash() { return hash; } },
    currentRoute: () => route,
    core: () => ({ getState: async () => state(hash.split("/")[3]) }),
    performance: { now: () => clock },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    scheduleSync: () => { syncs++; },
    destroyed: false,
    streamPrefs,
    isImdb: (id) => /^tt\d+$/.test(id),
    metadataSource: {
      isDefault: (addon) => addon.transportUrl === "https://v3-cinemeta.strem.io/manifest.json",
      url: (addon, resource, type, id) => `${addon.transportUrl.replace(/\/manifest\.json$/, "")}/${resource}/${type}/${id}.json`,
    },
    fetch: async (url) => {
      fetched.push(url);
      const given = cinemetaAnswer !== null && url.startsWith("https://v3-cinemeta.strem.io/") ? cinemetaAnswer : answer;
      if (given === "down") throw new TypeError("Failed to fetch");
      if (typeof given === "number") return { ok: false, status: given };
      return { ok: true, status: 200, json: async () => ({ meta: given }) };
    },
    AbortSignal: { timeout: () => undefined },
  });
  const { titleTongue } = vm.runInContext(`${source.slice(a, b)}\n({ titleTongue })`, world);
  const settle = () => new Promise((r) => setImmediate(r));
  const pass = async () => { const t = titleTongue.of(); await settle(); return t && { ...t }; };

  // The network down: six tries a second apart, each one asking for the pass that makes the next
  for (let n = 1; n <= 6; n++) {
    assert.equal(await pass(), null);
    assert.equal(fetched.length, n, `try ${n} asks`);
    assert.equal(timers.length, n < 6 ? 1 : 0, n < 6 ? `no answer at try ${n}: a pass is asked for a second later` : "after six, no more");
    for (const t of timers.splice(0)) { assert.equal(t.ms, 1100); t.fn(); }
    clock += 1100;
  }
  assert.equal(syncs, 5);
  assert.equal(await pass(), null);
  assert.equal(fetched.length, 6, "six tries on one visit");
  // Back to the board while the network comes back, then the title again: it is asked about again
  answer = { country: "South Korea" };
  route = "board";
  assert.equal(await pass(), null);
  assert.equal(fetched.length, 6, "nothing asked off a title's page");
  route = "detail";
  assert.equal(await pass(), null);
  assert.equal(fetched.length, 7, "opened again, asked again");
  assert.equal(syncs, 6, "a foreign title asks for the pass that orders its streams");
  assert.deepEqual(await pass(), { foreign: true, tongue: "Korean" });
  assert.equal(fetched.length, 7, "known: not asked again");

  // A server error is no answer either: asked again, never taken for a title in English
  hash = "#/detail/movie/tt0211915/tt0211915";
  answer = 503;
  assert.equal(await pass(), null);
  assert.equal(titleTongue.known.has("tt0211915"), false, "a 503 isn't kept");
  assert.equal(timers.length, 1);
  timers.splice(0);
  clock += 1100;
  answer = { country: "France, Germany" };
  assert.equal(await pass(), null);
  assert.deepEqual(await pass(), { foreign: true, tongue: "French" }, "Amélie, on the next try");
  // …and an address that has no such title (404) is an answer: a title it says nothing of is taken as in English
  hash = "#/detail/movie/tt0434409/tt0434409";
  answer = 404;
  assert.equal(await pass(), null);
  assert.equal(timers.length, 0, "not asked again");
  assert.deepEqual(await pass(), { foreign: false, tongue: "" });

  // Another metadata addon that doesn't answer (too many requests): Cinemeta is asked instead
  addon = "https://tmdb.example/manifest.json";
  hash = "#/detail/movie/tt6751668/tt6751668";
  titleTongue.known.clear();
  answer = 429;
  cinemetaAnswer = { country: "South Korea" };
  fetched.length = 0;
  assert.equal(await pass(), null);
  assert.deepEqual(fetched.map((u) => u.split("/")[2]), ["tmdb.example", "v3-cinemeta.strem.io"], "the addon, then Cinemeta once");
  assert.deepEqual(await pass(), { foreign: true, tongue: "Korean" }, "Cinemeta's answer is kept");
  // …and with Cinemeta down too: nothing is kept, and it is asked again a second later
  hash = "#/detail/movie/tt1375666/tt1375666";
  cinemetaAnswer = "down";
  timers.length = 0;
  assert.equal(await pass(), null);
  assert.equal(titleTongue.known.has("tt1375666"), false, "nothing kept");
  assert.equal(timers.length, 1, "one retry");
  console.log("PASS what a title is in is looked up once, asked again a few times when nothing answered, and again on another visit");
}
