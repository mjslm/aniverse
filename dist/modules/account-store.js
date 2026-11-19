export const defaultPreferences = { quality: "Auto (Best Available)", audio: "Japanese (日本語)", subtitles: "English", alerts: true, wifi: true, autoNext: true, skipIntro: false };
export const accountKeys = new Set(["preview-progress-v1", "library", "library-times", "library-deleted", "watch-records-v2", "preferences", "profile", "profile-photo", "sync-clock", "video-sources-v2", "cached-episode-keys-v2", "events-v2", "library-sort", "library-layout"]);
export function accountStorageKey(key, owner = "guest") {
  return accountKeys.has(key) || key.startsWith("comments-v2.") ? `aniverse.${owner === "guest" ? "" : `user.${owner}.`}${key}` : `aniverse.${key}`;
}
const time = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export function mergeAccountState(local, remote) {
  const result = { ...local, library: { ...object(local.library) }, libraryTimes: { ...object(local.libraryTimes) }, libraryDeleted: { ...object(local.libraryDeleted) }, progress: { ...object(local.progress) }, notes: { ...object(local.notes) }, clock: { ...object(local.clock) } };
  for (const [id, status] of Object.entries(object(remote.library))) {
    const stamp = time(remote.libraryTimes?.[id]);
    if (stamp > Math.max(time(result.libraryTimes[id]), time(result.libraryDeleted[id]))) {
      result.library[id] = status;
      result.libraryTimes[id] = stamp;
      delete result.libraryDeleted[id];
    }
  }
  for (const [id, deleted] of Object.entries(object(remote.libraryDeleted))) if (time(deleted) >= Math.max(time(result.libraryTimes[id]), time(result.libraryDeleted[id]))) {
    delete result.library[id];
    result.libraryDeleted[id] = time(deleted);
  }
  for (const [key, record] of Object.entries(object(remote.progress))) if (time(record.updatedAt) > time(result.progress[key]?.updatedAt)) result.progress[key] = record;
  for (const [id, notes] of Object.entries(object(remote.notes))) {
    const combined = new Map((result.notes[id] || []).map((note) => [note.id, note]));
    for (const note of notes) if (!combined.has(note.id)) combined.set(note.id, note);
    result.notes[id] = [...combined.values()].sort((a, b) => time(a.time) - time(b.time));
  }
  for (const field of ["profile", "preferences"]) if (time(remote.clock?.[field]) > time(result.clock[field])) {
    result[field] = remote[field];
    result.clock[field] = time(remote.clock[field]);
  }
  return result;
}
export function cloudRows(userId, state) {
  const iso = (value) => new Date(time(value) || Date.now()).toISOString();
  return {
    profiles: [{ id: userId, display_name: state.profile.name, updated_at: iso(state.clock.profile) }],
    user_settings: [{ user_id: userId, preferences: state.preferences, updated_at: iso(state.clock.preferences) }],
    watchlist: [...new Set([...Object.keys(state.library), ...Object.keys(state.libraryDeleted)])].map((id) => ({ user_id: userId, anime_id: id, status: state.library[id] || "Plan to Watch", deleted_at: state.library[id] ? null : iso(state.libraryDeleted[id]), updated_at: iso(state.library[id] ? state.libraryTimes[id] : state.libraryDeleted[id]) })),
    watch_progress: Object.entries(state.progress).map(([key, record]) => ({ user_id: userId, episode_key: key, seconds: record.seconds || 0, duration: record.duration || 0, watched_seconds: record.watchedSeconds || 0, completed: !!record.completed, updated_at: iso(record.updatedAt) })),
    user_notes: Object.entries(state.notes).flatMap(([id, notes]) => notes.map((note) => ({ user_id: userId, id: note.id, anime_id: id, body: note.text, created_at: iso(note.time) })))
  };
}
export function fromCloudRows(rows) {
  const result = { library: {}, libraryTimes: {}, libraryDeleted: {}, progress: {}, notes: {}, clock: {} };
  if (rows.profiles[0]) {
    result.profile = { name: rows.profiles[0].display_name };
    result.clock.profile = time(rows.profiles[0].updated_at);
  }
  if (rows.user_settings[0]) {
    result.preferences = rows.user_settings[0].preferences;
    result.clock.preferences = time(rows.user_settings[0].updated_at);
  }
  for (const row of rows.watchlist) {
    if (row.deleted_at) result.libraryDeleted[row.anime_id] = time(row.updated_at);
    else {
      result.library[row.anime_id] = row.status;
      result.libraryTimes[row.anime_id] = time(row.updated_at);
    }
  }
  for (const row of rows.watch_progress) result.progress[row.episode_key] = { seconds: row.seconds, duration: row.duration, watchedSeconds: row.watched_seconds, completed: row.completed, updatedAt: time(row.updated_at) };
  for (const row of rows.user_notes) (result.notes[row.anime_id] ??= []).push({ id: row.id, text: row.body, time: time(row.created_at) });
  return result;
}
export async function pullAccount(client, userId) {
  const entries = await Promise.all(["profiles", "user_settings", "watchlist", "watch_progress", "user_notes"].map(async (table) => {
    const rows = [];
    let offset = 0;
    while (true) {
      const { data, error } = await client.from(table).select("*").eq(table === "profiles" ? "id" : "user_id", userId).order(table === "watch_progress" ? "episode_key" : table === "watchlist" ? "anime_id" : table === "user_notes" ? "id" : table === "profiles" ? "id" : "user_id").range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1e3) break;
      offset += 1e3;
    }
    return [table, rows];
  }));
  return fromCloudRows(Object.fromEntries(entries));
}
export async function pushAccount(client, userId, state) {
  for (const [table, items] of Object.entries(cloudRows(userId, state))) for (let offset = 0; offset < items.length; offset += 100) {
    const onConflict = table === "profiles" ? "id" : table === "user_settings" ? "user_id" : table === "watchlist" ? "user_id,anime_id" : table === "watch_progress" ? "user_id,episode_key" : "user_id,id";
    const { error } = await client.from(table).upsert(items.slice(offset, offset + 100), { onConflict });
    if (error) throw error;
  }
}
