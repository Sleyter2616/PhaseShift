"use client";

import { useState } from "react";
import { completeOnboarding } from "./actions";

const SCREENS = [
  {
    eyebrow: "01",
    title: "A session is forty minutes.",
    body: "You listen once through. Your voice guides you. Nothing else competes for the hour.",
  },
  {
    eyebrow: "02",
    title: "You begin with a goal.",
    body: "State what you mean to inhabit. You may use a stock voice, or optionally clone your own for the session.",
  },
  {
    eyebrow: "03",
    title: "This is a daily practice.",
    body: "Return each day. The work is serious — not a novelty, not a glance. A practice you learn.",
  },
] as const;

export function WelcomeFlow() {
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screen = SCREENS[index] ?? SCREENS[0];
  const isLast = index === SCREENS.length - 1;

  async function handleStart() {
    setError(null);
    setPending(true);
    try {
      await completeOnboarding();
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Could not continue");
    }
  }

  return (
    <div className="land-fade land-fade-1 mx-auto flex w-full max-w-md flex-col gap-10 px-6 py-16 sm:px-8">
      <p className="step-eyebrow">
        Welcome · {screen.eyebrow} / {String(SCREENS.length).padStart(2, "0")}
      </p>

      <div className="space-y-5">
        <h1 className="font-display text-3xl leading-snug text-[var(--text-hi)] sm:text-4xl">
          {screen.title}
        </h1>
        <p className="text-base leading-relaxed text-[var(--text-mid)] sm:text-lg">{screen.body}</p>
      </div>

      <div className="flex items-center gap-2" aria-hidden>
        {SCREENS.map((item, i) => (
          <span
            key={item.eyebrow}
            className={`h-0.5 flex-1 rounded-full ${
              i <= index ? "bg-[var(--accent-sand)]" : "bg-[var(--border-hair)]"
            }`}
          />
        ))}
      </div>

      {error ? <p className="text-error">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-4">
        {index > 0 ? (
          <button type="button" onClick={() => setIndex((i) => i - 1)} className="btn-ghost">
            Back
          </button>
        ) : null}
        {isLast ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void handleStart()}
            className="btn-clay px-6 py-2.5"
          >
            {pending ? "Starting…" : "Start"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            className="btn-clay px-6 py-2.5"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
