import { buildPreviewMedia } from '../modules/preview-source.js';

// Your own authorized video sources override the title preview for matching episodes.
export const customMedia = {};
export const media = { ...buildPreviewMedia(), ...customMedia };

// Example key: "aot:s4p3:29".
// Example value: { url: "https://your-cdn.example/episode-29.mp4", quality: "1080p", audio: "ja", subtitles: [{ label: "English", language: "en", url: "https://your-cdn.example/episode-29.vtt" }] }.
