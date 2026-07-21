import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryTracesSampleRate } from "./lib/sentry/scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: sentryTracesSampleRate(),
  beforeSend: scrubSentryEvent,
});
