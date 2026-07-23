# AGENTS.md — operating rules for coding agents

PhaseShift agent conventions. Follow these unless the user overrides them for a specific task.

## Phase naming

| Series | Meaning |
| ------ | ------- |
| **v0 / Phase 0–10** | Initial build (scaffold → generation → TTS → playback → billing → ship → Sentry). **COMPLETE.** |
| **v0.5-N** | Customizable Protocol release (current). Starts with server-owned compiler skeleton + variable lengths (`v0.5-1`). |

Do not reopen closed Phase 0–10 work as if it were unfinished unless the user asks for a fix.

## Migrations

- Schema changes live in `supabase/migrations/` **only** (numbered SQL files).
- The **conductor** applies migrations via the Supabase connector.
- **Never** apply schema from an agent session (no `supabase db push`, no Dashboard SQL edits, no MCP `apply_migration` unless the user explicitly asks the conductor path).
- Agents may **author** migration files; they do not run them against shared projects.

## Money code (minutes / Stripe)

Any change to minutes balances, `minutes_ledger`, or Stripe fulfillment must include:

1. **`FOR UPDATE` row locks** on `profiles` (or equivalent) before mutate.
2. **Ledger rows** for every grant / spend / refund / reset (`minutes_ledger`).
3. **Service-role-only grants** on grant/refund/admin functions where the SQL already requires them; do not widen to `anon` / client write policies.
4. A **concurrency proof script** (see `scripts/minutes-concurrency.ts`) that still passes after the change.

Generation billing is the **two-pool minutes** model (`subscription_minutes` + `topup_minutes`), not credits. Credits tables/functions may still exist but are **retired from the generation path**.

## Compiler prompts

- Prompts are **immutable once versioned**.
- Ship a new file (`src/lib/compiler/prompt.vN+1.ts`); never edit a shipped `prompt.vN.ts`.
- Current default: **v2.0** (consumes server skeleton). Fallback: set `COMPILER_PROMPT_VERSION=v1.4`.
- Phase budgets, selected steps, and counted-sequence timings are computed in `src/lib/compiler/skeleton.ts` — do not move that authority into the model.

## Tests and CI

- `pnpm typecheck && pnpm lint && pnpm test` must stay green.
- Unit tests must pass **offline** (no network, no live LLM/TTS calls in CI).
- Use `TTS_PROVIDER=selfhost` and mocked Anthropic clients in tests.

## Secrets

- Never commit secrets (`.env`, API keys, service-role keys, Stripe live keys).
- Configuration via env vars only (see `.env.example`).

## Docs vs code

- When behavior changes land, keep `docs/blueprint.md`, `README.md`, and `AMBIGUITIES.md` aligned in a follow-up (or same PR if the user asks).
- Prefer documenting **current reality** over aspirational roadmap copy.
