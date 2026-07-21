import { LegalDocument } from "@/components/legal-document";
import { LEGAL_UPDATED, loadLegalHtml } from "@/lib/legal/load";

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Use" updated={LEGAL_UPDATED} html={loadLegalHtml("terms")} />
  );
}
