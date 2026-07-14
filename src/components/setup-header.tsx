import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { getSessionUser } from "@/lib/auth/session";
import { Mark } from "@/components/mark";

/** Warm-setup chrome for login/wizard/scripts only — leave AuthHeader for other routes. */
export async function SetupHeader() {
  const user = await getSessionUser();

  return (
    <header className="border-b border-[var(--setup-border)] bg-[var(--setup-bg)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/scripts"
          className="flex items-center gap-2 text-[var(--text-hi)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <Mark size={22} className="text-[var(--text-hi)]" />
          <span className="font-display text-lg tracking-tight">PhaseShift</span>
        </Link>
        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[10rem] truncate text-xs text-[var(--text-mid)] sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <button type="submit" className="setup-btn-ghost px-3 py-1.5 text-xs">
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
