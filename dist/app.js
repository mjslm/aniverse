import { mountScreen, mountDialog } from "./vendor/react-ui.js";
import { supabaseConfig } from "./config.js?v=2.7.0";
import { createAuthService, friendlyAuthError } from "./modules/auth.js";
import { authPage } from "./modules/auth-ui.js";
import { accountStorageKey, defaultPreferences, mergeAccountState, pullAccount, pushAccount } from "./modules/account-store.js";
import { catalog } from "./content/catalog.js";
import { fetchEpisodeSource, fetchLocalEpisodeSource, localEpisodePath } from "./modules/video-client.js";
import { previewSource, isYouTubeSource } from "./modules/preview-source.js";
import { mountYouTube } from "./modules/youtube-player.js";
import { animatePage, installFeedback } from "./modules/motion.js";
import { bindSearchSuggestions } from "./modules/search-suggestions.js";
import { createProfilePhoto, storedProfilePhoto } from "./modules/profile-photo.js";
import { media as configuredMedia } from "./content/media.js";
import { normalize, findAnime, seasonFor, episodeFor, episodeKey, orderedEpisodes, nextEpisode, resumeEpisode, profileStatistics, parseRoute, routeURL, safeMediaURL, sanitizeBackup } from "./modules/catalog.js";
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const A = (file) => `./assets/${file}`;
const icon = (file) => `<span class="icon" aria-hidden="true"><img src="${A(file)}" alt=""></span>`;
let accountOwner = "guest", authUser = null, authLoading = true, syncPaused = false, syncTimer = null, syncInFlight = false, syncDirty = false, syncAgain = false, syncStatus = "";
// Keep guest and signed-in browser data separate.
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(accountStorageKey(key, accountOwner))) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    if (!syncPaused && key === "library") {
      const previous = read(key, {}), deleted = read("library-deleted", {});
      for (const id of Object.keys(previous)) if (!value[id]) deleted[id] = Date.now();
      for (const id of Object.keys(value)) delete deleted[id];
      localStorage.setItem(accountStorageKey("library-deleted", accountOwner), JSON.stringify(deleted));
    }
    localStorage.setItem(accountStorageKey(key, accountOwner), JSON.stringify(value));
    if (!syncPaused) {
      if (["profile", "preferences"].includes(key)) {
        const clock = read("sync-clock", {});
        clock[key] = Date.now();
        localStorage.setItem(accountStorageKey("sync-clock", accountOwner), JSON.stringify(clock));
      }
      if (["library", "library-times", "watch-records-v2", "profile", "preferences"].includes(key) || key.startsWith("comments-v2.")) scheduleCloudSync();
    }
    return true;
  } catch {
    toast("Device storage is full or unavailable. This change could not be saved.");
    return false;
  }
};
const auth = createAuthService(supabaseConfig, { onChange: handleAuthChange });
const authCallbackURL = new URL(location.href);
const recoveryCallback = authCallbackURL.searchParams.get("auth") === "recovery";
const anime = catalog;
const byId = (id) => anime.find((item) => item.id === id);
const genres = [...new Set(anime.flatMap((item) => item.tags))].sort();
const studios = [...new Set(anime.map((item) => item.studio))].sort();
const app = $("#app"), sheet = $("#sheet");
const currentRoute = () => parseRoute(location.hash);
const defaultFilter = () => ({ genre: "All Catalog", rating: 0, studio: "All", dub: false, sort: "rating", view: "grid" });
let library = read("library", {});
library = Object.fromEntries(Object.entries(library).filter(([id, status]) => byId(id) && ["Watching", "Plan to Watch", "Completed"].includes(status)));
let prefs = { ...defaultPreferences, ...read("preferences", {}) };
let profile = { ...{ name: "Guest", email: "" }, ...read("profile", {}) };
let searchHistory = read("searches", []).filter((value) => typeof value === "string").slice(0, 8);
let progress = read("watch-records-v2", {}), sources = read("video-sources-v2", {}), cachedIds = read("cached-episode-keys-v2", []);
let events = read("events-v2", []);
let unread = events.filter((item) => !item.read).map((item) => item.id);
let filter = defaultFilter(), searchFilter = { ...defaultFilter(), genre: "All" };
let listTab = "Watching", notificationTab = "All", playerTab = "Episodes";
let query = "", searchGenre = "All", searchSort = "relevance", librarySort = read("library-sort", "recent"), libraryLayout = read("library-layout", "grid");
let youtubePlayer = null, player = null, playerContext = null, cleanupPlayer = null, installPrompt = null, toastTimer, searchTimer;
let searchSuggestions = null;
let routeTrail = 0, downloadKeys = new Set(), objectURLs = [], pendingSourceKey = null;
function go(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;

  
}
function toast(message) {
  const target = $("#toast");
  if (!target) return;
  target.textContent = message;
  target.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => target.classList.remove("visible"), 3500);
}
function syncSearchURL() {
  const values = { q: query, genre: searchGenre === "All" ? "" : searchGenre, sort: searchSort === "relevance" ? "" : searchSort, rating: searchFilter.rating || "", studio: searchFilter.studio === "All" ? "" : searchFilter.studio, dub: searchFilter.dub ? "1" : "" };
  history.replaceState(history.state, "", `#${routeURL("search", values)}`);
}
function restoreRouteState() {
  const { page, params } = currentRoute();
  if (page === "search") {
    query = params.get("q") || "";
    searchGenre = params.get("genre") || "All";
    searchSort = params.get("sort") || "relevance";
    searchFilter = { ...defaultFilter(), genre: searchGenre, rating: Number(params.get("rating")) || 0, studio: params.get("studio") || "All", dub: params.get("dub") === "1" };
  }
  if (page === "watchlist") listTab = ["Watching", "Plan to Watch", "Completed", "Downloaded"].includes(params.get("tab")) ? params.get("tab") : "Watching";

  if (page === "checkout") {
    const plan = params.get("plan"), method = params.get("payment");
    selectedPlan = Object.hasOwn(planPrices, plan) ? plan : "Standard";
    selectedPayment = paymentChoices.includes(method) ? method : "GCash";
  }
  if (page === "browse") filter = { ...defaultFilter(), genre: params.get("genre") || "All Catalog", rating: Number(params.get("rating")) || 0, studio: params.get("studio") || "All", dub: params.get("dub") === "1", sort: params.get("sort") || "rating", view: params.get("view") || "grid" };
}
function syncBrowseURL() {
  history.replaceState(history.state, "", `#${routeURL("browse", { genre: filter.genre === "All Catalog" ? "" : filter.genre, rating: filter.rating || "", studio: filter.studio === "All" ? "" : filter.studio, dub: filter.dub ? "1" : "", sort: filter.sort === "rating" ? "" : filter.sort, view: filter.view === "grid" ? "" : filter.view })}`);
}
function episodeLink(a, episode = resumeEpisode(a, progress), page = "player") {
  return `#${routeURL(`${page}/${a.id}${page === "player" ? `/${episode.number}` : ""}`, { season: episode.seasonId || a.defaultSeason })}`;
}
function mediaKey(id = currentRoute().id, seasonId = currentRoute().seasonId, number = currentRoute().episode) {
  const a = byId(id), s = seasonFor(a, seasonId);
  return s ? episodeKey(id, s.id, number ?? s.episodes[0].number) : "";
}
function currentEpisode() {
  const r = currentRoute(), a = byId(r.id), s = seasonFor(a, r.seasonId);
  return a && s ? { anime: a, season: s, episode: episodeFor(a, s.id, r.episode ?? s.episodes[0].number) } : null;
}
function recordEvent(title, body, type = "Library", link = "watchlist") {
  const event = { id: crypto.randomUUID(), title, body, type, link, createdAt: Date.now(), read: !prefs.alerts };
  events = [event, ...events].slice(0, 100);
  write("events-v2", events);
  unread = events.filter((item) => !item.read).map((item) => item.id);
}
function saveLibrary(id, status) {
  if (!byId(id)) return;
  const next = { ...library };
  if (status) next[id] = status;
  else delete next[id];
  if (!write("library", next)) return;
  library = next;
  write("library-times", { ...read("library-times", {}), [id]: Date.now() });
  recordEvent(status ? "Watchlist updated" : "Title removed", `${byId(id).short}${status ? ` was added to ${status}.` : " was removed from your library."}`);
  refreshSavedUI();
  toast(status ? `Saved to ${status}.` : "Removed from your library.");
}
function refreshSavedUI() {
  if (currentRoute().page !== "player") return render({ keepScroll: true });
  const button = $('[data-action="save"]', $(".player-actions"));
  if (button) button.innerHTML = `${icon("1a1f6.svg")}${library[currentRoute().id] ? "Saved" : "Save"}`;
}
function fitSheetToViewport() {
  const viewport = window.visualViewport;
  if (!sheet.open || !viewport || viewport.scale !== 1) return;
  // Keep the sheet above the keyboard when the visible viewport shrinks.
  const overlap = Math.max(0, document.documentElement.clientHeight - viewport.height - viewport.offsetTop);
  sheet.style.setProperty("--visible-height", `${viewport.height}px`);
  sheet.style.setProperty("--keyboard-overlap", `${overlap}px`);
}
window.visualViewport?.addEventListener("resize", fitSheetToViewport);
window.visualViewport?.addEventListener("scroll", fitSheetToViewport);
sheet.addEventListener("close", () => {
  if (!sheet.open) {
    sheet.style.removeProperty("--visible-height");
    sheet.style.removeProperty("--keyboard-overlap");
  }
});
function openSheet(title, body) {
  mountDialog(sheet, title, body);
  if (!sheet.open) sheet.showModal();
  else $(".sheet-close", sheet).focus({ preventScroll: true });
  fitSheetToViewport();
}
function closeSheet() {
  sheet.close();
}
function empty(title, description, action = '<a class="btn primary" href="#browse">Browse Anime</a>') {
  return `<div class="empty-state"><h2>${esc(title)}</h2><p class="muted">${esc(description)}</p>${action}</div>`;
}
function saveSheet(id) {
  const a = byId(id);
  if (!a) return;
  openSheet(a.short, `<p>Choose a status for your library.</p><div class="option-list">${["Watching", "Plan to Watch", "Completed"].map((status) => `<button class="${library[id] === status ? "selected" : ""}" data-action="set-library" data-id="${id}" data-value="${status}">${status}${library[id] === status ? " ✓" : ""}</button>`).join("")}${library[id] ? `<button class="sheet-danger" data-action="remove-library" data-id="${id}">Remove from My Library</button>` : ""}</div>`);
}
function relativeTime(time) {
  const minutes = Math.floor((Date.now() - time) / 6e4);
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
const formatTime = (seconds) => `${Math.floor((seconds || 0) / 60).toString().padStart(2, "0")}:${Math.floor((seconds || 0) % 60).toString().padStart(2, "0")}`;
function art(file, alt = "", style = "", base = "") {
  return `<div class="art"${style ? ` style="${style}"` : ""}>${base ? `<img class="base" src="${A(base)}" alt="" loading="lazy">` : ""}<img class="art-image" src="${A(file)}" alt="${esc(alt)}" loading="lazy"></div>`;
}
function crop(file, alt, style, base = "") {
  return `<div class="art">${base ? `<img class="base" src="${A(base)}" alt="" loading="lazy">` : ""}<img class="art-image" src="${A(file)}" alt="${esc(alt)}" style="${style}" loading="lazy"></div>`;
}
function header(label = "", brandLabel = "", options = {}) {
  const title = label ? `<button class="icon-button back" data-action="back" aria-label="Go back">${icon("47f45.svg")}</button><h1 class="page-heading">${esc(label)}</h1>` : `<a class="brand" href="#home" aria-label="AniVerse home"><img src="${A("f31ce.png")}" alt="AniVerse"><span><span class="wordmark">Ani<span>Verse</span></span><span class="brand-label" style="display:block">${esc(brandLabel)}</span></span></a>`;
  return `<header class="topbar"><div class="topbar-inner">${title}<div class="top-actions">${!label ? `<a class="icon-button" href="#search" aria-label="Search anime">${icon("18cbb.svg")}</a>` : ""}${options.help ? `<button class="icon-button" data-action="help" aria-label="Checkout help">${icon("02f31.svg")}</button>` : !options.noBell ? `<a class="icon-button notification-button" href="#notifications" aria-label="Notifications${unread.length ? `, ${unread.length} unread` : ""}">${icon("58e6e.svg")}${unread.length ? '<span class="notification-dot"></span>' : ""}</a>` : ""}<a class="icon-button" href="${authUser ? "#profile" : "#login"}" aria-label="${authUser ? "Profile settings" : "Log in or create account"}"><span class="profile-icon">${icon("731c8.svg")}</span></a></div></div></header>`;
}
function nav(active) {
  const tabs = [["home", "Home", active === "home" ? "fed06.svg" : "199ff.svg"], ["browse", "Browse", active === "browse" ? "3a22f.svg" : "d070c.svg"], ["watchlist", "Watchlist", active === "watchlist" ? "8516a.svg" : "8a05e.svg"], ["profile", "Profile", active === "profile" ? "ee114.svg" : "dd5e2.svg"]];
  return `<nav class="bottom-nav" aria-label="Main navigation">${tabs.map(([id, label, file]) => `<a class="nav-link ${active === id ? "active" : ""}" href="#${id}" ${active === id ? 'aria-current="page"' : ""}>${icon(file)}<span>${label}</span></a>`).join("")}</nav>`;
}
function rating(value, file = "de4ec.svg") {
  return `<span class="pill rating">${icon(file)}${value}</span>`;
}
function homePoster(id, seasonal = false) {
  const a = byId(id), files = { jjk: ["0fdd3.png", "inset:0 -2px -7px -3px;width:calc(100% + 5px);height:calc(100% + 7px)", "0e479.png"], demon: ["ff5ca.png", ""], chainsaw: ["d67b3.png", "left:-10px;right:-19px;top:-55px;width:calc(100% + 29px);height:auto;aspect-ratio:735/1143"], frieren: ["6782a.png", "left:-11px;top:-15px;width:calc(100% + 22px);height:auto;aspect-ratio:236/333"], kaiju: ["96d3b.png", "left:-6px;top:0;width:calc(100% + 11px);height:auto;aspect-ratio:742/1050"], oshi: ["1b141.png", "left:-43px;top:-59px;width:calc(100% + 56px);height:calc(100% + 63px)", "d1c99.png"] };
  const [file, style, base] = files[id] || [a.home, ""];
  return `<a class="poster-card" href="#detail/${id}"><div class="poster">${crop(file, a.title, style, base)}${rating(a.rating)}<span class="pill episode-label">${a.episodes} EPS</span>${id === "jjk" ? '<div class="progress"><i></i></div>' : ""}</div><div class="poster-info"><h3 class="ellipsis">${esc(id === "frieren" ? "Frieren: Beyond Journey" : a.short)}</h3><p class="muted ellipsis">${esc(id === "jjk" ? "Supernatural • Action" : id === "oshi" ? "Mystery • Drama" : id === "kaiju" ? "Sci-Fi • Shonen" : id === "frieren" ? "Drama • Fantasy" : a.genre)}</p></div></a>`;
}
function home() {
  return `${header("", "HOME")}<main class="home-page"><form class="search-pill" id="home-search" role="search"><button type="submit" aria-label="Search anime">${icon("bf859.svg")}</button><input class="placeholder" type="search" name="query" placeholder="Search anime, genres, studios..." maxlength="200" aria-label="Search anime"><button type="button" class="filter-bubble" data-action="filters" aria-label="Filter and sort">${icon("2aa1d.svg")}</button></form><section class="hero"><div class="hero-art"><img src="${A("8fba8.png")}" alt="Attack on Titan battlefield"></div><div class="hero-content"><div class="badge-row"><span class="pill hot">FEATURED SPOTLIGHT</span><span class="pill peach">SIMULCAST PREMIERE</span></div><a href="#detail/aot"><h1>Attack on Titan: The Final<br>Season</h1></a><div class="badge-row">${rating("9.1", "2dfc5.svg")}<span class="pill">Action</span><span class="pill">Dark Fantasy</span><span class="pill cyan">Sub | Dub</span></div><p class="hero-synopsis muted clamp">The war for Paradis zeroes in on Shiganshina as Jaegerists take control. The ultimate clash between Eren and the…</p><div class="actions"><a class="btn primary" href="#player/aot/29">${icon("32ab0.svg")}Watch Now</a><button class="btn secondary" data-action="save" data-id="aot">${icon("78b0c.svg")}My List</button></div></div></section><section class="home-section"><div class="section-title"><h2 class="accent-title">Trending Now</h2><a class="text-button" href="#browse">See All${icon("f9bf5.svg")}</a></div><div class="carousel">${["jjk", "demon", "chainsaw"].map((id) => homePoster(id)).join("")}</div></section><section class="home-section"><div class="section-title"><h2 class="accent-title cool">Top Seasonal Anime</h2><button class="text-button cyan" data-action="seasonal">Top Rated${icon("6bab5.svg")}</button></div><div class="carousel">${["frieren", "kaiju", "oshi"].map((id) => homePoster(id, true)).join("")}</div></section>${shouldShowPremiumUpgrade() ? `<section class="premium-banner"><div class="row"><span class="premium-icon">${icon('36720.svg')}</span><div><div class="eyebrow">MEMBERSHIP PASS</div><h2>Upgrade to AniVerse Premium</h2></div></div><p>Stream ad-free anime, catch new simulcasts 1 hour after Japan, enjoy crisp 4K HDR playback, and download episodes for offline viewing.</p><div class="perks"><span>${icon('163ef.svg')}No Ads</span><span>${icon('ea915.svg')}Simulcasts</span><span>${icon('d8320.svg')}Offline</span></div><a class="btn primary full" href="#checkout">Go Premium${icon('616d6.svg')}</a></section>` : ""}</main>${nav("home")}`;
}
function posterSpec(a, scope) {
  const maps = { browse: { frieren: ["ee8b0.png", "left:-4px;top:-6px;width:calc(100% + 10px);height:calc(100% + 14.5px)", "54ab7.png"], aot: ["875f7.png", "top:3px;left:0;width:calc(100% + 9px);height:auto;aspect-ratio:849/1200"], bleach: ["7dc71.png", "left:-5px;top:0;width:calc(100% + 11px);height:auto;aspect-ratio:736/1040"], jjk: ["8c4f3.png", "left:-15px;top:0;width:calc(100% + 30px);height:calc(100% + 27.5px)", "6a89c.png"], dandadan: ["b8d7d.png", "height:calc(100% + .5px)", "bfc9b.png"], demon: ["12b05.png", "left:-14px;top:-21px;width:calc(100% + 44px);height:calc(100% + 66.5px)", "b6ab5.png"], chainsaw: ["53227.png", "left:-5px;width:calc(100% + 11px);height:calc(100% + .5px)", "014cb.png"], solo: ["2a9eb.png", "left:-9px;top:-14px;width:calc(100% + 18px);height:calc(100% + 26.5px)", "dddc4.png"], kaiju: ["96d3b.png", "left:-8px;top:-14px;width:calc(100% + 19px);height:auto;aspect-ratio:742/1050"] }, watch: { frieren: ["ee8b0.png", "top:-18px;left:0;width:calc(100% + 12px);height:calc(100% + 18.5px)", "00490.png"], kaiju: ["097ca.png", "top:-5px;left:-12px;width:calc(100% + 16px);height:calc(100% + 5.5px)", "4a810.png"], solo: ["2a9eb.png", "left:0;top:-17.5px;width:calc(100% + 12px);height:calc(100% + 17.5px)", "d9a50.png"], chainsaw: ["53227.png", "left:-3px;top:-7.5px;width:calc(100% + 7px);height:calc(100% + 7.5px)", "fbf3a.png"] } };
  return maps[scope]?.[a.id] || [a.image, ""];
}
function catalogCard(a) {
  const [file, style, base] = posterSpec(a, "browse");
  return `<article class="catalog-card"><a href="#detail/${a.id}"><div class="poster">${crop(file, a.title, style, base)}${rating(a.rating, "323d0.svg")}<div class="studio"><span>${esc(a.studio)}</span><span>Ep ${a.episodes}</span></div></div><div class="catalog-info"><h3>${esc(a.title)}</h3><p class="ellipsis">${esc(a.genre)}</p><div class="status"><span>${esc(a.status)}</span>${icon("ba8c5.svg")}</div></div></a><button class="bookmark" data-action="toggle-save" data-id="${a.id}" aria-label="${library[a.id] ? "Remove" : "Add"} ${esc(a.short)} ${library[a.id] ? "from" : "to"} watchlist" aria-pressed="${!!library[a.id]}">${icon(library[a.id] ? "1a1f6.svg" : "2522e.svg")}</button></article>`;
}
let vip = null, vipUntil = null, membershipBusy = false, membershipError = "", membershipRead = 0, membershipLoaded = false;
const membershipDate = value => new Date(value).toLocaleDateString();
const canAccessMembership = () => Boolean(authUser && !authUser.is_anonymous);
function shouldShowPremiumUpgrade() {
  const now = Date.now();
  return canAccessMembership() && membershipLoaded
    && !(Date.parse(vipUntil) > now || Date.parse(vip?.access_until) > now);
}
const isMembershipRoute = (page) => page === "checkout" || page === "confirmation";

const planPrices = { Basic: 99, Standard: 179, Premium: 249 };
const paymentChoices = ["GCash", "Maya", "Credit / Debit Card"];
const money = value => `₱${value.toFixed(2)}`;
let selectedPlan = "Standard", selectedPayment = "GCash", savedPlan = "Standard", checkoutAfterLogin = null;
function planCard(name, subtitle, features, file) {
  const selected = name === selectedPlan;
  return `<button class="plan-option ${selected?'selected':''} ${name==='Standard'?'standard':''}" data-action="select-plan" data-value="${name}" role="radio" aria-checked="${selected}">${name==='Standard'?`<span class="most-popular">${icon('3bf7b.svg')}MOST POPULAR</span>`:''}<div class="plan-main"><span class="radio"></span><span class="grow"><span class="plan-name">${name} ${name==='Standard'?'<span class="pill orange">FULL HD</span>':name==='Premium'?'<span class="pill purple">4K + HDR</span>':''}</span><span class="plan-subtitle" style="display:block">${subtitle}</span></span><span class="plan-price">₱${planPrices[name]}<small>/ month</small></span></div><div class="plan-features">${features.map((t,i)=>`<span>${icon(Array.isArray(file)?file[i]:file)}${t}</span>`).join('')}</div></button>`;
}
function checkout() {
  const total = planPrices[selectedPlan];
  return `${header('Choose Your Plan','',{help:true})}<main class="checkout-page"><section class="checkout-intro"><span class="pill cyan">${icon('f798b.svg')}ANIVERSE ALL-ACCESS PASS</span><p>Select the right streaming experience for you.<br>Change or cancel anytime.</p></section><div class="plan-options" role="radiogroup" aria-label="Subscription plan">${planCard('Basic','Essential episodic library',['720p HD Video','1 Screen','Standard Audio'],['d5e9c.svg','82f3d.svg','c1ab2.svg'])}${planCard('Standard','Uncut simulcast experiences',['1080p Full HD crystal streaming','Watch on 2 simultaneous screens','100% Ad-free unlimited streaming','Tokyo Simulcasts direct 1h after air'],['2ff45.svg','2ff45.svg','2ff45.svg','c7485.svg'])}${planCard('Premium','The supreme otaku theater',['4K Ultra HD + HDR','4 Simultaneous Screens','Offline Downloads','Dolby Atmos 5.1 & Dubs'],['399ae.svg','d2794.svg','5ebc5.svg','90cf0.svg'])}</div><section class="payment-section"><div class="section-title"><h2>${icon('5cc55.svg')}Payment Method</h2><span class="pill cyan">PHILIPPINES PH</span></div><div role="radiogroup" aria-label="Payment method">${['GCash','Maya','Credit / Debit Card'].map((p,i)=>`<button class="payment-method ${p===selectedPayment?'selected':''}" role="radio" aria-checked="${p===selectedPayment}" data-action="payment" data-value="${p}"><span class="payment-logo ${i===0?'gcash':i===1?'maya':''}">${i===0?`<img class="gcash-logo" src="${A('1458b.png')}" alt="GCash">`:i===1?`<img src="${A('0caf1.png')}" alt="Maya">`:'<span class="card-logo">VISA<b></b></span>'}</span><span class="grow"><strong>${p}${i===0?' <span class="pill cyan">INSTANT</span>':''}</strong><small>${['Philippine e-Wallet (Instant 1-Click Pay)','Digital Wallet & Maya Bank','Visa, Mastercard, JCB'][i]}</small></span><span class="radio"></span></button>`).join('')}</div></section><section class="order-summary"><div class="section-title"><h2>Order Summary</h2><span class="eyebrow peach">SIMULCAST TIER</span></div><div class="summary-row"><strong>${selectedPlan} Plan</strong><strong>${money(total)} / mo</strong></div><div class="summary-row"><span>Processing &amp; Network Fees</span><span class="cyan">₱0.00 (FREE)</span></div><div class="summary-row"><span>AniVerse Tokyo Streaming Pass</span><span class="cyan">Included</span></div><div class="summary-total"><span><span class="eyebrow">TOTAL DUE TODAY</span><small class="cyan" style="display:block">Plan price ${money(total)} / mo</small></span><strong class="amount">₱0.00</strong></div><div class="auto-renew">${icon('f1684.svg')}<span>Subscribe activates access for 30 days without billing.</span></div></section><section class="checkout-submit"><button class="btn primary full" data-action="subscribe" ${membershipBusy ? "disabled" : ""}>${icon('1bcda.svg')}${membershipBusy ? "Activating…" : "Subscribe &amp; Start Watching"}</button><p class="checkout-security">${icon('2842a.svg')}Payment method selection stays on this screen.</p><p class="form-error" role="alert">${esc(membershipError)}</p><div class="checkout-links"><button data-action="terms">Terms of Service</button><span>•</span><button data-action="privacy">Privacy Policy</button><span>•</span><button data-action="help">Support &amp; FAQ</button></div></section></main>`;
}
function confirmation() {
  if (!vipUntil || Date.parse(vipUntil) <= Date.now()) {
    return `${header("Payment / Checkout")}<main class="page no-nav">${empty("Membership", "Open your profile to check your membership.", '<a class="btn primary" href="#profile">Back to Profile</a>')}</main>`;
  }
  return `${header('Payment / Checkout','',{noBell:true})}<main class="success-page"><section class="success-intro"><div class="success-emblem"><span>${icon('f052e.svg')}</span><span class="success-spark">${icon('18536.svg')}</span><span class="success-spark small-spark">${icon('42730.svg')}</span></div><span class="pill peach">● SUBSCRIPTION CONFIRMED</span><h1>Subscription Active!</h1><p>Welcome to AniVerse ${esc(savedPlan)}! Your subscription is active.</p></section><section class="card success-plan"><div class="row">${icon('0e37e.svg')}<div class="grow"><div class="eyebrow">PLAN SELECTED</div><h2>${esc(savedPlan)} Pass</h2></div><span class="pill cyan">● Active &amp; Verified</span></div><div class="receipt">
        <div><span>Amount Paid</span><strong>₱0.00</strong></div>
        <div><span>Valid Through</span><span>${membershipDate(vipUntil)}</span></div>
      </div></section><a class="btn primary full" href="#home">${icon('65617.svg')}Start Streaming Now</a><p class="success-footer">${icon('15c5c.svg')}Membership saved to your account.</p></main>`;
}
async function refreshMembership() {
  if (!canAccessMembership() || !auth.client) return;
  const owner = authUser.id, generation = ++membershipRead;
  const [demo, paid] = await Promise.all([
    auth.client.from("vip_demo_passes").select("expires_at,plan").eq("user_id", owner).maybeSingle(),
    auth.client.from("vip_payments").select("access_until").eq("user_id", owner).eq("status", "paid").eq("live", true)
      .gt("access_until", new Date().toISOString()).order("access_until", { ascending: false }).limit(1)
  ]);
  if (authUser?.id !== owner || generation !== membershipRead) return;
  const showedUpgrade = shouldShowPremiumUpgrade();
  if (!demo.error) {
    vipUntil = demo.data?.expires_at || null;
    savedPlan = demo.data?.plan || "Standard";
  }
  if (!paid.error) vip = paid.data[0] || null;
  if (!demo.error && !paid.error) membershipLoaded = true;
  const page = currentRoute().page;
  if (["profile", "checkout", "confirmation"].includes(page)
    || (page === "home" && showedUpgrade !== shouldShowPremiumUpgrade())) {
    render({ keepScroll: true });
  }
}

async function subscribeMembership() {
  if (!canAccessMembership() || membershipBusy) return;
  const plan = selectedPlan;
  const owner = authUser.id;
  membershipBusy = true;
  membershipError = "";
  render({ keepScroll: true });
  try {
    const { data, error } = await auth.client.rpc("subscribe_vip", { selected_plan: plan });
    if (authUser?.id !== owner) return;
    if (error || !data) throw new Error("Could not activate your subscription. Please try again.");
    membershipRead++;
    vipUntil = data;
    savedPlan = plan;
    if (currentRoute().page === "checkout") go("confirmation");
    else if (currentRoute().page === "home") render({ keepScroll: true });
  } catch (error) {
    if (authUser?.id === owner) membershipError = error.message;
  } finally {
    if (authUser?.id === owner) {
      membershipBusy = false;
      if (currentRoute().page === "checkout") render({ keepScroll: true });
    }
  }
}

function filteredCatalog() {
  return findAnime(anime, "", filter, filter.sort);
}
function filterCount(value) {
  return Number(value.rating > 0) + Number(value.studio !== "All") + Number(value.dub) + Number(!["All", "All Catalog"].includes(value.genre));
}
function filterPills(value, target) {
  return `<div class="active-filters"><span>Active:</span><button data-action="filters">Rating: <b>${value.rating ? value.rating + "+" : "All"}</b></button>${value.studio !== "All" ? `<button data-action="filters">${esc(value.studio)}</button>` : ""}<button data-action="filters">Audio: <b>${value.dub ? "English dub" : "Any"}</b></button><button class="reset" data-action="reset-filters" data-target="${target}">× Reset All</button></div>`;
}
function browse() {
  const list = filteredCatalog();
  return `${header("", "Browse")}<main class="page"><div class="catalog-controls"><button class="control" data-action="filters">${icon("17611.svg")}Filter &amp; Sort<span class="pill hot">${filterCount(filter)}</span></button><label class="control">${icon("0af98.svg")}<select aria-label="Sort catalog" data-setting="sort">${[["rating", "Top Rated"], ["az", "Title A–Z"], ["new", "Recently Added"]].map(([value, label]) => `<option value="${value}" ${filter.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select>${icon("74cf0.svg")}</label></div><div class="chips">${["All Catalog", ...genres].map((genre) => `<button class="chip ${filter.genre === genre ? "active" : ""}" data-action="catalog-genre" data-value="${esc(genre)}" aria-pressed="${filter.genre === genre}">${esc(genre)}</button>`).join("")}</div><div class="row between catalog-status"><p class="eyebrow"><span class="orange">●</span> SHOWING ${list.length} OF ${anime.length} ANIME TITLES</p><div class="view-toggle"><button data-action="view" data-value="grid" aria-label="Two column view" aria-pressed="${filter.view === "grid"}">${icon("5b752.svg")}</button><button data-action="view" data-value="list" aria-label="Compact list view" aria-pressed="${filter.view === "list"}">${icon("e44f5.svg")}</button></div></div>${filterPills(filter, "browse")}<div class="catalog-grid ${filter.view === "list" ? "list" : ""}">${list.map(catalogCard).join("") || empty("No matching titles", "Try another genre, studio, or rating.", '<button class="btn primary" data-action="reset-filters">Reset Filters</button>')}</div><div class="catalog-footer"><p>${list.length === anime.length ? "You’ve explored all available catalog titles." : `${list.length} titles match your filters.`}</p><button class="btn primary" data-action="filters">${icon("1e5fc.svg")}Refine Filters</button></div></main>${nav("browse")}`;
}
function filterSheet() {
  const target = currentRoute().page === "search" ? "search" : "browse", value = target === "search" ? searchFilter : filter;
  openSheet("Filter & Sort", `<form id="filter-form" class="stack" data-target="${target}"><label class="field">Minimum Rating<select name="rating">${[0, 7, 8, 8.5, 9].map((rating2) => `<option value="${rating2}" ${rating2 === value.rating ? "selected" : ""}>${rating2 ? rating2 + "+" : "All ratings"}</option>`).join("")}</select></label><label class="field">Studio<select name="studio">${["All", ...studios].map((studio) => `<option ${value.studio === studio ? "selected" : ""}>${esc(studio)}</option>`).join("")}</select></label><label class="field">Genre<select name="genre">${[target === "search" ? "All" : "All Catalog", ...genres].map((genre) => `<option ${value.genre === genre ? "selected" : ""}>${esc(genre)}</option>`).join("")}</select></label><label class="field-check"><input type="checkbox" name="dub" ${value.dub ? "checked" : ""}>English dub in catalog metadata</label><button class="btn primary" type="submit">Apply Filters</button><button class="text-button" type="button" data-action="reset-filters" data-target="${target}">Reset All</button></form>`);
}
function searchResults() {
  return findAnime(anime, query, { ...searchFilter, genre: searchGenre }, searchSort);
}
function searchCard(a, first) {
  const saved = !!library[a.id], episode = resumeEpisode(a, progress);
  if (first) return `<article class="card spotlight-result"><a href="#detail/${a.id}"><div class="result-art">${a.id === "aot" ? crop("7ab29.png", a.title, "top:-229px;left:0;width:calc(100% + 9px);height:calc(100% + 346px)", "171b2.png") : art(a.image, a.title, "width:100%;height:100%")}<div class="result-badges"><span class="pill hot">${esc(a.status)}</span><span class="pill cyan">${query.trim() ? "TOP MATCH" : "FEATURED"}</span>${rating(a.rating, "c53b4.svg")}</div><span class="pill" style="position:absolute;bottom:8px;right:8px">${a.episodes} EPISODES</span></div></a><div class="result-content"><div class="row between"><a href="#detail/${a.id}"><h2>${esc(a.title)}</h2></a><button class="icon-button secondary" data-action="toggle-save" data-id="${a.id}" aria-label="${saved ? "Remove" : "Add"} ${esc(a.short)} ${saved ? "from" : "to"} watchlist" aria-pressed="${saved}">${icon(saved ? "1a1f6.svg" : "8e5e2.svg")}</button></div><p class="metadata">${esc(a.studio)} &nbsp;•&nbsp; ${esc(a.genre)}</p><p class="small clamp">${esc(a.description)}</p><div class="actions"><a class="btn primary" href="${episodeLink(a, episode)}">${icon("e28bc.svg")}${progress[episodeKey(a.id, episode.seasonId, episode.number)] ? "Continue Watching" : "Watch Now"}</a><span class="pill cyan">${icon("6f0b4.svg")}${a.audio.includes("en") ? "Sub | Dub" : "Sub"}</span></div></div></article>`;
  return `<article class="small-result"><a href="#detail/${a.id}">${crop(a.id === "demon" ? "5ad1c.png" : a.image, a.title, a.id === "demon" ? "left:-5px;top:-11px;width:calc(100% + 5px);height:calc(100% + 21px)" : "")}</a><div class="result-content"><div class="badge-row"><span class="pill cyan">${esc(a.studio)}</span><span class="pill peach">${a.audio.includes("en") ? "Dub Available" : "Subtitled"}</span></div><a href="#detail/${a.id}"><h3 class="ellipsis">${esc(a.title)}</h3></a><p class="ellipsis">${esc(a.genre)}</p><p class="clamp">${esc(a.description)}</p><div class="result-foot"><span class="eyebrow cyan">${a.episodes} EPISODES · ${a.year}</span><button class="icon-button" data-action="toggle-save" data-id="${a.id}" aria-label="${saved ? "Remove" : "Add"} ${esc(a.short)} ${saved ? "from" : "to"} watchlist" aria-pressed="${saved}">${icon(saved ? "1a1f6.svg" : "78b0c.svg")}</button></div></div></article>`;
}
function resultsMarkup() {
  const list = searchResults();
  return `<div class="result-status"><span role="status">${list.length} MATCHING ${list.length === 1 ? "RESULT" : "RESULTS"}</span><label>Sort <select data-setting="search-sort" aria-label="Sort search results">${[["relevance", "Relevance"], ["rating", "Top Rated"], ["az", "Title A–Z"], ["new", "Recently Added"]].map(([value, label]) => `<option value="${value}" ${searchSort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>${list.map((a, i) => searchCard(a, i === 0)).join("") || empty("No matching anime", query.trim() ? `“${query.trim()}” isn’t in this catalog. Try another spelling or clear your filters.` : "No titles match these filters.", '<button class="btn primary" data-action="clear-search-filters">Clear Filters</button>')}`;
}
function search() {
  return `${header("Search Explore")}<main class="page no-nav search-page"><div class="search-input-row"><form class="input-wrap" id="search-form" role="search">${icon("e6db6.svg")}<input name="query" id="anime-search" type="search" value="${esc(query)}" placeholder="Search anime, genres, studios..." autocomplete="off" maxlength="200" aria-label="Search anime"><button class="clear" type="button" data-action="clear-query" aria-label="Clear search">×</button></form><button class="square-button primary" data-action="filters" aria-label="Search filters">${icon("1e5fc.svg")}</button></div><div class="chips">${["All", ...genres].map((genre) => `<button class="chip cool ${searchGenre === genre ? "active" : ""}" data-action="search-genre" data-value="${esc(genre)}" aria-pressed="${searchGenre === genre}">${esc(genre)}</button>`).join("")}</div>${filterCount(searchFilter) > 0 ? filterPills(searchFilter, "search") : ""}<section class="search-recent"><div class="section-title"><h2 class="accent-title">Recent Searches</h2><button class="text-button micro" data-action="clear-history">CLEAR HISTORY</button></div><div id="search-history" class="history-chips">${historyMarkup()}</div></section><section id="search-results" aria-label="Search results">${resultsMarkup()}</section></main>`;
}
function historyMarkup() {
  return searchHistory.map((value) => `<span class="history-chip"><button data-action="history" data-value="${esc(value)}">${icon("a6a1e.svg")}${esc(value)}</button><button class="remove" data-action="remove-history" data-value="${esc(value)}" aria-label="Remove ${esc(value)} from history">×</button></span>`).join("") || '<span class="small">No recent searches yet.</span>';
}
function rememberSearch() {
  const value = query.trim();
  if (!normalize(value)) return;
  searchHistory = [value, ...searchHistory.filter((item) => normalize(item) !== normalize(value))].slice(0, 8);
  write("searches", searchHistory);
  if ($("#search-history")) $("#search-history").innerHTML = historyMarkup();
}
function updateSearchResults() {
  if (!$("#search-results")) return;
  syncSearchURL();
  $("#search-results").innerHTML = resultsMarkup();
}
function watchingCard(id) {
  const a = byId(id);
  const resume = resumeEpisode(a, progress);
  const resumeKey = episodeKey(id, resume.seasonId, resume.number);
  const preview = read("preview-progress-v1", {})[id];
  const previewEpisode = episodeFromKey(preview?.episodeKey || "");
  const previewKey = previewEpisode?.anime.id === id ? preview.episodeKey : resumeKey;
  const source = sourceFor(previewKey);
  const usePreview = preview?.seconds > 0 && preview.duration > 0
    && !orderedEpisodes(a).some(item => {
      const record = progress[episodeKey(id, item.seasonId, item.number)];
      return record?.seconds > 0 || record?.completed;
    })
    && !cachedIds.includes(previewKey) && (!source || source.preview);
  const episode = usePreview && previewKey !== resumeKey
    ? orderedEpisodes(a).find(item => episodeKey(id, item.seasonId, item.number) === previewKey)
    : resume;
  const record = usePreview ? preview : progress[resumeKey] || {};
  const completed = library[id] === "Completed";
  const percent = record.duration ? Math.max(0, Math.min(100, record.seconds / record.duration * 100)) : 0;
  const artInfo = { aot: ["875f7.png", "left:-8px;top:-19px;width:calc(100% + 8px);height:calc(100% + 26px)", "56df0.png"], jjk: ["bfc04.png", "left:-3px;top:-17px;width:calc(100% + 6px);height:calc(100% + 34px)", "232dd.png"], demon: ["5ad1c.png", "left:-1px;top:-8px;width:calc(100% + 1px);height:calc(100% + 16px)", "5943b.png"] };
  const [file, style, base] = artInfo[id] || [a.image, ""];
  return `<article class="watching-card"><a class="watching-art art" href="#detail/${id}">${crop(file, a.title, style, base)}<span class="episode-label">S${episode.seasonNumber} · EP ${episode.number}</span><span class="remaining">${icon(completed ? "a0df9.svg" : "5da9a.svg")}${completed ? "Completed" : usePreview ? (preview.completed ? "Preview finished" : "Preview in progress") : record.seconds ? `${Math.max(0, Math.ceil(((record.duration || episode.duration) - record.seconds) / 60))}m left` : "Ready to watch"}</span></a><div class="watching-content"><div><div class="row between"><span class="pill peach">${esc(a.status)}</span><span class="row micro peach" style="gap:3px">${icon("d2e0c.svg")}${a.rating}</span></div><a href="#detail/${id}"><h3>${esc(a.short)}</h3></a><p class="subtext ellipsis">${esc(episode.seasonName)}</p><div class="genres">${a.tags.slice(0, 2).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></div><div><div class="progress" style="--progress:${completed ? 100 : percent}%"><i ${completed ? 'style="background:#00e3fd"' : ""}></i></div><div class="row"><a class="btn ${completed ? "secondary" : "primary"}" href="${episodeLink(a, episode)}">${icon(completed ? "f1f76.svg" : "796cd.svg")}${completed ? "Rewatch" : usePreview ? (preview.completed ? "Replay Preview" : "Resume Preview") : record.seconds ? "Resume" : "Start"} S${episode.seasonNumber}:E${episode.number}</a><button class="mini-save" data-action="edit-library" data-id="${id}" aria-label="Manage ${esc(a.short)}">${icon("eeef3.svg")}</button></div></div></div></article>`;
}
function watchlistCard(id, episodeOverride) {
  const a = byId(id), episode = episodeOverride || resumeEpisode(a, progress), [file, style, base] = posterSpec(a, "watch"), completed = library[id] === "Completed";
  return `<article class="watchlist-card"><a href="#detail/${id}"><div class="poster">${crop(file, a.title, style, base)}${rating(a.rating, "62b6f.svg")}<span class="episode-bottom">${episodeOverride ? `EPISODE ${episode.number} · OFFLINE` : a.episodes + " EPISODES"}</span></div><div class="info"><h3>${esc(a.short)}</h3><p class="ellipsis">${esc(a.genre)}</p></div></a><div class="info" style="padding-top:0"><a class="btn full" href="${episodeLink(a, episode)}${episodeOverride ? "&offline=1" : ""}">${icon("712e8.svg")}${episodeOverride ? "Play Offline" : completed ? "Rewatch" : `Start Ep ${episode.number}`}</a></div>${episodeOverride ? `<button class="bookmark" data-action="remove-local-video" data-key="${esc(episodeKey(id, episode.seasonId, episode.number))}" aria-label="Remove offline episode ${episode.number}">×</button>` : `<button class="bookmark" data-action="edit-library" data-id="${id}" aria-label="Manage ${esc(a.short)}">${icon("78b0c.svg")}</button>`}</article>`;
}
function sortedLibrary(ids) {
  const times = read("library-times", {});
  return [...ids].sort((a, b) => librarySort === "az" ? byId(a).title.localeCompare(byId(b).title) : librarySort === "rating" ? byId(b).rating - byId(a).rating : (times[b] || 0) - (times[a] || 0));
}
function libraryView() {
  const ids = Object.keys(library).filter(byId), watching = sortedLibrary(ids.filter((id) => library[id] === "Watching")), planned = sortedLibrary(ids.filter((id) => library[id] === "Plan to Watch")), completed = sortedLibrary(ids.filter((id) => library[id] === "Completed"));
  let content = "";
  if (listTab === "Watching") content = `<div class="section-title"><h2 class="library-status-heading">CONTINUE PLAYING</h2><button class="control" data-action="library-sort">${librarySort === "az" ? "Title A–Z" : librarySort === "rating" ? "Top Rated" : "Recently Added"} ${icon("80637.svg")}</button></div><div class="stack">${watching.map(watchingCard).join("") || empty("Your watchlist starts here", "Save an anime or start an episode to add it to your library.")}</div>${planned.length ? `<section class="library-section"><div class="section-title"><h2 class="accent-title cool">Plan to Watch <small>(${planned.length})</small></h2><button class="text-button" data-action="library-sort">Manage Order ${icon("ebddc.svg")}</button></div><div class="watchlist-grid ${libraryLayout === "list" ? "one-column" : ""}">${planned.map((id) => watchlistCard(id)).join("")}</div></section>` : ""}`;
  else if (listTab === "Downloaded") {
    const local = cachedIds.map((key) => episodeFromKey(key)).filter(Boolean);
    content = local.length ? `<div class="watchlist-grid ${libraryLayout === "list" ? "one-column" : ""}">${local.map(({ anime: a, episode, season }) => watchlistCard(a.id, { ...episode, seasonId: season.id, seasonNumber: season.number })).join("")}</div>` : empty("No offline episodes yet", "Open an episode and save a video file or download its configured video source.");
  } else {
    const list = listTab === "Completed" ? completed : planned;
    content = list.length ? `<div class="watchlist-grid ${libraryLayout === "list" ? "one-column" : ""}">${list.map((id) => watchlistCard(id)).join("")}</div>` : empty(`No ${listTab.toLowerCase()} titles yet`, "Change an anime’s status from its Watchlist button.");
  }
  return `${header("", "MY WATCHLIST")}<main class="page"><div class="library-head"><div class="row between"><h1 class="accent-title" style="font-size:22px">My Library</h1><div class="row"><button class="control" data-action="library-layout" aria-label="Toggle library layout" aria-pressed="${libraryLayout === "list"}">${icon("2c17c.svg")}</button><button class="control" data-action="library-sort" aria-label="Sort library">${icon("63d16.svg")}</button></div></div><div class="counts"><span>${ids.length} ANIME BOOKMARKED</span><span>${cachedIds.length} Episodes Cached</span></div></div><div class="chips library-tabs">${["Watching", "Plan to Watch", "Completed", "Downloaded"].map((tab, i) => `<button class="chip ${listTab === tab ? "active" : ""}" data-action="library-tab" data-value="${tab}" aria-pressed="${listTab === tab}">${tab}<b>${[watching.length, planned.length, completed.length, cachedIds.length][i]}</b></button>`).join("")}</div>${content}<section class="offline-banner"><div class="eyebrow row peach">${icon("058ef.svg")}OFFLINE LIBRARY</div><h3>Your episodes, on this device</h3><p>Saved video files and downloaded episodes stay available without an internet connection.</p><div class="row between"><span class="storage"><span class="offline-dot"></span><span id="storage-used">Storage Used: calculating…</span></span><button class="btn" data-action="offline-preferences">Preferences</button></div></section></main>${nav("watchlist")}`;
}
function settingRow(file, title, sub, value, action) {
  return `<button class="settings-row" data-action="${action}"><span class="settings-icon">${icon(file)}</span><span class="settings-copy"><strong>${title}</strong><small>${sub}</small></span><span class="settings-value">${esc(value)} ${icon("b624d.svg")}</span></button>`;
}
function preferenceSwitch(file, title, description, pref) {
  return `<div class="settings-row">
    <span class="settings-icon">${icon(file)}</span>
    <span class="settings-copy"><strong>${title}</strong><small>${description}</small></span>
    <button class="switch" role="switch" aria-label="${esc(title)}" aria-checked="${prefs[pref]}" data-action="toggle-pref" data-value="${pref}"></button>
  </div>`;
}
function profilePage() {
  const { episodes, completedTitles, level, levelXP } = profileStatistics(progress, library, read("preview-progress-v1", {}));
  const photo = storedProfilePhoto(read("profile-photo", "")) || A("2d8b9.png");
  const device = /iPhone|iPad/.test(navigator.userAgent) ? "iPhone / iPad" : /Android/.test(navigator.userAgent) ? "Android browser" : "Desktop browser";
  const verified = authUser?.email_confirmed_at ? `<svg class="verified-badge" viewBox="0 0 20 20" role="img" aria-label="Email verified"><path fill="currentColor" d="m10 0 2.6 2.1 3.3-.2.9 3.2 2.7 1.9-1.2 3.1.6 3.3-3 1.4-1.5 2.9-3.2-.6L8 19l-1.9-2.7-3.2-.9.2-3.3L1 9.5l2.1-2.6-.2-3.3 3.2-.9L8 0z"/><path d="m6 9.5 2.5 2.5L14 6.5" fill="none" stroke="#111318" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "";
  const membershipAvailable = canAccessMembership();
  const livePass = membershipAvailable && vip && Date.parse(vip.access_until) > Date.now();
  const accountPass = membershipAvailable && Date.parse(vipUntil) > Date.now();
  const badge = !membershipAvailable ? "GUEST" : livePass || accountPass ? "★ VIP" : "MEMBER";
  const expires = livePass ? vip.access_until : accountPass ? vipUntil : null;
  return `${header("Profile Settings")}
    <main class="page profile-page">
      <section class="identity-card" aria-label="Your profile">
        <div class="profile-identity">
          <button class="avatar" data-action="profile-photo" aria-label="Change profile photo">
            <img src="${esc(photo)}" alt="Your profile avatar">
            <span class="avatar-edit">${icon("4a7f2.svg")}</span>
          </button>
          <button class="profile-details" data-action="edit-profile" aria-label="Edit profile details">
            <span class="user-name">${esc(profile.name)}${verified}</span>
            <span class="user-email">${esc(authUser?.email || profile.email || "Your personal anime library")}</span>
            <span class="badge-row profile-badges">
              <span class="pill ${expires ? "orange" : "peach"}">${badge}</span>
            </span>
          </button>
        </div>
        <div class="xp-meta"><span>${icon("ab2c3.svg")} Otaku Level ${level}: ${level > 10 ? "Hashira Rank" : level > 3 ? "Anime Explorer" : "Rookie Watcher"}</span><span>${levelXP.toLocaleString()} / 500 XP</span></div>
        <div class="progress" style="--progress:${levelXP / 5}%" role="progressbar" aria-label="Watcher level progress" aria-valuemin="0" aria-valuemax="500" aria-valuenow="${levelXP}"><i></i></div>
      </section>
      <div class="stats-row" aria-label="Your watch statistics">
        <div class="stat"><div class="row">${icon("10c86.svg")}<strong>${episodes}</strong></div><small>EPISODES</small></div>
        <div class="stat"><div class="row">${icon("57ab8.svg")}<strong>${completedTitles}</strong></div><small>TITLES COMPLETED</small></div>
      </div>
      ${membershipAvailable ? `<section class="subscription-card" aria-label="VIP membership">
        <div class="profile-plan-heading">
          <span class="plan-title">${accountPass ? esc(savedPlan) + " Plan" : livePass ? "VIP Membership" : "Standard Plan"}</span>
          ${expires ? '<span class="pill cyan">ACTIVE</span>' : '<span class="pill orange">FULL HD 1080P</span>'}
        </div>
        <p class="renewal">${expires ? `Valid through ${membershipDate(expires)}` : "Choose a membership plan"}</p>
        ${expires ? "" : `<a class="upgrade-button" href="#checkout?plan=Premium">
          <span class="upgrade-emblem">${icon("47ab7.svg")}</span>
          <span class="grow"><strong>Upgrade to Premium 4K + HDR</strong><span>4 Screens • Offline Downloads • Atmos Audio</span><span>(₱249/mo)</span></span>
          <span aria-hidden="true">›</span>
        </a>`}
      </section>` : ""}
      <section class="settings-group">
        <h2>${icon("658d6.svg")}STREAMING &amp; DOWNLOAD PREFERENCES</h2>
        <div class="settings-items">
          ${settingRow("3bc20.svg", "Video Streaming Quality", prefs.quality.startsWith("Auto") ? "Auto (best available source)" : "Preferred source quality", prefs.quality.startsWith("Auto") ? "Auto" : prefs.quality.replace(" Full HD", "").replace(" Ultra HD", ""), "quality")}
          ${settingRow("3245b.svg", "Audio Language", "Original studio voice cast", prefs.audio, "audio")}
          ${settingRow("024f1.svg", "Subtitles &amp; Captions", "Use the captions included with your video", prefs.subtitles, "subtitles")}
        </div>
      </section>
      <section class="settings-group">
        <h2>${icon("e8264.svg")}APP SETTINGS</h2>
        <div class="settings-items">
          ${preferenceSwitch("7c3ca.svg", "Library Notifications", "Updates for your watchlist and downloads", "alerts")}
          ${preferenceSwitch("9fd8f.svg", "Download on Wi-Fi Only", "Prevents detected cellular data usage", "wifi")}
        </div>
      </section>
      <section class="settings-group profile-security">
        <h2>${icon("31c40.svg")}ACCOUNT &amp; SECURITY</h2>
        <div class="settings-items">
          ${settingRow("c21d9.svg", "Active Registered Devices", device, "This Device", "devices")}
          ${authUser ? settingRow("731c8.svg", "Password &amp; Security", "Send a password reset email", "", "password-settings") : ""}
          ${settingRow("01e98.svg", "Support &amp; Community FAQ", "Help with playback and your account", "", "help")}
        </div>
      </section>
      ${authUser ? `<span id="sync-status" class="sync-status" role="status">${esc(syncStatus)}</span><button class="logout" data-action="sign-out">${icon("965fd.svg")}Log Out of AniVerse</button>` : `<a class="logout" href="#login">${icon("965fd.svg")}Log In to AniVerse</a>`}
      <div class="profile-footer">AniVerse Streaming Mobile v2.7.0<br>Your anime world, anytime.
        <div class="profile-footer-actions"><button class="text-button" data-action="backup">Library Backup</button><span>•</span><button class="text-button" data-action="install">Install App</button></div>
      </div>
    </main>${nav("profile")}`;
}
function detailEpisode(episode, a, season) {
  const key = episodeKey(a.id, season.id, episode.number), record = progress[key], available = !!sourceFor(key) || cachedIds.includes(key), number = episode.number;
  return `<article class="detail-episode ${record?.seconds && !record.completed ? "active" : ""}"><a class="episode-top" href="${episodeLink(a, { ...episode, seasonId: season.id })}"><span class="episode-thumb art">${art(episode.image || a.image, `${a.short} episode ${number}`, "width:100%;height:100%")}<span class="play-disc">${icon("7efa4.svg")}</span><span class="duration">${Math.max(1, Math.max(1, Math.round((record?.duration || episode.duration || 1440) / 60)))}m</span></span><span class="grow"><span class="eyebrow peach">EPISODE ${number}${record?.completed ? " • WATCHED" : record?.seconds ? " • RESUME" : ""}</span><h3>${esc(episode.title)}</h3><span class="episode-meta">${cachedIds.includes(key) ? "Saved offline" : available ? sourceFor(key)?.preview ? "Sample clip" : sourceFor(key)?.demo ? "Demo video ready" : "Video available" : "Add a video source"}</span></span></a><button class="download-ep" data-action="download" data-key="${key}" aria-label="Download episode ${number}">${icon("45dee.svg")}</button><p class="clamp">${esc(episode.description || a.description)}</p><button class="text-button micro" data-action="mark-episode" data-key="${key}">${record?.completed ? "Mark Unwatched" : "Mark as Watched"}</button></article>`;
}
function detail(id) {
  const a = byId(id), seasonId = currentRoute().seasonId, season = seasonFor(a, seasonId);
  const lastEpisode = resumeEpisode(a, progress);
  const resume = seasonId && season.id !== lastEpisode.seasonId ? { ...season.episodes[0], seasonId: season.id, seasonNumber: season.number } : lastEpisode;
  const isAot = id === "aot", related = (a.related?.length ? a.related : findAnime(anime, "", { genre: a.tags[0] }, "rating").filter((item) => item.id !== id).slice(0, 5).map((item) => item.id)).map(byId).filter(Boolean);
  return `${header("Series Detail")}<main class="detail-page"><section class="detail-hero art">${isAot ? crop("7ab29.png", a.title, "left:1px;top:-70px;width:calc(100% + 8px);height:calc(100% + 268px)", "2f8bb.png") : art(a.image, a.title, "width:100%;height:100%")}<div class="hero-words"><div class="badge-row"><span class="pill hot">${esc(a.status)}</span><span class="pill cyan">${a.episodes} EPISODES</span><span class="pill">${esc(a.type)}</span></div><h1>${esc(a.short)}</h1><p>${esc(season.name)}</p><div class="badge-row" style="margin-top:8px">${rating(a.rating, "714ef.svg")}<span class="pill">${esc(a.ageRating)}</span><span class="pill">${a.year}</span><span class="pill cyan">${esc(a.studio)}</span></div></div></section><div class="detail-body"><a class="btn primary full" href="${episodeLink(a, resume)}">${icon("25540.svg")}${progress[episodeKey(id, resume.seasonId, resume.number)] ? "Continue" : "Watch"} S${resume.seasonNumber}:E${resume.number}</a><div class="quick-actions"><button class="quick-action" data-action="save" data-id="${id}">${icon("c3bd1.svg")}${library[id] ? "Saved" : "Watchlist"}</button><button class="quick-action" data-action="download-all" data-id="${id}">${icon("4d912.svg")}Download All</button><button class="quick-action" data-action="${a.trailer ? "trailer" : "source-list"}" data-id="${id}">${icon("e8a01.svg")}${a.trailer ? "Trailer" : "Video Sources"}</button></div><div class="genre-tags">${a.tags.map((tag) => `<button data-action="genre-search" data-value="${esc(tag)}">${esc(tag)}</button>`).join("")}</div><div class="synopsis-box"><p id="synopsis-text" class="clamp" style="-webkit-line-clamp:3">${esc(a.description)}</p><button class="read-more" data-action="read-more">Read More ${icon("9773a.svg")}</button></div><section class="episodes-section"><div class="section-title"><h2>Episodes</h2><span class="small">${a.episodes} Total</span></div><div class="chips season-tabs">${a.seasons.map((item) => `<button class="chip ${season.id === item.id ? "active" : ""}" data-action="season" data-value="${item.id}" aria-pressed="${season.id === item.id}">${esc(item.name)}</button>`).join("")}</div><div id="detail-episodes">${season.episodes.map((episode) => detailEpisode(episode, a, season)).join("")}</div></section>${a.cast?.length ? `<section class="cast-section"><div class="section-title"><h2>Cast &amp; Crew</h2><button class="text-button micro" data-action="cast">All (${a.cast.length})</button></div><div class="cast-carousel">${a.cast.map((member, i) => `<div class="cast-member">${crop(member.image, member.name, i === 1 ? "top:-39.51%;height:179.02%" : i > 1 ? "left:-41.76%;width:183.51%" : "")}<strong>${esc(member.name)}</strong><small>${esc(member.role)}</small></div>`).join("")}</div></section>` : ""}<section class="related-section"><div class="section-title"><h2>More Like This</h2><span class="eyebrow">Recommended</span></div><div class="carousel">${related.map((item) => `<a class="poster-card" href="#detail/${item.id}"><div class="poster">${art(item.watch || item.image, item.title, "width:100%;height:100%")}</div><div class="poster-info"><h3>${esc(item.short)}</h3><p class="muted ellipsis">${esc(item.genre)}</p></div></a>`).join("")}</div></section></div></main>`;
}
function playerEpisode(episode, a, season, active) {
  const key = episodeKey(a.id, season.id, episode.number), record = progress[key], percent = record?.duration ? record.seconds / record.duration * 100 : 0;
  return `<a class="player-episode ${episode.number === active ? "active" : ""}" href="${episodeLink(a, { ...episode, seasonId: season.id })}" ${episode.number === active ? 'aria-current="true"' : ""}><span class="episode-thumb art">${art(episode.playerImage || episode.image || a.image, episode.title, "width:100%;height:100%")}<span class="duration">${Math.max(1, Math.max(1, Math.round((record?.duration || episode.duration || 1440) / 60)))}m</span>${record?.seconds ? `<span class="progress" style="position:absolute;left:0;right:0;bottom:0;--progress:${percent}%"><i></i></span>` : ""}</span><span class="grow"><span class="eyebrow ${episode.number === active ? "orange" : ""}">EPISODE ${episode.number}${record?.completed ? " • WATCHED" : episode.number === active ? " • SELECTED" : ""}</span><h3>${esc(episode.title)}</h3><p class="ellipsis">${esc(episode.description || a.description)}</p></span></a>`;
}
function discussionPanel(id) {
  const comments = read(`comments-v2.${id}`, []);
  return `<div class="stack"><p class="micro muted">Personal notes · Saved on this device</p>${comments.map((comment) => `<article class="card note-card"><div class="row between"><strong>${esc(comment.name)}</strong><button class="text-button" data-action="remove-comment" data-value="${comment.id}">Remove</button></div><p>${esc(comment.text)}</p><small>${new Date(comment.time).toLocaleString()}</small></article>`).join("") || '<p class="small">Keep your thoughts about this series here.</p>'}<form id="comment-form" class="stack"><label class="field">Your note<textarea name="comment" required maxlength="1000" rows="3" placeholder="What did you think of this episode?"></textarea></label><button class="btn primary" type="submit">Save Note</button></form></div>`;
}
function playerPanelMarkup() {
  const { anime: a, season, episode } = currentEpisode();
  if (playerTab === "Related") return `<div class="catalog-grid">${findAnime(anime, "", { genre: a.tags[0] }, "rating").filter((item) => item.id !== a.id).slice(0, 6).map(catalogCard).join("")}</div>`;
  if (playerTab === "Discussion") return discussionPanel(a.id);
  return `<div class="section-title"><button class="row" data-action="player-season"><h2>${esc(season.name)}</h2>${icon("bc2c4.svg")}</button><span class="eyebrow">${season.episodes.length} EPISODES</span></div>${season.episodes.map((item) => playerEpisode(item, a, season, episode.number)).join("")}`;
}
function updatePlayerPanel() {
  if (!$("#player-panel") || !currentEpisode()?.episode) return;
  $("#player-panel").innerHTML = playerPanelMarkup();
  document.querySelectorAll('[data-action="player-tab"]').forEach((button) => {
    button.classList.toggle("active", button.dataset.value === playerTab);
    button.setAttribute("aria-selected", button.dataset.value === playerTab);
  });
}
function playerPage(id) {
  const { anime: a, season, episode } = currentEpisode(), key = episodeKey(id, season.id, episode.number), source = sourceFor(key), next = nextEpisode(a, season.id, episode.number);
  return `${header("Episode Playback")}<main class="player-page"><section class="video-wrap" id="video-wrap" tabindex="0" aria-label="Video player. Space to play or pause, left and right to seek."><img class="player-poster" src="${A(episode.playerImage || episode.image || a.image)}" alt="${esc(a.short)} episode ${episode.number} poster"><div class="poster-scrim"></div><video id="video" playsinline preload="metadata" aria-label="${esc(a.short)} episode ${episode.number}" class="hidden"></video><div class="video-top"><span class="pill" id="audio-label">${esc(source?.audio === "en" ? "EN AUDIO" : "JP AUDIO")}</span><span class="pill cyan" id="caption-label">CC</span><span class="video-tools"><button class="video-tool" data-action="lock" aria-label="Lock player">${icon("71e6d.svg")}</button><button class="video-tool" data-action="cast-video" aria-label="Cast video">${icon("90014.svg")}</button><button class="video-tool" data-action="playback-settings" aria-label="Playback settings">${icon("001f8.svg")}</button></span></div><div class="playback-controls"><button class="video-tool" data-action="seek" data-seconds="-10" aria-label="Rewind 10 seconds">${icon("d2905.svg")}</button><button class="big-play" id="play-pause" data-action="play" aria-label="Play video"><span style="font-size:28px">▶</span></button><button class="video-tool" data-action="seek" data-seconds="10" aria-label="Forward 10 seconds">${icon("e0468.svg")}</button></div><div class="video-bottom"><button class="skip-intro" data-action="skip-intro" ${episode.introEnd || source?.introEnd ? "" : "hidden"}>${icon("15dae.svg")}SKIP INTRO</button><input id="seekbar" type="range" min="0" max="1000" value="0" aria-label="Video position"><div class="video-time"><span id="time-display">00:00 / --:--</span><span class="pill cyan" id="resolution-label">${source ? "Loading video…" : "No source yet"}</span><button class="speed" data-action="speed">1.0×</button><button data-action="fullscreen" aria-label="Enter fullscreen">${icon("98afb.svg")}</button></div></div><div id="video-message" role="status" class="video-message hidden"></div></section><div class="player-body"><div class="row between"><p class="eyebrow orange">EPISODE ${episode.number}</p><span class="pill peach">${icon("0e810.svg")}${a.rating}</span></div><h1>${esc(episode.title)}</h1><div class="player-meta"><span>${esc(a.short)} · ${esc(season.name)}</span><span class="muted">•</span><span class="muted">${a.year}</span><span class="pill">${esc(a.ageRating)}</span></div><p class="player-notice">${source || cachedIds.includes(key) ? "Resume progress is saved automatically on this device." : "Add a video source for this episode in Playback Settings."}</p><div class="quick-actions player-actions"><button class="quick-action" data-action="download" data-key="${key}">${icon("29e94.svg")}${cachedIds.includes(key) ? "Downloaded" : "Download"}</button><button class="quick-action" data-action="save" data-id="${id}">${icon("1a1f6.svg")}${library[id] ? "Saved" : "Save"}</button><button class="quick-action" data-action="audio-sub">${icon("a33cb.svg")}Audio/Sub</button><button class="quick-action" data-action="share" data-id="${id}">${icon("14a13.svg")}Share</button></div><div class="row between episode-navigation"><button class="text-button" data-action="previous-episode">Previous Episode</button>${next ? `<a class="text-button" href="${episodeLink(a, next)}">Next Episode</a>` : '<span class="micro muted">Final Episode</span>'}</div><p class="player-description clamp">${esc(episode.description || a.description)}</p><div class="player-tabs" role="tablist">${["Episodes", "Related", "Discussion"].map((tab) => `<button role="tab" class="${playerTab === tab ? "active" : ""}" data-action="player-tab" data-value="${tab}" aria-selected="${playerTab === tab}">${tab === "Discussion" ? "My Notes" : tab}</button>`).join("")}</div><section id="player-panel">${playerPanelMarkup()}</section></div></main>`;
}
function notificationsPage() {
  const list = events.filter((item) => notificationTab === "All" || item.type === notificationTab);
  return `${header("Notifications")}<main class="page no-nav"><div class="section-title"><h2 class="eyebrow">ACTIVITY FEED</h2><button class="text-button" data-action="mark-read">Mark all read</button></div><div class="chips notification-tabs">${["All", "Library", "Downloads", "System"].map((tab) => `<button class="chip ${notificationTab === tab ? "active" : ""}" data-action="notification-tab" data-value="${tab}">${tab}${tab === "All" ? ` (${unread.length})` : ""}</button>`).join("")}</div>${list.map((item) => `<article class="notification-item ${item.read ? "" : "unread"}"><button class="grow" style="text-align:left" data-action="notification-open" data-value="${item.id}"><span class="row between"><span class="eyebrow orange">${esc(item.type.toUpperCase())}</span><span class="when">${relativeTime(item.createdAt)}</span></span><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p><span class="notification-actions"><span>View</span></span></button><button class="remove-notification" data-action="remove-notification" data-value="${item.id}" aria-label="Remove notification">×</button></article>`).join("") || empty("You’re all caught up", "Watchlist changes and downloads will appear here.")}<p class="prototype-note">Updates from your activity on this device.</p></main>`;
}
function notFound(message = "This page is not in your AniVerse catalog.") {
  return `${header("Page Not Found")}<main class="page no-nav">${empty("Page not found", message, '<a class="btn primary" href="#home">Go Home</a><a class="btn secondary" href="#search">Search Catalog</a>')}</main>`;
}
const rowScrollObserver = new ResizeObserver(entries => {
  for (const { target: row } of entries) updateRowScrollbar(row);
});

function updateRowScrollbar(row) {
  const bar = row.nextElementSibling;
  const distance = row.scrollWidth - row.clientWidth;
  bar.hidden = distance <= 1;
  if (distance > 1) bar.value = Math.round(100 * row.scrollLeft / distance);
}

function addRowScrollbars() {
  for (const row of app.querySelectorAll(".carousel, .chips, .genre-tags, .cast-carousel")) {
    const bar = document.createElement("input");
    const section = row.closest("section")?.querySelector("h2")?.textContent.trim();
    bar.type = "range";
    bar.className = "row-scrollbar";
    bar.setAttribute("aria-label", section ? `Scroll ${section} left or right` : "Scroll this row left or right");
    row.after(bar);
    bar.addEventListener("input", () => {
      row.scrollTo({ left: Number(bar.value) / 100 * (row.scrollWidth - row.clientWidth), behavior: "instant" });
    });
    row.addEventListener("scroll", () => updateRowScrollbar(row), { passive: true });
    updateRowScrollbar(row);
    rowScrollObserver.observe(row);
  }
}

function render(options = {}) {
  // Remove page listeners before replacing the current view.
  searchSuggestions?.destroy();
  searchSuggestions = null;
  clearTimeout(searchTimer);
  stopPlayer();
  const route = currentRoute();
  const requiresLogin = isMembershipRoute(route.page) && !canAccessMembership();
  if (requiresLogin && !authLoading) {
    checkoutAfterLogin = route.page === "checkout" ? route.params.toString() : null;
    history.replaceState(history.state, "", "#login");
  }
  const { id, episode, seasonId } = route;
  const page = requiresLogin ? "login" : route.page;
  const a = byId(id), selected = seasonFor(a, seasonId);
  const invalidSeries = ["detail", "player"].includes(page) && (currentRoute().invalidEpisode || !a || seasonId && !a.seasons.some((item) => item.id === seasonId) || page === "player" && !episodeFor(a, selected?.id, episode ?? selected?.episodes[0]?.number));
  const views = { login: () => authPage({ configured: auth.configured, loading: authLoading }), signup: () => authPage({ mode: "signup", configured: auth.configured, loading: authLoading }), "forgot-password": () => authPage({ mode: "forgot", configured: auth.configured, loading: authLoading, email: authUser?.email || "" }), "reset-password": () => authPage({ mode: "reset", configured: auth.configured, loading: authLoading, recovery: auth.recovery }), "verify-email": () => authPage({ mode: "verify", configured: auth.configured }), home, browse, search, watchlist: libraryView, profile: profilePage, notifications: notificationsPage, checkout, confirmation, detail: () => detail(id), player: () => playerPage(id) };
  rowScrollObserver.disconnect();
  mountScreen(app, invalidSeries || !views[page] ? notFound() : views[page](), !navigator.onLine);
  addRowScrollbars();
  const searchForm = $("#home-search") || $("#search-form");
  if (searchForm) searchSuggestions = bindSearchSuggestions({ form: searchForm, input: $("input[name=query]", searchForm), catalog: anime, onSelect: (match) => {
    query = match.title;
    rememberSearch();
    go(`detail/${match.id}`);
  } });
  animatePage(app, `${page}/${id}`);
  document.title = `${invalidSeries ? "Page Not Found" : a && ["detail", "player"].includes(page) ? a.short : { login: "Log In", signup: "Create Account", "forgot-password": "Reset Password", "reset-password": "New Password", "verify-email": "Confirm Email", home: "Home", browse: "Browse", search: "Search", watchlist: "My Library", profile: "Profile", notifications: "Notifications", checkout: "Membership Plans", confirmation: "Membership Status" }[page] || "Page Not Found"} · AniVerse`;
  if (options.chipOffset !== void 0 && $(".chips")) $(".chips").scrollLeft = options.chipOffset;
  if (!options.keepScroll) window.scrollTo(0, 0);
  if (page === "player" && !invalidSeries) mountPlayer({ autoplay: currentRoute().params.get("autoplay") === "1" });
  if (page === "watchlist") updateStorage();
}
const runtimeSources = new Map();
let databasePromise;
function db() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("aniverse-videos", 2);
    const timeout = setTimeout(() => reject(new Error("Local video storage is unavailable. Close other AniVerse tabs and try again.")), 1e4);
    request.onupgradeneeded = () => {
      for (const store of ["videos", "tracks"]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      databasePromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      databasePromise = null;
      reject(new Error("Close other AniVerse tabs to finish updating local video storage."));
    };
  });
  return databasePromise;
}
async function getStored(store, key, owner = accountOwner) {
  const storageKey = owner === "guest" ? key : `${owner}|${key}`, database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(storageKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putStored(store, key, value, owner = accountOwner) {
  const storageKey = owner === "guest" ? key : `${owner}|${key}`, database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).put(value, storageKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("The file could not be saved."));
  });
}
async function deleteStored(store, key, owner = accountOwner) {
  const storageKey = owner === "guest" ? key : `${owner}|${key}`, database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).delete(storageKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}
function episodeFromKey(key) {
  const [id, seasonId, number] = String(key).split(":"), a = byId(id), season = a?.seasons.find((item) => item.id === seasonId), episode = season?.episodes.find((item) => item.number === Number(number));
  return episode ? { anime: a, season, episode } : null;
}
function legacyKeyFor(a) {
  const season = seasonFor(a, a.defaultSeason), number = a.id === "aot" ? 29 : a.id === "jjk" ? 17 : season.episodes[0].number;
  return episodeKey(a.id, season.id, number);
}
function migratePlaybackData() {
  if (read("playback-migrated-v2", false)) return;
  const oldSources = read("sources", {}), oldCached = read("cached", []), oldProgress = read("progress", {});
  for (const a of anime) {
    const key = legacyKeyFor(a);
    if (oldSources[a.id] && !sources[key] && safeMediaURL(oldSources[a.id])) sources[key] = { url: oldSources[a.id], quality: "Original", audio: "ja" };
    if (oldCached.includes(a.id) && !cachedIds.includes(key)) cachedIds.push(key);
    for (const season of a.seasons) for (const episode of season.episodes) {
      const old = oldProgress[`${a.id}.${episode.number}`], key2 = episodeKey(a.id, season.id, episode.number);
      if (typeof old === "number" && !progress[key2]) progress[key2] = { seconds: old, duration: 0, watchedSeconds: 0, updatedAt: Date.now(), completed: false };
    }
  }
  write("video-sources-v2", sources);
  write("cached-episode-keys-v2", cachedIds);
  write("watch-records-v2", progress);
  write("playback-migrated-v2", true);
}
async function localVideo(key) {
  const owner = accountOwner;
  try {
    let file = await getStored("videos", key, owner);
    if (file) return file;
    const item = episodeFromKey(key);
    if (item && key === legacyKeyFor(item.anime)) {
      file = await getStored("videos", item.anime.id, owner);
      if (file) {
        await putStored("videos", key, file, owner);
        await deleteStored("videos", item.anime.id, owner);
        return file;
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function saveVideo(key, file) {
  if (!episodeFromKey(key)) throw new Error("Choose a valid episode first.");
  const owner = accountOwner;
  await putStored("videos", key, file);
  return indexDownload(key, owner);
}
function indexDownload(key, owner) {
  const storageKey = accountStorageKey("cached-episode-keys-v2", owner);
  const keys = JSON.parse(localStorage.getItem(storageKey)) || [];
  if (!keys.includes(key)) localStorage.setItem(storageKey, JSON.stringify([...keys, key]));
  if (owner === accountOwner) cachedIds = keys.includes(key) ? keys : [...keys, key];
  return owner === accountOwner;
}
function selectSource(raw) {
  if (!raw) return null;
  const value = typeof raw === "string" ? { url: raw } : raw;
  let chosen = value;
  if (Array.isArray(value.variants) && value.variants.length) {
    const valid = value.variants.filter((item) => safeMediaURL(item.url));
    chosen = { ...value, ...valid.find((item) => prefs.quality.includes(item.quality)) || valid.at(-1) || {} };
  }
  return safeMediaURL(chosen.url) ? { ...chosen, subtitles: (chosen.subtitles || []).filter((track) => safeMediaURL(track.url)) } : null;
}
function sourceFor(key) {
  const item = episodeFromKey(key);
  return selectSource(runtimeSources.get(key)) || selectSource(sources[key]) || selectSource(configuredMedia[key]) || selectSource(item?.episode.video);
}
function canSaveSource(source) {
  return Boolean(source?.url && !source.preview && !isYouTubeSource(source));
}
async function resolveEpisodeSource(key) {
  const fallback = sourceFor(key);
  if (runtimeSources.has(key) || canSaveSource(fallback)) return fallback;
  return await fetchLocalEpisodeSource(key) || selectSource(await fetchEpisodeSource(key, fallback));
}
function showTitlePreview(source, { autoplay = false } = {}) {
  const video = player, wrap = $("#video-wrap"), owner = accountOwner;
  if (!video || !wrap) return;
  video.classList.add("hidden");
  wrap.classList.add("youtube-active");
  showVideoSource(source);
  playerContext.loading = false;
  const previous = read("preview-progress-v1", {})[source.animeId];
  videoMessage("Connecting to the official preview…");
  youtubePlayer = mountYouTube(wrap, source, {
    autoplay: autoplay || playerContext.playWhenReady,
    resume: previous && !previous.completed ? previous.seconds : 0,
    onProgress: (record) => {
      // Sample progress must never mark an episode as watched.
      if (owner !== accountOwner || record.seconds <= 0 || record.duration <= 0) return;
      const previews = read("preview-progress-v1", {}), saved = previews[source.animeId];
      const everCompleted = Boolean(saved?.everCompleted || saved?.completed || record.completed);
      write("preview-progress-v1", { ...previews, [source.animeId]: { ...record, everCompleted, episodeKey: source.key, updatedAt: Date.now() } });
      if (!library[source.animeId] || library[source.animeId] === "Plan to Watch") {
        library[source.animeId] = "Watching";
        write("library", library);
        write("library-times", { ...read("library-times", {}), [source.animeId]: Date.now() });
        if (currentRoute().page === "player") refreshSavedUI();
      }
    },
    onReady: () => {
      if (player === video) $("#video-message")?.classList.add("hidden");
    },
    onEnd: () => {
      if (player === video) toast("Sample finished. You can add an episode video in Video source.");
    },
    onError: (error) => {
      if (player !== video) return;
      youtubePlayer = null;
      videoMessage(error.message, `<a class="btn primary" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open original video</a><button class="btn secondary" data-action="reset-demo" data-key="${source.key}">Retry Video</button><button class="btn secondary" data-action="open-source" data-key="${source.key}">Change Video</button>`);
    }
  });
}
function showVideoSource(source) {
  if (playerContext) playerContext.source = source;
  const selected = currentEpisode(), heading = $(".player-body>h1"), eyebrow = $(".player-body>.row .eyebrow");
  if (selected && heading) heading.textContent = selected.episode.title;
  if (eyebrow) eyebrow.textContent = `EPISODE ${selected?.episode.number}`;
  const notice = $(".player-notice");
  if (!notice) return;
  const skip = $('[data-action="skip-intro"]');
  if (skip) {
    const end = currentEpisode()?.episode.introEnd || source?.introEnd;
    skip.hidden = !end;
    skip.dataset.end = String(end || 0);
  }
  $("#audio-label").textContent = source?.demo ? "DEMO VIDEO" : source?.audio === "en" ? "EN AUDIO" : "ORIGINAL AUDIO";
  notice.classList.toggle("sample-notice", !!source?.preview);
  notice.innerHTML = source?.preview ? `<span>Sample clip · Up to 60 seconds</span><button class="text-button" data-action="open-source" data-key="${source.key}">Video source</button>` : source?.demo ? "<span>Sample clip</span>" : "Resume progress is saved automatically on this device.";
}
function stopPlayer() {
  youtubePlayer?.destroy();
  youtubePlayer = null;
  $("#video-wrap")?.classList.remove("youtube-active");
  const video = player;
  if (cleanupPlayer) cleanupPlayer();
  cleanupPlayer = null;
  player = null;
  playerContext = null;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  for (const url of objectURLs) URL.revokeObjectURL(url);
  objectURLs = [];
}
function videoMessage(text, action = "") {
  const target = $("#video-message");
  if (!target) return;
  target.innerHTML = `<p>${esc(text)}</p>${action}`;
  target.classList.remove("hidden");
}
async function mountPlayer({ autoplay = false, atTime = null } = {}) {
  const offline = currentRoute().params.get("offline") === "1";
  const selected = currentEpisode();
  if (!selected?.episode) return;
  const { anime: a, season, episode } = selected, key = episodeKey(a.id, season.id, episode.number), old = $("#video");
  if (!old) return;
  const video = old.cloneNode(false);
  video.controls = false;
  old.replaceWith(video);
  player = video;
  for (const selector of [".playback-controls", ".video-top", ".video-bottom"]) $(selector)?.classList.remove("hidden");
  $("#video-message")?.classList.add("hidden");
  playerContext = { key, ...selected, loading: true, playWhenReady: autoplay };
  const controller = new AbortController(), listen = (name, fn) => video.addEventListener(name, fn, { signal: controller.signal });
  let lastClock = performance.now(), wasPlaying = false, lastSave = 0, played = 0, active = true, fallbackUsed = false, activeSource = null;
  const save = (force = false) => {
    if (!active || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const now = performance.now();
    if (wasPlaying && !video.seeking) {
      const elapsed = Math.max(0, Math.min(2, (now - lastClock) / 1e3));
      played += elapsed;
    }
    lastClock = now;
    wasPlaying = !video.paused && !video.ended;
    if (!force && now - lastSave < 2e3) return;
    lastSave = now;
    const previous = progress[key] || {}, completed = video.ended || video.currentTime / video.duration >= 0.95;
    progress[key] = { seconds: Math.min(video.duration, Math.max(0, video.currentTime)), duration: video.duration, watchedSeconds: (previous.watchedSeconds || 0) + played, updatedAt: Date.now(), completed: previous.completed || completed };
    played = 0;
    write("watch-records-v2", progress);
    if (!library[a.id] && video.currentTime > 0) {
      library[a.id] = "Watching";
      write("library", library);
      write("library-times", { ...read("library-times", {}), [a.id]: Date.now() });
      refreshSavedUI();
    }
    if (orderedEpisodes(a).every((item) => progress[episodeKey(a.id, item.seasonId, item.number)]?.completed)) {
      library[a.id] = "Completed";
      write("library", library);
    }
  };
  cleanupPlayer = () => {
    save(true);
    active = false;
    controller.abort();
  };
  listen("loadedmetadata", () => {
    if (player !== video) return;
    const previous = progress[key], resume = atTime !== null ? atTime : previous && !previous.completed ? previous.seconds : 0;
    if (resume > 0 && resume < video.duration - 1) video.currentTime = resume;
    video.volume = Number.isFinite(prefs.volume) ? Math.max(0, Math.min(1, prefs.volume)) : 1;
    video.playbackRate = Number(prefs.speed) || 1;
    $("#video-message").classList.add("hidden");
    $("#resolution-label").textContent = video.videoHeight ? `${video.videoHeight}p` : "Original";
    $(".speed").textContent = `${video.playbackRate}×`;
    applyTracks();
    updateVideoTime();
    playerContext.loading = false;
    if (autoplay || playerContext.playWhenReady) video.play().catch(() => toast("Video ready. Tap Play to continue."));
  });
  listen("timeupdate", () => {
    if (player !== video) return;
    save();
    updateVideoTime();
  });
  listen("play", () => {
    wasPlaying = true;
    lastClock = performance.now();
    $("#play-pause").innerHTML = icon("e6350.svg");
    $("#play-pause").setAttribute("aria-label", "Pause video");
    $("#video-message").classList.add("hidden");
  });
  listen("pause", () => {
    save(true);
    wasPlaying = false;
    if (player === video) {
      $("#play-pause").innerHTML = '<span style="font-size:28px">▶</span>';
      $("#play-pause").setAttribute("aria-label", "Play video");
    }
  });
  listen("seeking", () => {
    save(true);
    lastClock = performance.now();
  });
  listen("volumechange", () => {
    prefs.volume = video.volume;
    write("preferences", prefs);
  });
  listen("error", () => {
    if (player !== video) return;
    if (!offline && !fallbackUsed && !activeSource?.preview) {
      fallbackUsed = true;
      const fallback = previewSource(key);
      if (fallback) {
        runtimeSources.set(key, fallback);
        stopPlayer();
        mountPlayer({ autoplay: true });
        toast("Your video source is unavailable. Showing this anime’s official preview.");
        return;
      }
    }
    playerContext.loading = false;
    videoMessage("This video could not be loaded. Choose another source or watch the title preview.", `<button class="btn primary" data-action="reset-demo" data-key="${key}">Watch Title Preview</button><button class="btn secondary" data-action="open-source" data-key="${key}">Change Source</button>`);
  });
  listen("ended", () => {
    save(true);
    updatePlayerPanel();
    const next = nextEpisode(a, season.id, episode.number);
    const nextKey = next && episodeKey(a.id, next.seasonId, next.number);
    if (next && prefs.autoNext && (cachedIds.includes(nextKey) || !offline && sourceFor(nextKey))) {
      go(episodeLink(a, next).slice(1) + "&autoplay=1" + (offline ? "&offline=1" : ""));
      return;
    }
    videoMessage(next ? "Episode finished. Ready for the next one?" : "You’ve reached the final episode.", next ? `<a class="btn primary" href="${episodeLink(a, next)}">Next Episode</a>` : `<a class="btn primary" href="#detail/${a.id}">Back to Series</a>`);
  });
  const file = offline || !runtimeSources.has(key) ? await localVideo(key) : null;
  if (player !== video) return;
  if (offline && !file) {
    playerContext.loading = false;
    videoMessage("This offline video is missing from this device.", '<a class="btn secondary" href="#watchlist?tab=Downloaded">Back to Downloads</a>');
    return;
  }
  let source = file ? sourceFor(key) : await resolveEpisodeSource(key);
  if (player !== video) return;
  if (file && (offline || !source || source.preview)) source = { audio: source?.preview ? "original" : source?.audio, subtitles: [] };
  if (!file && isYouTubeSource(source)) {
    showTitlePreview(source, { autoplay });
    return;
  }
  activeSource = source;
  if (!file && canSaveSource(source) && !source.demo) {
    // Save the same source that actually started playing.
    video.addEventListener("playing", () => downloadVideo(key, { automatic: true, playingSource: source }), { once: true, signal: controller.signal });
  }
  showVideoSource(source);
  if (file) {
    const url = URL.createObjectURL(file);
    objectURLs.push(url);
    video.src = url;
  } else if (source) video.src = new URL(source.url, location.href).href;
  else {
    playerContext.loading = false;
    video.classList.add("hidden");
    return;
  }
  video.classList.remove("hidden");
  for (const track of source?.subtitles || []) appendTrack(video, track.url, track.label, track.language);
  try {
    const track = await getStored("tracks", key);
    if (track && player === video) {
      const url = URL.createObjectURL(track.file);
      objectURLs.push(url);
      appendTrack(video, url, track.label || "Uploaded Subtitles", track.language || "en");
    }
  } catch {
  }
}
function appendTrack(video, url, label = "English", language = "en") {
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = label;
  track.srclang = language;
  track.src = url;
  track.default = prefs.subtitles !== "Off";
  track.addEventListener("load", applyTracks, { once: true });
  video.append(track);
}
function applyTracks() {
  if (!player) return;
  const preferred = prefs.subtitles === "Tagalog" ? "tl" : "en";
  let selected = false;
  for (const track of player.textTracks) {
    const show = prefs.subtitles !== "Off" && !selected && (track.language === preferred || player.textTracks.length === 1);
    track.mode = show ? "showing" : "disabled";
    if (show) selected = true;
  }
  const language = prefs.audio.startsWith("English") ? "en" : prefs.audio.startsWith("Tagalog") ? "tl" : "ja";
  if (player.audioTracks?.length) {
    const tracks = Array.from(player.audioTracks), match = tracks.find((track) => track.language === language) || tracks[0];
    for (const track of tracks) track.enabled = track === match;
  }
  if ($("#caption-label")) $("#caption-label").textContent = prefs.subtitles === "Off" ? "CC OFF" : selected ? `CC: ${preferred.toUpperCase()}` : "CC: NONE";
}
function updateVideoTime() {
  if (!player || !$("#time-display")) return;
  $("#time-display").textContent = `${formatTime(player.currentTime)} / ${Number.isFinite(player.duration) ? formatTime(player.duration) : "--:--"}`;
  $("#seekbar").value = Number.isFinite(player.duration) && player.duration > 0 ? Math.round(player.currentTime / player.duration * 1e3) : 0;
}
async function playVideo() {
  if (youtubePlayer) {
    youtubePlayer.play();
    return;
  }
  if (playerContext?.loading) {
    playerContext.playWhenReady = true;
    toast("Loading video…");
    return;
  }
  if (!player?.getAttribute("src") && playerContext?.source?.preview) {
    stopPlayer();
    await mountPlayer({ autoplay: true });
    return;
  }
  if (!player?.getAttribute("src")) return videoSourceSheet(mediaKey());
  try {
    if (player.paused) await player.play();
    else player.pause();
  } catch {
    toast("Video ready. Tap Play again or choose another video source.");
  }
}
function videoSourceSheet(key = mediaKey(), { download = false } = {}) {
  const selected = episodeFromKey(key);
  if (!selected) return;
  pendingSourceKey = key;
  const source = sourceFor(key);
  openSheet(`${download ? "Download" : "Video Source"} · Episode ${selected.episode.number}`, `<p>${esc(selected.anime.short)} · ${esc(selected.season.name)}<br>${download ? "Save a video you have permission to use. Embedded previews stream online." : "Each episode has its own video source."}</p><form id="video-source-form" class="stack" data-key="${key}" data-download="${download}"><label class="field">Video file<input type="file" name="file" accept="video/*"></label><p class="micro muted">The selected file stays on this device and works offline.</p><label class="field">Or a direct video URL<input type="url" name="url" placeholder="https://your-cdn.example/episode.mp4" value="${esc(source?.demo || source?.preview ? "" : source?.url || "")}"></label><label class="field">Optional subtitles (.vtt)<input type="file" name="subtitle" accept=".vtt,text/vtt"></label><label class="field">Subtitle language<select name="subtitleLanguage"><option value="en">English</option><option value="tl">Tagalog</option><option value="ja">Japanese</option></select></label><p id="source-error" class="form-error" role="alert"></p><button class="btn primary" type="submit">${download ? "Save Offline" : "Save &amp; Play"}</button>${download ? "" : `<button class="text-button" type="button" data-action="remove-source" data-key="${key}">Use Default Sample</button>`}</form>`);
}
function sourceList(id) {
  const a = byId(id);
  if (!a) return;
  openSheet("Episode Video Sources", `<p>Choose an episode to add a video file or a direct video URL. Sources saved here stay on this device.</p><div class="option-list">${orderedEpisodes(a).map((episode) => {
    const key = episodeKey(id, episode.seasonId, episode.number);
    return `<button data-action="open-source" data-key="${key}"><strong>${esc(episode.seasonName)} · Ep ${episode.number}</strong><br><span class="small">${cachedIds.includes(key) ? "Saved offline" : sourceFor(key)?.preview ? "Sample clip" : sourceFor(key)?.demo ? "Demo video ready" : sourceFor(key) ? "Video URL configured" : "Add video source"}</span></button>`;
  }).join("")}</div>`);
}
async function updateStorage() {
  try {
    const info = await navigator.storage?.estimate();
    if ($("#storage-used")) $("#storage-used").textContent = `Storage Used: ${((info?.usage || 0) / 1048576).toFixed(1)} MB`;
  } catch {
    if ($("#storage-used")) $("#storage-used").textContent = `${cachedIds.length} local episodes`;
  }
}
function showSavedDownload() {
  openSheet("Ready to Watch Offline", '<p>This episode is saved on this device.</p><a class="btn primary" href="#watchlist?tab=Downloaded">View Downloads</a>');
}
function recordDownload(selected) {
  const link = episodeLink(selected.anime, { ...selected.episode, seasonId: selected.season.id }).slice(1);
  recordEvent("Episode ready offline", `${selected.anime.short} · Episode ${selected.episode.number}`, "Downloads", link + "&offline=1");
}
async function fetchDownload(url) {
  if (prefs.wifi && navigator.connection?.type === "cellular") {
    throw new Error("Wi-Fi downloads are enabled. Connect to Wi-Fi or change Offline Preferences.");
  }
  let response;
  try {
    response = await fetch(new URL(url, location.href));
  } catch {
    throw new Error("Could not reach the video file. Check your connection and make sure the host allows cross-origin downloads.");
  }
  if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const fileURL = new URL(response.url || url, location.href);
  if (!type.startsWith("video/") && !(["", "application/octet-stream"].includes(type) && /\.(mp4|m4v|webm|mov)$/i.test(fileURL.pathname))) {
    throw new Error("Enter a direct MP4, WebM, M4V, or MOV file URL.");
  }
  const file = await response.blob();
  if (!file.size) throw new Error("The video file is empty.");
  return file;
}
function refreshDownloadButton(key) {
  if (currentRoute().page !== "player" || mediaKey() !== key) return;
  const button = $('.player-actions [data-action="download"]');
  if (button) button.innerHTML = `${icon("29e94.svg")}${cachedIds.includes(key) ? "Downloaded" : "Download"}`;
}
async function downloadVideo(key, { batch = false, automatic = false, playingSource } = {}) {
  const owner = accountOwner, operation = `${owner}|${key}`, selected = episodeFromKey(key);
  if (!selected) return false;
  const interactive = !batch && !automatic;
  if (downloadKeys.has(operation)) {
    if (interactive) toast("This episode is already downloading.");
    return false;
  }
  downloadKeys.add(operation);
  try {
    const local = await localVideo(key);
    if (owner !== accountOwner) return false;
    if (local) {
      indexDownload(key, owner);
      refreshDownloadButton(key);
      if (interactive) showSavedDownload();
      return true;
    }
    const source = playingSource || await resolveEpisodeSource(key);
    if (owner !== accountOwner) return false;
    if (!canSaveSource(source)) {
      if (interactive) videoSourceSheet(key, { download: true });
      return false;
    }
    if (interactive) toast("Downloading episode. Keep this tab open.");
    const file = await fetchDownload(source.url);
    if (owner !== accountOwner || !await saveVideo(key, file)) return false;
    recordDownload(selected);
    refreshDownloadButton(key);
    const page = currentRoute().page;
    if (interactive && page === "player" && mediaKey() === key) showSavedDownload();
    if (automatic) toast("Episode saved to My Library → Downloaded.");
    if (!batch && page === "watchlist") render({ keepScroll: true });
    return true;
  } catch (error) {
    if (automatic && owner === accountOwner) toast("Offline save didn’t finish. Use Download to try again.");
    if (interactive && owner === accountOwner) openSheet("Download Unavailable", `<p>${esc(error.message)}</p><button class="btn primary" data-action="download-source" data-key="${key}">Choose Video Source</button>`);
    return false;
  } finally {
    downloadKeys.delete(operation);
  }
}
async function downloadAll(id) {
  const a = byId(id), keys = orderedEpisodes(a).map((episode) => episodeKey(id, episode.seasonId, episode.number)).filter((key) => cachedIds.includes(key) || canSaveSource(sourceFor(key)) || localEpisodePath(key));
  if (!keys.length) return sourceList(id);
  toast(`Preparing ${keys.length} available episodes…`);
  let count = 0;
  for (const key of keys) if (await downloadVideo(key, { batch: true })) count++;
  toast(`${count} of ${keys.length} episodes are available offline.`);
  if (currentRoute().page === "watchlist") render({ keepScroll: true });
}
function choice(title, values, pref) {
  openSheet(title, `<div class="option-list">${values.map((value) => `<button class="${prefs[pref] === value ? "selected" : ""}" data-action="choose-pref" data-pref="${pref}" data-value="${esc(value)}">${esc(value)}</button>`).join("")}</div>`);
}
function downloadJSON(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function backupSheet() {
  openSheet("Back Up Your Library", '<p>Export your watchlist, watch progress, profile, and preferences. Video files stay on this device.</p><button class="btn primary" data-action="export-backup">Download Library Backup</button><form id="backup-form" class="stack"><label class="field">Import an AniVerse backup<input name="backup" type="file" accept="application/json,.json" required></label><p class="micro muted">Imported records are merged with your current library. Existing video files are kept.</p><p class="form-error" id="backup-error" role="alert"></p><button class="btn secondary" type="submit">Import Backup</button></form>' + (authUser ? '<button class="btn secondary" data-action="import-guest">Import Guest Library</button><button class="btn secondary" data-action="sync-account">Retry Cloud Sync</button>' : ""));
}
async function shareTitle(id) {
  const url = new URL(location.href);
  url.hash = `detail/${id}`;
  try {
    if (navigator.share) await navigator.share({ title: byId(id).title, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      toast("Series link copied.");
    }
  } catch (error) {
    if (error.name !== "AbortError") openSheet("Share This Series", `<label class="field">Copy this link<input readonly value="${esc(url.href)}"></label>`);
  }
}
async function install() {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    return;
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  openSheet("Install AniVerse", `<p>${ios ? "In Safari, tap Share, then “Add to Home Screen”." : "In Chrome on Android, open the browser menu and choose “Add to Home screen” or “Install app”."}</p><p>The app shell and the episodes saved on this device work offline after their first load.</p>`);
}
async function removeLocalVideo(key) {
  const owner = accountOwner;
  await deleteStored("videos", key);
  if (owner !== accountOwner) return;
  const selected = episodeFromKey(key);
  if (selected && key === legacyKeyFor(selected.anime)) await deleteStored("videos", selected.anime.id, owner);
  if (owner !== accountOwner) return;
  cachedIds = cachedIds.filter((item) => item !== key);
  write("cached-episode-keys-v2", cachedIds);
}
function offlinePreferences() {
  openSheet("Offline Preferences", `<p>Saved video files are stored in this browser. Downloaded episodes require video hosts that allow cross-origin downloads.</p><div class="settings-row"><span class="grow">Wi-Fi downloads only</span><button class="switch" role="switch" aria-label="Wi-Fi downloads only" aria-checked="${prefs.wifi}" data-action="toggle-pref" data-value="wifi"></button></div><p class="micro muted">Cellular blocking works when your browser exposes connection information. Otherwise downloads start only when you tap Download.</p><button class="btn secondary" data-action="clear-videos">Remove Local Videos</button>`);
}
function helpSheet() {
  openSheet("Support & Help", '<div class="stack"><h3>Search the whole catalog</h3><p class="small">Search by title, alternate title, abbreviation, genre, or studio. Matching ignores capitalization and punctuation and tolerates small typing errors. Search results only include titles in this catalog.</p><h3>Watch an episode</h3><p class="small">Select a series and an episode, then tap Play to watch an official trailer matching that title, limited to 60 seconds. This preview is separate from full episodes. Use Playback Settings → Add or Change Episode Source to choose your own video file, direct URL, or WebVTT subtitles.</p><h3>Resume and watch next</h3><p class="small">Playback saves your place automatically. Watching an episode adds its series to your library. The next episode plays automatically when enabled and a source is available.</p><h3>Where is my account?</h3><p class="small">Log in or create an account from Profile to sync your watchlist, progress, settings, and private notes. Guest data stays on this browser. Video files and downloaded episodes always stay on the device where they were saved.</p>' + (canAccessMembership() ? '<h3>How does membership work?</h3><p class="small">Subscribe activates a 30-day membership without a charge. Open Profile to check your status.</p>' : "") + '</div>');
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, value } = button.dataset, id = button.dataset.id || currentRoute().id, key = button.dataset.key || mediaKey();
  try {
    if (action === "close-sheet") return closeSheet();
    if (action === "show-password") {
      const input = document.getElementById(button.dataset.target), visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${input.name === "confirmPassword" ? "confirm password" : input.autocomplete === "new-password" ? "new password" : "password"}`);
      return;
    }
    if (action === "sign-out") {
      button.disabled = true;
      try {
        await syncCloud();
        await auth.signOut();
      } catch (error) {
        button.disabled = false;
        toast(friendlyAuthError(error));
      }
      return;
    }
    if (action === "sync-account") {
      await syncCloud(true);
      return;
    }
    if (action === "import-guest") {
      if (!authUser) return;
      const guest = readGuestSnapshot();
      const now = Date.now();
      guest.libraryTimes = Object.fromEntries(Object.keys(guest.library).map((id2) => [id2, now]));
      applyAccountSnapshot(mergeAccountState(accountSnapshot(), guest));
      syncDirty = true;
      await syncCloud(true);
      render({ keepScroll: true });
      return;
    }
    if (action === "back") {
      if ((history.state?.aniverseDepth || 0) > 0) history.back();
      else go("home");
      return;
    }
    if (action === "filters") return filterSheet();
    if (action === "save" || action === "edit-library") return saveSheet(id);
    if (action === "toggle-save") {
      saveLibrary(id, library[id] ? null : "Plan to Watch");
      return;
    }
    if (action === "set-library") {
      closeSheet();
      saveLibrary(id, value);
      return;
    }
    if (action === "remove-library") {
      if (sheet.open) closeSheet();
      saveLibrary(id, null);
      return;
    }
    if (action === "catalog-genre") {
      filter.genre = value;
      syncBrowseURL();
      render({ keepScroll: true, chipOffset: $(".chips")?.scrollLeft || 0 });
      return;
    }
    if (action === "seasonal") {
      filter = { ...defaultFilter(), sort: "rating" };
      go(routeURL("browse", { sort: "rating" }));
      return;
    }
    if (action === "view") {
      filter.view = value;
      syncBrowseURL();
      render({ keepScroll: true });
      return;
    }
    if (action === "reset-filters" || action === "clear-search-filters") {
      const target = button.dataset.target || currentRoute().page;
      if (sheet.open) closeSheet();
      if (target === "search") {
        searchGenre = "All";
        searchFilter = { ...defaultFilter(), genre: "All" };
        searchSort = "relevance";
        syncSearchURL();
        render();
      } else {
        filter = defaultFilter();
        go("browse");
      }
      return;
    }
    if (action === "clear-query") {
      query = "";
      const input = $("#anime-search");
      if (input) {
        input.value = "";
        input.focus();
      }
      searchSuggestions?.refresh();
      updateSearchResults();
      return;
    }
    if (action === "search-genre") {
      searchGenre = value;
      searchFilter.genre = value;
      syncSearchURL();
      render({ keepScroll: true, chipOffset: $(".chips")?.scrollLeft || 0 });
      return;
    }
    if (action === "genre-search") {
      go(routeURL("search", { genre: value }));
      return;
    }
    if (action === "history") {
      query = value;
      rememberSearch();
      syncSearchURL();
      render();
      return;
    }
    if (action === "clear-history" || action === "remove-history") {
      searchHistory = action === "clear-history" ? [] : searchHistory.filter((item) => item !== value);
      write("searches", searchHistory);
      $("#search-history").innerHTML = historyMarkup();
      return;
    }
    if (action === "library-tab") {
      listTab = value;
      history.replaceState(history.state, "", `#${routeURL("watchlist", { tab: value })}`);
      render();
      return;
    }
    if (action === "library-sort" || action === "manage-order") {
      openSheet("Library Order", '<div class="option-list"><button data-action="sort-library" data-value="recent">Recently Added</button><button data-action="sort-library" data-value="az">Title A–Z</button><button data-action="sort-library" data-value="rating">Highest Rated</button></div>');
      return;
    }
    if (action === "sort-library") {
      librarySort = value;
      write("library-sort", value);
      closeSheet();
      render();
      return;
    }
    if (action === "library-layout") {
      libraryLayout = libraryLayout === "grid" ? "list" : "grid";
      write("library-layout", libraryLayout);
      render({ keepScroll: true });
      return;
    }
    if (action === "password-settings") return go("forgot-password");
    if (action === "profile-photo") {
      openSheet("Profile Photo", `<div class="stack"><p>Choose your avatar. Photos stay on this device and are kept separately for each account.</p><label class="field">Upload photo<input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="small muted">JPG, PNG, or WebP · Up to 5 MB</p><p id="photo-error" class="form-error" role="alert"></p>${storedProfilePhoto(read("profile-photo", "")) ? '<button class="btn secondary" data-action="remove-profile-photo">Use Original Avatar</button>' : ""}</div>`);
      return;
    }
    if (action === "remove-profile-photo") {
      if (!write("profile-photo", "")) return;
      closeSheet();
      render({ keepScroll: true });
      toast("Original avatar restored.");
      return;
    }
    if (action === "edit-profile") {
      openSheet("Edit Profile", `<form id="profile-form" class="stack"><label class="field">Display name<input name="name" value="${esc(profile.name)}" required maxlength="60" autocomplete="nickname"></label><label class="field">Email${authUser ? " (account email)" : " (optional)"}<input name="email" type="email" value="${esc(authUser?.email || profile.email)}" maxlength="120" ${authUser ? "readonly" : ""}></label><p class="small muted">${authUser ? "Your display name syncs to your account." : "This guest profile stays on this device."}</p><button class="btn primary" type="submit">Save Profile</button></form>`);
      return;
    }
    if (action === "quality" && playerContext?.source?.preview) {
      toast("Use the gear inside the preview for available video quality.");
      return;
    }
    if (action === "quality") {
      const source = playerContext?.source || sourceFor(mediaKey()), variants = source?.variants?.map((item) => item.quality) || [];
      choice("Preferred Video Quality", ["Auto (Best Available)", ...new Set(variants.length ? variants : player ? ["Original"] : ["480p", "720p", "1080p Full HD", "4K Ultra HD"])], "quality");
      $(".sheet-body", sheet).insertAdjacentHTML("beforeend", `<p class="small muted">Playback uses the closest quality provided by your video source.</p>${preferenceSwitch("1a1f6.svg", "Play Next Episode", "Continue when the next video is available", "autoNext")}`);
      return;
    }
    if (action === "audio") return choice("Audio Language", playerContext?.source?.demo ? ["English"] : ["Japanese (日本語)", "English", "Tagalog"], "audio");
    if (action === "subtitles") return choice("Subtitles & Captions", ["English", "Tagalog", "Off"], "subtitles");
    if (action === "choose-pref") {
      const pref = button.dataset.pref, wasPlaying = player && !player.paused, time = player?.currentTime;
      prefs[pref] = value;
      write("preferences", prefs);
      closeSheet();
      if (currentRoute().page === "player") {
        if (pref === "quality") {
          stopPlayer();
          await mountPlayer({ autoplay: wasPlaying, atTime: time });
          toast("Applied the closest available source quality.");
        } else {
          applyTracks();
          toast("Preference saved. Only tracks included with your source are available.");
        }
      } else render({ keepScroll: true });
      return;
    }
    if (action === "toggle-pref") {
      prefs[value] = !prefs[value];
      write("preferences", prefs);
      button.setAttribute("aria-checked", String(prefs[value]));
      return;
    }
    if (action === "offline-preferences") return offlinePreferences();
    if (action === "clear-videos" || action === "remove-local-video") {
      openSheet("Remove Saved Videos?", `<p>${action === "remove-local-video" ? "Remove this saved episode from this browser?" : "Remove all saved video files from this browser?"} Your original files, online URLs, and watchlist stay available.</p><button class="btn primary" data-action="confirm-remove-videos" data-key="${action === "remove-local-video" ? esc(key) : ""}">Remove Saved Videos</button><button class="btn secondary" data-action="close-sheet">Cancel</button>`);
      return;
    }
    if (action === "confirm-remove-videos") {
      const owner = accountOwner;
      if (button.dataset.key) await removeLocalVideo(button.dataset.key);
      else {
        for (const key2 of [...cachedIds]) {
          if (owner !== accountOwner) return;
          await removeLocalVideo(key2);
        }
        if (owner !== accountOwner) return;
        cachedIds = [];
        write("cached-episode-keys-v2", cachedIds);
      }
      closeSheet();
      if (currentRoute().page !== "player") render({ keepScroll: true });
      toast("Saved videos removed.");
      return;
    }
    if (action === "devices") {
      openSheet("Active Registered Devices", `<div class="stack"><div class="card device-current"><span class="pill cyan">THIS DEVICE</span><h3>${/iPhone|iPad/.test(navigator.userAgent) ? "iPhone / iPad" : /Android/.test(navigator.userAgent) ? "Android" : "Desktop Browser"}</h3><p class="small">${authUser ? "Signed in to your AniVerse account" : "Guest library on this browser"}</p></div><p>This page shows the current browser. A list of other signed-in devices is not available yet.</p><p class="small muted">Account data can sync between devices. Downloaded videos and profile photos stay on the device where you saved them.</p></div>`);
      return;
    }
    if (action === "backup") return backupSheet();
    if (action === "export-backup") {
      downloadJSON({ app: "AniVerse", version: 2, exportedAt: (new Date()).toISOString(), library, progress, profile, preferences: prefs }, "AniVerse_Library_Backup.json");
      toast("Library backup ready.");
      return;
    }
    if (action === "help") return helpSheet();
    if (action === "welcome") {
      if (sheet.open) closeSheet();
      go("home");
      showSplash();
      return;
    }
    if (action === "install") return install();
    if (action === "read-more") {
      const text = $("#synopsis-text"), collapsed = text.classList.toggle("clamp");
      button.textContent = collapsed ? "Read More ⌄" : "Show Less ⌃";
      return;
    }
    if (action === "season") {
      go(routeURL(`detail/${id}`, { season: value }));
      return;
    }
    if (action === "cast") {
      const a = byId(id);
      openSheet("Cast & Crew", `<div class="option-list">${a.cast.map((member) => `<article class="card" style="padding:12px"><h3>${esc(member.name)}</h3><p class="small">${esc(member.role)}</p></article>`).join("")}</div>`);
      return;
    }
    if (action === "trailer") {
      go(episodeLink(byId(id)).slice(1));
      return;
    }
    if (action === "source-list") return sourceList(id);
    if (action === "open-source") return videoSourceSheet(key);
    if (action === "download-source") return videoSourceSheet(key, { download: true });
    if (action === "remove-source") {
      openSheet("Use Official Title Preview?", `<p>Remove the personal video, subtitles, and URL for this episode on this device, then use this anime’s official title preview?</p><button class="btn primary" data-action="confirm-remove-source" data-key="${key}">Use Title Preview</button><button class="btn secondary" data-action="open-source" data-key="${key}">Cancel</button>`);
      return;
    }
    if (action === "confirm-remove-source") {
      await removeLocalVideo(key);
      await deleteStored("tracks", key);
      delete sources[key];
      runtimeSources.delete(key);
      write("video-sources-v2", sources);
      closeSheet();
      if (currentRoute().page === "player" && mediaKey() === key) {
        stopPlayer();
        await mountPlayer();
      }
      toast("Official title preview restored.");
      return;
    }
    if (action === "play") return playVideo();
    if (action === "reset-demo") {
      runtimeSources.set(key, previewSource(key));
      stopPlayer();
      await mountPlayer({ autoplay: true });
      return;
    }
    if (action === "seek" && youtubePlayer) {
      youtubePlayer.seek(Number(button.dataset.seconds));
      return;
    }
    if (action === "seek") {
      if (!player?.src) return videoSourceSheet(key);
      player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + Number(button.dataset.seconds)));
      return;
    }
    if (action === "skip-intro") {
      const end = Number(button.dataset.end) || currentEpisode()?.episode.introEnd || sourceFor(key)?.introEnd;
      if (player && end) player.currentTime = Math.min(player.duration || Infinity, end);
      return;
    }
    if (action === "playback-settings") {
      openSheet("Playback Settings", `<button class="btn primary" data-action="open-source" data-key="${key}">Add or Change Episode Source</button><button class="btn secondary" data-action="quality">Source Quality</button><button class="btn secondary" data-action="speed">Playback Speed</button><button class="btn secondary" data-action="audio-sub">Audio &amp; Subtitles</button><div class="settings-row"><span class="grow">Play next episode automatically</span><button class="switch" role="switch" aria-label="Play next episode" aria-checked="${prefs.autoNext}" data-action="toggle-pref" data-value="autoNext"></button></div>`);
      return;
    }
    if (action === "speed") {
      openSheet("Playback Speed", `<div class="option-list">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => `<button class="${(prefs.speed || 1) === speed ? "selected" : ""}" data-action="set-speed" data-value="${speed}">${speed}×${speed === 1 ? " (Normal)" : ""}</button>`).join("")}</div>`);
      return;
    }
    if (action === "set-speed") {
      prefs.speed = Number(value);
      write("preferences", prefs);
      if (player) player.playbackRate = prefs.speed;
      if ($(".speed")) $(".speed").textContent = `${value}×`;
      closeSheet();
      return;
    }
    if (action === "fullscreen") {
      const wrap = $("#video-wrap");
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (wrap.requestFullscreen) await wrap.requestFullscreen();
        else if (player?.webkitEnterFullscreen) player.webkitEnterFullscreen();
        else toast("Fullscreen is unavailable in this browser.");
      } catch {
        toast("Fullscreen is unavailable in this browser.");
      }
      return;
    }
    if (action === "lock") {
      const locked = $("#video-wrap").classList.toggle("locked");
      button.setAttribute("aria-label", locked ? "Unlock player" : "Lock player");
      toast(locked ? "Player locked. Tap the lock again to unlock." : "Player unlocked.");
      return;
    }
    if (action === "cast-video") {
      if (!player?.src) return videoSourceSheet(key);
      try {
        if (player.remote?.prompt) await player.remote.prompt();
        else if (player.webkitShowPlaybackTargetPicker) player.webkitShowPlaybackTargetPicker();
        else toast("Use your device’s Cast or AirPlay menu.");
      } catch {
        toast("No casting device selected.");
      }
      return;
    }
    if (action === "audio-sub" && playerContext?.source?.preview) {
      openSheet("Preview Controls", '<p>Use the controls inside the YouTube player for available captions, audio, playback speed, quality, and fullscreen.</p><button class="btn secondary" data-action="open-source" data-key="' + key + '">Use Your Own Episode Video</button>');
      return;
    }
    if (action === "audio-sub") {
      openSheet("Audio & Subtitles", `<button class="btn secondary" data-action="audio">Audio: ${esc(playerContext?.source?.demo ? "English (demo)" : prefs.audio)}</button><button class="btn secondary" data-action="subtitles">Subtitles: ${esc(prefs.subtitles)}</button><button class="btn secondary" data-action="open-source" data-key="${key}">Add a Subtitle File</button><button class="btn primary" data-action="native-controls">Show Native Video Controls</button><p class="small">Language and subtitle options apply to available tracks in your video source.</p>`);
      return;
    }
    if (action === "native-controls") {
      if (player) player.controls = true;
      $(".playback-controls")?.classList.add("hidden");
      $(".video-bottom")?.classList.add("hidden");
      $(".video-top")?.classList.add("hidden");
      closeSheet();
      return;
    }
    if (action === "player-tab") {
      playerTab = value;
      updatePlayerPanel();
      return;
    }
    if (action === "player-season") {
      const { anime: a, season } = currentEpisode();
      openSheet("Choose Season", `<div class="option-list">${a.seasons.map((item) => `<button class="${item.id === season.id ? "selected" : ""}" data-action="jump-season" data-value="${item.id}">${esc(item.name)}</button>`).join("")}</div>`);
      return;
    }
    if (action === "jump-season") {
      const a = byId(id), season = seasonFor(a, value);
      closeSheet();
      go(episodeLink(a, { ...season.episodes[0], seasonId: season.id }).slice(1));
      return;
    }
    if (action === "previous-episode") {
      const selected = currentEpisode(), list = orderedEpisodes(selected.anime), index = list.findIndex((episode) => episode.seasonId === selected.season.id && episode.number === selected.episode.number);
      if (index > 0) go(episodeLink(selected.anime, list[index - 1]).slice(1));
      else toast("You’re on the first available episode.");
      return;
    }
    if (action === "mark-episode") {
      const item = episodeFromKey(key), previous = progress[key] || {}, complete = !previous.completed;
      progress[key] = { ...previous, seconds: complete ? previous.duration || item.episode.duration : 0, duration: previous.duration || item.episode.duration, completed: complete, updatedAt: Date.now() };
      write("watch-records-v2", progress);
      if (!complete && library[item.anime.id] === "Completed") {
        library[item.anime.id] = "Watching";
        write("library", library);
      }
      if (currentRoute().page === "player") updatePlayerPanel();
      else render({ keepScroll: true });
      toast(complete ? "Marked as watched." : "Marked as unwatched.");
      return;
    }
    if (action === "download") return downloadVideo(key);
    if (action === "download-all") return downloadAll(id);
    if (action === "share") return shareTitle(id);
    if (action === "remove-comment") {
      const comments = read(`comments-v2.${id}`, []).filter((comment) => comment.id !== value);
      write(`comments-v2.${id}`, comments);
      updatePlayerPanel();
      return;
    }
    if (action === "select-plan" || action === "payment") {
      if (!canAccessMembership() || membershipBusy) return;
      if (action === "select-plan" && Object.hasOwn(planPrices, value)) selectedPlan = value;
      if (action === "payment" && paymentChoices.includes(value)) selectedPayment = value;
      history.replaceState(history.state, "", `#${routeURL("checkout", { plan: selectedPlan, payment: selectedPayment })}`);
      render({ keepScroll: true });
      return;
    }
    if (action === "subscribe") return subscribeMembership();
    if (action === "terms" || action === "privacy") {
      openSheet(action === "terms" ? "Terms of Service" : "Privacy Policy", "<p>AniVerse stores your personal library, progress, preferences, and notes in this browser. Video files and subtitle uploads stay on this device. Your configured video provider receives requests when you play or download its files.</p><p>Anime images and names belong to their respective owners. You must provide authorized video sources. Membership saves the plan and expiry to your account.</p>");
      return;
    }
    if (action === "notification-tab") {
      notificationTab = value;
      render();
      return;
    }
    if (action === "mark-read") {
      events = events.map((item) => ({ ...item, read: true }));
      write("events-v2", events);
      unread = [];
      render();
      return;
    }
    if (action === "notification-open") {
      const item = events.find((item2) => item2.id === value);
      if (!item) return;
      item.read = true;
      write("events-v2", events);
      unread = events.filter((item2) => !item2.read).map((item2) => item2.id);
      go(item.link || "home");
      return;
    }
    if (action === "remove-notification") {
      events = events.filter((item) => item.id !== value);
      write("events-v2", events);
      unread = events.filter((item) => !item.read).map((item) => item.id);
      render({ keepScroll: true });
      return;
    }
  } catch (error) {
    toast(error.message || "This action could not be completed. Please try again.");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "anime-search") {
    query = event.target.value.slice(0, 200);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(updateSearchResults, 120);
  }
  if (event.target.id === "seekbar" && player?.src && Number.isFinite(player.duration)) player.currentTime = Number(event.target.value) / 1e3 * player.duration;
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "profile-photo") {
    const input = event.target, file = input.files?.[0], owner = accountOwner;
    if (!file) return;
    input.disabled = true;
    try {
      const photo = await createProfilePhoto(file);
      if (owner !== accountOwner || !input.isConnected) return;
      if (!write("profile-photo", photo)) return;
      closeSheet();
      render({ keepScroll: true });
      toast("Profile photo saved on this device.");
    } catch (error) {
      const label = $("#photo-error");
      if (label) label.textContent = error.message || "This photo could not be opened. Try another image.";
    } finally {
      input.disabled = false;
      input.value = "";
    }
    return;
  }
  if (event.target.dataset.setting === "sort") {
    filter.sort = event.target.value;
    syncBrowseURL();
    render();
  }
  if (event.target.dataset.setting === "search-sort") {
    searchSort = event.target.value;
    updateSearchResults();
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["auth-form", "search-form", "home-search", "filter-form", "profile-form", "comment-form", "video-source-form", "backup-form"].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === "auth-form") {
    await submitAuthForm(form, data);
    return;
  }
  if (form.id === "home-search") {
    const q = String(data.get("query")).trim();
    query = q;
    rememberSearch();
    go(routeURL("search", { q }));
    return;
  }
  if (form.id === "search-form") {
    query = String(data.get("query")).trim().slice(0, 200);
    rememberSearch();
    updateSearchResults();
    return;
  }
  if (form.id === "filter-form") {
    const target = form.dataset.target, settings = { ...defaultFilter(), rating: Number(data.get("rating")), genre: String(data.get("genre")), studio: String(data.get("studio")), dub: data.has("dub") };
    closeSheet();
    if (target === "search") {
      searchFilter = settings;
      searchGenre = settings.genre;
      syncSearchURL();
      render();
    } else {
      filter = { ...filter, ...settings };
      go(routeURL("browse", { ...filter, dub: filter.dub ? "1" : "" }));
    }
    return;
  }
  if (form.id === "profile-form") {
    const name = String(data.get("name")).trim();
    if (!name) return;
    profile = { name, email: authUser?.email || String(data.get("email")).trim() };
    if (write("profile", profile)) {
      closeSheet();
      render({ keepScroll: true });
      toast(authUser ? "Profile saved. Cloud sync queued." : "Profile saved on this device.");
    }
    return;
  }
  if (form.id === "comment-form") {
    const id = currentRoute().id, text = String(data.get("comment")).trim();
    if (text) {
      const comments = read(`comments-v2.${id}`, []);
      comments.push({ id: crypto.randomUUID(), name: profile.name, text: text.slice(0, 1e3), time: Date.now() });
      write(`comments-v2.${id}`, comments);
      updatePlayerPanel();
      toast("Note saved.");
    }
    return;
  }
  if (form.id === "backup-form") {
    try {
      const file = data.get("backup");
      if (!file?.size || file.size > 2 * 1024 * 1024) throw new Error("Choose a backup JSON file smaller than 2 MB.");
      const backup = sanitizeBackup(JSON.parse(await file.text()), anime);
      library = { ...library, ...backup.library };
      progress = { ...progress, ...backup.progress };
      profile = { ...profile, ...backup.profile };
      prefs = { ...prefs, ...backup.preferences };
      write("library", library);
      write("watch-records-v2", progress);
      write("profile", profile);
      write("preferences", prefs);
      closeSheet();
      render();
      toast("Library backup imported.");
    } catch (error) {
      $("#backup-error").textContent = error.message || "This backup could not be imported.";
    }
    return;
  }
  if (form.id === "video-source-form") {
    const owner = accountOwner, key = form.dataset.key, operation = `${owner}|${key}`, download = form.dataset.download === "true";
    const file = data.get("file"), url = String(data.get("url")).trim(), subtitle = data.get("subtitle"), button = $('button[type="submit"]', form);
    if (downloadKeys.has(operation)) return toast("A save for this episode is already in progress.");
    downloadKeys.add(operation);
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      if (!episodeFromKey(key)) throw new Error("This episode is not in the catalog.");
      if (download && !file?.size && !url) throw new Error("Choose a video file or enter its direct URL.");
      if (!file?.size && !url && !subtitle?.size) throw new Error("Choose a video file, enter a video URL, or add subtitles.");
      if (subtitle?.size) {
        if (subtitle.size > 5 * 1024 * 1024) throw new Error("Subtitle files must be smaller than 5 MB.");
        const text = (await subtitle.text()).replace(/^\uFEFF/, "");
        if (!/^WEBVTT(?:\s|$)/.test(text)) throw new Error("Choose a valid WebVTT (.vtt) subtitle file.");
      }
      if (owner !== accountOwner) return;
      if (file?.size) {
        if (!file.type.startsWith("video/") && !/\.(mp4|webm|m4v|mov)$/i.test(file.name)) throw new Error("Choose a compatible video file.");
        if (!await saveVideo(key, file)) return;
        sources[key] = { local: true };
        write("video-sources-v2", sources);
      } else if (url) {
        if (!safeMediaURL(url) || /^\.\.?\//.test(url) || url.startsWith("/")) throw new Error("Enter an HTTPS direct video URL (or localhost while developing).");
        if (download) {
          const video = await fetchDownload(url);
          if (owner !== accountOwner || !await saveVideo(key, video)) return;
          sources[key] = { url, quality: "Original", audio: "ja" };
          write("video-sources-v2", sources);
        } else if (url !== sourceFor(key)?.url) {
          await removeLocalVideo(key);
          if (owner !== accountOwner) return;
          sources[key] = { url, quality: "Original", audio: "ja" };
          write("video-sources-v2", sources);
        }
      }
      if (subtitle?.size) await putStored("tracks", key, { file: subtitle, language: String(data.get("subtitleLanguage")), label: { en: "English", tl: "Tagalog", ja: "Japanese" }[data.get("subtitleLanguage")] || "Subtitles" });
      if (owner !== accountOwner) return;
      runtimeSources.delete(key);
      const item = episodeFromKey(key);
      if (download) {
        refreshDownloadButton(key);
        recordDownload(item);
        if (form.isConnected) showSavedDownload();
        else toast("Episode saved for offline viewing.");
        return;
      }
      recordEvent("Episode source updated", `${item.anime.short} · Episode ${item.episode.number}`, "System", episodeLink(item.anime, { ...item.episode, seasonId: item.season.id }).slice(1));
      closeSheet();
      if (currentRoute().page === "player" && mediaKey() === key) {
        stopPlayer();
        await mountPlayer({ autoplay: true });
      } else go(episodeLink(item.anime, { ...item.episode, seasonId: item.season.id }).slice(1) + "&autoplay=1");
    } catch (error) {
      if (form.isConnected) {
        $("#source-error", form).textContent = error.name === "QuotaExceededError" ? "Device storage is full. Free some space and try again." : error.message || "The video could not be saved.";
        button.disabled = false;
        button.textContent = download ? "Save Offline" : "Save & Play";
      }
    } finally {
      downloadKeys.delete(operation);
    }
  }
});
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) {
    const bounds = sheet.getBoundingClientRect();
    if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) closeSheet();
  }
});
document.addEventListener("keydown", (event) => {
  if (sheet.open || currentRoute().page !== "player" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(event.target.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    playVideo();
  }
  if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && youtubePlayer) {
    event.preventDefault();
    youtubePlayer.seek(event.key === "ArrowRight" ? 10 : -10);
    return;
  }
  if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && player?.src) {
    event.preventDefault();
    player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + (event.key === "ArrowRight" ? 10 : -10)));
  }
});
function accountSnapshot() {
  return { library: { ...library }, libraryTimes: read("library-times", {}), libraryDeleted: read("library-deleted", {}), progress: { ...progress }, profile: { ...profile }, preferences: { ...prefs }, clock: read("sync-clock", {}), notes: Object.fromEntries(anime.map((a) => [a.id, read(`comments-v2.${a.id}`, [])])) };
}
function readGuestSnapshot() {
  const get = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(accountStorageKey(key, "guest"))) ?? fallback;
    } catch {
      return fallback;
    }
  };
  return { library: get("library", {}), libraryTimes: get("library-times", {}), libraryDeleted: {}, progress: get("watch-records-v2", {}), clock: {}, notes: Object.fromEntries(anime.map((a) => [a.id, get(`comments-v2.${a.id}`, [])])) };
}
function applyAccountSnapshot(snapshot) {
  const safe = sanitizeBackup({ app: "AniVerse", version: 2, ...snapshot }, anime);
  library = safe.library;
  progress = safe.progress;
  profile = { name: authUser?.user_metadata?.display_name || "Anime Fan", ...profile, ...safe.profile, email: authUser?.email || safe.profile.email || "" };
  prefs = { ...defaultPreferences, ...safe.preferences };
  syncPaused = true;
  try {
    write("library", library);
    write("library-times", snapshot.libraryTimes || {});
    write("library-deleted", snapshot.libraryDeleted || {});
    write("watch-records-v2", progress);
    write("profile", profile);
    write("preferences", prefs);
    write("sync-clock", snapshot.clock || {});
    for (const a of anime) {
      const notes = (snapshot.notes?.[a.id] || []).filter((note) => /^[0-9a-f-]{36}$/i.test(note.id) && typeof note.text === "string").map((note) => ({ ...note, text: note.text.slice(0, 1e3), name: profile.name }));
      write(`comments-v2.${a.id}`, notes);
    }
  } finally {
    syncPaused = false;
  }
}
function loadAccountDevice() {
  library = read("library", {});
  prefs = { ...defaultPreferences, ...read("preferences", {}) };
  profile = { name: authUser?.user_metadata?.display_name || "Guest", email: authUser?.email || "", ...read("profile", {}) };
  if (authUser) profile.email = authUser.email;
  progress = read("watch-records-v2", {});
  sources = read("video-sources-v2", {});
  cachedIds = read("cached-episode-keys-v2", []);
  events = read("events-v2", []);
  unread = events.filter((item) => !item.read).map((item) => item.id);
  librarySort = read("library-sort", "recent");
  libraryLayout = read("library-layout", "grid");
  runtimeSources.clear();
}
function scheduleCloudSync() {
  if (!authUser || syncPaused) return;
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncCloud(), 5e3);
}
function setSyncStatus(text) {
  syncStatus = text;
  const label = $("#sync-status");
  if (label) label.textContent = text;
}
async function syncCloud(notify = false) {
  if (!authUser || !auth.client) return false;
  if (syncInFlight) {
    syncAgain = true;
    return false;
  }
  if (!navigator.onLine) {
    setSyncStatus("Offline · Changes are saved on this device");
    if (notify) toast("Connect to the internet to sync your account.");
    return false;
  }
  const owner = accountOwner, userId = authUser.id;
  syncInFlight = true;
  syncAgain = false;
  clearTimeout(syncTimer);
  setSyncStatus("Syncing your library…");
  try {
    const remote = await pullAccount(auth.client, userId);
    if (owner !== accountOwner) return false;
    const merged = mergeAccountState(accountSnapshot(), remote);
    applyAccountSnapshot(merged);
    syncDirty = false;
    await pushAccount(auth.client, userId, accountSnapshot());
    if (owner !== accountOwner) return false;
    setSyncStatus(`Last synced ${(new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    if (notify) toast("Your account library is up to date.");
    if (["profile", "watchlist"].includes(currentRoute().page)) render({ keepScroll: true });
    return true;
  } catch (error) {
    if (owner === accountOwner) {
      syncDirty = true;
      setSyncStatus("Saved on this device · Cloud sync needs attention");
      if (notify) toast("Could not sync. Check your connection and the Supabase table setup, then tap Sync Now.");
    }
    return false;
  } finally {
    syncInFlight = false;
    if (syncAgain) {
      syncAgain = false;
      setTimeout(() => syncCloud(), 0);
    }
  }
}
async function handleAuthChange(event, session) {
  const next = session?.user || null;
  // An expired session can still open this browser’s local files while offline.
  const offlineOwner = auth.configured && !navigator.onLine && event === "INITIAL_SESSION" ? read("offline-account-owner", "") : "";
  const nextOwner = next?.id || offlineOwner || "guest";
  if (next || event === "SIGNED_OUT" || navigator.onLine) write("offline-account-owner", next?.id || "");
  if (accountOwner !== nextOwner || Boolean(authUser) !== Boolean(next)) {
    stopPlayer();
    clearTimeout(syncTimer);
    accountOwner = nextOwner;
    vip = vipUntil = null;
    membershipLoaded = false;
    savedPlan = "Standard";
    membershipError = "";
    membershipBusy = false;
    membershipRead++;
    authUser = next;
    syncDirty = false;
    loadAccountDevice();
    setSyncStatus(next ? "Loading your account library…" : "");
    if (event === "SIGNED_OUT") {
      checkoutAfterLogin = null;
      go("login");
      toast("Logged out on this device.");
    } else if (canAccessMembership() && checkoutAfterLogin !== null && ["login", "signup", "verify-email"].includes(currentRoute().page)) {
      const query = checkoutAfterLogin;
      checkoutAfterLogin = null;
      go(query ? `checkout?${query}` : "checkout");
    } else if (["login", "signup", "verify-email"].includes(currentRoute().page)) go("profile");
    else render({ keepScroll: true });
  } else authUser = next;
  if (event === "PASSWORD_RECOVERY" && auth.recovery) {
    go("reset-password");
    return;
  }
  if (next && ["SIGNED_IN", "INITIAL_SESSION"].includes(event)) {
    syncCloud();
    if (["home", "profile", "checkout", "confirmation"].includes(currentRoute().page)) refreshMembership();
  }
}
async function bootAuth() {
  try {
    const recoveryCode = recoveryCallback ? authCallbackURL.searchParams.get("code") : null;
    const session = await auth.init({ recoveryCode });
    authLoading = false;
    await handleAuthChange("INITIAL_SESSION", session);
    const url = new URL(location.href);
    if (!recoveryCallback && (url.searchParams.has("auth") || url.searchParams.has("code"))) {
      const error = url.searchParams.get("error_description");
      url.searchParams.delete("code");
      url.searchParams.delete("auth");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      if (error) toast("This account link could not be verified. Request a new link.");
      else if (auth.recovery) go("reset-password");
      else if (session && !location.hash) go("profile");
    }
  } catch (error) {
    authLoading = false;
    if (!navigator.onLine) await handleAuthChange("INITIAL_SESSION", null);
    else if (!recoveryCallback) toast(friendlyAuthError(error));
  } finally {
    if (recoveryCallback) {
      const url = new URL(location.href);
      for (const key of ["auth", "code", "sb_flow_id", "error", "error_code", "error_description"]) url.searchParams.delete(key);
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  }
  const page = currentRoute().page;
  if (["login", "signup", "forgot-password", "reset-password"].includes(page) || (isMembershipRoute(page) && !canAccessMembership())) {
    render({ keepScroll: true });
  }
}
async function submitAuthForm(form, data) {
  const mode = form.dataset.mode, button = $('button[type="submit"]', form), error = $("#auth-error"), message = $("#auth-message"), original = button.textContent;
  error.textContent = "";
  message.textContent = "";
  button.disabled = true;
  button.textContent = mode === "login" ? "Logging In…" : mode === "signup" ? "Creating Account…" : mode === "reset" ? "Updating Password…" : "Sending Link…";
  try {
    const result = await auth.submit(mode, Object.fromEntries(data));
    if (mode === "forgot") {
      message.textContent = "If an account exists for this email, you’ll receive a reset link shortly. Open it in this browser to continue.";
      return;
    }
    if (mode === "reset") {
      go("profile");
      toast("Your password has been updated.");
      return;
    }
    if (mode === "signup" && !result.session) {
      go("verify-email");
      return;
    }
    if (result.session) {
      await handleAuthChange("SIGNED_IN", result.session);
      toast(mode === "signup" ? "Welcome to AniVerse." : "Welcome back to AniVerse.");
    }
  } catch (problem) {
    error.textContent = friendlyAuthError(problem);
  } finally {
    button.disabled = !auth.configured;
    button.textContent = original;
  }
}
if (!Number.isInteger(history.state?.aniverseDepth)) history.replaceState({ aniverseDepth: 0 }, "", location.href);
if (recoveryCallback) history.replaceState(history.state, "", location.pathname + location.search + "#reset-password");
let lastRoute = currentRoute();
window.addEventListener("hashchange", () => {
  if (sheet.open) closeSheet();
  const route = currentRoute(), keepScroll = route.page === "detail" && lastRoute.page === "detail" && route.id === lastRoute.id;
  if (!Number.isInteger(history.state?.aniverseDepth)) history.replaceState({ aniverseDepth: routeTrail + 1 }, "", location.href);
  routeTrail = history.state.aniverseDepth;
  lastRoute = route;
  membershipError = "";
  restoreRouteState();
  render({ keepScroll });
  if (["home", "profile", "checkout", "confirmation"].includes(route.page)) refreshMembership();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("pagehide", () => {
  if (cleanupPlayer) cleanupPlayer();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render({ keepScroll: true });
});
window.addEventListener("offline", () => toast("Offline. Saved episodes and local files are available."));
window.addEventListener("online", () => {
  toast("Back online.");
  if (authUser) syncCloud();
});
function showSplash() {
  if ($(".splash-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "splash-overlay";
  overlay.setAttribute("aria-label", "Loading AniVerse");
  overlay.setAttribute("role", "status");
  overlay.innerHTML = `<section class="splash"><div class="splash-brand"><img class="splash-logo" src="${A("733b0.png")}" alt="AniVerse"><div class="anime-network">アニメバース • ANIME NETWORK</div><h1>ANI<span>VERSE</span></h1><p class="tagline">Your Anime World, Anytime.</p></div><div class="splash-loading"><p>Loading...</p><div class="progress"><i></i></div></div></section>`;
  document.body.classList.add("splash-open");
  app.inert = true;
  document.body.append(overlay);
  const panel = $(".splash", overlay), align = () => {
    const bounds = app.getBoundingClientRect();
    panel.style.left = `${bounds.left}px`;
    panel.style.width = `${bounds.width}px`;
  };
  align();
  window.addEventListener("resize", align);
  const done = () => {
    overlay.classList.add("splash-leaving");
    document.body.classList.add("splash-revealing");
    app.inert = false;
    setTimeout(() => {
      overlay.remove();
      document.body.classList.remove("splash-open", "splash-revealing");
      window.removeEventListener("resize", align);
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
  };
  setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : 2300);
}
installFeedback();
migratePlaybackData();
restoreRouteState();
render();
bootAuth();
setInterval(() => {
  if (syncDirty && authUser && !syncInFlight) syncCloud();
}, 2e4);
try {
  if (new URL(location.href).searchParams.get("welcome") === "1" || !sessionStorage.getItem("aniverse.welcomed")) {
    sessionStorage.setItem("aniverse.welcomed", "1");
    showSplash();
  }
} catch {
}
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  navigator.serviceWorker.register("./sw.js", {updateViaCache:"none"}).catch(() => {});
}
