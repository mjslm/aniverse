export function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’'`]/g, "").replace(/[×✕]/g, " x ").replace(/science fiction/g, "sci fi").replace(/shounen/g, "shonen").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
const compact = (value) => normalize(value).replace(/\s/g, "");
export function editDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
export // Rank exact and partial titles ahead of fuzzy word matches.
function searchScore(anime, input) {
  const query = normalize(input);
  if (!query) return 1;
  const titles = [anime.title, anime.short, ...anime.aliases || []].map(normalize);
  if (titles.includes(query)) return 1e3;
  const joined = compact(query);
  if (titles.some((title) => compact(title) === joined)) return 950;
  if (titles.some((title) => title.startsWith(query))) return 850;
  if (titles.some((title) => title.includes(query) || compact(title).includes(joined))) return 750;
  const words = normalize([anime.title, anime.short, ...anime.aliases || [], anime.genre, ...anime.tags || [], anime.studio].join(" ")).split(" ");
  if (joined.length >= 3 && compact([anime.genre, ...anime.tags || [], anime.studio].join(" ")).includes(joined)) return 400;
  const terms = query.split(" ");
  let score = 0;
  for (const term of terms) {
    if (words.includes(term)) score += 65;
    else if (words.some((word) => word.startsWith(term))) score += 45;
    else if (term.length >= 4 && words.some((word) => word.length >= 4 && editDistance(term, word, term.length >= 7 ? 2 : 1) <= (term.length >= 7 ? 2 : 1))) score += 15;
    else return 0;
  }
  return score;
}
export function matchesFilters(anime, filters = {}) {
  const genre = filters.genre || "All";
  if (!["All", "All Catalog"].includes(genre) && !(anime.tags || []).some((tag) => normalize(tag) === normalize(genre)) && !normalize(anime.genre).includes(normalize(genre))) return false;
  if (Number(anime.rating) < Number(filters.rating || 0)) return false;
  if (filters.studio && filters.studio !== "All" && normalize(anime.studio) !== normalize(filters.studio)) return false;
  if (filters.dub && !(anime.audio || []).includes("en")) return false;
  return true;
}
export function findAnime(catalog, query = "", filters = {}, sort = "relevance") {
  const matches = catalog.map((anime, index) => ({ anime, index, score: searchScore(anime, query) })).filter((item) => item.score > 0 && matchesFilters(item.anime, filters));
  matches.sort((a, b) => {
    if (sort === "rating" || sort === "default") return Number(b.anime.rating) - Number(a.anime.rating) || a.anime.title.localeCompare(b.anime.title);
    if (sort === "az") return a.anime.title.localeCompare(b.anime.title);
    if (sort === "new") return Date.parse(b.anime.addedAt || "2000-01-01") - Date.parse(a.anime.addedAt || "2000-01-01");
    if (!normalize(query)) return Number(!!b.anime.featured) - Number(!!a.anime.featured) || a.index - b.index;
    return b.score - a.score || Number(b.anime.rating) - Number(a.anime.rating) || a.index - b.index;
  });
  return matches.map((item) => item.anime);
}
export function seasonFor(anime, seasonId) {
  const seasons = anime?.seasons || [];
  return seasons.find((season) => season.id === seasonId) || seasons.find((season) => season.id === anime.defaultSeason) || seasons[0];
}
export function episodeFor(anime, seasonId, number) {
  return seasonFor(anime, seasonId)?.episodes.find((episode) => episode.number === Number(number));
}
export function episodeKey(animeId, seasonId, number) {
  return `${animeId}:${seasonId}:${Number(number)}`;
}
export function orderedEpisodes(anime) {
  return (anime?.seasons || []).flatMap((season) => season.episodes.map((episode) => ({ ...episode, seasonId: season.id, seasonName: season.name, seasonNumber: season.number })));
}
export function nextEpisode(anime, seasonId, number) {
  const episodes = orderedEpisodes(anime), index = episodes.findIndex((episode) => episode.seasonId === seasonId && episode.number === Number(number));
  return index < 0 ? null : episodes[index + 1] || null;
}
export function resumeEpisode(anime, records = {}) {
  const episodes = orderedEpisodes(anime);
  const played = episodes.filter((episode) => records[episodeKey(anime.id, episode.seasonId, episode.number)]).sort((a, b) => (records[episodeKey(anime.id, b.seasonId, b.number)].updatedAt || 0) - (records[episodeKey(anime.id, a.seasonId, a.number)].updatedAt || 0));
  if (!played.length) return episodes.find((episode) => episode.seasonId === anime.defaultSeason) || episodes[0];
  const latest = played[0], record = records[episodeKey(anime.id, latest.seasonId, latest.number)];
  return record.completed ? nextEpisode(anime, latest.seasonId, latest.number) || latest : latest;
}
export function watchStatistics(records = {}) {
  const entries = Object.values(records).filter((value) => value && typeof value === "object");
  return { episodes: entries.filter((value) => value.seconds > 0 || value.completed).length, completed: entries.filter((value) => value.completed).length, seconds: entries.reduce((sum, value) => sum + Number(value.watchedSeconds || 0), 0) };
}
export function profileStatistics(records = {}, library = {}, previews = {}) {
  const { episodes, completed } = watchStatistics(records);
  const completedTitles = Object.values(library).filter((status) => status === "Completed").length;
  const finishedPreviews = Object.values(previews).filter((record) => record?.everCompleted || record?.completed).length;
  const xp = completed * 100 + completedTitles * 50 + finishedPreviews * 25;
  return { episodes, completedTitles, level: Math.floor(xp / 500) + 1, levelXP: xp % 500 };
}
export function parseRoute(hash = "") {
  const [path, query = ""] = String(hash).replace(/^#/, "").split("?");
  const parts = path.split("/").map((value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  });
  const params = new URLSearchParams(query);
  return { page: parts[0] || "home", id: parts[1] || "", episode: /^\d+$/.test(parts[2] || "") ? Number(parts[2]) : null, invalidEpisode: Boolean(parts[2] && !/^\d+$/.test(parts[2])), seasonId: params.get("season") || "", params };
}
export function routeURL(page, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== void 0 && value !== null && value !== "" && value !== false) params.set(key, String(value));
  return `${page}${params.size ? `?${params}` : ""}`;
}
export function safeMediaURL(value) {
  if (!value || typeof value !== "string") return false;
  if (/^\.\.?\//.test(value) || /^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}
export function sanitizeBackup(input, catalog) {
  if (!input || typeof input !== "object" || input.app !== "AniVerse" || input.version !== 2) throw new Error("Choose an AniVerse version 2 backup file.");
  const ids = new Set(catalog.map((item) => item.id)), keys = new Set(catalog.flatMap((item) => orderedEpisodes(item).map((episode) => episodeKey(item.id, episode.seasonId, episode.number))));
  const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const library = Object.fromEntries(Object.entries(object(input.library)).filter(([id, status]) => ids.has(id) && ["Watching", "Plan to Watch", "Completed"].includes(status)));
  const progress = {};
  for (const [key, value] of Object.entries(object(input.progress))) if (keys.has(key) && value && typeof value === "object") {
    const safeNumber = (value2, limit = 1e9) => typeof value2 === "number" && Number.isFinite(value2) ? Math.max(0, Math.min(limit, value2)) : 0;
    progress[key] = { seconds: safeNumber(value.seconds), duration: safeNumber(value.duration), watchedSeconds: safeNumber(value.watchedSeconds), updatedAt: safeNumber(value.updatedAt, Date.now()), completed: value.completed === true };
  }
  const profile = {};
  if (typeof input.profile?.name === "string") profile.name = input.profile.name.trim().slice(0, 60);
  if (typeof input.profile?.email === "string") profile.email = input.profile.email.trim().slice(0, 120);
  const preferences = {};
  for (const key of ["alerts", "wifi", "autoNext", "skipIntro"]) if (typeof input.preferences?.[key] === "boolean") preferences[key] = input.preferences[key];
  for (const [key, values] of Object.entries({ quality: ["Auto (Best Available)", "Original", "480p", "720p", "Auto (Recommended 1080p FHD)", "720p HD", "1080p Full HD", "4K Ultra HD"], audio: ["Japanese (日本語)", "English", "Tagalog"], subtitles: ["English", "Tagalog", "Off"] })) if (values.includes(input.preferences?.[key])) preferences[key] = input.preferences[key];
  if (typeof input.preferences?.volume === "number" && Number.isFinite(input.preferences.volume)) preferences.volume = Math.max(0, Math.min(1, input.preferences.volume));
  if ([0.5, 0.75, 1, 1.25, 1.5, 2].includes(input.preferences?.speed)) preferences.speed = input.preferences.speed;
  return { library, progress, profile, preferences };
}
