import { previewSettings } from "../content/previews.js";
import { safeMediaURL } from "./catalog.js";
const responses = new Map();
export async function fetchEpisodeSource(key, fallback, fetcher = fetch) {
  const cached = responses.get(key);
  if (cached && Date.now() - cached.time < 3e5) return cached.source;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), previewSettings.apiTimeoutMs);
  try {
    const response = await fetcher(`./api/videos?id=${encodeURIComponent(key)}`, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-cache" });
    if (!response.ok) throw new Error("Video API unavailable.");
    const data = await response.json();
    if (!data.ok || data.video?.key !== key || !safeMediaURL(data.video.url)) throw new Error("Invalid video API response.");
    responses.set(key, { time: Date.now(), source: data.video });
    return data.video;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
