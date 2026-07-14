# PhaseShift

Reality-engineering meditation app — guided self-hypnosis with per-segment TTS, client-side entrainment layering, and iterative triangulation loops.

See the full execution plan in [`docs/blueprint.md`](docs/blueprint.md).

## Stack

- **Runtime:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod
- **Auth:** Supabase Auth via `@supabase/ssr` (cookie sessions, RLS-scoped clients)
- **Jobs:** Inngest (generation pipeline)
- **Database:** Supabase (Postgres + Storage)
- **LLM:** Anthropic Claude (compiler); **TTS:** ElevenLabs via raw `fetch` (Phase 2; `selfhost` mock for offline CI)
- **Package manager:** pnpm (Node 22 LTS via `.nvmrc`)

## Prerequisites

- Node.js ≥ 22 (`nvm use`)
- pnpm 9+
- Hosted Supabase dev project with migrations `0001`–`0008` applied
- [Anthropic API key](https://console.anthropic.com/)
- [ElevenLabs API key](https://elevenlabs.io/) (Phase 2 live synthesis; optional when `TTS_PROVIDER=selfhost`)
- [Inngest dev server](https://www.inngest.com/docs/local-development)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + user-scoped server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin (signed URLs, refunds, jobs) |
| `ANTHROPIC_API_KEY` | Claude compiler |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (live synthesis) |
| `ELEVENLABS_VOICES_API_KEY` | ElevenLabs instant voice clone (`POST /api/voice`); required for real cloning |
| `ELEVENLABS_STOCK_VOICE_ID` | Default stock voice for `POST /api/scripts` |
| `ELEVENLABS_MODEL_ID` | Default `eleven_flash_v2_5` |
| `TTS_PROVIDER` | `elevenlabs` (default) or `selfhost` for zero ElevenLabs spend |
| `LLM_MODEL` | Default `claude-sonnet-4-6` |
| `DEV_USER_PASSWORD` | Optional; seed script sets dev user password (printed if unset) |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud (optional for local dev) |

## Local development

> **Cost warning:** A full 40-minute generation synthesizes every segment via ElevenLabs and can consume substantial API credits. Set `TTS_PROVIDER=selfhost` for **zero ElevenLabs spend** on acceptance runs (LLM compiler cost still applies, ~$0.25 per generation).

### 1. Install and test (offline)

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

### 2. Apply migrations

Apply `supabase/migrations/0001` through `0008` on your hosted Supabase project (including `0007_auth.sql` for the signup profile trigger and `refund_credits`, and `0008_voice_bucket.sql` for the `voice-samples` storage bucket).

### 3. Seed dev user

```bash
pnpm seed:dev
```

Sign in at `http://localhost:3000/login` with `dev@phaseshift.local` and the printed `DEV_USER_PASSWORD`.

### 4. Start services (two terminals)

```bash
# Terminal A — Next.js
pnpm dev

# Terminal B — Inngest dev server
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

### 5. Sign in and browse scripts

Open `http://localhost:3000` → redirects to `/login` or `/scripts`. After sign-in, `/scripts` lists your scripts with links to playback.

### 6. Request generation (authenticated)

Sign in in the browser, then POST with your session cookie (or use a REST client that forwards cookies):

```bash
curl -s -X POST http://localhost:3000/api/scripts \
  -H "Content-Type: application/json" \
  -b "your-session-cookies" \
  -d "$(pnpm tsx -e "import { intake40Min } from './src/lib/fixtures/intake.ts'; process.stdout.write(JSON.stringify(intake40Min))")"
```

With `TTS_PROVIDER=selfhost`, generation enqueues without ElevenLabs API spend. Credit cost depends on the TTS model: Flash stock voice = 1 credit; clone / multilingual v2 = 2 credits (`creditsPerGeneration` in `src/lib/billing/plans.ts`).

Expect `202` with `{ "script_id": "..." }`, or `402` with `{ "error": "insufficient_credits" }`.

### 7. Watch progress

Open `http://localhost:3000/dev/scripts/<script_id>` (polls every 2s).

### 8. Verify pipeline

```bash
pnpm verify:phase1 <script_id>
pnpm resynth:check <script_id>
```

### 9. RLS and credits acceptance (after 0007 applied)

```bash
pnpm rls:e2e
pnpm credits:concurrency
```

Both print `PASS`/`FAIL` lines and clean up throwaway users.

### Billing (after `0009_billing` applied)

Create Products and Prices in the [Stripe Dashboard](https://dashboard.stripe.com/test/products) (test mode), then paste Price IDs into `.env.local`:

- `STRIPE_PRICE_TOPUP` — one-time $6 top-up (1 credit)
- `STRIPE_PRICE_GUIDED` — Guided $29/mo subscription
- `STRIPE_PRICE_PRACT` — Practitioner $49/mo subscription
- `STRIPE_WEBHOOK_SECRET` — from `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- `NEXT_PUBLIC_APP_URL` — e.g. `http://localhost:3000`

Signed-in users manage balance at `/billing`. Webhook fulfillment is idempotent via `stripe_events` (D26).

```bash
pnpm billing:sim   # requires dev server + test Stripe keys; prints PASS/FAIL
```

### 10. Session playback

```
http://localhost:3000/session/<script_id>
```

Requires sign-in; foreign scripts return 404 via RLS.

## Phase 4b — Intake wizard and voice onboarding

### Intake wizard (`/wizard`)

Seven-step client flow (auth required). Per-step validation uses partial Zod schemas from `src/lib/contracts/intake.ts`; submit runs full `intakeSchema.parse` then `POST /api/scripts`.

- Step 7 locks duration at **40 minutes** (v0 preset only).
- Optional `voice_profile_id` in the POST body selects an owned `ready` voice profile; synthesis uses `provider_voice_id` with `asset_scope: user`.
- `402 insufficient_credits` renders inline on step 7; `202` redirects to `/dev/scripts/<id>`.

### Voice clone (`/voice`)

Consent screen (own-voice-only, in-app recording, no uploads) → server action sets `voice_profiles.consent_confirmed_at` and `status: pending` → ~90s guided reading with `MediaRecorder` → `POST /api/voice` stores sample to `voice-samples/{user_id}/`, runs ElevenLabs IVC (`ELEVENLABS_VOICES_API_KEY` required; returns 422 if unset). `PATCH /api/voice` retries clone from the stored sample.

When `status: ready`, the wizard step 7 voice selector shows **My voice**.

### Scripts list

**New script** links to `/wizard`. The golden-fixture shortcut button appears only when `NODE_ENV === "development"`.

## Phase 3 — Session playback notes

### Desktop smoke test

1. Begin → **Start audio** → voice over entrainment tone bed.
2. Listen for beat glide at the alpha→theta phase boundary.
3. Pause / resume.
4. End → rate alertness 1–5.

### Device testing (iPhone Safari, secure context)

```bash
pnpm dev -- --experimental-https
```

Open `https://<your-lan-ip>:3000/session/<script_id>` and keep the screen in the foreground.

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Next.js dev server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm seed:dev` | Create dev auth user + profile (100 credits) |
| `pnpm rls:e2e` | RLS isolation acceptance script |
| `pnpm credits:concurrency` | `spend_credits` FOR UPDATE lock proof |
| `pnpm verify:phase1 <id>` | Phase 1 acceptance checks |
| `pnpm resynth:check <id>` | Dedupe idempotency check |
| `pnpm retry:synthesis <id>` | Re-synthesize a failed script with corrected voice identity (no recompile) |
| `pnpm tts:sample <voiceId> [modelId]` | S1 bake-off: ~75s excerpt MP3 |

## Repo map

```
src/
  app/api/scripts/        POST intake (auth + spend_credits), GET manifest
  app/api/voice/          POST voice sample upload + clone (auth, FormData)
  app/api/inngest/        Inngest serve endpoint
  app/login/              Sign-in / sign-up
  app/scripts/            User's script list (RLS-scoped)
  app/wizard/             7-step intake wizard (v0: 40 min locked)
  app/voice/              Voice-clone consent + in-app recording
  app/session/[scriptId]/ Server-loaded manifest + client player
  app/dev/scripts/[id]/   Dev status page (poll)
  lib/supabase/           @supabase/ssr browser/server/middleware clients
  lib/auth/               Session helpers, ownership checks
  lib/audio/              EntrainmentEngine, scheduler, JIT decode window
  lib/playback/           Shared manifest loader
  inngest/functions/      generate-script, synthesize-segment
  lib/compiler/           Claude compile + retry
  lib/contracts/          intake + manifest Zod
  lib/pipeline/           segment derivation, dedupe, reconcile
  lib/tts/                ElevenLabs + selfhost providers
scripts/                  seed, rls-e2e, credits-concurrency, verify
supabase/migrations/      0001–0008
```

## Roadmap

See **[`docs/blueprint.md` §6](docs/blueprint.md)**.

## License

Private — all rights reserved.
