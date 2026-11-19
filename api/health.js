import { media } from "../dist/content/media.js";
import { videoApiResult } from "../dist/modules/video-api.js";
function GET(request) {
  return Response.json(videoApiResult(request.url, media, "health").body, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
function HEAD(request) {
  const response = GET(request);
  return new Response(null, { status: 200, headers: response.headers });
}
export default { fetch(request) {
  return request.method === "GET" ? GET(request) : request.method === "HEAD" ? HEAD(request) : Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, HEAD" } });
} };
