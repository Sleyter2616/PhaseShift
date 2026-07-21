import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const PII_KEY =
  /^(email|user_email|password|goal|goal_statement|voice|voice_id|provider_voice_id|sample|audio|transcript|authorization|cookie|set-cookie)$/i;

const PII_VALUE =
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|sk_(live|test)_|whsec_|eyJ[A-Za-z0-9_-]{10,}/i;

function scrubRecord(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") {
    return PII_VALUE.test(value) ? "[Filtered]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubRecord(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = PII_KEY.test(key) ? "[Filtered]" : scrubRecord(nested, depth + 1);
    }
    return out;
  }
  return value;
}

/** Strip obvious PII before events leave the process. */
export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  void _hint;
  if (event.user) {
    event.user = {
      id: event.user.id,
    };
  }
  if (event.request) {
    const { headers, data, ...rest } = event.request;
    event.request = {
      ...rest,
      headers: headers ? (scrubRecord(headers) as typeof headers) : undefined,
      cookies: undefined,
      data: data ? scrubRecord(data) : undefined,
      query_string: undefined,
    };
  }
  if (event.extra) {
    event.extra = scrubRecord(event.extra) as typeof event.extra;
  }
  if (event.contexts) {
    event.contexts = scrubRecord(event.contexts) as typeof event.contexts;
  }
  return event;
}

export function sentryTracesSampleRate(): number {
  return process.env.NODE_ENV === "development" ? 1.0 : 0.1;
}
