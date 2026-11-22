export function validPublicConfig(config) {
  try {
    const url = new URL(config.url);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.endsWith(".supabase.co") || url.pathname !== "/") return false;
    const key = config.publishableKey || "";
    if (key.startsWith("sb_publishable_")) return key.length > 25;
    if (key.split(".").length === 3) return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon";
  } catch {
  }
  return false;
}
export function validateCredentials({ email, password, name, confirmPassword }, mode = "login") {
  if (mode === "signup" && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60)) throw new Error("Enter a name between 2 and 60 characters.");
  if (mode !== "reset" && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) throw new Error("Enter a valid email address.");
  if (mode !== "forgot" && (!password || password.length < (mode === "login" ? 1 : 8) || password.length > 128)) throw new Error(mode === "login" ? "Enter your password." : "Use a password between 8 and 128 characters.");
  if (["signup", "reset"].includes(mode) && password !== confirmPassword) throw new Error("Your passwords do not match.");
  return { email: email?.trim().toLowerCase(), password, name: name?.trim() };
}
export function friendlyAuthError(error) {
  const code = error?.code || "", message = String(error?.message || "");
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return "The email or password is incorrect. Please try again.";
  if (code === "email_not_confirmed") return "Confirm your email first, then return here to log in.";
  if (/rate|too many|429/i.test(code + " " + message)) return "Too many requests. Please wait a little and try again.";
  if (/fetch|network|timeout/i.test(message)) return "We could not connect. Check your internet connection and try again.";
  if (code === "weak_password") return "Choose a stronger password with at least 8 characters.";
  return message.slice(0, 200) || "Something went wrong. Please try again.";
}
export function createAuthService(config, { loadSDK = () => import("../vendor/supabase.js"), onChange = () => {
}, baseURL = () => location.origin + location.pathname } = {}) {
  let client = null, recovery = false;
  const ready = validPublicConfig(config);
  const requireClient = () => {
    if (!client) throw new Error("Account services are not connected yet. You can continue as a guest.");
    return client;
  };
  const redirect = (type) => {
    const url = new URL(baseURL());
    url.search = "";
    url.hash = "";
    url.searchParams.set("auth", type);
    return url.href;
  };
  return {
    configured: ready,
    get client() {
      return client;
    },
    get recovery() {
      return recovery;
    },
    async init({ recoveryCode = null } = {}) {
      if (!ready) return null;
      const { createClient } = await loadSDK();
      client = createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !recoveryCode, flowType: "pkce" } });
      client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session?.user) recovery = true;
        if (event === "SIGNED_OUT") recovery = false;
        setTimeout(() => onChange(event, session), 0);
      });
      if (recoveryCode) {
        // Exchange exactly once and wait for Supabase to confirm the recovery flow.
        const { data, error } = await client.auth.exchangeCodeForSession(recoveryCode);
        if (error) throw error;
        recovery = data?.redirectType === "recovery" && Boolean(data.session?.user);
        return data?.session ?? null;
      }
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    async submit(mode, values) {
      const input = validateCredentials(values, mode), auth = requireClient().auth;
      let result;
      if (mode === "login") result = await auth.signInWithPassword({ email: input.email, password: input.password });
      else if (mode === "signup") result = await auth.signUp({ email: input.email, password: input.password, options: { data: { display_name: input.name }, emailRedirectTo: redirect("confirmed") } });
      else if (mode === "forgot") result = await auth.resetPasswordForEmail(input.email, { redirectTo: redirect("recovery") });
      else if (mode === "reset") {
        if (!recovery) throw new Error("Open the password reset link from your email first.");
        result = await auth.updateUser({ password: input.password });
        if (!result.error) recovery = false;
      } else throw new Error("Unknown account action.");
      if (result.error) throw result.error;
      return result.data || {};
    },
    async signOut() {
      const { error } = await requireClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      recovery = false;
    }
  };
}
