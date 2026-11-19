import fs from 'node:fs';
import path from 'node:path';
import { validPublicConfig } from '../dist/modules/auth.js';

function readEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

export function resolveConfig(root, environment = process.env) {
  const defaults = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8')).supabase;
  const local = readEnv(path.join(root, '.env'));
  let config = defaults;
  let source = 'app.config.json';

  // Never combine credentials from two different projects.
  for (const [values, label] of [[local, '.env'], [environment, 'environment']]) {
    if (!values.SUPABASE_URL && !values.SUPABASE_PUBLISHABLE_KEY) continue;
    if (!values.SUPABASE_URL || !values.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error(`Set both public Supabase values in ${label}, or remove that override.`);
    }
    config = { url: values.SUPABASE_URL, publishableKey: values.SUPABASE_PUBLISHABLE_KEY };
    source = label;
  }
  if (!validPublicConfig(config)) {
    throw new Error(`Invalid public account settings in ${source}. Use a project URL and publishable key; never a secret key.`);
  }
  return { config, source };
}

export function prepareConfig(root, environment = process.env) {
  const result = resolveConfig(root, environment);
  fs.writeFileSync(path.join(root, 'dist/config.js'), `export const supabaseConfig = ${JSON.stringify(result.config)};\n`);
  return result;
}
