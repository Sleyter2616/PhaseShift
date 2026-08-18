import { describe, expect, it } from "vitest";
import {
  isPasswordRecoveryNext,
  safeAuthNextPath,
} from "./recovery-params";

/**
 * Documents the callback routing contract (unit-level; the Route Handler
 * itself talks to Supabase and is covered by live acceptance).
 */
describe("auth callback routing contract", () => {
  it("signup confirmation has no recovery next → lands in-app after exchange", () => {
    const next = safeAuthNextPath(null);
    expect(next).toBeNull();
    expect(isPasswordRecoveryNext(next)).toBe(false);
  });

  it("password recovery next → /reset-password only", () => {
    expect(safeAuthNextPath("/reset-password")).toBe("/reset-password");
    expect(isPasswordRecoveryNext("/reset-password")).toBe(true);
  });

  it("does not treat arbitrary next as recovery (no open redirect / no false reset)", () => {
    expect(safeAuthNextPath("/welcome")).toBeNull();
    expect(safeAuthNextPath("/scripts")).toBeNull();
    expect(isPasswordRecoveryNext("/welcome")).toBe(false);
  });
});
