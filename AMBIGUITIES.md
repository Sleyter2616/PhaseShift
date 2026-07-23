# PhaseShift — open ambiguities

Resolved Phase 0–10 and v0.5-1 items have been pruned. Keep only decisions that are still open or quality risks that are not yet product-closed.

---

## §1.2B — Regen economics and byte-identical segment assumption (D8)

**Ambiguity:** Re-triangulation assumes ~40% regen cost because unchanged segments hash-match. LLM recompilation does not guarantee byte-identical text for unchanged theta steps.

**Proposed resolution:** Compiler **regen mode** that accepts the prior manifest and copy-through unchanged steps verbatim (edited steps only recompiled). Idempotent re-synthesis (`resynth-check.ts`) proves cache replay; cross-compile stability is still deferred.

**Status:** Open (scheduled with deeper v0.5 regen work).

---

## §2.3 — Gamma long-silence quality risk

**Ambiguity:** Underwritten gamma text plus pause stretching can produce long gaps in the high-energy exit phase (quality smell, not a hard failure).

**Proposed resolution:** First-listen review; candidates include per-phase `scheduled_pause_after_ms` caps or tighter skeleton-owned pause slots for gamma counted sequences.

**Status:** Open (quality).

---

## §2.4 — `aos_layer` collected but lightly consumed

**Ambiguity:** Wizard / intake collect optional `aos_layer` (ego/self/persona/shadow) and persist it on `goals.aos_layer`. Prompt v2.0 lists it in INPUT but does not yet drive step-level semantics.

**Proposed resolution:** Define aos-layer content rules in a future prompt version (immutable bump); until then treat as optional metadata.

**Status:** Open.

---

## §2.4 — Features “concrete noun” lint is a heuristic

**Ambiguity:** Server Zod lint uses a lexicon/heuristic, not true NLP.

**Proposed resolution:** Keep server lint as a backstop; improve wizard examples / on-device hints so users supply observable features without fighting the heuristic.

**Status:** Open (product copy / UX); heuristic is intentional for now.

---

## §5 — Multi-provider TTS fidelity gate

**Ambiguity:** Default voice path is ElevenLabs (Flash / Multilingual v2). Cross-provider bake-off and provider-conditional COGS tables were sketched in Phase 0.1 but not product-locked.

**Proposed resolution:** Run the blind A/B harness before changing default `TTS_PROVIDER` or own-voice model policy. Minutes billing already meters by session length × voice multiplier, independent of character-credit math.

**Status:** Open (vendor / fidelity), not blocking generation.

---

## Wizard step selection UI (v0.5-2)

**Ambiguity:** API accepts `duration_min` / `length_min`, contiguous `middle_start` + `middle_count`, and `posture` with server validation via `skeleton.ts`. Wizard UI still locks length presentation and does not yet expose middle-step picking.

**Proposed resolution:** v0.5-2 wizard surfaces the length ladder and contiguous middle-block picker; defaults remain 45 / full arc / sitting.

**Status:** Open (scheduled UI).
