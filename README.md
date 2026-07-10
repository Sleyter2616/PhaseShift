# PhaseShift

Reality-engineering meditation app — guided self-hypnosis with per-segment TTS, client-side entrainment layering, and iterative triangulation loops.

See the full execution plan in [`docs/blueprint.md`](docs/blueprint.md).

## Stack

- **Runtime:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod
- **Jobs:** Inngest (generation pipeline)
- **Database:** Supabase (Postgres + Storage)
- **LLM:** Anthropic Claude (compiler); **TTS:** ElevenLabs via raw `fetch` (Phase 2; `selfhost` mock for offline CI)
- **Package manager:** pnpm (Node 22 LTS via `.nvmrc`)

## Prerequisites

- Node.js ≥ 22 (`nvm use`)
- pnpm 9+
- Hosted Supabase dev project with migrations `0001`–`0006` applied
- [Anthropic API key](https://console.anthropic.com/)
- [ElevenLabs API key](https://elevenlabs.io/) (Phase 2 live synthesis)
- [Inngest dev server](https://www.inngest.com/docs/local-development)

## Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB + storage writes |
| `ANTHROPIC_API_KEY` | Claude compiler |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (live synthesis) |
| `ELEVENLABS_STOCK_VOICE_ID` | Default stock voice for `POST /api/scripts` |
| `ELEVENLABS_MODEL_ID` | Default `eleven_flash_v2_5` |
| `TTS_PROVIDER` | `elevenlabs` (default) or `selfhost` for offline mock |
| `LLM_MODEL` | Default `claude-sonnet-4-6` |
| `DEV_USER_ID` | From seed script (Phase 1 dev auth) |
| `DEV_API_SECRET` | Shared secret for `x-dev-secret` header |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud (optional for local dev) |

## Local development (Phase 2)

> **Cost warning:** A full 40-minute generation synthesizes every segment via ElevenLabs and can consume substantial API credits. Use `TTS_PROVIDER=selfhost` for zero-cost offline pipeline tests, and run `pnpm tts:sample` first to validate voice/model choice before a full compile.

### 0. S1 voice bake-off (optional, recommended)

```bash
pnpm tts:sample <elevenlabs_voice_id> [model_id]
# writes ./samples/<voiceId>-<modelId>.mp3 — play locally before full generation
```

Set `ELEVENLABS_STOCK_VOICE_ID` in `.env.local` to the winning voice.

### 1. Install and test (offline)

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

### 7. Playback manifest (Phase 3 contract)

```bash
curl -s http://localhost:3000/api/scripts/<script_id>/manifest \
  -H "x-dev-secret: $DEV_API_SECRET" | jq .
```

Returns ordered segments with `signedUrl` (24h TTL) plus script meta (`entrainment_mode`, `entrainment_plan`).

## Phase 3 — Session playback

Open a ready script in the browser player (manifest loaded server-side; no dev secret in the client):

```
http://localhost:3000/session/<script_id>
```

Use one of the cached `ready` scripts from Phase 2 synthesis (zero new TTS/LLM spend).

### Desktop smoke test

1. Begin → confirm voice over entrainment tone bed.
2. Listen for beat glide at the alpha→theta phase boundary.
3. Pause / resume.
4. End → rate alertness 1–5 → verify `sessions.exit_alertness` in Supabase.

### Device testing (iPhone Safari, secure context)

Wake Lock requires HTTPS. Run the dev server with the experimental flag and open the LAN URL on your phone:

```bash
pnpm dev -- --experimental-https
# or: npx next dev --turbopack --experimental-https
```

Accept the self-signed certificate on the phone, then open `https://<your-lan-ip>:3000/session/<script_id>`. Keep the session screen in the foreground for at least 10 minutes; wake lock should prevent the screen from dimming.

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
| `pnpm tts:sample <voiceId> [modelId]` | S1 bake-off: ~75s excerpt MP3 |

## Repo map

```
src/
  app/api/scripts/        POST intake, GET manifest
  app/api/inngest/        Inngest serve endpoint
  app/dev/scripts/[id]/   Dev status page (poll)
  app/session/[scriptId]/ Server-loaded manifest + client player
  lib/audio/              EntrainmentEngine, scheduler, JIT decode window
  lib/playback/           Shared manifest loader for API + session page
  inngest/functions/      generate-script, synthesize-segment
  lib/compiler/           Claude compile + retry
  lib/contracts/          intake + manifest Zod
  lib/pipeline/           segment derivation, dedupe, reconcile
  lib/tts/                ElevenLabs + selfhost providers
  lib/session/derive.ts   intake → compiler INPUT session block
scripts/                  seed, verify, resynth-check, tts-sample
supabase/migrations/      0001–0006
```

## Roadmap

See **[`docs/blueprint.md` §6](docs/blueprint.md)**.

## License

Private — all rights reserved.
