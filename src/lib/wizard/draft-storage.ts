import type { WizardDraft } from "@/lib/contracts/wizard";

export const WIZARD_DRAFT_STORAGE_VERSION = 1 as const;

export type StoredWizardDraft = {
  version: typeof WIZARD_DRAFT_STORAGE_VERSION;
  step: number;
  draft: WizardDraft;
  reusedFromId: string | null;
  updatedAt: string;
};

export function wizardDraftStorageKey(userId: string): string {
  return `phaseshift:wizard-draft:v1:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

/** Validate a minimally usable stored payload (tolerate partial older shapes). */
export function parseStoredWizardDraft(raw: unknown): StoredWizardDraft | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== WIZARD_DRAFT_STORAGE_VERSION) return null;
  if (typeof raw.step !== "number" || raw.step < 1 || raw.step > 7) return null;
  if (!isRecord(raw.draft)) return null;
  if (typeof raw.draft.goal_statement !== "string") return null;
  if (!isRecord(raw.draft.session)) return null;

  return {
    version: WIZARD_DRAFT_STORAGE_VERSION,
    step: Math.floor(raw.step),
    draft: raw.draft as unknown as WizardDraft,
    reusedFromId: typeof raw.reusedFromId === "string" ? raw.reusedFromId : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
  };
}

export function loadWizardDraft(userId: string): StoredWizardDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(wizardDraftStorageKey(userId));
    if (!raw) return null;
    return parseStoredWizardDraft(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveWizardDraft(
  userId: string,
  payload: Omit<StoredWizardDraft, "version" | "updatedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredWizardDraft = {
      version: WIZARD_DRAFT_STORAGE_VERSION,
      step: payload.step,
      draft: payload.draft,
      reusedFromId: payload.reusedFromId,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(wizardDraftStorageKey(userId), JSON.stringify(stored));
  } catch {
    // Quota / private mode — ignore; generation still works without drafts.
  }
}

export function clearWizardDraft(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(wizardDraftStorageKey(userId));
  } catch {
    // ignore
  }
}

/** True when the draft has any user-entered content worth restoring. */
export function wizardDraftHasContent(draft: WizardDraft): boolean {
  if (draft.goal_statement.trim()) return true;
  if (draft.localization.place.trim()) return true;
  if (draft.triangulation.some((item) => item.trim())) return true;
  if (draft.not_list.some((item) => item.trim())) return true;
  if (draft.wrong_pulls.some((item) => item.trim())) return true;
  if (draft.features.some((item) => item.trim())) return true;
  if (draft.sync_actions.some((item) => item.action.trim())) return true;
  return false;
}
