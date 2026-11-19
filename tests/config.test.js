import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, prepareConfig } from '../scripts/config.mjs';

const defaults = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example_public_key_123456789' };

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aniverse-config-'));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'app.config.json'), JSON.stringify({ supabase: defaults }));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('startup regenerates a blank browser config from the bundled project settings', () => fixture(root => {
  fs.writeFileSync(path.join(root, 'dist/config.js'), 'export const supabaseConfig = {};');
  assert.equal(prepareConfig(root, {}).source, 'app.config.json');
  assert.match(fs.readFileSync(path.join(root, 'dist/config.js'), 'utf8'), /https:\/\/example.supabase.co/);
}));

test('complete environment settings take priority and partial overrides are rejected', () => fixture(root => {
  fs.writeFileSync(path.join(root, '.env'), `SUPABASE_URL=${defaults.url}\nSUPABASE_PUBLISHABLE_KEY=${defaults.publishableKey}`);
  const other = { SUPABASE_URL: 'https://second.supabase.co', SUPABASE_PUBLISHABLE_KEY: defaults.publishableKey };
  assert.equal(resolveConfig(root, other).config.url, other.SUPABASE_URL);
  assert.equal(resolveConfig(root, {}).source, '.env');
  assert.throws(() => resolveConfig(root, { SUPABASE_URL: other.SUPABASE_URL }), /Set both/);
  assert.throws(() => resolveConfig(root, { ...other, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_for_browsers' }), /never a secret key/);
}));
