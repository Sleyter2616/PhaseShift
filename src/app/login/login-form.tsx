"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";

  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError(null);
    setConfirmPassword("");
    setAgreedToTerms(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (!agreedToTerms) {
        setError("Please agree to the terms and privacy policy.");
        return;
      }
    }

    setPending(true);

    const supabase = createClient();
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setPending(false);
      setError(result.error.message);
      return;
    }

    const userId = result.data.user?.id;
    if (!userId) {
      setPending(false);
      setError("Check your email to confirm your account, then sign in.");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", userId)
      .maybeSingle();

    setPending(false);
    router.push(profile?.onboarded_at ? "/scripts" : "/welcome");
    router.refresh();
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
      <label className="setup-label">
        Password
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="setup-input mt-1.5"
        />
      </label>
      {mode === "signup" ? (
        <>
          <label className="setup-label">
            Confirm password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="setup-input mt-1.5"
            />
          </label>
          <label className="flex items-start gap-2.5 text-sm text-[var(--text-mid)]">
            <input
              type="checkbox"
              required
              checked={agreedToTerms}
              onChange={(event) => setAgreedToTerms(event.target.checked)}
              className="mt-1 accent-[var(--accent-sand)]"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="btn-link" target="_blank" rel="noreferrer">
                terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="btn-link" target="_blank" rel="noreferrer">
                privacy policy
              </Link>
              .
            </span>
          </label>
        </>
      ) : null}
      {error ? <p className="text-error">{error}</p> : null}
      <button type="submit" disabled={pending} className="btn-clay w-full py-2.5">
        {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <p className="text-center text-sm text-[var(--text-mid)]">
        {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
          className="btn-link"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
