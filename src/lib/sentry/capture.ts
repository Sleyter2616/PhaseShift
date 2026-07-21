import * as Sentry from "@sentry/nextjs";

/** Capture an error with a path tag only — never attach user content. */
export function capturePathError(error: unknown, path: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(err, {
    tags: { path },
  });
}
