# PhaseShift

Reality-engineering meditation app — guided self-hypnosis with per-segment TTS, client-side entrainment layering, and iterative triangulation loops.

**Phase 0** is scaffolding and contracts only. See the full execution plan in [`docs/blueprint.md`](docs/blueprint.md).

## Stack

- **Runtime:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod
- **Styling:** Tailwind CSS 4
- **Database (contracts only):** Supabase SQL migrations in `supabase/migrations/` — not applied in Phase 0
- **Tests:** Vitest
- **Package manager:** pnpm (Node 22 LTS via `.nvmrc`)

## Prerequisites

- Node.js ≥ 22 (`nvm use`)
- pnpm 9+

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (unit tests) |
| `pnpm format` | Prettier write |

## Repo map

```
src/
  app/                    Next.js App Router (placeholder UI)
  lib/
    contracts/            Zod schemas: intake (§2.4), manifest (§2.1)
    compiler/             Compiler system prompt v1 (§2.2)
    schedule/             Post-synthesis phase reconciliation (§2.3)
    tts/                  TTSProvider interface, dedupe key (A1), mock provider
    costs.ts              Phase budgets, pacing, credit constants (§2.3, §5)
    fixtures/             Golden intake JSON for tests
supabase/
  migrations/             DDL, RLS, spend_credits (not applied in Phase 0)
docs/
  blueprint.md            Sole source of truth for product architecture
AMBIGUITIES.md            Unresolved blueprint decisions + proposed resolutions
```

## Roadmap

MVP cutline and phased delivery are defined in **[`docs/blueprint.md` §6](docs/blueprint.md)**:

- **v0** — Guarded core: 40-min guided mode, voice clone, foreground playback
- **v0.5** — Recognition log, re-triangulate hash-diff regen, duration presets
- **v1** — Offline render, Practitioner tier, credit ledger UX
- **v1.5+** — Delta research mode

## Environment

Copy `.env.example` to `.env.local` when integrating external services in later phases. Phase 0 does not call any external APIs.

## License

Private — all rights reserved.
