import Link from "next/link";
import { Mark } from "@/components/mark";

export function LegalDocument({
  title,
  updated,
  html,
}: {
  title: string;
  updated: string;
  html: string;
}) {
  return (
    <main className="setup-ground min-h-dvh">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
        <Link href="/" className="mb-8 flex w-fit items-center gap-2">
          <Mark size={22} />
          <span className="font-display text-lg text-[var(--text-hi)]">PhaseShift</span>
        </Link>

        <header className="mb-8 space-y-2 border-b border-[var(--setup-border)] pb-6">
          <h1 className="font-display text-3xl text-[var(--text-hi)] sm:text-4xl">{title}</h1>
          <p className="text-sm text-[var(--text-lo)]">Last updated {updated}</p>
        </header>

        <article
          className="legal-termly max-w-prose"
          // Termly HTML is trusted first-party content checked into the repo.
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <p className="mt-12 border-t border-[var(--setup-border)] pt-8">
          <Link href="/" className="btn-link">
            Back to PhaseShift
          </Link>
        </p>
      </div>
    </main>
  );
}
