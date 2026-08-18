/** Canonical app origin for absolute links and Auth redirectTo. */
export function appBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function resolveOrigin(
  env: Record<string, string | undefined>,
  options?: { origin?: string },
): string {
  const fromOrigin = options?.origin?.trim().replace(/\/$/, "");
  const base = fromOrigin || appBaseUrl(env);
  // Strip accidental auth paths if a caller passed a full redirect URL as origin.
  return base
    .replace(/\/auth\/callback\/?$/, "")
    .replace(/\/reset-password\/?$/, "");
}

/**
 * Signup / email-confirm redirect. Lands on `/auth/callback` which exchanges
 * the PKCE code and sends the user into the app (no password step).
 */
export function authCallbackRedirectTo(
  env: Record<string, string | undefined> = process.env,
  options?: { origin?: string },
): string {
  return `${resolveOrigin(env, options)}/auth/callback`;
}

/**
 * Absolute URL for Supabase Auth password-reset redirectTo.
 * Goes through `/auth/callback?next=/reset-password` so recovery is distinct
 * from signup confirmation (which uses bare `/auth/callback`).
 */
export function passwordResetRedirectTo(
  env: Record<string, string | undefined> = process.env,
  options?: { origin?: string },
): string {
  const origin = resolveOrigin(env, options);
  return `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
}
