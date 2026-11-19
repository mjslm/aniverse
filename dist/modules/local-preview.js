export const isLocalPreview = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

export async function clearLocalWorker({ serviceWorker, pageURL, storage, reload, release }) {
  if (!serviceWorker) return false;
  const base = new URL('./', pageURL);
  const script = new URL('sw.js', base).href;
  const registrations = await serviceWorker.getRegistrations();
  const ours = registrations.filter(registration => registration.scope === base.href &&
    [registration.active, registration.waiting, registration.installing].some(worker => worker?.scriptURL.split('?')[0] === script));
  await Promise.all(ours.map(registration => registration.unregister()));

  // Reload once before rendering forms so an old controller cannot serve stale files.
  const key = `aniverse.local-refresh.${release}`;
  if (serviceWorker.controller?.scriptURL.split('?')[0] === script && storage.getItem(key) !== 'done') {
    storage.setItem(key, 'done');
    reload();
    return true;
  }
  return false;
}
