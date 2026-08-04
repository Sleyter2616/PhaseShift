"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function establishRecoverySession() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      const authError = params.get("error_description") ?? params.get("error");

      if (authError) {
        if (!cancelled) {
          setLinkError(authError);
          setSessionReady(false);
          setChecking(false);
        }
        return;
      }

      // PKCE (current Supabase email links): ?code=<uuid>
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          if (exchangeError) {
            setLinkError(
              exchangeError.message ||
                "This reset link is invalid or has expired.",
            );
            setSessionReady(false);
          } else {
            setSessionReady(true);
            // Drop one-time code from the URL so refresh does not re-exchange.
            window.history.replaceState({}, "", "/reset-password");
          }
          setChecking(false);
        }
        return;
      }

      // Legacy email format: ?token_hash=…&type=recovery
      if (tokenHash && type === "recovery") {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        if (!cancelled) {
          if (verifyError) {
            setLinkError(
              verifyError.message ||
                "This reset link is invalid or has expired.",
            );
            setSessionReady(false);
          } else {
            setSessionReady(true);
            window.history.replaceState({}, "", "/reset-password");
          }
          setChecking(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSessionReady(Boolean(data.session));
        if (!data.session) {
          setLinkError(
            "This reset link is invalid or has expired. Request a new one and try again.",
          );
        }
        setChecking(false);
      }
    }

    void establishRecoverySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady(true);
        setChecking(false);
        setLinkError(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setPending(false);
      setError(updateError.message);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setPending(false);
      router.push("/login");
      router.refresh();
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", user.id)
      .maybeSingle();

    setPending(false);
    router.push(profile?.onboarded_at ? "/scripts" : "/welcome");
    router.refresh();
  }

  if (checking) {
    return <p className="text-sm text-[var(--text-mid)]">Checking reset link…</p>;
  }

  if (!sessionReady) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-[var(--text-mid)]">
          {linkError ??
            "This reset link is invalid or has expired. Request a new one and try again."}
        </p>
        <p className="text-center text-sm text-[var(--text-mid)]">
          <Link href="/forgot-password" className="btn-link">
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <label className="setup-label">
        New password
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="setup-input mt-1.5"
        />
      </label>
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
      {error ? <p className="text-error">{error}</p> : null}
      <button type="submit" disabled={pending} className="btn-clay w-full py-2.5">
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
