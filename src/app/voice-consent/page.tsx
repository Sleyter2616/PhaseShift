import Link from "next/link";
import { Mark } from "@/components/mark";
import { SiteFooter } from "@/components/site-footer";

export default function VoiceConsentPage() {
  return (
    <main className="setup-ground flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 sm:px-8">
        <Link href="/" className="mb-8 flex w-fit items-center gap-2">
          <Mark size={22} />
          <span className="font-display text-lg text-[var(--text-hi)]">PhaseShift</span>
        </Link>

        <header className="mb-8 space-y-2 border-b border-[var(--setup-border)] pb-6">
          <h1 className="font-display text-3xl text-[var(--text-hi)]">Voice consent</h1>
          <p className="text-sm text-[var(--text-lo)]">In-app voice cloning for your account</p>
        </header>

        <div className="space-y-5 text-base leading-relaxed text-[var(--text-mid)]">
          <p>
            When you record your voice in PhaseShift, the sample is sent to ElevenLabs to create a
            voice clone for your account. That clone is stored privately and used only to generate
            your own guided sessions.
          </p>
          <p>
            We do not use your voice sample or clone to create sessions for anyone else. You may
            request deletion of your voice sample and clone by contacting us through the channels in
            our{" "}
            <Link href="/privacy" className="btn-link">
              privacy policy
            </Link>
            .
          </p>
          <p>
            By accepting the voice-recording checkbox in the app, you confirm the recording is your
            own voice and you consent to this processing.
          </p>
        </div>

        <p className="mt-12 border-t border-[var(--setup-border)] pt-8">
          <Link href="/" className="btn-link">
            Back to PhaseShift
          </Link>
        </p>
      </div>
      <SiteFooter />
    </main>
  );
}
