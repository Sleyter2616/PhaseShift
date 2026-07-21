"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { digest: error.digest ?? "unknown", path: "global-error" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background:
            "radial-gradient(ellipse at 50% 20%, #3a3566 0%, #241f42 45%, #141026 100%)",
          color: "#ece7db",
        }}
      >
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <p
              style={{
                margin: 0,
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: "1.75rem",
                lineHeight: 1.3,
              }}
            >
              Something went wrong
            </p>
            <p style={{ marginTop: "0.75rem", color: "#9aa3b5", lineHeight: 1.5 }}>
              We&apos;ve been notified. You can try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: "1.5rem",
                border: "none",
                borderRadius: "8px",
                background: "#c96a3a",
                color: "#ece7db",
                padding: "0.625rem 1.25rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
