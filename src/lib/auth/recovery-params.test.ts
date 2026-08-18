import { describe, expect, it } from "vitest";
import {
  authCallbackForwardPath,
  hasLegacyRecoveryParams,
  hasPasswordRecoveryParams,
  isPasswordRecoveryNext,
  resetPasswordForwardPath,
  safeAuthNextPath,
} from "./recovery-params";

describe("isPasswordRecoveryNext / safeAuthNextPath", () => {
  it("recognizes reset-password as recovery intent", () => {
    expect(isPasswordRecoveryNext("/reset-password")).toBe(true);
    expect(isPasswordRecoveryNext("/welcome")).toBe(false);
    expect(isPasswordRecoveryNext(null)).toBe(false);
  });

  it("rejects open redirects", () => {
    expect(safeAuthNextPath("//evil.com")).toBeNull();
    expect(safeAuthNextPath("https://evil.com")).toBeNull();
    expect(safeAuthNextPath("/reset-password")).toBe("/reset-password");
    expect(safeAuthNextPath("/scripts")).toBeNull();
  });
});

describe("authCallbackForwardPath", () => {
  it("forwards bare ?code= to /auth/callback (not reset-password)", () => {
    expect(authCallbackForwardPath(new URLSearchParams("code=uuid-1"))).toBe(
      "/auth/callback?code=uuid-1",
    );
  });

  it("preserves recovery next when present", () => {
    expect(
      authCallbackForwardPath(
        new URLSearchParams("code=uuid-1&next=/reset-password"),
      ),
    ).toBe("/auth/callback?code=uuid-1&next=%2Freset-password");
  });

  it("forwards legacy recovery params via callback with next=reset", () => {
    expect(
      authCallbackForwardPath(
        new URLSearchParams("token_hash=h&type=recovery"),
      ),
    ).toBe(
      "/auth/callback?token_hash=h&type=recovery&next=%2Freset-password",
    );
  });

  it("returns null when unrelated", () => {
    expect(authCallbackForwardPath(new URLSearchParams("foo=1"))).toBeNull();
  });
});

describe("hasPasswordRecoveryParams", () => {
  it("requires next=/reset-password for PKCE code (signup code alone is not recovery)", () => {
    expect(hasPasswordRecoveryParams(new URLSearchParams("code=abc"))).toBe(
      false,
    );
    expect(
      hasPasswordRecoveryParams(
        new URLSearchParams("code=abc&next=/reset-password"),
      ),
    ).toBe(true);
    expect(
      hasPasswordRecoveryParams(
        new URLSearchParams("token_hash=h&type=recovery"),
      ),
    ).toBe(true);
    expect(hasPasswordRecoveryParams(new URLSearchParams("type=signup"))).toBe(
      false,
    );
  });
});

describe("hasLegacyRecoveryParams", () => {
  it("detects token_hash + type=recovery", () => {
    expect(
      hasLegacyRecoveryParams(
        new URLSearchParams("token_hash=h&type=recovery"),
      ),
    ).toBe(true);
    expect(hasLegacyRecoveryParams(new URLSearchParams("code=abc"))).toBe(
      false,
    );
  });
});

describe("resetPasswordForwardPath (compat)", () => {
  it("aliases to authCallbackForwardPath", () => {
    expect(resetPasswordForwardPath(new URLSearchParams("code=uuid-1"))).toBe(
      "/auth/callback?code=uuid-1",
    );
  });
});
