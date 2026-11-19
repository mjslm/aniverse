import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { catalog } from "../dist/content/catalog.js";
import { media } from "../dist/content/media.js";
import { episodeKey, orderedEpisodes, safeMediaURL } from "../dist/modules/catalog.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const errors = [], ids = new Set(), keys = new Set();
for (const anime of catalog) {
  if (!/^[a-z0-9-]+$/.test(anime.id) || ids.has(anime.id)) errors.push(`Invalid or duplicate anime id: ${anime.id}`);
  ids.add(anime.id);
  for (const key of ["title", "short", "genre", "studio", "description", "image"]) if (typeof anime[key] !== "string" || !anime[key].trim()) errors.push(`${anime.id}: missing ${key}`);
  if (!Array.isArray(anime.tags) || !Array.isArray(anime.aliases) || !Array.isArray(anime.seasons) || !anime.seasons.length) errors.push(`${anime.id}: tags, aliases, and seasons must be arrays`);
  if (!Number.isFinite(anime.rating) || anime.rating < 0 || anime.rating > 10) errors.push(`${anime.id}: rating must be between 0 and 10`);
  const seasons = new Set();
  for (const season of anime.seasons) {
    if (!/^[a-z0-9-]+$/.test(season.id) || seasons.has(season.id)) errors.push(`${anime.id}: invalid season id`);
    seasons.add(season.id);
    if (!season.episodes?.length) errors.push(`${anime.id}/${season.id}: season has no episodes`);
  }
  if (!seasons.has(anime.defaultSeason)) errors.push(`${anime.id}: defaultSeason does not exist`);
  for (const episode of orderedEpisodes(anime)) {
    const key = episodeKey(anime.id, episode.seasonId, episode.number);
    if (keys.has(key) || !Number.isInteger(episode.number) || episode.number < 1) errors.push(`Invalid or duplicate episode: ${key}`);
    keys.add(key);
    if (!episode.title) errors.push(`${key}: missing title`);
  }
  if (anime.episodes !== orderedEpisodes(anime).length) errors.push(`${anime.id}: episode count does not match seasons`);
}
for (const [key, source] of Object.entries(media)) {
  if (!keys.has(key)) errors.push(`Unknown video episode key: ${key}`);
  const variants = source.variants || [source];
  for (const variant of variants) {
    if (!safeMediaURL(variant.url)) errors.push(`${key}: invalid video URL`);
    if (/^\.\//.test(variant.url)) {
      const file = path.join(root, "dist", variant.url.slice(2));
      if (!fs.existsSync(file) || !fs.statSync(file).size) errors.push(`${key}: missing local video ${variant.url}`);
    }
  }
  for (const track of source.subtitles || []) if (!safeMediaURL(track.url)) errors.push(`${key}: invalid subtitle URL`);
}
const code = fs.readFileSync(path.join(root, "dist/app.js"), "utf8") + fs.readFileSync(path.join(root, "dist/styles.css"), "utf8") + fs.readFileSync(path.join(root, "dist/content/catalog.js"), "utf8");
for (const asset of new Set(code.match(/[\w-]+\.(?:png|svg|ttf|jpe?g|webp|avif)/gi) || [])) {
  const file = path.join(root, "dist/assets", asset);
  if (!fs.existsSync(file) || !fs.statSync(file).size) errors.push(`Missing asset: ${asset}`);
}
for (const file of ["dist/config.js", "dist/bootstrap.js", "dist/modules/local-preview.js", "scripts/config.mjs", "dist/modules/auth.js", "dist/modules/auth-ui.js", "dist/modules/account-store.js", "dist/app.js", "dist/modules/catalog.js", "dist/content/catalog.js", "dist/content/media.js", "dist/content/previews.js", "dist/modules/preview-source.js", "dist/modules/youtube-player.js", "dist/modules/motion.js", "dist/modules/search-suggestions.js", "dist/modules/profile-photo.js", "dist/modules/video-api.js", "dist/modules/video-client.js", "api/videos.js", "api/health.js", "dist/sw.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) errors.push(result.stderr);
}
JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
JSON.parse(fs.readFileSync(path.join(root, "dist/manifest.webmanifest"), "utf8"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Build validated: ${catalog.length} anime titles, ${keys.size} episodes. Output: dist/`);
