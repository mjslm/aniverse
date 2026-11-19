import { media } from "../dist/content/media.js";
import { videoApiResult } from "../dist/modules/video-api.js";
function GET(request) {
  const result = videoApiResult(request.url, media, "videos");
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
function HEAD(request) {
  const response = GET(request);
  return new Response(null, { status: response.status, headers: response.headers });
}
function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type" } });
}
export default { fetch(request) {
  return request.method === "GET" ? GET(request) : request.method === "HEAD" ? HEAD(request) : request.method === "OPTIONS" ? OPTIONS() : Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
} };
