// Read callbacks before the hash router or Supabase changes the address.
export function readAuthCallback(input) {
  const url = new URL(input), query = url.searchParams, hash = new URLSearchParams(url.hash.slice(1));
  const hasAuthHash = ["access_token", "refresh_token", "error", "error_code", "error_description"].some(key => hash.has(key));
  const recovery = query.get("auth") === "recovery" || query.get("type") === "recovery" || hasAuthHash && hash.get("type") === "recovery";
  return {
    present: hasAuthHash || ["auth", "code", "token_hash", "error", "error_code", "error_description"].some(key => query.has(key)),
    recovery,
    hasAuthHash,
    code: query.get("code"),
    tokenHash: recovery ? query.get("token_hash") : null,
    error: query.get("error_description") || query.get("error_code") || query.get("error") || (hasAuthHash ? hash.get("error_description") || hash.get("error_code") || hash.get("error") : null),
  };
}

export function cleanAuthCallback(input, callback, verifiedRecovery = false) {
  const url = new URL(input);
  for (const key of ["auth", "code", "token_hash", "type", "sb_flow_id", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  if (callback.recovery || verifiedRecovery) url.hash = "reset-password";
  else if (callback.hasAuthHash) url.hash = "login";
  return url.pathname + url.search + url.hash;
}
