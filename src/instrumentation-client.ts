import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryTracesSampleRate } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: sentryTracesSampleRate(),
  // Skip session replay — sensitive biometric/personal data; stay within free limits.
  beforeSend: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
