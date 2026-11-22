const LOCAL = ['localhost','127.0.0.1','[::1]'].includes(self.location.hostname);
if (LOCAL) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim().then(() => self.registration.unregister())));
} else {
const CACHE = 'aniverse-local-v2.7.4';
const SHELL = ['./bootstrap.js?v=2.7.4','./app.js?v=2.7.4','./config.js?v=2.7.0','./bootstrap.js','./modules/local-preview.js','./config.js','./modules/auth.js','./modules/auth-ui.js','./modules/account-store.js','./vendor/supabase.js','./assets/pwa-192.png','./assets/pwa-512.png','./','./index.html','./styles.css','./tailwind.css','./vendor/react-ui.js','./app.js','./content/catalog.js','./content/media.js','./modules/catalog.js','./modules/video-api.js','./modules/video-client.js','./content/previews.js','./modules/preview-source.js','./modules/youtube-player.js','./modules/motion.js','./modules/search-suggestions.js','./modules/profile-photo.js','./manifest.webmanifest','./assets/app-icon.svg','./assets/f31ce.png','./assets/733b0.png','./assets/jakarta-400.ttf','./assets/jakarta-500.ttf','./assets/jakarta-600.ttf','./assets/jakarta-700.ttf','./assets/jakarta-800.ttf'];
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aniverse-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', event => {
  const {request}=event;const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api/')||url.origin!==self.location.origin||request.headers.has('range')||/\.(mp4|webm|m4v|mov|vtt)$/i.test(url.pathname))return;
  if(request.mode==='navigate') {event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));}return response;}).catch(()=>caches.match('./index.html')));return;}
  if(/\.(js|css|webmanifest)$/.test(url.pathname)){event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request)));return;}
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;})));
});

}
