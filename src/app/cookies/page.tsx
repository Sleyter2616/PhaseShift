import { LegalDocument } from "@/components/legal-document";
import { LEGAL_UPDATED, loadLegalHtml } from "@/lib/legal/load";

export default function CookiesPage() {
  return (
    <LegalDocument title="Cookie Policy" updated={LEGAL_UPDATED} html={loadLegalHtml("cookies")} />
  );
}
