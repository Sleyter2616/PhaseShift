import { redirect } from "next/navigation";
import { LandingPage } from "@/app/landing";
import { authCallbackForwardPath } from "@/lib/auth/recovery-params";
import { resolvePostAuthPath } from "@/lib/auth/onboarding";
import { getSessionUser } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Site URL fallback may land ?code= on `/` — send to /auth/callback, not reset.
  const authPath = authCallbackForwardPath(params);
  if (authPath) {
    redirect(authPath);
  }

  const user = await getSessionUser();
  if (user) {
    redirect(await resolvePostAuthPath(user.id));
  }

  return <LandingPage />;
}
