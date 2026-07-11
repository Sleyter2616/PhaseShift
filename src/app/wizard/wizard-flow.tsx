"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { ChipInput } from "./chip-input";
import { FieldExplainer, StepExplainer } from "./step-explainer";

const STEP_COUNT = 7;
const FEATURE_LINT_MESSAGE =
  "Must include a concrete noun (observability lint)";

interface WizardFlowProps {
  readyVoiceProfileId: string | null;
  stockVoiceLabel: string;
}

export function WizardFlow({ readyVoiceProfileId, stockVoiceLabel }: WizardFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_WIZARD_DRAFT);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [pending, setPending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useCustomDate, setUseCustomDate] = useState(false);

  const showRewriteChip = PRESENT_TENSE_GOAL_PATTERN.test(draft.goal_statement);
  const goalCharCount = draft.goal_statement.length;

  const dateBounds = useMemo(
    () => ({ min: todayIsoDate(), max: maxTimeframeIsoDate() }),
    [],
  );

  function updateDraft(patch: Partial<WizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStepError(null);
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

  async function handleSubmit() {
    for (let s = 1; s <= STEP_COUNT; s += 1) {
      const error = validateWizardStep(s, draft);
      if (error) {
        setStep(s);
        setStepError(error);
        return;
      }
    }

    setPending(true);
    setSubmitError(null);
    setInsufficientCredits(false);

    try {
      const intake = draftToIntake(draft);
      const body = {
        ...intake,
        ...(draft.voice_profile_id ? { voice_profile_id: draft.voice_profile_id } : {}),
      };

      const response = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload: { script_id?: string; error?: string | object } = await response
        .json()
        .catch(() => ({}));

      if (response.status === 202 && payload.script_id) {
        router.push(`/dev/scripts/${payload.script_id}`);
        return;
      }

      if (response.status === 402) {
        setInsufficientCredits(true);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New script</h1>
        <p className="text-sm text-neutral-500">
          Step {step} of {STEP_COUNT}
        </p>
      </div>

      {step === 1 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[1]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[1]!.description} />
          <label className="sr-only" htmlFor="goal">
            Goal statement
          </label>
          <textarea
            id="goal"
            rows={4}
            value={draft.goal_statement}
            onChange={(event) => updateDraft({ goal_statement: event.target.value })}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            placeholder={WIZARD_STEP_COPY[1]!.fields!.goal_statement!.placeholder}
          />
          <p className="text-xs text-neutral-500">{goalCharCount} / 280 characters</p>
          {showRewriteChip ? (
            <button
              type="button"
              onClick={() =>
                updateDraft({ goal_statement: rewriteGoalPresentTense(draft.goal_statement) })
              }
              className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-sm text-amber-900"
            >
              Rewrite to present tense
            </button>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[2]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[2]!.description} />
          <div>
            <p className="mb-2 text-sm font-medium">Timeframe</p>
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
                  className={`rounded-full border px-3 py-1 text-sm ${
                    !useCustomDate && draft.localization.timeframe === preset
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs text-neutral-600" htmlFor="timeframe-date">
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
              className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="text-sm font-medium">{WIZARD_STEP_COPY[2]!.fields!.place!.heading}</p>
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
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[3]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[3]!.description} />
          {draft.triangulation.map((value, index) => {
            const fieldKey = `prerequisite${index + 1}` as
              | "prerequisite1"
              | "prerequisite2"
              | "prerequisite3";
            return (
              <input
                key={index}
                type="text"
                value={value}
                onChange={(event) => {
                  const next = [...draft.triangulation] as [string, string, string];
                  next[index] = event.target.value;
                  updateDraft({ triangulation: next });
                }}
                placeholder={WIZARD_STEP_COPY[3]!.fields![fieldKey]!.placeholder}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            );
          })}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-6">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[4]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[4]!.description} />
          <div>
            <p className="mb-1 text-sm font-medium">
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
            <p className="mb-1 text-sm font-medium">
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
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[5]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[5]!.description} />
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
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[6]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[6]!.description} />
          {draft.sync_actions.map((item, index) => (
            <div key={index} className="space-y-2 rounded border border-neutral-200 p-3">
              <input
                type="text"
                value={item.action}
                onChange={(event) => {
                  const sync_actions = [...draft.sync_actions];
                  sync_actions[index] = { ...item, action: event.target.value };
                  updateDraft({ sync_actions });
                }}
                placeholder={WIZARD_STEP_COPY[6]!.fields!.action!.placeholder}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
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
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              {draft.sync_actions.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    updateDraft({
                      sync_actions: draft.sync_actions.filter((_, i) => i !== index),
                    })
                  }
                  className="text-xs text-red-700"
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
              className="text-sm text-neutral-700 underline"
            >
              Add action
            </button>
          ) : null}
        </section>
      ) : null}

      {step === 7 ? (
        <section className="space-y-5">
          <h2 className="text-sm font-medium">{WIZARD_STEP_COPY[7]!.heading}</h2>
          <StepExplainer text={WIZARD_STEP_COPY[7]!.description} />
          <div>
            <p className="text-sm font-medium">Duration</p>
            <p className="mt-1 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
              40 minutes (locked) — more lengths coming in v0.5
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Entrainment mode</legend>
            <div className="mt-2 flex gap-4 text-sm">
              {(["isochronic", "binaural"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="entrainment_mode"
                    checked={draft.session.entrainment_mode === mode}
                    onChange={() =>
                      updateDraft({
                        session: { ...draft.session, entrainment_mode: mode },
                      })
                    }
                  />
                  {mode}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium">Senses emphasis (min 2)</p>
            <div className="flex flex-wrap gap-2">
              {SENSE_OPTIONS.map((sense) => {
                const selected = draft.session.senses_emphasis.includes(sense);
                return (
                  <button
                    key={sense}
                    type="button"
                    onClick={() => toggleSense(sense)}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      selected
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300"
                    }`}
                  >
                    {sense}
                  </button>
                );
              })}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Voice</legend>
            <div className="mt-2 space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="voice"
                  checked={draft.voice_profile_id === null}
                  onChange={() => updateDraft({ voice_profile_id: null })}
                />
                {stockVoiceLabel}
              </label>
              {readyVoiceProfileId ? (
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="voice"
                    checked={draft.voice_profile_id === readyVoiceProfileId}
                    onChange={() => updateDraft({ voice_profile_id: readyVoiceProfileId })}
                  />
                  My voice
                </label>
              ) : (
                <p className="text-xs text-neutral-500">
                  <Link href="/voice" className="underline">
                    Record your voice
                  </Link>{" "}
                  to unlock the own-voice option.
                </p>
              )}
            </div>
          </fieldset>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="text-sm text-neutral-700 underline"
            >
              {showAdvanced ? "Hide" : "Show"} advanced
            </button>
            {showAdvanced ? (
              <div className="mt-2">
                <label className="block text-sm font-medium" htmlFor="aos_layer">
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
                  className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
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

          {insufficientCredits ? (
            <p className="text-sm text-amber-700">Insufficient credits for generation.</p>
          ) : null}
          {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
        </section>
      ) : null}

      {stepError ? <p className="text-sm text-red-700">{stepError}</p> : null}

      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 1 || pending}
          className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          Back
        </button>
        {step < STEP_COUNT ? (
          <button
            type="button"
            onClick={goNext}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Starting…" : "Generate script"}
          </button>
        )}
      </div>
    </div>
  );
}
