import Link from "next/link";
import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { SessionPrimerContent } from "@/components/session-primer";
import { SetupHeader } from "@/components/setup-header";
import { SiteFooter } from "@/components/site-footer";
import { getSessionUser } from "@/lib/auth/session";

export default async function HowToPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="setup-ground flex min-h-dvh flex-col">
      <SetupHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-10 sm:px-6">
        <Mark size={28} className="mb-6" />
        <SessionPrimerContent showAction={false} actionLabel="I'm ready" />
        <p className="mt-10">
          <Link href="/scripts" className="btn-link">
            Back to sessions
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
