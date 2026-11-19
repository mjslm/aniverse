import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('local preview uses the shipped client when esbuild is missing and builds explain how to install tools', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aniverse-startup-'));
  try {
    for (const folder of ['scripts', 'dist/modules', 'dist/vendor']) {
      fs.mkdirSync(path.join(fixture, folder), { recursive: true });
    }
    fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
    for (const file of ['scripts/build-auth.mjs', 'dist/modules/auth.js', 'scripts/config.mjs']) {
      fs.copyFileSync(path.join(root, file), path.join(fixture, file));
    }
    fs.writeFileSync(path.join(fixture, 'dist/vendor/supabase.js'), 'export {};');
    const command = path.join(fixture, 'scripts/build-auth.mjs');
    const options = { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_public_key_123456789' } };
    const preview = spawnSync(process.execPath, [command], options);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Using the included account client/);
    const build = spawnSync(process.execPath, [command, '--require-tools'], options);
    assert.equal(build.status, 1);
    assert.match(build.stderr, /npm ci --include=dev/);
    fs.rmSync(path.join(fixture, 'dist/vendor/supabase.js'));
    assert.equal(spawnSync(process.execPath, [command], options).status, 1);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
