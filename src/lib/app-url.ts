/** Canonical app origin for absolute links and Auth redirectTo. */
export function appBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/**
 * Absolute URL for Supabase Auth password-reset redirectTo.
 * Always ends with `/reset-password` — never the site root.
 * Pass `origin` (e.g. `window.location.origin`) from the browser so emails
 * target the live host even if `NEXT_PUBLIC_APP_URL` is missing at runtime.
 */
export function passwordResetRedirectTo(
  env: Record<string, string | undefined> = process.env,
  options?: { origin?: string },
): string {
  const fromOrigin = options?.origin?.trim().replace(/\/$/, "");
  const base = fromOrigin || appBaseUrl(env);
  // Guard against callers accidentally passing a bare path or trailing path.
  const originOnly = base.replace(/\/reset-password\/?$/, "");
  return `${originOnly}/reset-password`;
}
