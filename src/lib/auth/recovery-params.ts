/**
 * Auth params Supabase may attach to a recovery redirect.
 * Prefer PKCE `code`; keep legacy `token_hash` + `type=recovery`.
 */
export function hasPasswordRecoveryParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): boolean {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  if (get("code")) return true;
  return Boolean(get("token_hash") && get("type") === "recovery");
}

/** Forward recovery query params onto `/reset-password` (e.g. from `/`). */
export function resetPasswordForwardPath(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  if (!hasPasswordRecoveryParams(params)) return null;

  const out = new URLSearchParams();
  const copy = (key: string) => {
    if (params instanceof URLSearchParams) {
      const value = params.get(key);
      if (value) out.set(key, value);
      return;
    }
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    if (single) out.set(key, single);
  };

  copy("code");
  copy("token_hash");
  copy("type");

  const qs = out.toString();
  return qs ? `/reset-password?${qs}` : "/reset-password";
}
