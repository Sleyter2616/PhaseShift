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
