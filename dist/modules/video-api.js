import { catalog } from "../content/catalog.js";
import { titlePreviews } from "../content/previews.js";
import { episodeKey, safeMediaURL } from "./catalog.js";
function absoluteSource(source, origin) {
  const absolute = (url) => safeMediaURL(url) ? new URL(url, origin + "/").href : null;
  return { ...source, url: absolute(source.url), variants: (source.variants || []).map((variant) => ({ ...variant, url: absolute(variant.url) })), subtitles: (source.subtitles || []).map((track) => ({ ...track, url: absolute(track.url) })) };
}
export function videoApiResult(requestUrl, media, endpoint = "videos") {
  const url = new URL(requestUrl, "http://localhost"), params = url.searchParams;
  const success = (body) => ({ status: 200, body }), failure = (status, error) => ({ status, body: { ok: false, error } });
  if (endpoint === "health") return success({ ok: true, service: "AniVerse Video API", version: "2.7.0", apiKeyRequired: false, demoMode: false, previewMode: true, previewTitles: Object.keys(titlePreviews).length, animeCount: catalog.length, episodeCount: Object.keys(media).length });
  if (endpoint !== "videos") return failure(404, "API endpoint not found.");
  const id = params.get("id"), animeId = params.get("anime"), seasonId = params.get("season"), number = params.get("episode");
  let key = id;
  if (params.get("preview") === "1" && animeId) {
    key = Object.keys(media).find((value) => value.startsWith(animeId + ":"));
    if (!key) return failure(404, "Anime preview not found.");
  }
  if (!key && number) {
    if (!animeId || !seasonId || !/^\d+$/.test(number)) return failure(400, "Provide anime, season, and a numeric episode, or provide id=anime:season:episode.");
    key = episodeKey(animeId, seasonId, number);
  }
  if (key) {
    const source = media[key];
    if (!source) return failure(404, "This episode is not available in the AniVerse catalog.");
    return success({ ok: true, video: absoluteSource({ ...source, key }, url.origin) });
  }
  if (animeId && !catalog.some((item) => item.id === animeId)) return failure(404, "Anime not found in the AniVerse catalog.");
  const limitText = params.get("limit") ?? "20", offsetText = params.get("offset") ?? "0";
  if (!/^\d+$/.test(limitText) || !/^\d+$/.test(offsetText) || Number(limitText) < 1 || Number(limitText) > 100) return failure(400, "Use a limit from 1 to 100 and a non-negative offset.");
  const all = Object.entries(media).filter(([key2]) => (!animeId || key2.startsWith(animeId + ":")) && (!seasonId || key2.split(":")[1] === seasonId));
  const offset = Number(offsetText), limit = Number(limitText);
  return success({ ok: true, total: all.length, offset, limit, nextOffset: offset + limit < all.length ? offset + limit : null, videos: all.slice(offset, offset + limit).map(([key2, source]) => ({ id: key2, ...absoluteSource({ ...source, key: key2 }, url.origin) })) });
}
