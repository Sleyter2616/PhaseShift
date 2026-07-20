import type { ReactNode } from "react";
import Link from "next/link";
import { Mark } from "@/components/mark";

const BANNER =
  "PLACEHOLDER — not legally reviewed, replace before public launch";

export function LegalStub({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="setup-ground min-h-dvh">
      <div className="mx-auto max-w-2xl px-6 py-12 sm:px-8">
        <Link href="/" className="mb-8 flex items-center gap-2 w-fit">
          <Mark size={22} />
          <span className="font-display text-lg text-[var(--text-hi)]">PhaseShift</span>
        </Link>

        <div role="status" className="legal-placeholder-banner mb-8 px-4 py-3 text-sm">
          {BANNER}
        </div>

        <h1 className="font-display mb-6 text-3xl text-[var(--text-hi)]">{title}</h1>
        <div className="space-y-4 text-base leading-relaxed text-[var(--text-mid)]">{children}</div>

        <p className="mt-12">
          <Link href="/" className="btn-link">
            Back to PhaseShift
          </Link>
        </p>
      </div>
    </main>
  );
}
