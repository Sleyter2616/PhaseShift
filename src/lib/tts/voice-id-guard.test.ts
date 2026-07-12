import { describe, expect, it } from "vitest";
import { isUuidV4 } from "./voice-id-guard";

describe("isUuidV4", () => {
  it("matches canonical uuid v4 strings", () => {
    expect(isUuidV4("a1b2c3d4-e5f6-4a78-9abc-def012345678")).toBe(true);
  });

  it("rejects non-uuid voice ids", () => {
    expect(isUuidV4("pNInz6obpgDQGcFmaJgB")).toBe(false);
    expect(isUuidV4("stock-voice-abc")).toBe(false);
  });
});
