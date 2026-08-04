import { redirect } from "next/navigation";
import { LandingPage } from "@/app/landing";
import { resetPasswordForwardPath } from "@/lib/auth/recovery-params";
import { resolvePostAuthPath } from "@/lib/auth/onboarding";
import { getSessionUser } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const recoveryPath = resetPasswordForwardPath(params);
  if (recoveryPath) {
    redirect(recoveryPath);
  }

  const user = await getSessionUser();
  if (user) {
    redirect(await resolvePostAuthPath(user.id));
  }

  return <LandingPage />;
}
