# PhaseShift — Phase 0 Ambiguities

Recorded ambiguities from `docs/blueprint.md` where the Phase 0 prompt or blueprint left decisions unspecified. Each entry states the section reference and a proposed resolution. **None of these resolutions are implemented** unless explicitly called out elsewhere in Phase 0 deliverables.

---

## §1.2B vs §1.4 — `dedupe_key` includes `asset_scope`

**Ambiguity:** §1.2B defines `dedupe_key = sha256(elevenlabs_voice_id | model_id | voice_settings_json | segment_text)` without `asset_scope`. §1.4 DDL comment says `sha256(scope|voice|model|settings|text)`.

**Resolution (Amendments A1 + A3, applied in code):** Include `asset_scope` and `provider` as pipe-delimited fields. Phase 0.1 `src/lib/tts/dedupe.ts` implements A3 (`provider|asset_scope|voice_id|model_id|settings|text`).

---

## §1.4 — `script_segments` RLS via join vs denormalized `user_id`

**Ambiguity:** RLS strategy says "script_segments (via join or denormalized user_id)" without choosing one.

**Resolution (Amendment A2, applied in migration):** Add `user_id uuid not null references profiles(id)` on `script_segments` with an index; use a flat `user_id = auth.uid()` owner policy.

---

## §2.4 — Intake field name `wrong_pulls` vs DDL `wrong_direction_pulls`

**Ambiguity:** Intake wizard table (§2.4 screen 4) labels the field `wrong_pulls`; `goal_versions` DDL stores `wrong_direction_pulls`.

**Proposed resolution:** Client/API intake JSON uses `wrong_pulls`; persistence layer maps to `wrong_direction_pulls` at insert time (Phase 1).

---

## §2.4 — Features "concrete noun" observability lint

**Ambiguity:** Blueprint requires each feature to "contain a concrete noun" but does not define an algorithm.

**Heuristic implemented in Phase 0 (for Zod refinement only; not a product decision):** Tokenize on whitespace; a feature passes if any token (a) matches `/\b\d+([.,]\d+)?%?\b/` (measurable quantity), OR (b) appears in `CONCRETE_NOUN_LEXICON` (curated observability anchors: email, paycheck, meeting, etc.), OR (c) has length ≥ 5, is not in `ABSTRACT_DENYLIST`, and does not end with `ness` or `tion`. Tokens under 3 characters are ignored.

**Proposed product resolution:** Replace heuristic with a lightweight on-device NLP pass or human-readable examples in the wizard copy; keep server-side lint as a backstop.

---

## §2.4 — Full intake object shape beyond the wizard table

**Ambiguity:** §2.4 lists per-screen fields; compiler prompt INPUT (§2.2) also references `senses_emphasis`, `aos_layer`, `phase_budget_sec`, `entrainment_plan`, and per-phase `pacing` inside `session`, which are not enumerated in the wizard table.

**Proposed resolution:** Phase 0 `intake.ts` models wizard fields plus `session` prefs (`duration_min`, `entrainment_mode`, `senses_emphasis`, optional `aos_layer`). Derived fields (`phase_budget_sec`, `entrainment_plan`, pacing) are computed server-side from `duration_min` and `src/lib/costs.ts` in Phase 1, not collected in the wizard.

---

## §2.1 — Manifest `title` on segments

**Ambiguity:** Example JSON includes `title` on segments; Zod contract in Phase 0 prompt lists segment fields without explicitly marking `title` optional or required.

**Proposed resolution:** Treat `title` as optional string on segments; compiler may omit for non-theta segments.

---

## §2.3 — Reconciliation when `segments.length === 1` and `rawPauseMs === 0`

**Ambiguity:** Even-gap fallback uses `remainingMs / Math.max(1, segments.length - 1)`, which yields `remainingMs / 1` for a single-segment phase, assigning that full remainder as `scheduled_pause_after_ms` on the only segment — but the loop also sets the last segment to `0`.

**Proposed resolution:** Single-segment phases should always get `scheduled_pause_after_ms = 0` (last-segment rule wins). Phase 0 `reconcile.ts` follows the blueprint loop literally; confirm in Phase 1 integration tests.

---

## §1.4 — `profiles` INSERT policy on signup

**Ambiguity:** Blueprint shows owner CRUD for profiles but does not specify whether profile rows are created by a trigger on `auth.users` or by client INSERT.

**Proposed resolution:** Supabase `auth.users` trigger creates `profiles` row; client UPDATE only for `display_name`. No client INSERT policy needed if trigger uses service role / security definer.

---

## §5 — Credit unit vs character count naming

**Ambiguity:** §5 uses "13,500 credits" for a Flash generation while §2.3 cites "~27,000 billable characters" — the numeric coincidence suggests credits may be 1:1 with characters for Flash, but this is not stated explicitly.

**Proposed resolution:** Document in Phase 1 pricing module that 1 generation credit = up to 30k billable chars on Flash; v2 costs 2 credits. Constants in `costs.ts` preserve blueprint numbers as-is pending fidelity gate.

---

## §5 — Provider-conditional pricing and multi-provider fidelity gate (Phase 0.1)

**Ambiguity:** §5 cost tables and the Flash-vs-Multilingual v2 fidelity gate assume a single vendor (ElevenLabs). Phase 0.1 introduces `tts_provider` enum and `PROVIDER_PRICING_USD_PER_1M_CHARS` with indicative per-provider ranges.

**Proposed resolution:** §5 pricing tables become provider-conditional at Phase 2 implementation time. The fidelity gate expands to a multi-provider bake-off: same 90s voice sample, blind A/B across shortlisted providers (at minimum ElevenLabs Flash, ElevenLabs v2, and one cost leader), rating voice similarity, naturalness, and daily-usability before locking default `provider` on `scripts` and credit burn rates.

---

## §1.2B — Regen economics and byte-identical segment assumption (D8, Phase 1)

**Ambiguity:** §1.2B assumes re-triangulation regen costs ~40% because unchanged segments hash-match and reuse `audio_files`. LLM recompilation does not guarantee byte-identical text for unchanged theta steps — wording drift breaks dedupe even when semantics are preserved.

**Proposed resolution:** Introduce a compiler **regen mode** in v0.5 that accepts the prior manifest and emits unchanged steps verbatim (copy-through), with only edited steps recompiled. Phase 1 validates dedupe via idempotent re-synthesis (`resynth-check.ts`: 0 new `audio_files` rows on cache replay), not cross-compile stability.

---

## §2.2 — System prompt references schema never provided (erratum, Phase 1.2)

**Ambiguity:** Blueprint §2.2 tells the model to emit JSON "matching the provided schema" but the v1 system prompt never embeds the §2.1 manifest contract. Models invent non-conforming shapes (`segment_id`, nested `meta.session`, etc.).

**Resolution (applied in `prompt.v1.1`):** `COMPILER_PROMPT_V1_1` appends an explicit `## OUTPUT SCHEMA (exact, mandatory)` section before SELF-CHECK, mirroring the §2.1 Zod contract field names. `prompt.v1.ts` remains immutable; active `PROMPT_VERSION` is `v1.1`.

---

## §2.2 / §2.3 / §6 — Short-preset word budgets vs. verbatim content (D9, Phase 1.4)

**Ambiguity:** §2.2 step weights × per-segment word budgets under-provision theta steps on short presets (20 min): mandated verbatim intake strings (goal, localization, triangulation, features, sync_actions, not_list) do not scale down with duration, yet step weights still require all twelve theta steps. Hard word ceilings and exact `target_duration_sec` sums are jointly unsatisfiable on short presets.

**Resolution (applied in Phase 1.4):** Word-budget checks move from hard validation to advisory `warnings` on `validateManifest`; post-synthesis reconciliation (§2.3, D9) is the duration authority. **v0 ships 40-minute sessions only** (§6); short-preset support is deferred.

**Scheduled resolution (compiler v2):** Server-owned segment skeleton — server computes all `target_duration_sec` values from the step-weight table; the model emits text per slot only. This also enables the D8 regen mode (copy-through unchanged steps verbatim).

---

## §2.3 — Trailing silence dropped when segments carry no raw pause (Phase 1.5 → fixed Phase 2.1, D13)

**Ambiguity:** Reconciliation (§2.3) fallback distributed phase remainder across `segments.length - 1` gaps, zeroing the last segment's pause. Phases whose segments all carry `pause_after_ms = 0` therefore dropped trailing silence (observed on beta: ~75s voiced vs 120s budget, 0ms scheduled pause on the last segment).

**Resolution (applied in Phase 2.1, D13):** Fallback branch now distributes `remainingMs` evenly across **all** segments including the last; rounding drift lands on the final segment so each phase closes exactly. `scripts/re-reconcile.ts` rewrites pause scheduling on existing rows without re-synthesis.

---

## §2.3 — Gamma long-silence quality risk (Phase 2.1)

**Ambiguity:** Underwritten gamma text combined with pause stretching can produce ~2-minute gaps in the high-energy exit phase (quality smell, not a hard failure).

**Proposed resolution:** Defer to Phase 3 first-listen review. Candidates if unacceptable: per-phase `scheduled_pause_after_ms` caps, or the v0.5 server-owned segment skeleton with pre-allocated pause slots.

---

## §2.4 — `aos_layer` collected but not consumed by compiler (Phase 4b.1)

**Ambiguity:** Wizard step 7 collects optional `aos_layer` (ego/self/persona/shadow) and persists it on `goals.aos_layer`, but compiler prompt ≤v1.3 does not reference it in INPUT or step instructions.

**Proposed resolution:** `aos_layer` is collected but unconsumed by compiler ≤v1.3; semantics scheduled with the v0.5 prompt.

---

## §2.2 — Raw vs normalized compiler input and dedupe identity (Phase 4.5.0)

**Ambiguity:** Intake strings are stored raw on `goals` / `goal_versions` for display, but the compiler must quote speech-safe forms (currency, dates, counts, clock times). It is unclear whether `content_hash` / `dedupe_key` should hash raw intake, normalized compiler input, or compiled segment text.

**Resolution (applied in Phase 4.5.0):** `buildCompilerInput()` persists **both** shapes on `scripts.compiler_input`:
- `raw` — exact wizard strings (goal, localization, triangulation, not_list, features, sync_actions) for display and audit.
- Top-level string fields — deterministic `toSpeakableText()` output fed to the LLM (`compilerInputForModel()` omits `raw` from the user message).

**Dedupe key uses compiled segment text only:** `content_hash` / `audio_files.dedupe_key` hash the **post-compile segment `text` after output `toSpeakableText()` normalization** (plus voice/model/settings), never raw intake and never `compiler_input.raw`. Normalization changes segment text and therefore content_hash — new speakable text correctly produces new audio. Recompilation that changes wording breaks dedupe even when semantics match (see §1.2B D8). Verbatim QA against segment text should use the **normalized** compiler-input strings, not `goal_versions` raw columns.
