import test from "node:test";
import assert from "node:assert/strict";
import { validPublicConfig, validateCredentials, createAuthService } from "../dist/modules/auth.js";
import { authPage } from "../dist/modules/auth-ui.js";
import { accountStorageKey, mergeAccountState, cloudRows, fromCloudRows, pullAccount, pushAccount } from "../dist/modules/account-store.js";
const config = { url: "https://exampleproject.supabase.co", publishableKey: "sb_publishable_example_public_key_only" };
const state = () => ({ library: { aot: "Watching" }, libraryTimes: { aot: 1e3 }, libraryDeleted: {}, progress: { "aot:s4p3:29": { seconds: 12, duration: 30, watchedSeconds: 7, completed: false, updatedAt: 1e3 } }, profile: { name: "Anime Fan" }, preferences: { quality: "720p" }, clock: { profile: 1e3, preferences: 1e3 }, notes: { aot: [{ id: "11111111-1111-4111-8111-111111111111", text: "Private", time: 1e3 }] } });
test("public config accepts publishable/anon keys and rejects secret/service-role keys", () => {
  assert.equal(validPublicConfig(config), true);
  assert.equal(validPublicConfig({ ...config, publishableKey: "sb_secret_no" }), false);
  const jwt = (role) => "eyJ." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".sig";
  assert.equal(validPublicConfig({ ...config, publishableKey: jwt("anon") }), true);
  assert.equal(validPublicConfig({ ...config, publishableKey: jwt("service_role") }), false);
  assert.equal(validPublicConfig({ ...config, url: "http://exampleproject.supabase.co" }), false);
});
test("credentials check email, name, password strength and confirmation without trimming passwords", () => {
  assert.throws(() => validateCredentials({ email: "bad", password: "password" }, "login"));
  assert.throws(() => validateCredentials({ email: "fan@example.test", name: "Fan", password: "short", confirmPassword: "short" }, "signup"));
  assert.throws(() => validateCredentials({ email: "fan@example.test", name: "Fan", password: "password123", confirmPassword: "different" }, "signup"));
  assert.equal(validateCredentials({ email: " FAN@example.test ", password: " secret " }, "login").password, " secret ");
});
test("signup, login, reset email, and local logout call official auth methods and safe callbacks", async () => {
  const calls = [], fake = { auth: { onAuthStateChange() {
  }, async getSession() {
    return { data: { session: null } };
  } } };
  for (const method of ["signUp", "signInWithPassword", "resetPasswordForEmail", "signOut"]) fake.auth[method] = async (...args) => {
    calls.push([method, ...args]);
    return { data: { session: null }, error: null };
  };
  const auth = createAuthService(config, { loadSDK: async () => ({ createClient: (url, key, options) => {
    assert.equal(options.auth.flowType, "pkce");
    return fake;
  } }), baseURL: () => "https://aniverse.example/?old=1#home" });
  await auth.init();
  await auth.submit("signup", { name: "Anime Fan", email: "fan@example.test", password: "password123", confirmPassword: "password123" });
  await auth.submit("login", { email: "fan@example.test", password: "password123" });
  await auth.submit("forgot", { email: "fan@example.test" });
  await auth.signOut();
  assert.equal(calls[0][1].options.emailRedirectTo, "https://aniverse.example/?auth=confirmed");
  assert.equal(calls[2][2].redirectTo, "https://aniverse.example/?auth=recovery");
  assert.deepEqual(calls[3], ["signOut", { scope: "local" }]);
});
test("password change requires a real recovery event rather than a reset URL", async () => {
  let listener, updated = false;
  const fake = { auth: { onAuthStateChange(fn) {
    listener = fn;
  }, async getSession() {
    return { data: { session: null } };
  }, async updateUser() {
    updated = true;
    return { data: { user: {} } };
  } } };
  const auth = createAuthService(config, { loadSDK: async () => ({ createClient: () => fake }), baseURL: () => "https://aniverse.example/" });
  await auth.init();
  const data = { password: "newpassword123", confirmPassword: "newpassword123" };
  await assert.rejects(auth.submit("reset", data));
  assert.equal(updated, false);
  listener("PASSWORD_RECOVERY", { user: { id: "user-a" } });
  await auth.submit("reset", data);
  assert.equal(updated, true);
  assert.equal(auth.recovery, false);
});
test("a recovery callback waits for a successful, recovery-specific PKCE exchange", async () => {
  const session = { user: { id: "user-a" } };
  const exchangeCalls = [];
  let redirectType = "recovery", exchangeError = null;
  const sdk = { createClient(_url, _key, options) {
    assert.equal(options.auth.detectSessionInUrl, false);
    return { auth: {
      onAuthStateChange() {},
      async exchangeCodeForSession(code) {
        exchangeCalls.push(code);
        return { data: { session, redirectType }, error: exchangeError };
      },
      async getSession() { assert.fail("Recovery must verify its code, even if a saved session exists."); }
    } };
  } };
  const auth = createAuthService(config, { loadSDK: async () => sdk });
  assert.equal(await auth.init({ recoveryCode: "reset-code" }), session);
  assert.equal(auth.recovery, true);
  assert.deepEqual(exchangeCalls, ["reset-code"]);
  assert.doesNotMatch(authPage({ mode: "reset", configured: true, recovery: auth.recovery }), /type="submit"[^>]+disabled/);

  redirectType = null;
  const signIn = createAuthService(config, { loadSDK: async () => sdk });
  await signIn.init({ recoveryCode: "sign-in-code" });
  assert.equal(signIn.recovery, false);
  assert.match(authPage({ mode: "reset", configured: true, recovery: signIn.recovery }), /Send a new reset link/);
  assert.match(authPage({ mode: "reset", configured: true, recovery: signIn.recovery }), /type="submit"[^>]+disabled/);

  exchangeError = new Error("Invalid recovery code");
  const expired = createAuthService(config, { loadSDK: async () => sdk });
  await assert.rejects(expired.init({ recoveryCode: "expired-code" }), /Invalid recovery code/);
  assert.equal(expired.recovery, false);
});
test("unconfigured auth cannot fabricate a session and the form clearly reports unavailable service", async () => {
  const auth = createAuthService({}, { loadSDK: () => {
    throw Error("must not load");
  } });
  assert.equal(await auth.init(), null);
  await assert.rejects(auth.submit("login", { email: "fan@example.test", password: "password" }));
  assert.match(authPage({ mode: "signup" }), /Account services aren’t connected yet/);
  assert.match(authPage({ mode: "signup" }), /type="submit"[^>]+disabled/);
});
test("guest and two account caches have different library, note, preference and private-source keys", () => {
  for (const key of ["library", "watch-records-v2", "profile", "profile-photo", "preferences", "video-sources-v2", "cached-episode-keys-v2", "comments-v2.aot"]) assert.equal(new Set(["guest", "user-a", "user-b"].map((id) => accountStorageKey(key, id))).size, 3);
  assert.equal(accountStorageKey("library", "guest"), "aniverse.library");
});
test("merge keeps newer progress and preferences and does not resurrect removed titles", () => {
  const local = state(), remote = state();
  remote.progress["aot:s4p3:29"] = { seconds: 5, updatedAt: 500 };
  remote.library = {};
  remote.libraryDeleted = { aot: 2e3 };
  remote.preferences = { quality: "480p" };
  remote.clock.preferences = 3e3;
  const merged = mergeAccountState(local, remote);
  assert.equal(merged.progress["aot:s4p3:29"].seconds, 12);
  assert.equal(merged.library.aot, void 0);
  assert.equal(merged.preferences.quality, "480p");
  assert.equal(merged.notes.aot.length, 1);
  assert.equal(mergeAccountState(merged, state()).library.aot, void 0);
});
test("cloud rows round-trip account data without passwords, tokens or personal video files", () => {
  const rows = cloudRows("user-a", state()), restored = fromCloudRows(rows);
  assert.equal(restored.library.aot, "Watching");
  assert.equal(restored.progress["aot:s4p3:29"].seconds, 12);
  assert.equal(restored.notes.aot[0].text, "Private");
  assert.ok(!/password|access_token|video-sources|blob:/.test(JSON.stringify(rows)));
});
test("cloud adapter scopes every query by user and propagates failed RLS writes", async () => {
  const seen = [], client = { from(table) {
    return { select() {
      return this;
    }, eq(column, id) {
      seen.push([table, column, id]);
      return this;
    }, order() {
      return this;
    }, async range() {
      return { data: [] };
    }, async upsert(items) {
      assert.ok(items.every((row) => (row.user_id || row.id) === "user-a"));
      return {};
    } };
  } };
  await pullAccount(client, "user-a");
  await pushAccount(client, "user-a", state());
  assert.equal(seen.length, 5);
  assert.ok(seen.every((row) => row[2] === "user-a"));
  await assert.rejects(pushAccount({ from() {
    return { upsert: async () => ({ error: Error("RLS denied") }) };
  } }, "user-a", state()), /RLS denied/);
});
