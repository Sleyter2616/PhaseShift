/** Canonical app origin for absolute links and Auth redirectTo. */
export function appBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function passwordResetRedirectTo(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${appBaseUrl(env)}/reset-password`;
}
