import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LegalDocId = "privacy" | "terms" | "cookies";

const LEGAL_DIR = join(process.cwd(), "src/content/legal");

/** Strip Termly document chrome / color-forcing styles; keep body markup. */
export function normalizeTermlyHtml(raw: string): string {
  let html = raw.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Termly watermark / logo strip at the top of the export
  html = html.replace(
    /<span\s+style="display:\s*block;margin:\s*0\s+auto\s+3\.125rem;[\s\S]*?<\/span>/i,
    "",
  );
  // Drop inline color/background so our dark-theme CSS wins cleanly
  html = html.replace(/\sstyle="([^"]*)"/gi, (_match, styles: string) => {
    const cleaned = styles
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !/^(color|background(-color)?)\s*:/i.test(part))
      .join("; ");
    return cleaned ? ` style="${cleaned}"` : "";
  });
  return html.trim();
}

export function loadLegalHtml(id: LegalDocId): string {
  const raw = readFileSync(join(LEGAL_DIR, `${id}.html`), "utf8");
  return normalizeTermlyHtml(raw);
}

export const LEGAL_UPDATED = "July 20, 2026";
