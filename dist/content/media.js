import { buildPreviewMedia } from '../modules/preview-source.js';

// Your own authorized video sources override the title preview for matching episodes.
export const customMedia = {
  // Add permitted, direct HTTPS video URLs here for the deployed site.
  // "frieren:s1:1": { url: "https://your-cdn.example/frieren-s1e1.mp4", audio: "ja" },
  // "demon:season-1:1": { url: "https://your-cdn.example/demon-slayer-s1e1.mp4", audio: "ja" },
  // "aot:season-1:1": { url: "https://your-cdn.example/attack-on-titan-s1e1.mp4", audio: "ja" },
  // "jjk:season-1:1": { url: "https://your-cdn.example/jujutsu-kaisen-s1e1.mp4", audio: "ja" },
};
export const localEpisodeFiles = {
  "frieren:s1:1": "./videos/frieren-s1e1.mp4",
  "demon:season-1:1": "./videos/demon-slayer-s1e1.mp4",
  "aot:season-1:1": "./videos/attack-on-titan-s1e1.mp4",
  "jjk:season-1:1": "./videos/jujutsu-kaisen-s1e1.mp4",
};
export const media = { ...buildPreviewMedia(), ...customMedia };

// Example key: "aot:s4p3:29".
// Example value: { url: "https://your-cdn.example/episode-29.mp4", quality: "1080p", audio: "ja", subtitles: [{ label: "English", language: "en", url: "https://your-cdn.example/episode-29.vtt" }] }.
