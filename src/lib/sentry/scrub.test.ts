import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubSentryEvent } from "./scrub";

describe("scrubSentryEvent", () => {
  it("strips email and sensitive keys while keeping ids", () => {
    const event = {
      user: { id: "user-1", email: "person@example.com", username: "person" },
      request: {
        url: "/api/scripts",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        cookies: { session: "abc" },
        data: { goal_statement: "I am present", email: "person@example.com" },
        query_string: "email=person@example.com",
      },
      extra: {
        voice_id: "voice_abc",
        script_id: "script-1",
        note: "ok",
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed?.user).toEqual({ id: "user-1" });
    expect(scrubbed?.request?.cookies).toBeUndefined();
    expect(scrubbed?.request?.query_string).toBeUndefined();
    expect(scrubbed?.request?.data).toEqual({
      goal_statement: "[Filtered]",
      email: "[Filtered]",
    });
    expect(scrubbed?.request?.headers).toMatchObject({
      authorization: "[Filtered]",
      "content-type": "application/json",
    });
    expect(scrubbed?.extra).toEqual({
      voice_id: "[Filtered]",
      script_id: "script-1",
      note: "ok",
    });
  });

  it("redacts email-like strings in extras", () => {
    const event = {
      extra: { detail: "contact person@example.com please" },
    } as unknown as ErrorEvent;
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed?.extra).toEqual({ detail: "[Filtered]" });
  });
});
