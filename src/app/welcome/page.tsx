import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { needsOnboarding } from "@/lib/auth/onboarding";
import { getSessionUser } from "@/lib/auth/session";
import { WelcomeFlow } from "./welcome-flow";

export default async function WelcomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await needsOnboarding(user.id))) redirect("/scripts");

  return (
    <main className="setup-ground flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-md items-center gap-3 px-6 pt-10 sm:px-8">
        <Mark size={28} labeled />
        <span className="font-display text-xl text-[var(--text-hi)]">PhaseShift</span>
      </div>
      <WelcomeFlow />
    </main>
  );
}
