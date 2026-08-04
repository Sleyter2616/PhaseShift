import { describe, expect, it } from "vitest";
import { appBaseUrl, passwordResetRedirectTo } from "./app-url";

describe("appBaseUrl", () => {
  it("defaults to localhost and strips trailing slash", () => {
    expect(appBaseUrl({})).toBe("http://localhost:3000");
    expect(appBaseUrl({ NEXT_PUBLIC_APP_URL: "https://phaseshift.app/" })).toBe(
      "https://phaseshift.app",
    );
  });
});

describe("passwordResetRedirectTo", () => {
  it("points at /reset-password on the canonical origin", () => {
    expect(
      passwordResetRedirectTo({ NEXT_PUBLIC_APP_URL: "https://phaseshift.app" }),
    ).toBe("https://phaseshift.app/reset-password");
  });
});
