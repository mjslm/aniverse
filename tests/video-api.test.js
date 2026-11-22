import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { catalog } from "../dist/content/catalog.js";
import { media, localEpisodeFiles } from "../dist/content/media.js";
import { titlePreviews } from "../dist/content/previews.js";
import { previewSource, isYouTubeSource, youTubeEmbedURL } from "../dist/modules/preview-source.js";
import { videoApiResult } from "../dist/modules/video-api.js";
import { fetchEpisodeSource, fetchLocalEpisodeSource } from "../dist/modules/video-client.js";
import { orderedEpisodes, episodeKey, seasonFor } from "../dist/modules/catalog.js";
import videosAPI from "../api/videos.js";
import healthAPI from "../api/health.js";
const expectedEpisodes = catalog.reduce((sum, anime) => sum + anime.episodes, 0);
test("every catalog slot maps to the matching anime official preview and never an unrelated demo", () => {
  const keys = catalog.flatMap((anime) => orderedEpisodes(anime).map((episode) => episodeKey(anime.id, episode.seasonId, episode.number)));
  assert.equal(keys.length, expectedEpisodes);
  assert.equal(Object.keys(media).length, keys.length);
  for (const key of keys) {
    const source = media[key];
    assert.equal(source.key, key);
    assert.equal(source.animeId, key.split(":")[0]);
    assert.equal(source.demo, false);
    assert.equal(source.preview, true);
    assert.equal(source.previewSeconds, 60);
    assert(isYouTubeSource(source));
    assert.equal(source.videoId, titlePreviews[source.animeId].videoId);
    assert(source.publisher);
  }
});
test("all 13 title previews retain verified publisher attribution and unique video IDs", () => {
  assert.equal(Object.keys(titlePreviews).length, catalog.length);
  assert.equal(new Set(Object.values(titlePreviews).map((clip) => clip.videoId)).size, catalog.length);
  for (const a of catalog) {
    const clip = titlePreviews[a.id];
    assert(clip.publisher && clip.publisherURL && clip.verifiedAt);
    assert.equal(a.trailer, "https://www.youtube.com/watch?v=" + clip.videoId);
  }
});
test("embed URLs validate the source and set a 60 second limit, origin and native controls", () => {
  const one = previewSource("aot:s4p3:28"), two = previewSource("aot:s4p3:29");
  assert.equal(one.videoId, two.videoId);
  assert.notEqual(one.key, two.key);
  const url = new URL(youTubeEmbedURL(one, "https://aniverse.example"));
  assert.equal(url.origin, "https://www.youtube.com");
  assert.equal(url.searchParams.get("end"), "60");
  assert.equal(url.searchParams.get("origin"), "https://aniverse.example");
  assert.equal(url.searchParams.get("controls"), "1");
  assert.throws(() => youTubeEmbedURL({ ...one, videoId: "javascript:bad" }, "https://aniverse.example"));
  assert.equal(previewSource("aot:s4p3:999"), null);
  assert.equal(previewSource("missing:s1:1"), null);
});
test("video API provides title-level and episode-slot preview lookups without external API dependency", () => {
  const result = videoApiResult("https://aniverse.example/api/videos?anime=aot&preview=1", media);
  assert.equal(result.status, 200);
  assert.equal(result.body.video.provider, "youtube");
  assert.equal(result.body.video.videoId, titlePreviews.aot.videoId);
  const episode = videoApiResult("https://aniverse.example/api/videos?anime=aot&season=s4p3&episode=29", media);
  assert.equal(episode.body.video.key, "aot:s4p3:29");
  assert.equal(new URL(episode.body.video.url).hostname, "www.youtube.com");
});
test("video API accepts a colon-separated id and handles custom published sources", () => {
  const custom = { ...media, "aot:s4p3:29": { url: "https://cdn.example/authorized-episode.mp4", demo: false, quality: "1080p" } };
  const result = videoApiResult("https://aniverse.example/api/videos?id=aot%3As4p3%3A29", custom);
  assert.equal(result.body.video.key, "aot:s4p3:29");
  assert.equal(result.body.video.url, "https://cdn.example/authorized-episode.mp4");
  assert.equal(result.body.video.demo, false);
});
test("unknown episodes, unknown anime, and malformed parameters return honest HTTP errors", () => {
  for (const query of ["id=missing:s1:1", "anime=missing", "anime=aot&season=s4p3&episode=999"]) assert.equal(videoApiResult("https://demo.example/api/videos?" + query, media).status, 404);
  for (const query of ["episode=1", "anime=aot&season=s4p3&episode=oops", "limit=0", "limit=101", "offset=-1"]) assert.equal(videoApiResult("https://demo.example/api/videos?" + query, media).status, 400);
});
test("pagination lists the entire catalog exactly once and anime filtering stays within that series", () => {
  const keys = [];
  let offset = 0;
  do {
    const result = videoApiResult(`https://demo.example/api/videos?limit=100&offset=${offset}`, media);
    keys.push(...result.body.videos.map((video) => video.key));
    offset = result.body.nextOffset;
  } while (offset !== null);
  assert.equal(keys.length, expectedEpisodes);
  assert.equal(new Set(keys).size, expectedEpisodes);
  const kaiju = videoApiResult("https://demo.example/api/videos?anime=kaiju&limit=100", media);
  assert.equal(kaiju.body.total, 12);
  assert(kaiju.body.videos.every((video) => video.key.startsWith("kaiju:")));
});
test("deployed Web API handler supports GET, HEAD, OPTIONS, and rejects writes", async () => {
  const response = await videosAPI.fetch(new Request("https://demo.example/api/videos?id=solo:s1:1"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).video.key, "solo:s1:1");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const head = await videosAPI.fetch(new Request("https://demo.example/api/videos", { method: "HEAD" }));
  assert.equal(await head.text(), "");
  const options = await videosAPI.fetch(new Request("https://demo.example/api/videos", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  const write = await videosAPI.fetch(new Request("https://demo.example/api/videos", { method: "POST" }));
  assert.equal(write.status, 405);
});
test("health API reports title previews without requiring an API key", async () => {
  const response = await healthAPI.fetch(new Request("https://demo.example/api/health"));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.apiKeyRequired, false);
  assert.equal(body.demoMode, false);
  assert.equal(body.previewMode, true);
  assert.equal(body.previewTitles, catalog.length);
  assert.equal(body.episodeCount, expectedEpisodes);
});
test("the player client consumes the real API response and falls back safely on errors", async () => {
  const key = "frieren:s1:2";
  const source = await fetchEpisodeSource(key, media[key], (input) => videosAPI.fetch(new Request("https://demo.example/" + input.replace("./", ""))));
  assert.equal(source.key, key);
  assert.equal(new URL(source.url).hostname, "www.youtube.com");
  assert.equal(source.videoId, titlePreviews.frieren.videoId);
  const fallback = media["spy:s1:3"];
  assert.deepEqual(await fetchEpisodeSource("spy:s1:3", fallback, async () => {
    throw new Error("Offline");
  }), fallback);
  const wrong = media["demon:s1:3"];
  assert.deepEqual(await fetchEpisodeSource("demon:s1:3", wrong, async () => Response.json({ ok: true, video: { key: "wrong", url: "javascript:bad" } })), wrong);
});

test("local episode files target the original Season 1 without changing existing routes", async () => {
  assert.equal(Object.keys(localEpisodeFiles).length, 4);
  for (const [key, filename] of Object.entries(localEpisodeFiles)) {
    const [id, seasonId, episode] = key.split(":");
    const anime = catalog.find((item) => item.id === id);
    const season = seasonFor(anime, seasonId);
    assert.equal(season.id, seasonId);
    assert.equal(season.name, "Season 1");
    assert(season.episodes.some((item) => item.number === Number(episode)));
    assert.equal(seasonFor(anime).id, anime.defaultSeason);
    const source = await fetchLocalEpisodeSource(key, "localhost", async (url, options) => {
      assert.equal(url, filename);
      assert.equal(options.method, "HEAD");
      return new Response(null, { headers: { "Content-Type": "video/mp4" } });
    });
    assert.equal(source?.url, filename);
  }
  assert.equal(await fetchLocalEpisodeSource("aot:season-1:1", "localhost", async () => new Response(null, { status: 404 })), null);
  assert.equal(await fetchLocalEpisodeSource("frieren:s1:1", "localhost", async () => new Response("<html>Wrong file</html>", { headers: { "Content-Type": "text/html" } })), null);
  assert.equal(await fetchLocalEpisodeSource("frieren:s1:1", "aniverse.vercel.app", () => assert.fail("Public sites use configured HTTPS sources")), null);
});
