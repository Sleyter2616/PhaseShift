# Deploy (Phase 6)

Production wiring for Vercel + Supabase + Inngest Cloud + Stripe. Do **not** treat this as an automated deploy — connect the Vercel project manually after merge.

## Vercel environment variables

Set these on the Vercel project (**Production**). Leave secrets empty in git; never commit real values.

| Variable | Notes |
| -------- | ----- |
| `NEXT_PUBLIC_APP_URL` | Canonical prod origin: **`https://phaseshift.app`** (no trailing slash). Used for Stripe return URLs and Auth `emailRedirectTo` / password-reset `redirectTo` (`/auth/callback`). |
| `NEXT_PUBLIC_SUPABASE_URL` | Prod Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod service role (server-only) |
| `ANTHROPIC_API_KEY` | Claude compiler |
| `LLM_MODEL` | Optional; defaults to `claude-sonnet-4-6` if set in app |
| `TTS_PROVIDER` | **`elevenlabs`** in prod |
| `ELEVENLABS_API_KEY` | Live TTS |
| `ELEVENLABS_VOICES_API_KEY` | Instant voice clone |
| `ELEVENLABS_STOCK_VOICE_ID` | Default stock voice |
| `ELEVENLABS_MODEL_ID` | Optional; default `eleven_flash_v2_5` |
| `ELEVENLABS_CLONE_MODEL_ID` | Optional; default `eleven_multilingual_v2` |
| `INNGEST_EVENT_KEY` | **prod-only** — from Inngest Cloud / Vercel integration |
| `INNGEST_SIGNING_KEY` | **prod-only** — from Inngest Cloud / Vercel integration |
| `STRIPE_SECRET_KEY` | **prod-only live** `sk_live_…` (not `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the **prod** Dashboard webhook endpoint |
| `STRIPE_PRICE_TOPUP` | Live Price ID for $8 / 80-min top-up |
| `STRIPE_PRICE_GUIDED` | Live Price ID for Guided subscription |
| `STRIPE_PRICE_PRACT` | Live Price ID for Practitioner subscription |
| `WELCOME_GRANT_ENABLED` | Set to **`1`** to grant new users topup minutes when they complete `/welcome`; anything else (or unset) = off. Flip + redeploy to disable — no code change. |
| `WELCOME_GRANT_MINUTES` | Optional; integer minutes for the welcome topup (default **400**) |
| `COMPILER_PROMPT_VERSION` | Optional; default `v2.7`. Pin an older immutable prompt if needed |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional error tracking. Client events tunnel via same-origin **`/monitoring`** (`tunnelRoute` in `next.config.ts`) so ad-blockers cannot CORS-block ingest. |

**Do not set in production:**

- `INNGEST_DEV` — must be **unset** so the client uses cloud mode and signing keys
- `DEV_USER_PASSWORD` — local seed only

Optional: `INNGEST_SERVE_ORIGIN` if Inngest should sync against a custom domain instead of the default Vercel deployment URL.

## Supabase Auth (prod)

In the prod Supabase project → **Authentication → URL configuration**:

1. **Site URL** — `https://phaseshift.app` (same as `NEXT_PUBLIC_APP_URL`). Site URL is the **fallback origin** only — email links should use the explicit `redirectTo` paths below.
2. **Redirect URLs** — include at least:
   - `https://phaseshift.app/auth/callback` (**required** — signup confirmation + shared PKCE exchange)
   - `https://phaseshift.app/auth/callback?next=/reset-password` (password recovery; or a wildcard that covers query variants)
   - `https://phaseshift.app/reset-password` (legacy / post-callback landing)
   - `https://phaseshift.app/**` or the exact paths your app uses after magic-link / OAuth

Signup `emailRedirectTo` → `/auth/callback`. Forgot-password `redirectTo` → `/auth/callback?next=/reset-password`. Do not point confirmation at `/reset-password`.

Apply migrations through `0014_voice_profiles_one_per_user.sql` on the prod database before serving traffic.

## Inngest Cloud

1. Deploy the Next.js app so `/api/inngest` is reachable.
2. Prefer the [Inngest Vercel integration](https://www.inngest.com/docs/deploy/vercel) (sets `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` and syncs on deploy), **or** create an app in the Inngest dashboard and paste the keys into Vercel manually.
3. Confirm the serve URL is `https://phaseshift.app/api/inngest` (or set `INNGEST_SERVE_ORIGIN`).
4. Sync / deploy once and verify functions `generate-script`, `synthesize-segment`, and `stuck-generation-reaper` (cron every 5 min) appear in the Inngest UI.

Local reminder: use `INNGEST_DEV=1` and `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` — never point local at prod keys.

## Stripe webhook (prod)

1. Stripe Dashboard → **Developers → Webhooks** (live mode).
2. Add endpoint: `https://phaseshift.app/api/webhooks/stripe`.
3. Subscribe to the events the app handles (checkout / subscription / invoice — see `src/lib/billing/webhook.ts`).
4. Copy the endpoint **Signing secret** into Vercel as `STRIPE_WEBHOOK_SECRET`.
5. Ensure live Price IDs match `STRIPE_PRICE_*` and `STRIPE_SECRET_KEY` is `sk_live_…`.

Test mode stays on localhost via `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## Route hardening

- `/api/inngest` — `runtime = nodejs`, `dynamic = force-dynamic`, `maxDuration = 300`
- `/api/webhooks/stripe` — `runtime = nodejs`, `dynamic = force-dynamic`

See `vercel.json` for matching function duration caps.
