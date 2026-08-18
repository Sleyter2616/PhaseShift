/**
 * Auth redirect helpers for Supabase email links (confirm + recovery).
 *
 * Signup confirmation → `/auth/callback` (no `next`) → app.
 * Password recovery → `/auth/callback?next=/reset-password` → reset page.
 */

export const PASSWORD_RECOVERY_COOKIE = "ps_pw_recovery";

function paramGet(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** True when `next` asks for the password-reset page (recovery intent). */
export function isPasswordRecoveryNext(next: string | null | undefined): boolean {
  if (!next) return false;
  const path = next.split("?")[0] ?? next;
  return path === "/reset-password";
}

/**
 * Only allow same-origin relative paths we explicitly support after auth.
 * Rejects open redirects (`//evil.com`, `https://…`).
 */
export function safeAuthNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (isPasswordRecoveryNext(next)) return "/reset-password";
  return null;
}

/** Legacy recovery email params (pre-PKCE). */
export function hasLegacyRecoveryParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): boolean {
  return Boolean(
    paramGet(params, "token_hash") && paramGet(params, "type") === "recovery",
  );
}

/**
 * If Site URL fallback lands auth params on `/`, forward to `/auth/callback`
 * (never assume a bare `?code=` is password recovery).
 */
export function authCallbackForwardPath(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  const code = paramGet(params, "code");
  const next = paramGet(params, "next");
  const tokenHash = paramGet(params, "token_hash");
  const type = paramGet(params, "type");

  if (code) {
    const out = new URLSearchParams();
    out.set("code", code);
    const safeNext = safeAuthNextPath(next);
    if (safeNext) out.set("next", safeNext);
    return `/auth/callback?${out.toString()}`;
  }

  if (tokenHash && type === "recovery") {
    const out = new URLSearchParams();
    out.set("token_hash", tokenHash);
    out.set("type", "recovery");
    out.set("next", "/reset-password");
    return `/auth/callback?${out.toString()}`;
  }

  return null;
}

/** @deprecated Prefer authCallbackForwardPath — bare code is not always recovery. */
export function hasPasswordRecoveryParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): boolean {
  if (paramGet(params, "code") && isPasswordRecoveryNext(paramGet(params, "next"))) {
    return true;
  }
  return hasLegacyRecoveryParams(params);
}

/** @deprecated Prefer authCallbackForwardPath. */
export function resetPasswordForwardPath(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  return authCallbackForwardPath(params);
}
