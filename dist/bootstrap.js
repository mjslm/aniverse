import { clearLocalWorker, isLocalPreview } from './modules/local-preview.js';

async function start() {
  if (isLocalPreview(location.hostname)) {
    try {
      const reloading = await clearLocalWorker({
        serviceWorker: navigator.serviceWorker,
        pageURL: location.href,
        storage: sessionStorage,
        reload: () => location.reload(),
        release: '2.7.0',
      });
      if (reloading) return;
    } catch (error) {
      console.warn('Local cache cleanup was unavailable:', error.message);
    }
  }
  await import('./app.js?v=2.7.4');
}

start().catch(error => {
  console.error('AniVerse could not start:', error);
  document.querySelector('#app').textContent = 'AniVerse could not load. Check your connection and reload the page.';
});
