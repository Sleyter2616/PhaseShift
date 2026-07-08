# PhaseShift

Reality-engineering meditation app — guided self-hypnosis with per-segment TTS, client-side entrainment layering, and iterative triangulation loops.

See the full execution plan in [`docs/blueprint.md`](docs/blueprint.md).

## Stack

- **Runtime:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod
- **Jobs:** Inngest (generation pipeline)
- **Database:** Supabase (Postgres + Storage)
- **LLM:** Anthropic Claude (compiler); **TTS:** MockTTSProvider in Phase 1 (zero spend)
- **Package manager:** pnpm (Node 22 LTS via `.nvmrc`)

## Prerequisites

- Node.js ≥ 22 (`nvm use`)
- pnpm 9+
- Hosted Supabase dev project with migrations `0001`–`0004` applied
- [Anthropic API key](https://console.anthropic.com/)
- [Inngest dev server](https://www.inngest.com/docs/local-development)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB + storage writes |
| `ANTHROPIC_API_KEY` | Claude compiler |
| `LLM_MODEL` | Default `claude-sonnet-4-6` |
| `DEV_USER_ID` | From seed script (Phase 1 dev auth) |
| `DEV_API_SECRET` | Shared secret for `x-dev-secret` header |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud (optional for local dev) |

## Local development (Phase 1)

### 1. Install and test

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

### 2. Seed dev user

```bash
pnpm tsx scripts/seed-dev-user.ts
```

Copy the printed `DEV_USER_ID` into `.env.local`. Set `DEV_API_SECRET` to any long random string.

### 3. Start services (two terminals)

```bash
# Terminal A — Next.js
pnpm dev

# Terminal B — Inngest dev server
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

### 4. Request generation

```bash
curl -s -X POST http://localhost:3000/api/scripts \
  -H "Content-Type: application/json" \
  -H "x-dev-secret: $DEV_API_SECRET" \
  -d "$(pnpm tsx -e "import { intake40Min } from './src/lib/fixtures/intake.ts'; process.stdout.write(JSON.stringify(intake40Min))")"
```

v0 ships the **40-minute** golden path (`intake40Min` in `src/lib/fixtures/intake.ts`). The 20-minute fixture remains for unit tests only.

Expect `202` with `{ "script_id": "..." }`.

### 5. Watch progress

Open `http://localhost:3000/dev/scripts/<script_id>` (polls every 2s).

### 6. Verify

```bash
pnpm tsx scripts/verify-phase1.ts <script_id>
pnpm tsx scripts/resynth-check.ts <script_id>
```

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Next.js dev server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm tsx scripts/seed-dev-user.ts` | Create dev auth user + profile |
| `pnpm tsx scripts/verify-phase1.ts <id>` | Phase 1 acceptance checks |
| `pnpm tsx scripts/resynth-check.ts <id>` | Dedupe idempotency check |

## Repo map

```
src/
  app/api/scripts/        POST intake → enqueue generation
  app/api/inngest/        Inngest serve endpoint
  app/dev/scripts/[id]/   Dev status page (poll)
  inngest/functions/      generate-script, synthesize-segment
  lib/compiler/           Claude compile + retry
  lib/contracts/          intake + manifest Zod
  lib/pipeline/           segment derivation, dedupe, reconcile
  lib/session/derive.ts   intake → compiler INPUT session block
scripts/                  seed, verify, resynth-check
supabase/migrations/      0001–0004 (0004 via connector for Phase 1)
```

## Roadmap

See **[`docs/blueprint.md` §6](docs/blueprint.md)**.

## License

Private — all rights reserved.
