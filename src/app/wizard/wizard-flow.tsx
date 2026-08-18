"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChoiceControl } from "@/components/choice-control";
import {
  availableMinutes,
  minutesCost,
  TOPUP_MINUTES,
} from "@/lib/billing/minutes";
import { LENGTHS } from "@/lib/compiler/skeleton";
import {
  hasConcreteNounToken,
  maxTimeframeIsoDate,
  PRESENT_TENSE_GOAL_PATTERN,
  rewriteGoalPresentTense,
  SENSE_OPTIONS,
  TIMEFRAME_PRESET_OPTIONS,
  todayIsoDate,
} from "@/lib/contracts/intake";
import {
  draftToIntake,
  EMPTY_WIZARD_DRAFT,
  validateWizardStep,
  withSessionLength,
  type WizardDraft,
  type WizardLengthMin,
} from "@/lib/contracts/wizard";
import type { PriorSessionOption } from "@/lib/contracts/wizard-from-prior";
import { WIZARD_STEP_COPY } from "@/lib/contracts/wizard-copy";
import type { WizardVoiceStatus } from "@/lib/voice/profile-select";
import type { StockVoiceOption } from "@/lib/voice/stock-voices";
import {
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  wizardDraftHasContent,
} from "@/lib/wizard/draft-storage";
import { ChipInput } from "./chip-input";
import { FieldExplainer, StepExplainer } from "./step-explainer";

const STEP_COUNT = 7;
const FEATURE_LINT_MESSAGE =
  "Must include a concrete noun (observability lint)";

interface WizardFlowProps {
  userId: string;
  readyVoiceProfileId: string | null;
  voiceStatus: WizardVoiceStatus;
  stockVoices: StockVoiceOption[];
  minutesBalance: {
    subscription: number;
    topup: number;
    resetAt: string | null;
  };
  priorSessions?: PriorSessionOption[];
  /** Full drafts keyed by script id for reuse (payload from server). */
  priorDrafts?: Record<string, WizardDraft>;
  initialDraft?: WizardDraft | null;
  initialFromScriptId?: string | null;
}

type InsufficientPayload = {
  needed: number;
  available: number;
  canUseStock: boolean;
};

function formatResetDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function normalizeDraftForVoice(
  draft: WizardDraft,
  readyVoiceProfileId: string | null,
  defaultStockId: string | null,
): WizardDraft {
  const ownOk =
    draft.voice_profile_id != null &&
    readyVoiceProfileId != null &&
    draft.voice_profile_id === readyVoiceProfileId;
  return {
    ...draft,
    voice_profile_id: ownOk ? draft.voice_profile_id : null,
    stock_voice_id: ownOk
      ? null
      : (draft.stock_voice_id ?? defaultStockId),
  };
}

export function WizardFlow({
  userId,
  readyVoiceProfileId,
  voiceStatus,
  stockVoices,
  minutesBalance,
  priorSessions = [],
  priorDrafts = {},
  initialDraft = null,
  initialFromScriptId = null,
}: WizardFlowProps) {
  const router = useRouter();
  const defaultStockId = stockVoices[0]?.id ?? null;
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(() => {
    if (initialDraft) {
      return normalizeDraftForVoice(initialDraft, readyVoiceProfileId, defaultStockId);
    }
    return {
      ...EMPTY_WIZARD_DRAFT,
      stock_voice_id: defaultStockId,
    };
  });
  const [reusedFromId, setReusedFromId] = useState<string | null>(initialFromScriptId);
  const [showReusePicker, setShowReusePicker] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<InsufficientPayload | null>(null);
  const [pending, setPending] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const skipNextSave = useRef(Boolean(initialFromScriptId));

  // Restore local draft after mount (survives refresh / Stripe top-up redirect).
  useEffect(() => {
    if (initialFromScriptId) return;
    const stored = loadWizardDraft(userId);
    if (!stored || !wizardDraftHasContent(stored.draft)) return;
    skipNextSave.current = true;
    setDraft(normalizeDraftForVoice(stored.draft, readyVoiceProfileId, defaultStockId));
    setStep(stored.step);
    setReusedFromId(stored.reusedFromId);
    setDraftRestored(true);
    // Only hydrate once on mount for this user / from-script combo.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount hydrate
  }, [userId, initialFromScriptId]);

  // Autosave draft + step (debounced).
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (!wizardDraftHasContent(draft) && step === 1) {
      clearWizardDraft(userId);
      return;
    }
    const timer = window.setTimeout(() => {
      saveWizardDraft(userId, { step, draft, reusedFromId });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [userId, step, draft, reusedFromId]);

  const showRewriteChip = PRESENT_TENSE_GOAL_PATTERN.test(draft.goal_statement);
  const goalCharCount = draft.goal_statement.length;
  const isOwnVoice = draft.voice_profile_id != null;
  const lengthMin = draft.session.duration_min;
  const sessionCost = minutesCost(lengthMin, isOwnVoice);
  const balanceTotal = availableMinutes({
    subscription: minutesBalance.subscription,
    topup: minutesBalance.topup,
  });
  const stockCost = minutesCost(lengthMin, false);
  const ownCost = minutesCost(lengthMin, true);

  const dateBounds = useMemo(
    () => ({ min: todayIsoDate(), max: maxTimeframeIsoDate() }),
    [],
  );

  function updateDraft(patch: Partial<WizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStepError(null);
    setInsufficient(null);
  }

  function setLength(length: WizardLengthMin) {
    updateDraft({
      session: withSessionLength(draft.session, length),
    });
  }

  function applyPriorSession(scriptId: string) {
    const prior = priorDrafts[scriptId];
    if (!prior) return;
    skipNextSave.current = false;
    setDraft(normalizeDraftForVoice(prior, readyVoiceProfileId, defaultStockId));
    setReusedFromId(scriptId);
    setShowReusePicker(false);
    setStep(1);
    setStepError(null);
    setInsufficient(null);
    setDraftRestored(false);
  }

  function clearReuse() {
    skipNextSave.current = true;
    clearWizardDraft(userId);
    setDraft({
      ...EMPTY_WIZARD_DRAFT,
      stock_voice_id: defaultStockId,
    });
    setReusedFromId(null);
    setStep(1);
    setDraftRestored(false);
  }

  function selectStockVoice(voiceId: string) {
    updateDraft({ voice_profile_id: null, stock_voice_id: voiceId });
  }

  function selectOwnVoice() {
    if (!readyVoiceProfileId) return;
    updateDraft({
      voice_profile_id: readyVoiceProfileId,
      stock_voice_id: null,
    });
  }

  function goNext() {
    const error = validateWizardStep(step, draft);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    if (step < STEP_COUNT) {
      setStep((current) => current + 1);
    }
  }

  function goBack() {
    setStepError(null);
    setStep((current) => Math.max(1, current - 1));
  }

  async function startTopupCheckout() {
    setCheckoutPending(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "topup" }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "checkout failed");
      }
      window.location.href = data.url;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "checkout failed");
      setCheckoutPending(false);
    }
  }

  async function handleSubmit() {
    for (let s = 1; s <= STEP_COUNT; s += 1) {
      const error = validateWizardStep(s, draft);
      if (error) {
        setStep(s);
        setStepError(error);
        return;
      }
    }

    if (!isOwnVoice && !draft.stock_voice_id && stockVoices.length > 0) {
      setStepError("Select a stock voice");
      return;
    }

    if (balanceTotal < sessionCost) {
      const canUseStock = isOwnVoice && balanceTotal >= stockCost;
      setInsufficient({ needed: sessionCost, available: balanceTotal, canUseStock });
      return;
    }

    setPending(true);
    setSubmitError(null);
    setInsufficient(null);

    try {
      const intake = draftToIntake(draft);
      const body = {
        ...intake,
        ...(draft.voice_profile_id
          ? { voice_profile_id: draft.voice_profile_id }
          : draft.stock_voice_id
            ? { stock_voice_id: draft.stock_voice_id }
            : {}),
      };

      const response = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload: {
        script_id?: string;
        error?: string | object;
        needed?: number;
        available?: number;
        canUseStock?: boolean;
      } = await response.json().catch(() => ({}));

      if (response.status === 202 && payload.script_id) {
        clearWizardDraft(userId);
        router.push(`/dev/scripts/${payload.script_id}`);
        return;
      }

      if (response.status === 402) {
        setInsufficient({
          needed: Number(payload.needed ?? sessionCost),
          available: Number(payload.available ?? balanceTotal),
          canUseStock: Boolean(payload.canUseStock),
        });
        return;
      }

      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error != null
            ? JSON.stringify(payload.error)
            : response.statusText || "request failed";
      setSubmitError(message);
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "request failed");
    } finally {
      setPending(false);
    }
  }

  function toggleSense(sense: string) {
    const current = draft.session.senses_emphasis;
    if (current.includes(sense)) {
      if (current.length <= 2) return;
      updateDraft({
        session: {
          ...draft.session,
          senses_emphasis: current.filter((item) => item !== sense),
        },
      });
      return;
    }
    updateDraft({
      session: {
        ...draft.session,
        senses_emphasis: [...current, sense],
      },
    });
  }

  return (
    <div className="space-y-8">
      {draftRestored ? (
        <p className="rounded border border-[var(--setup-border)] bg-[var(--setup-panel)] px-4 py-3 text-sm text-[var(--text-mid)]">
          Restored your in-progress draft.{" "}
          <button type="button" className="btn-link" onClick={clearReuse}>
            Discard and start blank
          </button>
        </p>
      ) : null}
      {priorSessions.length > 0 ? (
        <section className="space-y-3 rounded border border-[var(--setup-border)] bg-[var(--setup-panel)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="setup-label">Start from a previous session</p>
              <p className="mt-1 text-sm text-[var(--text-mid)]">
                Prefill answers, then edit anything before generating.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-sm"
              onClick={() => setShowReusePicker((open) => !open)}
            >
              {showReusePicker ? "Hide" : "Browse"}
            </button>
          </div>
          {reusedFromId ? (
            <p className="text-sm text-[var(--text-hi)]">
              Loaded prior answers.{" "}
              <button type="button" className="btn-link" onClick={clearReuse}>
                Clear and start blank
              </button>
            </p>
          ) : null}
          {showReusePicker ? (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {priorSessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className="w-full rounded border border-[var(--setup-border)] px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--setup-panel)_80%,var(--text-hi)_4%)]"
                    onClick={() => applyPriorSession(session.id)}
                  >
                    <p className="truncate text-sm font-medium text-[var(--text-hi)]">
                      {session.goal_statement}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-mid)]">
                      {session.duration_min != null ? `${session.duration_min} min · ` : ""}
                      {new Date(session.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <header className="space-y-3">
        <p className="step-eyebrow">
          Step {String(step).padStart(2, "0")} / {String(STEP_COUNT).padStart(2, "0")}
        </p>
        <div className="wizard-progress" aria-hidden>
          {Array.from({ length: STEP_COUNT }, (_, index) => {
            const tick = index + 1;
            const state =
              tick < step ? "wizard-tick-done" : tick === step ? "wizard-tick-current" : "";
            return <span key={tick} className={`wizard-tick ${state}`.trim()} />;
          })}
        </div>
        <h1 className="font-display text-2xl font-normal text-[var(--text-hi)]">
          {WIZARD_STEP_COPY[step]!.heading}
        </h1>
        <StepExplainer text={WIZARD_STEP_COPY[step]!.description} />
      </header>

      {step === 1 ? (
        <section className="space-y-4">
          <label className="sr-only" htmlFor="goal">
            Goal statement
          </label>
          <textarea
            id="goal"
            rows={4}
            value={draft.goal_statement}
            onChange={(event) => updateDraft({ goal_statement: event.target.value })}
            className="setup-input setup-textarea"
            placeholder={WIZARD_STEP_COPY[1]!.fields!.goal_statement!.placeholder}
          />
          <p className="text-xs text-[var(--text-lo)]">{goalCharCount} / 280 characters</p>
          {showRewriteChip ? (
            <button
              type="button"
              onClick={() =>
                updateDraft({ goal_statement: rewriteGoalPresentTense(draft.goal_statement) })
              }
              className="chip-pill"
            >
              Rewrite to present tense
            </button>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-6">
          <div>
            <p className="setup-label mb-2">Timeframe</p>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAME_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setUseCustomDate(false);
                    updateDraft({
                      localization: { ...draft.localization, timeframe: preset },
                    });
                  }}
                  className={`chip-pill ${
                    !useCustomDate && draft.localization.timeframe === preset
                      ? "chip-pill-active"
                      : ""
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <label className="margin-note mt-3 block" htmlFor="timeframe-date">
              Or pick a date (up to 24 months)
            </label>
            <input
              id="timeframe-date"
              type="date"
              min={dateBounds.min}
              max={dateBounds.max}
              value={useCustomDate ? draft.localization.timeframe : ""}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                setUseCustomDate(true);
                updateDraft({
                  localization: { ...draft.localization, timeframe: value },
                });
              }}
              className="setup-input mt-1.5"
            />
          </div>
          <div>
            <p className="setup-label">{WIZARD_STEP_COPY[2]!.fields!.place!.heading}</p>
            <label className="sr-only" htmlFor="place">
              Place
            </label>
            <input
              id="place"
              type="text"
              value={draft.localization.place}
              onChange={(event) =>
                updateDraft({
                  localization: { ...draft.localization, place: event.target.value },
                })
              }
              placeholder={WIZARD_STEP_COPY[2]!.fields!.place!.placeholder}
              className="setup-input"
            />
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          {draft.triangulation.map((value, index) => {
            const fieldKey = `prerequisite${index + 1}` as
              | "prerequisite1"
              | "prerequisite2"
              | "prerequisite3";
            return (
              <div key={index}>
                <p className="setup-label mb-1.5">
                  {WIZARD_STEP_COPY[3]!.fields![fieldKey]!.heading}
                </p>
                <input
                  type="text"
                  value={value}
                  onChange={(event) => {
                    const next = [...draft.triangulation] as [string, string, string];
                    next[index] = event.target.value;
                    updateDraft({ triangulation: next });
                  }}
                  placeholder={WIZARD_STEP_COPY[3]!.fields![fieldKey]!.placeholder}
                  className="setup-input"
                />
              </div>
            );
          })}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-8">
          <div>
            <p className="setup-label">
              {WIZARD_STEP_COPY[4]!.fields!.not_list!.heading}
            </p>
            <FieldExplainer text={WIZARD_STEP_COPY[4]!.fields!.not_list!.description} />
            <ChipInput
              values={draft.not_list}
              onChange={(not_list) => updateDraft({ not_list })}
              minItems={2}
              maxItems={5}
              placeholder={WIZARD_STEP_COPY[4]!.fields!.not_list!.placeholder}
            />
          </div>
          <div>
            <p className="setup-label">
              {WIZARD_STEP_COPY[4]!.fields!.wrong_pulls!.heading}
            </p>
            <FieldExplainer text={WIZARD_STEP_COPY[4]!.fields!.wrong_pulls!.description} />
            <ChipInput
              values={draft.wrong_pulls}
              onChange={(wrong_pulls) => updateDraft({ wrong_pulls })}
              maxItems={3}
              placeholder={WIZARD_STEP_COPY[4]!.fields!.wrong_pulls!.placeholder}
            />
          </div>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="space-y-4">
          <ChipInput
            values={draft.features}
            onChange={(features) => updateDraft({ features })}
            minItems={3}
            maxItems={7}
            placeholder={WIZARD_STEP_COPY[5]!.fields!.features!.placeholder}
            getItemError={(value) =>
              hasConcreteNounToken(value) ? null : FEATURE_LINT_MESSAGE
            }
          />
        </section>
      ) : null}

      {step === 6 ? (
        <section className="space-y-4">
          {draft.sync_actions.map((item, index) => (
            <div key={index} className="space-y-3 rounded-[var(--radius)] border border-[var(--setup-border)] p-4">
              <input
                type="text"
                value={item.action}
                onChange={(event) => {
                  const sync_actions = [...draft.sync_actions];
                  sync_actions[index] = { ...item, action: event.target.value };
                  updateDraft({ sync_actions });
                }}
                placeholder={WIZARD_STEP_COPY[6]!.fields!.action!.placeholder}
                className="setup-input"
              />
              <input
                type="date"
                value={item.deadline ?? ""}
                onChange={(event) => {
                  const sync_actions = [...draft.sync_actions];
                  sync_actions[index] = {
                    ...item,
                    deadline: event.target.value || undefined,
                  };
                  updateDraft({ sync_actions });
                }}
                title={WIZARD_STEP_COPY[6]!.fields!.deadline!.placeholder}
                className="setup-input"
              />
              {draft.sync_actions.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    updateDraft({
                      sync_actions: draft.sync_actions.filter((_, i) => i !== index),
                    })
                  }
                  className="btn-link text-error"
                >
                  Remove action
                </button>
              ) : null}
            </div>
          ))}
          {draft.sync_actions.length < 5 ? (
            <button
              type="button"
              onClick={() =>
                updateDraft({
                  sync_actions: [...draft.sync_actions, { action: "" }],
                })
              }
              className="btn-link"
            >
              Add action
            </button>
          ) : null}
        </section>
      ) : null}

      {step === 7 ? (
        <section className="space-y-6">
          <fieldset>
            <legend className="setup-label">Session length</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {LENGTHS.map((length) => {
                const selected = draft.session.duration_min === length;
                return (
                  <button
                    key={length}
                    type="button"
                    onClick={() => setLength(length)}
                    className={`chip-pill ${selected ? "chip-pill-active" : ""}`}
                  >
                    {length} min
                  </button>
                );
              })}
            </div>
            <p className="margin-note mt-2">
              {lengthMin <= 15
                ? "Shorter sessions use a focused subset of the protocol steps."
                : "30 and 45 run the full 12-step arc; 45 goes deeper, not wider."}
            </p>
          </fieldset>

          <fieldset>
            <legend className="setup-label">Entrainment mode</legend>
            <div className="mt-3 flex flex-wrap gap-4 text-[var(--text-hi)]">
              {(["isochronic", "binaural"] as const).map((mode) => (
                <ChoiceControl
                  key={mode}
                  name="entrainment_mode"
                  checked={draft.session.entrainment_mode === mode}
                  onChange={() =>
                    updateDraft({
                      session: { ...draft.session, entrainment_mode: mode },
                    })
                  }
                >
                  {mode}
                </ChoiceControl>
              ))}
            </div>
          </fieldset>

          <div>
            <p className="setup-label mb-3">Senses emphasis (min 2)</p>
            <div className="flex flex-wrap gap-2">
              {SENSE_OPTIONS.map((sense) => {
                const selected = draft.session.senses_emphasis.includes(sense);
                return (
                  <button
                    key={sense}
                    type="button"
                    onClick={() => toggleSense(sense)}
                    className={`chip-pill ${selected ? "chip-pill-active" : ""}`}
                  >
                    {sense}
                  </button>
                );
              })}
            </div>
          </div>

          <fieldset>
            <legend className="setup-label">Voice</legend>
            <div className="mt-3 space-y-2 text-[var(--text-hi)]">
              {stockVoices.length === 0 ? (
                <p className="margin-note">No stock voices configured.</p>
              ) : (
                stockVoices.map((voice) => (
                  <ChoiceControl
                    key={voice.id}
                    name="voice"
                    checked={draft.voice_profile_id === null && draft.stock_voice_id === voice.id}
                    onChange={() => selectStockVoice(voice.id)}
                  >
                    {voice.label}
                    <span className="ml-2 text-sm text-[var(--text-lo)]">({stockCost} min)</span>
                  </ChoiceControl>
                ))
              )}
              {readyVoiceProfileId ? (
                <ChoiceControl
                  name="voice"
                  checked={draft.voice_profile_id === readyVoiceProfileId}
                  onChange={selectOwnVoice}
                >
                  My voice
                  <span className="ml-2 text-sm text-[var(--text-lo)]">({ownCost} min)</span>
                </ChoiceControl>
              ) : voiceStatus === "pending" ? (
                <p className="margin-note">
                  Your voice clone is still processing.{" "}
                  <Link href="/voice" className="btn-link">
                    Check status
                  </Link>{" "}
                  or refresh this page when it is ready.
                </p>
              ) : voiceStatus === "failed" ? (
                <p className="margin-note">
                  Your voice clone did not finish.{" "}
                  <Link href="/voice" className="btn-link">
                    Retry or re-record
                  </Link>{" "}
                  to unlock own-voice.
                </p>
              ) : (
                <p className="margin-note">
                  <Link href="/voice" className="btn-link">
                    Record your voice
                  </Link>{" "}
                  to unlock the own-voice option.
                </p>
              )}
            </div>
          </fieldset>

          <div className="space-y-2 rounded border border-[var(--setup-border)] bg-[var(--setup-panel)] p-4 text-sm">
            <p className="text-[var(--text-hi)]">
              This session uses{" "}
              <span className="font-medium tabular-nums">{sessionCost} minutes</span> (
              {isOwnVoice ? "your own voice" : "stock voice"}).
            </p>
            <p className="text-[var(--text-mid)]">
              Balance:{" "}
              <span className="tabular-nums">{minutesBalance.subscription}</span> subscription +{" "}
              <span className="tabular-nums">{minutesBalance.topup}</span> top-up (
              <span className="tabular-nums">{balanceTotal}</span> total). Resets{" "}
              {formatResetDate(minutesBalance.resetAt)}.
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="btn-link"
            >
              {showAdvanced ? "Hide" : "Show"} advanced
            </button>
            {showAdvanced ? (
              <div className="mt-3">
                <label className="setup-label" htmlFor="aos_layer">
                  AOS layer (optional)
                </label>
                <select
                  id="aos_layer"
                  value={draft.session.aos_layer ?? ""}
                  onChange={(event) =>
                    updateDraft({
                      session: {
                        ...draft.session,
                        aos_layer:
                          (event.target.value as WizardDraft["session"]["aos_layer"]) ||
                          undefined,
                      },
                    })
                  }
                  className="setup-input mt-1.5"
                >
                  <option value="">None</option>
                  <option value="ego">ego</option>
                  <option value="self">self</option>
                  <option value="persona">persona</option>
                  <option value="shadow">shadow</option>
                </select>
              </div>
            ) : null}
          </div>

          {insufficient ? (
            <div className="space-y-3 rounded border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-4">
              <p className="text-warning">
                Not enough minutes ({insufficient.available} available, {insufficient.needed}{" "}
                needed).
              </p>
              <div className="flex flex-wrap gap-3">
                {insufficient.canUseStock && defaultStockId ? (
                  <button
                    type="button"
                    className="btn-clay"
                    onClick={() => selectStockVoice(defaultStockId)}
                  >
                    Switch to a stock voice to generate now
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={checkoutPending}
                  onClick={() => void startTopupCheckout()}
                >
                  {checkoutPending
                    ? "Redirecting…"
                    : `Buy ${TOPUP_MINUTES.minutes} more minutes ($${TOPUP_MINUTES.priceUsd})`}
                </button>
              </div>
            </div>
          ) : null}
          {submitError ? <p className="text-error">{submitError}</p> : null}
        </section>
      ) : null}

      {stepError ? <p className="text-error">{stepError}</p> : null}

      <div className="flex items-center justify-between border-t border-[var(--setup-border)] pt-6">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 1 || pending}
          className="btn-ghost"
        >
          Back
        </button>
        {step < STEP_COUNT ? (
          <button type="button" onClick={goNext} className="btn-clay">
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="btn-clay"
          >
            {pending ? "Starting…" : "Generate script"}
          </button>
        )}
      </div>
    </div>
  );
}
