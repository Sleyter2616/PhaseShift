import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { resolvePostAuthPath } from "@/lib/auth/onboarding";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-params";
import { getSessionUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : null;
  const type = typeof params.type === "string" ? params.type : null;
  const legacyRecovery = Boolean(tokenHash && type === "recovery");

  const cookieStore = await cookies();
  const recoveryOk = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value === "1";

  const user = await getSessionUser();

  // Fully authenticated, non-recovery visit → app (never prompt for a password).
  if (user && !recoveryOk && !legacyRecovery) {
    redirect(await resolvePostAuthPath(user.id));
  }

  return (
    <main className="setup-ground flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="setup-panel w-full max-w-sm space-y-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mark size={36} labeled />
          <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">
            Choose a new password
          </h1>
          <p className="text-sm text-[var(--text-mid)]">
            Enter a new password for your PhaseShift account.
          </p>
        </div>
        <ResetPasswordForm recoveryOk={recoveryOk || legacyRecovery} />
      </div>
    </main>
  );
}
