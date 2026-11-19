import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLocalWorker, isLocalPreview } from '../dist/modules/local-preview.js';

test('local cache recovery removes only this app worker and reloads a stale page once', async () => {
  let removed = 0, otherRemoved = 0, reloads = 0;
  const storage = new Map([['existing-setting', 'keep']]);
  const own = { scope: 'http://localhost:3000/', active: { scriptURL: 'http://localhost:3000/sw.js' }, unregister: async () => { removed++; } };
  const other = { scope: 'http://localhost:3000/other/', active: { scriptURL: 'http://localhost:3000/other/sw.js' }, unregister: async () => { otherRemoved++; } };
  const options = {
    serviceWorker: { controller: own.active, getRegistrations: async () => [own, other] },
    pageURL: 'http://localhost:3000/#signup', release: 'test', reload: () => { reloads++; },
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  };
  assert.equal(await clearLocalWorker(options), true);
  assert.equal(await clearLocalWorker(options), false);
  assert.equal(removed, 2);
  assert.equal(otherRemoved, 0);
  assert.equal(reloads, 1);
  assert.equal(storage.get('existing-setting'), 'keep');
});

test('local mode handles unsupported workers and never treats a public hostname as localhost', async () => {
  assert.equal(await clearLocalWorker({ serviceWorker: null }), false);
  assert.equal(isLocalPreview('localhost'), true);
  assert.equal(isLocalPreview('127.0.0.1'), true);
  assert.equal(isLocalPreview('aniverse.vercel.app'), false);
  assert.equal(isLocalPreview('localhost.example.com'), false);
});
