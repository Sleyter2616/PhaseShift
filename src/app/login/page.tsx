import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/scripts");

  return (
    <main className="setup-ground flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="setup-panel w-full max-w-sm space-y-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mark size={36} labeled />
          <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">PhaseShift</h1>
          <p className="text-sm text-[var(--text-mid)]">Sign in to continue</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
