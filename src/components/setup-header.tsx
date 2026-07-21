import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Mark } from "@/components/mark";
import { getSessionUser } from "@/lib/auth/session";

const navLinkClass =
  "text-sm text-[var(--text-mid)] transition-colors hover:text-[var(--text-hi)]";

export function SetupHeaderBar({ email }: { email: string }) {
  return (
    <header className="setup-header-bar">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <nav className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
          <Link href="/scripts" className="flex items-center gap-2" aria-label="PhaseShift home">
            <Mark size={20} />
            <span className="font-display text-base text-[var(--text-hi)]">PhaseShift</span>
          </Link>
          <Link href="/scripts" className={navLinkClass}>
            Sessions
          </Link>
          <Link href="/wizard" className={navLinkClass}>
            New session
          </Link>
          <Link href="/voice" className={navLinkClass}>
            Voice
          </Link>
          <Link href="/billing" className={navLinkClass}>
            Billing
          </Link>
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden max-w-[12rem] truncate text-sm text-[var(--text-lo)] sm:inline">
            {email}
          </span>
          <form action={signOut}>
            <button type="submit" className="btn-ghost px-3 py-1.5 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export async function SetupHeader() {
  const user = await getSessionUser();
  if (!user) return null;
  return <SetupHeaderBar email={user.email ?? ""} />;
}
