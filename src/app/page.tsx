import { redirect } from "next/navigation";
import { LandingPage } from "@/app/landing";
import { resolvePostAuthPath } from "@/lib/auth/onboarding";
import { getSessionUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getSessionUser();
  if (user) {
    redirect(await resolvePostAuthPath(user.id));
  }

  return <LandingPage />;
}
