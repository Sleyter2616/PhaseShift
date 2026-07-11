import { signOut } from "@/app/login/actions";
import { getSessionUser } from "@/lib/auth/session";
import Link from "next/link";

export async function AuthHeader() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/scripts" className="font-medium">
            PhaseShift
          </Link>
          <Link href="/wizard" className="text-neutral-600 hover:text-neutral-900">
            Wizard
          </Link>
          <Link href="/voice" className="text-neutral-600 hover:text-neutral-900">
            Voice
          </Link>
          <span className="text-neutral-500">{user.email}</span>
        </nav>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded border border-neutral-300 px-3 py-1 text-sm text-neutral-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
