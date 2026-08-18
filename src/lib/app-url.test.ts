import { describe, expect, it } from "vitest";
import {
  appBaseUrl,
  authCallbackRedirectTo,
  passwordResetRedirectTo,
} from "./app-url";

describe("appBaseUrl", () => {
  it("defaults to localhost and strips trailing slash", () => {
    expect(appBaseUrl({})).toBe("http://localhost:3000");
    expect(appBaseUrl({ NEXT_PUBLIC_APP_URL: "https://phaseshift.app/" })).toBe(
      "https://phaseshift.app",
    );
  });
});

describe("authCallbackRedirectTo", () => {
  it("points at bare /auth/callback for signup confirmation", () => {
    expect(
      authCallbackRedirectTo({ NEXT_PUBLIC_APP_URL: "https://phaseshift.app" }),
    ).toBe("https://phaseshift.app/auth/callback");
  });

  it("prefers an explicit browser origin over env", () => {
    expect(
      authCallbackRedirectTo(
        { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
        { origin: "https://phaseshift.app" },
      ),
    ).toBe("https://phaseshift.app/auth/callback");
  });
});

describe("passwordResetRedirectTo", () => {
  it("routes recovery through /auth/callback?next=/reset-password", () => {
    expect(
      passwordResetRedirectTo({ NEXT_PUBLIC_APP_URL: "https://phaseshift.app" }),
    ).toBe(
      "https://phaseshift.app/auth/callback?next=%2Freset-password",
    );
  });

  it("differs from signup confirmation redirect", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://phaseshift.app" };
    expect(passwordResetRedirectTo(env)).not.toBe(authCallbackRedirectTo(env));
  });

  it("never returns the site root, even if origin already includes a path", () => {
    expect(
      passwordResetRedirectTo(
        {},
        { origin: "https://phaseshift.app/reset-password" },
      ),
    ).toBe(
      "https://phaseshift.app/auth/callback?next=%2Freset-password",
    );
  });

  it("prefers an explicit browser origin over env", () => {
    expect(
      passwordResetRedirectTo(
        { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
        { origin: "https://phaseshift.app" },
      ),
    ).toBe(
      "https://phaseshift.app/auth/callback?next=%2Freset-password",
    );
  });
});
