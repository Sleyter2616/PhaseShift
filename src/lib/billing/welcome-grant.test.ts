import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WELCOME_GRANT_MINUTES,
  hasWelcomeGrantLedgerRow,
  isWelcomeGrantEnabled,
  maybeGrantWelcomeMinutes,
  welcomeGrantMinutes,
} from "./welcome-grant";

vi.mock("./webhook", () => ({
  grantTopupMinutesForUser: vi.fn(async () => undefined),
}));

import { grantTopupMinutesForUser } from "./webhook";

const grantMock = vi.mocked(grantTopupMinutesForUser);

afterEach(() => {
  vi.unstubAllEnvs();
  grantMock.mockClear();
});

describe("welcome-grant config", () => {
  it("is enabled only when WELCOME_GRANT_ENABLED is exactly 1", () => {
    expect(isWelcomeGrantEnabled({ WELCOME_GRANT_ENABLED: "1" })).toBe(true);
    expect(isWelcomeGrantEnabled({ WELCOME_GRANT_ENABLED: "0" })).toBe(false);
    expect(isWelcomeGrantEnabled({ WELCOME_GRANT_ENABLED: "true" })).toBe(false);
    expect(isWelcomeGrantEnabled({})).toBe(false);
  });

  it("reads WELCOME_GRANT_MINUTES with default 400", () => {
    expect(welcomeGrantMinutes({})).toBe(DEFAULT_WELCOME_GRANT_MINUTES);
    expect(welcomeGrantMinutes({ WELCOME_GRANT_MINUTES: "250" })).toBe(250);
    expect(welcomeGrantMinutes({ WELCOME_GRANT_MINUTES: "0" })).toBe(
      DEFAULT_WELCOME_GRANT_MINUTES,
    );
    expect(welcomeGrantMinutes({ WELCOME_GRANT_MINUTES: "nope" })).toBe(
      DEFAULT_WELCOME_GRANT_MINUTES,
    );
  });
});

type LedgerState = { rows: Array<{ id: string; delta: number; reason: string }> };

function mockService(state: LedgerState) {
  const supabase = {
    from(table: string) {
      if (table !== "minutes_ledger") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return this;
            },
            in() {
              return this;
            },
            limit: async () => ({
              data: state.rows.map((r) => ({ id: r.id })),
              error: null,
            }),
          };
        },
      };
    },
  };

  return { supabase: supabase as never };
}

describe("hasWelcomeGrantLedgerRow", () => {
  it("is true when a matching purchase/grant topup row exists", async () => {
    const { supabase } = mockService({
      rows: [{ id: "w1", delta: 400, reason: "purchase" }],
    });
    await expect(
      hasWelcomeGrantLedgerRow(supabase, "user-1", 400),
    ).resolves.toBe(true);
  });

  it("is false when no matching row exists", async () => {
    const { supabase } = mockService({ rows: [] });
    await expect(
      hasWelcomeGrantLedgerRow(supabase, "user-1", 400),
    ).resolves.toBe(false);
  });
});

describe("maybeGrantWelcomeMinutes", () => {
  it("grants exactly WELCOME_GRANT_MINUTES to topup once when flag is on and just onboarded", async () => {
    vi.stubEnv("WELCOME_GRANT_ENABLED", "1");
    vi.stubEnv("WELCOME_GRANT_MINUTES", "400");
    const state: LedgerState = { rows: [] };
    const { supabase } = mockService(state);

    const first = await maybeGrantWelcomeMinutes(supabase, "user-1", true);
    expect(first).toEqual({ granted: true, minutes: 400 });
    expect(grantMock).toHaveBeenCalledTimes(1);
    expect(grantMock).toHaveBeenCalledWith(supabase, "user-1", 400);

    // Simulate ledger row written by grant_topup_minutes
    state.rows.push({ id: "welcome-1", delta: 400, reason: "purchase" });

    const second = await maybeGrantWelcomeMinutes(supabase, "user-1", true);
    expect(second).toEqual({
      granted: false,
      minutes: 400,
      reason: "already_granted",
    });
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it("does not grant when re-run without justOnboarded (onboarded_at already set)", async () => {
    vi.stubEnv("WELCOME_GRANT_ENABLED", "1");
    const { supabase } = mockService({ rows: [] });

    const result = await maybeGrantWelcomeMinutes(supabase, "user-1", false);
    expect(result).toEqual({
      granted: false,
      minutes: 400,
      reason: "not_just_onboarded",
    });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("does not grant when the flag is off", async () => {
    vi.stubEnv("WELCOME_GRANT_ENABLED", "0");
    vi.stubEnv("WELCOME_GRANT_MINUTES", "400");
    const { supabase } = mockService({ rows: [] });

    const result = await maybeGrantWelcomeMinutes(supabase, "user-1", true);
    expect(result).toEqual({
      granted: false,
      minutes: 400,
      reason: "disabled",
    });
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("onboarded_at-was-null guard prevents double grant even without ledger yet", async () => {
    vi.stubEnv("WELCOME_GRANT_ENABLED", "1");
    const { supabase } = mockService({ rows: [] });

    await maybeGrantWelcomeMinutes(supabase, "user-1", true);
    await maybeGrantWelcomeMinutes(supabase, "user-1", false);

    expect(grantMock).toHaveBeenCalledTimes(1);
  });
});
