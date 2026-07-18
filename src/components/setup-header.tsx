import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Mark } from "@/components/mark";
import { getSessionUser } from "@/lib/auth/session";

export async function SetupHeader() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <header className="setup-header-bar">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
        <nav className="flex items-center gap-3 sm:gap-4">
          <Link href="/scripts" className="flex items-center gap-2" aria-label="PhaseShift home">
            <Mark size={20} />
            <span className="font-display text-base text-[var(--text-hi)]">PhaseShift</span>
          </Link>
          <Link
            href="/wizard"
            className="text-sm text-[var(--text-mid)] transition-colors hover:text-[var(--text-hi)]"
          >
            New session
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[var(--text-lo)] sm:inline">{user.email}</span>
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
