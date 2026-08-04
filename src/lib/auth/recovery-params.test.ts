import { describe, expect, it } from "vitest";
import {
  hasPasswordRecoveryParams,
  resetPasswordForwardPath,
} from "./recovery-params";

describe("hasPasswordRecoveryParams", () => {
  it("detects PKCE code and legacy token_hash recovery", () => {
    expect(hasPasswordRecoveryParams(new URLSearchParams("code=abc"))).toBe(true);
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

describe("resetPasswordForwardPath", () => {
  it("forwards code to /reset-password", () => {
    expect(resetPasswordForwardPath(new URLSearchParams("code=uuid-1"))).toBe(
      "/reset-password?code=uuid-1",
    );
  });

  it("forwards legacy recovery params", () => {
    expect(
      resetPasswordForwardPath(
        new URLSearchParams("token_hash=h&type=recovery"),
      ),
    ).toBe("/reset-password?token_hash=h&type=recovery");
  });

  it("returns null when unrelated", () => {
    expect(resetPasswordForwardPath(new URLSearchParams("foo=1"))).toBeNull();
  });
});
