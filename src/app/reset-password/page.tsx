import { Mark } from "@/components/mark";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
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
        <ResetPasswordForm />
      </div>
    </main>
  );
}
