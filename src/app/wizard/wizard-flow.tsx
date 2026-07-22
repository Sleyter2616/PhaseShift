"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChoiceControl } from "@/components/choice-control";
import {
  availableMinutes,
  minutesCost,
  SESSION_LENGTH_MINUTES,
  TOPUP_MINUTES,
} from "@/lib/billing/minutes";
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
  type WizardDraft,
} from "@/lib/contracts/wizard";
import { WIZARD_STEP_COPY } from "@/lib/contracts/wizard-copy";
import type { StockVoiceOption } from "@/lib/voice/stock-voices";
import { ChipInput } from "./chip-input";
import { FieldExplainer, StepExplainer } from "./step-explainer";

const STEP_COUNT = 7;
const FEATURE_LINT_MESSAGE =
  "Must include a concrete noun (observability lint)";

interface WizardFlowProps {
  readyVoiceProfileId: string | null;
  stockVoices: StockVoiceOption[];
  minutesBalance: {
    subscription: number;
    topup: number;
    resetAt: string | null;
  };
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

export function WizardFlow({
  readyVoiceProfileId,
  stockVoices,
  minutesBalance,
}: WizardFlowProps) {
  const router = useRouter();
  const defaultStockId = stockVoices[0]?.id ?? null;
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>({
    ...EMPTY_WIZARD_DRAFT,
    stock_voice_id: defaultStockId,
  });
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<InsufficientPayload | null>(null);
  const [pending, setPending] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomDate, setUseCustomDate] = useState(false);

  const showRewriteChip = PRESENT_TENSE_GOAL_PATTERN.test(draft.goal_statement);
  const goalCharCount = draft.goal_statement.length;
  const isOwnVoice = draft.voice_profile_id != null;
  const sessionCost = minutesCost(SESSION_LENGTH_MINUTES, isOwnVoice);
  const balanceTotal = availableMinutes({
    subscription: minutesBalance.subscription,
    topup: minutesBalance.topup,
  });
  const stockCost = minutesCost(SESSION_LENGTH_MINUTES, false);
  const ownCost = minutesCost(SESSION_LENGTH_MINUTES, true);

  const dateBounds = useMemo(
    () => ({ min: todayIsoDate(), max: maxTimeframeIsoDate() }),
    [],
  );

  function updateDraft(patch: Partial<WizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStepError(null);
    setInsufficient(null);
  }

  function selectStockVoice(voiceId: string) {
    updateDraft({ voice_profile_id: null, stock_voice_id: voiceId });
  }

  function selectOwnVoice() {
    if (!readyVoiceProfileId) return;
    updateDraft({
      voice_profile_id: readyVoiceProfileId,
      stock_voice_id: draft.stock_voice_id ?? defaultStockId,
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
          <div>
            <p className="setup-label">Duration</p>
            <p className="setup-input mt-1.5 cursor-default opacity-90">
              45 minutes (locked) — more lengths coming in v0.5-2
            </p>
          </div>

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
