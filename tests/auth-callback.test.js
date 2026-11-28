import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAuthCallback, cleanAuthCallback } from "../dist/modules/auth-callback.js";
import { createAuthService } from "../dist/modules/auth.js";
import { createClient } from "../dist/vendor/supabase.js";

const config = { url: "https://exampleproject.supabase.co", publishableKey: "sb_publishable_example_public_key_only" };
const appSource = fs.readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const bootSource = appSource.slice(appSource.indexOf("async function bootAuth()"), appSource.indexOf("async function submitAuthForm("));
const startupGuard = appSource.split("\n").find(line => line.startsWith("if (recoveryCallback"));

async function boot(input, init) {
  let url = new URL(input);
  const callback = readAuthCallback(url), events = [];
  const context = {
    authCallback: callback, recoveryCallback: callback.recovery, authLoading: true, recoveryMessage: "",
    location: { get href() { return url.href; }, get pathname() { return url.pathname; }, get search() { return url.search; }, get hash() { return url.hash; } },
    history: { state: {}, replaceState(_state, _title, value) { url = new URL(value, url); } },
    auth: { recovery: false, async init(options) { return init(options, url, this); } },
    cleanAuthCallback, navigator: { onLine: true }, friendlyAuthError: error => error.message,
    handleAuthChange: async (event, session) => events.push([event, session]),
    go: page => { url.hash = page; }, toast: text => events.push(["toast", text]),
    currentRoute: () => ({ page: url.hash.slice(1) }), render: () => events.push(["render"]),
    isMembershipRoute: () => false, canAccessMembership: () => false,
  };
  await vm.runInNewContext(`${startupGuard}\n${bootSource}\nbootAuth()`, context);
  return { url, context, events };
}

test("startup preserves implicit recovery credentials until Supabase consumes them", async () => {
  const result = await boot("https://aniverse.example/?auth=recovery#access_token=test-access&refresh_token=test-refresh&type=recovery", async (options, url, auth) => {
    assert.equal(options.implicitCallback, true);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("access_token"), "test-access");
    auth.recovery = true;
    return { user: { id: "mobile-user" } };
  });
  assert.equal(result.url.href, "https://aniverse.example/#reset-password");
  assert.equal(result.context.authLoading, false);
});

test("token-hash callbacks verify on a fresh device and remove credentials from the URL", async () => {
  const result = await boot("https://aniverse.example/?auth=recovery&token_hash=test-once&type=recovery&sb_flow_id=test-flow&keep=1", async (options, _url, auth) => {
    assert.equal(options.recoveryTokenHash, "test-once");
    auth.recovery = true;
    return { user: { id: "mobile-user" } };
  });
  assert.equal(result.url.href, "https://aniverse.example/?keep=1#reset-password");
});

test("PKCE recovery still opens the reset form if a redirect omits the auth marker", async () => {
  const result = await boot("https://aniverse.example/?code=legacy-code&sb_flow_id=legacy-flow", async (options, url, auth) => {
    assert.equal(options.recoveryCode, "legacy-code");
    assert.equal(url.searchParams.get("sb_flow_id"), "legacy-flow");
    auth.recovery = true;
    return { user: { id: "desktop-user" } };
  });
  assert.equal(result.url.href, "https://aniverse.example/#reset-password");
});

test("expired callbacks show recovery feedback and never fall back to a saved session", async () => {
  const result = await boot("https://aniverse.example/?auth=recovery#error=access_denied&error_code=otp_expired", () => assert.fail("An error callback must not restore a saved account."));
  assert.match(result.context.recoveryMessage, /expired/);
  assert.equal(result.context.auth.recovery, false);
  assert.equal(result.url.href, "https://aniverse.example/#reset-password");
  const failed = await boot("https://aniverse.example/?auth=recovery&token_hash=used-token&type=recovery", async () => { throw new Error("This reset link was already used."); });
  assert.match(failed.context.recoveryMessage, /already used/);
  assert.equal(failed.url.search, "");
  assert.equal(failed.context.auth.recovery, false);
});

test("normal hash routes remain intact and non-recovery token types cannot activate recovery", () => {
  const input = "https://aniverse.example/?keep=1#search?q=demon";
  assert.equal(readAuthCallback(input).present, false);
  assert.equal(cleanAuthCallback(input, readAuthCallback(input)), "/?keep=1#search?q=demon");
  const signup = readAuthCallback("https://aniverse.example/?token_hash=signup-token&type=signup");
  assert.equal(signup.recovery, false);
  assert.equal(signup.tokenHash, null);
});

test("the shipped Supabase SDK verifies a recovery token without an originating browser verifier", async () => {
  const requests = [];
  let expired = false;
  const session = { access_token: "test-access", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user: { id: "mobile-user", aud: "authenticated", email: "fan@example.test" } };
  const sdk = { createClient(url, key, options) {
    return createClient(url, key, { ...options, auth: { ...options.auth, persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(expired ? { code: "otp_expired", msg: "Token has expired or is invalid" } : session), { status: expired ? 403 : 200, headers: { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" } });
    } } });
  } };
  const auth = createAuthService(config, { loadSDK: async () => sdk });
  const verified = await auth.init({ recoveryTokenHash: "test-token-hash" });
  assert.equal(verified.user.id, "mobile-user");
  assert.equal(auth.recovery, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/auth\/v1\/verify$/);
  assert.equal(requests[0].body.token_hash, "test-token-hash");
  assert.equal(requests[0].body.type, "recovery");
  assert.equal(requests[0].body.code_verifier, undefined);

  expired = true;
  const invalid = createAuthService(config, { loadSDK: async () => sdk });
  await assert.rejects(invalid.init({ recoveryTokenHash: "expired-token" }), /expired|invalid/);
  assert.equal(invalid.recovery, false);
  await assert.rejects(invalid.submit("reset", { password: "test-password-123", confirmPassword: "test-password-123" }), /Open the password reset link/);
});
