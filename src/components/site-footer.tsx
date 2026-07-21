import Link from "next/link";

const linkClass = "transition-colors hover:text-[var(--text-mid)]";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--setup-border)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-[var(--text-lo)] sm:px-6">
        <Link href="/privacy" className={linkClass}>
          Privacy
        </Link>
        <Link href="/terms" className={linkClass}>
          Terms
        </Link>
        <Link href="/cookies" className={linkClass}>
          Cookies
        </Link>
      </div>
    </footer>
  );
}
