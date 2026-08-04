"use client";

import { useState } from "react";
import Link from "next/link";
import { passwordResetRedirectTo } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/client";

const CONFIRMATION =
  "If an account exists for that email, a reset link is on its way.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    // Enumeration-safe: always show the same confirmation after attempt.
    // Pass live origin so redirectTo is always https://…/reset-password (never /).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: passwordResetRedirectTo(process.env, {
          origin: window.location.origin,
        }),
      },
    );

    setPending(false);
    if (resetError && /rate limit|too many/i.test(resetError.message)) {
      setError("Too many attempts. Please wait a minute and try again.");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-[var(--text-mid)]">{CONFIRMATION}</p>
        <p className="text-center text-sm text-[var(--text-mid)]">
          <Link href="/login" className="btn-link">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <label className="setup-label">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="setup-input mt-1.5"
        />
      </label>
      {error ? <p className="text-error">{error}</p> : null}
      <button type="submit" disabled={pending} className="btn-clay w-full py-2.5">
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-center text-sm text-[var(--text-mid)]">
        <Link href="/login" className="btn-link">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
