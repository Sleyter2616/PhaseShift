import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/scripts");

  return (
    <main className="setup-surface flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="setup-panel w-full max-w-sm space-y-6 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mark size={36} className="text-[var(--text-hi)]" />
          <h1 className="font-display text-3xl tracking-tight text-[var(--text-hi)]">
            PhaseShift
          </h1>
          <p className="setup-note">Sign in to continue your sessions.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
