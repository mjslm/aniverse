import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');

test('production offline installation includes the exact versioned startup imports', async () => {
  const events = {}, cached = [], pending = [];
  const self = {
    location: { hostname: 'aniverse.example' },
    addEventListener: (name, handler) => { events[name] = handler; },
    skipWaiting: async () => {},
  };
  const caches = { open: async () => ({ addAll: async urls => cached.push(...urls) }) };
  vm.runInNewContext(read('sw.js'), { self, caches, URL });
  events.install({ waitUntil: task => pending.push(task) });
  await Promise.all(pending);
  const entry = read('index.html').match(/type="module" src="([^"]+)"/)[1];
  const app = read('bootstrap.js').match(/import\('([^']+)'\)/)[1];
  const config = read('app.js').match(/from "(\.\/config\.js[^\"]*)"/)[1];
  for (const file of [entry, app, config, './modules/local-preview.js', './modules/auth-callback.js', './tailwind.css', './vendor/react-ui.js']) assert(cached.includes(file), file);
  assert.equal(typeof events.fetch, 'function');
});

test('a worker updated on localhost retires without caching requests or deleting user data', async () => {
  const events = {}, pending = [];
  let claimed = false, retired = false;
  const self = {
    location: { hostname: 'localhost' },
    addEventListener: (name, handler) => { events[name] = handler; },
    skipWaiting: async () => {},
    clients: { claim: async () => { claimed = true; } },
    registration: { unregister: async () => { retired = true; } },
  };
  vm.runInNewContext(read('sw.js'), { self });
  events.activate({ waitUntil: task => pending.push(task) });
  await Promise.all(pending);
  assert.equal(events.fetch, undefined);
  assert(claimed && retired);
});
