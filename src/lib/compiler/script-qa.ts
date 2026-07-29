import type { Manifest, ManifestSegment } from "../contracts/manifest";
import { THETA_BANNED_TOKENS, countBannedTokensInTheta } from "../pipeline/phase1-verify";

export type ScriptQaFindingKind =
  | "person_agreement"
  | "template_artifact"
  | "banned_token";

export interface ScriptQaFinding {
  kind: ScriptQaFindingKind;
  seq: number;
  phase: string;
  detail: string;
  /** True when the QA pass rewrote the segment text. */
  fixed: boolean;
}

export interface ScriptQaResult {
  manifest: Manifest;
  findings: ScriptQaFinding[];
}

const SECOND_PERSON_RE = /\byou(?:'re|'ve|'d|rself)?\b/i;
const FIRST_PERSON_MISMATCH_RE = /\b(myself|mine|my|I'm|I've|I'd|I)\b/i;

/** Mechanical first→second person swaps (word-boundary safe). Order matters. */
const PERSON_SWAPS: Array<{ from: RegExp; to: string }> = [
  { from: /\bmyself\b/gi, to: "yourself" },
  { from: /\bmine\b/gi, to: "yours" },
  { from: /\bmy\b/gi, to: "your" },
  { from: /\bI'm\b/g, to: "you're" },
  { from: /\bI've\b/g, to: "you've" },
  { from: /\bI'd\b/g, to: "you'd" },
  { from: /\bI\b/g, to: "you" },
];

const TEMPLATE_ARTIFACT_RE =
  /\{\{[^{}]+\}\}|\{[a-z_][a-z0-9_]*\}|\[\[[^\]]+\]\]|__(?:PLACEHOLDER|TODO|INSERT)__|\bTODO\b|\bTBD\b|\bFIXME\b/i;

/**
 * Split on sentence-ish boundaries while keeping delimiters attached.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return parts?.map((p) => p) ?? [text];
}

export function sentenceNeedsPersonAgreementFix(sentence: string): boolean {
  return SECOND_PERSON_RE.test(sentence) && FIRST_PERSON_MISMATCH_RE.test(sentence);
}

export function adjustFirstPersonToSecond(sentence: string): string {
  let out = sentence;
  for (const { from, to } of PERSON_SWAPS) {
    out = out.replace(from, (match) => {
      if (match[0] === match[0]!.toUpperCase() && /[A-Z]/.test(match[0]!) && to[0]) {
        return to[0]!.toUpperCase() + to.slice(1);
      }
      return to;
    });
  }
  return out;
}

/**
 * Fix first-person pronouns only in sentences that also address the listener
 * as "you" — leaves pure first-person declarations ("the role is mine") alone.
 */
export function fixPersonAgreementInText(text: string): {
  text: string;
  fixes: string[];
} {
  const fixes: string[] = [];
  const sentences = splitSentences(text);
  const rewritten = sentences.map((sentence) => {
    if (!sentenceNeedsPersonAgreementFix(sentence)) return sentence;
    const next = adjustFirstPersonToSecond(sentence);
    if (next !== sentence) {
      fixes.push(`person-agreement: "${sentence.trim()}" → "${next.trim()}"`);
    }
    return next;
  });
  return { text: rewritten.join(""), fixes };
}

export function findTemplateArtifacts(text: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(TEMPLATE_ARTIFACT_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    hits.push(match[0]);
  }
  return hits;
}

/**
 * Pre-synthesis QA: auto-correct person-agreement errors in second-person
 * narration; flag template artifacts and banned theta tokens.
 */
export function runScriptQa(manifest: Manifest): ScriptQaResult {
  const findings: ScriptQaFinding[] = [];
  const segments = manifest.segments.map((segment: ManifestSegment) => {
    let text = segment.text;

    const { text: fixed, fixes } = fixPersonAgreementInText(text);
    for (const detail of fixes) {
      findings.push({
        kind: "person_agreement",
        seq: segment.seq,
        phase: segment.phase,
        detail,
        fixed: true,
      });
    }
    text = fixed;

    for (const artifact of findTemplateArtifacts(text)) {
      findings.push({
        kind: "template_artifact",
        seq: segment.seq,
        phase: segment.phase,
        detail: `template artifact: ${artifact}`,
        fixed: false,
      });
    }

    if (segment.phase === "theta") {
      const banned = countBannedTokensInTheta(text);
      for (const token of THETA_BANNED_TOKENS) {
        const n = banned.get(token);
        if (n && n > 0) {
          findings.push({
            kind: "banned_token",
            seq: segment.seq,
            phase: segment.phase,
            detail: `banned token "${token}" x${n}`,
            fixed: false,
          });
        }
      }
    }

    return text === segment.text ? segment : { ...segment, text };
  });

  return {
    manifest: { ...manifest, segments },
    findings,
  };
}

export function logScriptQaFindings(findings: ReadonlyArray<ScriptQaFinding>): void {
  if (findings.length === 0) {
    console.error("script-qa: clean (0 findings)");
    return;
  }
  const fixed = findings.filter((f) => f.fixed).length;
  const flagged = findings.length - fixed;
  console.error(`script-qa: ${findings.length} finding(s) fixed=${fixed} flagged=${flagged}`);
  for (const finding of findings) {
    console.error(
      `script-qa: seq=${finding.seq} phase=${finding.phase} kind=${finding.kind} ` +
        `fixed=${finding.fixed ? 1 : 0} ${finding.detail}`,
    );
  }
}
