import { Mark } from "@/components/mark";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="setup-ground flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="setup-panel w-full max-w-sm space-y-6 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Mark size={36} labeled />
          <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">
            Reset password
          </h1>
          <p className="text-sm text-[var(--text-mid)]">
            Enter the email for your account. We will send a reset link if it matches
            one we know.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
