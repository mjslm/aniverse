import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../dist/content/catalog.js";
import { normalize, findAnime, searchScore, episodeKey, episodeFor, orderedEpisodes, nextEpisode, resumeEpisode, watchStatistics, profileStatistics, parseRoute, routeURL, safeMediaURL, sanitizeBackup } from "../dist/modules/catalog.js";
test("profile XP counts saved episodes, titles, and finished previews once per record", () => {
  const library = { frieren: "Completed" };
  assert.deepEqual(profileStatistics({}, library), { episodes: 0, completedTitles: 1, level: 1, levelXP: 50 });
  const records = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`frieren:s1:${i + 1}`, { completed: true }]));
  const previews = { frieren: { completed: false, everCompleted: true }, demon: { completed: true }, oshi: { completed: false } };
  assert.deepEqual(profileStatistics(records, library, previews), { episodes: 5, completedTitles: 1, level: 2, levelXP: 100 });
});
test("every available catalog title is searchable and blank search includes the entire catalog", () => {
  assert.equal(findAnime(catalog).length, catalog.length);
  for (const anime of catalog) {
    assert.equal(findAnime(catalog, anime.title)[0].id, anime.id);
    assert.equal(findAnime(catalog, anime.short)[0].id, anime.id);
  }
});
test("alternate English, romanized, Japanese, and abbreviated titles find the right series", () => {
  for (const [query, id] of [["AoT", "aot"], ["進撃の巨人", "aot"], ["JJK", "jjk"], ["Kimetsu no Yaiba", "demon"], ["Sōsō no Furīren", "frieren"], ["Dandadan", "dandadan"], ["Spy × Family", "spy"], ["HOTD", "highschool"], ["Bleach TYBW", "bleach"]]) assert.equal(findAnime(catalog, query)[0]?.id, id, query);
});
test("case, punctuation, extra spaces, and reordered query words work", () => {
  for (const query of ["  ATTACK   ON   TITAN  ", "Attack-on-Titan", "titan attack", "attack titan final"]) assert.equal(findAnime(catalog, query)[0]?.id, "aot");
  assert.equal(normalize("Frieren’s JOURNEY"), "frierens journey");
});
test("small spelling mistakes match without replacing unrelated missing titles", () => {
  assert.equal(findAnime(catalog, "attak on titan")[0]?.id, "aot");
  assert.equal(findAnime(catalog, "jujustu kaisen")[0]?.id, "jjk");
  assert.equal(findAnime(catalog, "Naruto").length, 0);
  assert.equal(findAnime(catalog, "Hunter x Hunter").length, 0);
  assert.equal(findAnime(catalog, "zzzzzzzzzz").length, 0);
});
test("genres and studios are indexed alongside titles", () => {
  assert(findAnime(catalog, "mappa").length >= 4);
  assert(findAnime(catalog, "science fiction").some((item) => item.id === "kaiju"));
  assert.equal(findAnime(catalog, "productionig")[0]?.id, "kaiju");
  assert(findAnime(catalog, "shounen").some((item) => item.id === "jjk"));
});
test("rating, studio, genre, and dub filters combine with the search query", () => {
  assert.deepEqual(findAnime(catalog, "attack", { genre: "Action", studio: "MAPPA", rating: 9, dub: true }).map((item) => item.id), ["aot"]);
  assert.equal(findAnime(catalog, "attack", { studio: "Ufotable" }).length, 0);
  const fixture = [{ ...catalog[0], audio: ["ja"] }, { ...catalog[1], audio: ["ja", "en"] }];
  assert.deepEqual(findAnime(fixture, "", { dub: true }).map((item) => item.id), ["jjk"]);
});
test("result sorting is deterministic and exact titles outrank weaker matches", () => {
  const rated = findAnime(catalog, "", {}, "rating");
  assert(rated.every((item, i) => i === 0 || rated[i - 1].rating >= item.rating));
  const az = findAnime(catalog, "", {}, "az");
  assert.deepEqual(az.map((item) => item.title), az.map((item) => item.title).sort((a, b) => a.localeCompare(b)));
  assert(searchScore(catalog.find((item) => item.id === "jjk"), "Jujutsu Kaisen") > searchScore(catalog.find((item) => item.id === "jjk"), "action"));
});
test("series use their own seasons and episodes rather than shared Attack on Titan data", () => {
  const aot = catalog.find((item) => item.id === "aot"), kaiju = catalog.find((item) => item.id === "kaiju");
  assert.equal(episodeFor(aot, "s4p3", 29).title, "The Rumbling Awakens");
  assert.equal(episodeFor(kaiju, "s1", 1).title, "Episode 1");
  assert.notEqual(episodeFor(kaiju, "s1", 1).image, episodeFor(aot, "s4p3", 29).image);
  assert.equal(episodeFor(kaiju, "s1", 29), void 0);
  for (const anime of catalog) assert.equal(orderedEpisodes(anime).length, anime.episodes);
});
test("video and resume keys distinguish both seasons and episode numbers", () => {
  assert.notEqual(episodeKey("aot", "s4p3", 28), episodeKey("aot", "s4p3", 29));
  assert.notEqual(episodeKey("jjk", "s1", 1), episodeKey("jjk", "s2", 1));
});
test("next episode and resume advance only through existing episodes", () => {
  const aot = catalog.find((item) => item.id === "aot");
  assert.equal(nextEpisode(aot, "s4p3", 29).number, 30);
  assert.equal(nextEpisode(aot, "s4p3", 31), null);
  assert.equal(resumeEpisode(aot, {}).number, 28);
  assert.equal(resumeEpisode(aot, { "aot:s4p3:29": { seconds: 130, updatedAt: 10, completed: false } }).number, 29);
  assert.equal(resumeEpisode(aot, { "aot:s4p3:29": { seconds: 1440, updatedAt: 10, completed: true } }).number, 30);
});
test("watch statistics reflect recorded viewing instead of fixed design numbers", () => {
  assert.deepEqual(watchStatistics({}), { episodes: 0, completed: 0, seconds: 0 });
  assert.deepEqual(watchStatistics({ a: { seconds: 5, watchedSeconds: 5 }, b: { seconds: 60, watchedSeconds: 40, completed: true } }), { episodes: 2, completed: 1, seconds: 45 });
});
test("search state and season links round trip through bookmarkable URLs", () => {
  const route = parseRoute("#" + routeURL("search", { q: "Spy × Family", genre: "Action", rating: 8.5, studio: "MAPPA" }));
  assert.equal(route.page, "search");
  assert.equal(route.params.get("q"), "Spy × Family");
  assert.equal(route.params.get("rating"), "8.5");
  const episode = parseRoute("#player/aot/29?season=s4p3");
  assert.equal(episode.id, "aot");
  assert.equal(episode.episode, 29);
  assert.equal(episode.seasonId, "s4p3");
  assert.equal(parseRoute("#detail/unknown-anime").id, "unknown-anime");
  assert.equal(parseRoute("#player/aot/not-a-number").episode, null);
  assert.equal(parseRoute("#player/aot/not-a-number").invalidEpisode, true);
});
test("media URL validation rejects unsafe protocols and embedded credentials", () => {
  for (const url of ["https://cdn.example/video.mp4", "./videos/episode.mp4", "/videos/episode.mp4", "http://127.0.0.1:3000/video.mp4"]) assert(safeMediaURL(url));
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://cdn.example/file.mp4", "https://name:secret@cdn.example/file.mp4", "//evil.example/video.mp4", "file:///tmp/test.mp4"]) assert.equal(safeMediaURL(url), false, url);
});
test("backup import rejects unrelated files and keeps only valid catalog records and safe preferences", () => {
  assert.throws(() => sanitizeBackup({}, catalog), /backup/);
  const result = sanitizeBackup({ app: "AniVerse", version: 2, library: { aot: "Watching", naruto: "Watching", jjk: "Bad" }, progress: { "aot:s4p3:29": { seconds: -5, duration: 20, watchedSeconds: NaN, completed: true }, "unknown:s1:1": { seconds: 5 } }, profile: { name: "Marchael" }, preferences: { autoNext: false, quality: "javascript", subtitles: "English" } }, catalog);
  assert.deepEqual(result.library, { aot: "Watching" });
  assert.deepEqual(Object.keys(result.progress), ["aot:s4p3:29"]);
  assert.equal(result.progress["aot:s4p3:29"].seconds, 0);
  assert.equal(result.preferences.autoNext, false);
  assert.equal(result.preferences.quality, void 0);
});
