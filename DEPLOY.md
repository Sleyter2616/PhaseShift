# Deploy (Phase 6)

Production wiring for Vercel + Supabase + Inngest Cloud + Stripe. Do **not** treat this as an automated deploy — connect the Vercel project manually after merge.

## Vercel environment variables

Set these on the Vercel project (**Production**). Leave secrets empty in git; never commit real values.

| Variable | Notes |
| -------- | ----- |
| `NEXT_PUBLIC_APP_URL` | Canonical prod origin, e.g. `https://your-domain.com` (no trailing slash) |
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
| `STRIPE_PRICE_TOPUP` | Live Price ID for $6 top-up |
| `STRIPE_PRICE_GUIDED` | Live Price ID for Guided subscription |
| `STRIPE_PRICE_PRACT` | Live Price ID for Practitioner subscription |

**Do not set in production:**

- `INNGEST_DEV` — must be **unset** so the client uses cloud mode and signing keys
- `DEV_USER_PASSWORD` — local seed only

Optional: `INNGEST_SERVE_ORIGIN` if Inngest should sync against a custom domain instead of the default Vercel deployment URL.

## Supabase Auth (prod)

In the prod Supabase project → **Authentication → URL configuration**:

1. **Site URL** — `https://your-domain.com` (same as `NEXT_PUBLIC_APP_URL`).
2. **Redirect URLs** — include at least:
   - `https://your-domain.com/auth/callback` (if used)
   - `https://your-domain.com/**` or the exact paths your app uses after magic-link / OAuth

Apply migrations through `0010_lock_trigger_fn.sql` on the prod database before serving traffic.

## Inngest Cloud

1. Deploy the Next.js app so `/api/inngest` is reachable.
2. Prefer the [Inngest Vercel integration](https://www.inngest.com/docs/deploy/vercel) (sets `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` and syncs on deploy), **or** create an app in the Inngest dashboard and paste the keys into Vercel manually.
3. Confirm the serve URL is `https://your-domain.com/api/inngest` (or set `INNGEST_SERVE_ORIGIN`).
4. Sync / deploy once and verify functions `generate-script` and `synthesize-segment` appear in the Inngest UI.

Local reminder: use `INNGEST_DEV=1` and `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` — never point local at prod keys.

## Stripe webhook (prod)

1. Stripe Dashboard → **Developers → Webhooks** (live mode).
2. Add endpoint: `https://your-domain.com/api/webhooks/stripe`.
3. Subscribe to the events the app handles (checkout / subscription / invoice — see `src/lib/billing/webhook.ts`).
4. Copy the endpoint **Signing secret** into Vercel as `STRIPE_WEBHOOK_SECRET`.
5. Ensure live Price IDs match `STRIPE_PRICE_*` and `STRIPE_SECRET_KEY` is `sk_live_…`.

Test mode stays on localhost via `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## Route hardening

- `/api/inngest` — `runtime = nodejs`, `dynamic = force-dynamic`, `maxDuration = 300`
- `/api/webhooks/stripe` — `runtime = nodejs`, `dynamic = force-dynamic`

See `vercel.json` for matching function duration caps.
