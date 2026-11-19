import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import videosAPI from "../api/videos.js";
import healthAPI from "../api/health.js";
import { prepareConfig } from "./config.mjs";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const {source: configSource} = prepareConfig(projectRoot);
const {version} = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const apiRoutes = { "/api/videos": videosAPI, "/api/health": healthAPI };
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const portFlag = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : 3e3));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt" };
http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (pathname.startsWith("/api/")) {
    const handler = apiRoutes[pathname.replace(/\/$/, "")];
    if (!handler) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "API endpoint not found." }));
      return;
    }
    try {
      const options = { method: request.method, headers: request.headers };
      if (request.method !== "GET" && request.method !== "HEAD") {
        options.body = request;
        options.duplex = "half";
      }
      const result = await handler.fetch(new Request(`http://localhost${request.url}`, options));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(request.method === "HEAD" ? void 0 : Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "The API could not complete this request." }));
    }
    return;
  }
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }
    const headers = { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": /\.(?:html|js)$/.test(file) ? "no-store" : "no-cache", "X-AniVerse-Version": version, "Accept-Ranges": "bytes" };
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        response.end();
        return;
      }
      response.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": stat.size });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  });
}).on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Stop the older server with Ctrl+C, then start this folder again.` : error.message);
  process.exitCode=1;
}).listen(port, "0.0.0.0", () => {
  console.log(`AniVerse ${version} running at http://localhost:${port}`);
  console.log(`Project folder: ${projectRoot}`);
  console.log(`Account settings: ${configSource}`);
  console.log("Leave this terminal open while using the local website.");
});
