import Link from "next/link";
import { Mark } from "@/components/mark";

const EXPERIENCE = [
  "Name a goal you intend to inhabit.",
  "Receive a forty-minute session composed in your own cloned voice.",
  "The session moves through distinct phases — each with its own weight.",
  "Return daily. The practice accumulates.",
] as const;

export function LandingPage() {
  return (
    <main className="setup-ground">
      {/* Hero — one composition */}
      <section className="land-hero mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16 sm:px-8">
        <div className="land-fade land-fade-1 flex flex-col items-start gap-8">
          <div className="flex items-center gap-3">
            <Mark size={40} labeled />
            <span className="font-display text-2xl tracking-tight text-[var(--text-hi)] sm:text-3xl">
              PhaseShift
            </span>
          </div>

          <div className="space-y-5">
            <h1 className="font-display text-[1.85rem] leading-[1.2] font-normal text-[var(--text-hi)] sm:text-4xl sm:leading-[1.15]">
              Hear your own voice tell you who you&apos;re becoming.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-[var(--text-mid)] sm:text-lg">
              A guided practice built on a proprietary protocol — personal, precise, deliberate.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <Link href="/login?mode=signup" className="btn-clay px-6 py-2.5 text-base">
              Begin
            </Link>
            <Link href="/login" className="btn-link text-base">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* What it is — experience only */}
      <section className="land-section border-t border-[var(--setup-border)]">
        <div className="mx-auto max-w-2xl px-6 py-20 sm:px-8">
          <p className="step-eyebrow mb-4">What it is</p>
          <h2 className="font-display mb-10 text-2xl text-[var(--text-hi)] sm:text-3xl">
            The experience
          </h2>
          <ol className="space-y-6">
            {EXPERIENCE.map((line, index) => (
              <li key={line} className="flex gap-4">
                <span className="font-display w-6 shrink-0 text-[var(--accent-sand)]">
                  {index + 1}
                </span>
                <p className="text-base leading-relaxed text-[var(--text-mid)] sm:text-lg">{line}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The practice — depth without method */}
      <section className="land-section border-t border-[var(--setup-border)]">
        <div className="mx-auto max-w-2xl px-6 py-20 sm:px-8">
          <p className="step-eyebrow mb-4">The practice</p>
          <h2 className="font-display mb-6 text-2xl text-[var(--text-hi)] sm:text-3xl">
            Built to be learned
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-[var(--text-mid)] sm:text-lg">
            PhaseShift rests on the Phase Locking protocol — a structured system refined over
            years, meant to be learned rather than glanced at.
          </p>
        </div>
      </section>

      {/* Begin — open invitation */}
      <section className="land-section border-t border-[var(--setup-border)]">
        <div className="mx-auto max-w-2xl px-6 py-20 sm:px-8">
          <p className="step-eyebrow mb-4">Begin your practice</p>
          <h2 className="font-display mb-4 text-2xl text-[var(--text-hi)] sm:text-3xl">
            Create an account. Build your first session.
          </h2>
          <p className="mb-8 max-w-md text-base leading-relaxed text-[var(--text-mid)]">
            Create an account when you are ready. The door is open.
          </p>
          <Link href="/login?mode=signup" className="btn-clay inline-block px-6 py-2.5 text-base">
            Begin
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--setup-border)]">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-[var(--text-lo)] sm:px-8">
          <span className="font-display text-[var(--text-mid)]">PhaseShift</span>
          <Link href="/privacy" className="transition-colors hover:text-[var(--text-mid)]">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-[var(--text-mid)]">
            Terms
          </Link>
          <Link href="/cookies" className="transition-colors hover:text-[var(--text-mid)]">
            Cookies
          </Link>
          <Link href="/voice-consent" className="transition-colors hover:text-[var(--text-mid)]">
            Voice consent
          </Link>
        </div>
      </footer>
    </main>
  );
}
