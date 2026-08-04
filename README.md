# PhaseShift

Reality-engineering meditation app — guided self-hypnosis with per-segment TTS, client-side entrainment layering, variable session lengths, and iterative triangulation loops.

See the full execution plan in [`docs/blueprint.md`](docs/blueprint.md). Agent operating rules: [`AGENTS.md`](AGENTS.md).

**Production deploy:** see [`DEPLOY.md`](DEPLOY.md) (Vercel env vars, Supabase auth URLs, Inngest Cloud, Stripe live webhook). Do not deploy from this README — connect Vercel manually.

## Features (current)

- **Variable session lengths:** 10 / 15 / 30 / 45 minutes (40 retired). Phase budgets are **server-computed** and sum to `length × 60`; delivered length matches via distributed theta dwelling silence. Billing = exact budgeted length × voice multiplier.
- **First-session primer:** calm how-to once before first playback; revisit via **How to use** (`/how-to`).
- **Step model B:** Visualize (1) + Closure (12) bookends; contiguous middle steps from 2..11, count capped by length. Wizard length picker + prior-session reuse; middle-step picker UI still deferred.
- **Self-paced breathing:** session states the 4/2/8/2 pattern once, then guides over the user's own pacing (not live breath cueing). Countdown = numbers only into silence.
- **Compiler prompt v2.5** (default): skeleton givens, depth-by-length, self-paced breath, word-budget minimums, person-aware intake. Pin older via `COMPILER_PROMPT_VERSION` (incl. `v1.4`).
- **Session content QA:** pre-synthesis person-agreement fix (`my→your`) and broken-script block.
- **Fail-open compile:** underwrite expand runs as a separate Inngest step (never hangs the main compile).
- **Stuck-generation reaper:** Inngest cron every 5 min marks hard-killed `generating` scripts failed and refunds minutes idempotently.
- **Minutes billing:** two-pool — subscription (monthly) + top-up (never expire); cost = `length_min ×` stock `1×` / own-voice `2×`. Optional **welcome grant** (`WELCOME_GRANT_ENABLED=1`) credits new users once on onboarding.
- **Tone mix:** entrainment bed capped well below voice (`TONE_GAIN_MAX=0.15`).
- **Posture:** sitting (default) | lying — affects body-reference language.
- **Sentry** error tracking for the App Router (`@sentry/nextjs`).
- Per-segment ElevenLabs TTS with content-hash dedupe; client-side binaural/isochronic entrainment; Inngest generation pipeline.

## Stack

- **Runtime:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod
- **Auth:** Supabase Auth via `@supabase/ssr` (cookie sessions, RLS-scoped clients)
- **Jobs:** Inngest (generation pipeline)
- **Database:** Supabase (Postgres + Storage)
- **LLM:** Anthropic Claude (compiler); **TTS:** ElevenLabs via raw `fetch` (`selfhost` mock for offline CI)
- **Observability:** Sentry (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`)
- **Package manager:** pnpm (Node 22 LTS via `.nvmrc`)

## Prerequisites

- Node.js ≥ 22 (`nvm use`)
- pnpm 9+
- Hosted Supabase project with migrations through `0013_primer_seen_at.sql` applied (conductor applies migrations — see `AGENTS.md`)
- [Anthropic API key](https://console.anthropic.com/)
- [ElevenLabs API key](https://elevenlabs.io/) (optional when `TTS_PROVIDER=selfhost`)
- [Inngest dev server](https://www.inngest.com/docs/local-development)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + user-scoped server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin (signed URLs, refunds, jobs) |
| `ANTHROPIC_API_KEY` | Claude compiler |
| `COMPILER_PROMPT_VERSION` | Optional; default **`v2.5`**. Pin `v2.4`…`v2.0` or `v1.4` for older prompts |
| `WELCOME_GRANT_ENABLED` | Set to `1` to grant new users topup minutes on `/welcome` complete; anything else = off |
| `WELCOME_GRANT_MINUTES` | Welcome topup amount (default `400`) |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (live synthesis) |
| `ELEVENLABS_VOICES_API_KEY` | Instant voice clone (`POST /api/voice`) |
| `ELEVENLABS_STOCK_VOICE_ID` | Default stock voice for `POST /api/scripts` |
| `ELEVENLABS_MODEL_ID` | Default `eleven_flash_v2_5` |
| `TTS_PROVIDER` | `elevenlabs` (default) or `selfhost` for zero ElevenLabs spend |
| `LLM_MODEL` | Default `claude-sonnet-4-6` |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Optional error tracking |
| `DEV_USER_PASSWORD` | Optional; seed script sets dev user password |
| `INNGEST_DEV` | Set to `1` for local Dev Server; **unset in prod** |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud (**prod-only**) |
| `STRIPE_*` | Test keys locally; **live** keys + Price IDs in prod (see [`DEPLOY.md`](DEPLOY.md)) |

## Local development

> **Cost warning:** A full generation synthesizes every segment via ElevenLabs. Set `TTS_PROVIDER=selfhost` for **zero ElevenLabs spend** on acceptance runs (LLM compiler cost still applies).

### 1. Install and test (offline)

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

### 2. Apply migrations

Ask the conductor to apply `supabase/migrations/` through `0013` on your hosted project. Agents do not apply schema directly (`AGENTS.md`).

### 3. Seed dev user

```bash
pnpm seed:dev
```

Sign in at `http://localhost:3000/login` with `dev@phaseshift.local` and the printed `DEV_USER_PASSWORD`.

### 4. Start services (two terminals)

```bash
# Terminal A — Next.js (ensure INNGEST_DEV=1 in .env.local)
pnpm dev

# Terminal B — Inngest Dev Server
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

### 5. Sign in and browse scripts

Open `http://localhost:3000` → redirects to `/login` or `/scripts`.

### 6. Request generation (authenticated)

```bash
curl -s -X POST http://localhost:3000/api/scripts \
  -H "Content-Type: application/json" \
  -b "your-session-cookies" \
  -d "$(pnpm tsx -e "import { intake45Min } from './src/lib/fixtures/intake.ts'; process.stdout.write(JSON.stringify(intake45Min))")"
```

Defaults: **30 min** wizard default (override to 10/15/45), skeleton-chosen middle steps, sitting. Override with `session.duration_min` / `length_min` (`10|15|30|45`), `middle_start`, `middle_count`, `posture`.

Minutes cost = `length_min ×` (stock `1` | own-voice `2`). Expect `202` with `{ "script_id": "..." }`, or `402` with `{ "error": "insufficient_minutes" }`.

### 7. Watch progress

Open `http://localhost:3000/dev/scripts/<script_id>` (polls every 2s).

### 8. Verify pipeline

```bash
pnpm verify:phase1 <script_id>
pnpm resynth:check <script_id>
```

### 9. RLS and minutes acceptance

```bash
pnpm rls:e2e
pnpm minutes:concurrency
```

### Billing

Stripe Price IDs in `.env.local`:

- `STRIPE_PRICE_TOPUP` — **$8 / 80 minutes** (never expire)
- `STRIPE_PRICE_GUIDED` — Guided **$29/mo = 240 minutes**
- `STRIPE_PRICE_PRACT` — Practitioner **$49/mo = 640 minutes**

```bash
pnpm billing:sim   # or minutes billing sim — see package.json scripts
```

### 10. Session playback

```
http://localhost:3000/session/<script_id>
```

## Intake wizard and voice

### Intake wizard (`/wizard`)

Seven-step client flow with **length picker** (10/15/30/45), posture, entrainment, and prior-session answer reuse. Contiguous middle-step picker UI is still deferred (API accepts `middle_start` / `middle_count`; skeleton chooses the middle for the selected length).

### Voice clone (`/voice`)

Consent → in-app ~90s recording → Instant Voice Cloning. Own-voice generations cost **2× minutes**.

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Next.js dev server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests (offline) |
| `pnpm seed:dev` | Create dev auth user + profile |
| `pnpm rls:e2e` | RLS isolation acceptance |
| `pnpm minutes:concurrency` | `spend_minutes` FOR UPDATE lock proof |
| `pnpm verify:phase1 <id>` | Phase 1 acceptance checks |
| `pnpm resynth:check <id>` | Dedupe idempotency check |

## Repo map

```
src/
  app/api/scripts/        POST intake (auth + spend_minutes), GET manifest
  app/api/voice/          Voice sample upload + clone
  app/api/inngest/        Inngest serve endpoint
  app/api/webhooks/stripe Stripe webhook
  app/billing/            Checkout / portal UI
  app/wizard/             7-step intake wizard
  app/session/[scriptId]/ Player
  lib/compiler/           skeleton.ts, prompt.v2.5.ts (+ immutable v2.x / v1.x), script-qa, compile
  lib/billing/            minutes.ts (two-pool), welcome-grant, Stripe helpers
  lib/contracts/          intake + manifest Zod
  lib/sentry/             capture helpers
  inngest/functions/      generate-script, synthesize-segment, stuck-generation-reaper
scripts/                  seed, verify, minutes-concurrency
supabase/migrations/      0001–0013
AGENTS.md                 Coding-agent operating rules
```

## Deploy

See **[`DEPLOY.md`](DEPLOY.md)**.

## Roadmap

See **[`docs/blueprint.md` §6](docs/blueprint.md)**. v0 (Phases 0–10) is complete; **v0.5** is the Customizable Protocol release.

## License

Private — all rights reserved.
