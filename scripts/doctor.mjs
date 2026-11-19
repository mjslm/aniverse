import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
console.log(`AniVerse ${version}`);
console.log(`Project folder: ${root}`);
try {
  const { config, source } = resolveConfig(root);
  console.log(`Account settings: valid (${source})`);
  console.log(`Supabase project: ${new URL(config.url).hostname}`);
  const response = await fetch(`${config.url}/auth/v1/health`, {
    headers: { apikey: config.publishableKey }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
  console.log('Account service: reachable');
  console.log('Start the website with npm run dev and leave that terminal open.');
} catch (error) {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
}
