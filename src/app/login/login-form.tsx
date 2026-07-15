"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setPending(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    router.push("/scripts");
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
      {error ? <p className="text-error">{error}</p> : null}
      <button type="submit" disabled={pending} className="btn-clay w-full py-2.5">
        {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <p className="text-center text-sm text-[var(--text-mid)]">
        {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="btn-link"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
