import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareConfig } from "./config.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const { source } = prepareConfig(root);
console.log(`Account settings loaded from ${source}.`);
let build;
try {
  ({ build } = await import("esbuild"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  const bundledClient = path.join(root, "dist/vendor/supabase.js");
  if (process.argv.includes("--require-tools") || !fs.existsSync(bundledClient)) {
    console.error("Build tools are missing. Run npm ci --include=dev in the folder containing package.json, then try again.");
    process.exit(1);
  }
  // A bundled client lets local preview run without build dependencies.
  console.log("Using the included account client. Run npm ci to install build and test tools.");
  process.exit(0);
}
await build({ stdin: { contents: "export {createClient} from '@supabase/supabase-js';", resolveDir: root }, bundle: true, format: "esm", platform: "browser", target: ["es2020"], minify: true, legalComments: "linked", outfile: path.join(root, "dist/vendor/supabase.js") });
console.log("Supabase browser client prepared.");
