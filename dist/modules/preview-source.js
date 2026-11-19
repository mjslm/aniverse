import { catalog } from "../content/catalog.js";
import { titlePreviews, previewSettings } from "../content/previews.js";
import { episodeKey, orderedEpisodes } from "./catalog.js";
export const validYouTubeId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
export function isYouTubeSource(source) {
  return source?.provider === "youtube" && validYouTubeId(source.videoId);
}
export function previewSource(key) {
  const [id, seasonId, number, ...extra] = String(key).split(":"), anime = catalog.find((a) => a.id === id), clip = titlePreviews[id];
  if (extra.length || !anime?.seasons.some((s) => s.id === seasonId && s.episodes.some((e) => e.number === Number(number))) || !clip || !validYouTubeId(clip.videoId)) return null;
  return { key, animeId: id, provider: "youtube", preview: true, demo: false, kind: "official-trailer", videoId: clip.videoId, title: clip.title, publisher: clip.publisher, credit: clip.publisher, creditUrl: clip.publisherURL, verifiedAt: clip.verifiedAt, malId: clip.malId, metadataUrl: `https://api.jikan.moe/v4/anime/${clip.malId}`, url: `https://www.youtube.com/watch?v=${clip.videoId}`, previewSeconds: Math.min(previewSettings.maxSeconds, clip.previewSeconds), duration: Math.min(previewSettings.maxSeconds, clip.previewSeconds), quality: "YouTube Auto", audio: "original", variants: [], subtitles: [] };
}
export function buildPreviewMedia() {
  return Object.fromEntries(catalog.flatMap((a) => orderedEpisodes(a).map((e) => {
    const key = episodeKey(a.id, e.seasonId, e.number);
    return [key, previewSource(key)];
  })).filter(([, source]) => source));
}
export function youTubeEmbedURL(source, origin) {
  if (!isYouTubeSource(source)) throw new Error("Invalid YouTube source.");
  const url = new URL(`https://www.youtube.com/embed/${source.videoId}`);
  const site = new URL(origin);
  if (!["https:", "http:"].includes(site.protocol)) throw new Error("Invalid player origin.");
  for (const [key, value] of Object.entries({ enablejsapi: 1, origin: site.origin, playsinline: 1, controls: 1, rel: 0, start: 0, end: Math.max(1, Math.min(60, Math.floor(source.previewSeconds || 60))) })) url.searchParams.set(key, value);
  return url.href;
}
