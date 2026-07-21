import { LegalDocument } from "@/components/legal-document";
import { LEGAL_UPDATED, loadLegalHtml } from "@/lib/legal/load";

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" updated={LEGAL_UPDATED} html={loadLegalHtml("privacy")} />
  );
}
