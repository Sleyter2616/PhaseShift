import { describe, expect, it } from "vitest";
import { resynthPreconditionError } from "./resynth-guard";

describe("resynthPreconditionError", () => {
  it("fails when script status is not ready", () => {
    expect(resynthPreconditionError("failed", 10)).toMatch(/status is 'failed'/);
    expect(resynthPreconditionError("generating", 5)).toMatch(/expected 'ready'/);
  });

  it("fails when segment count is zero", () => {
    expect(resynthPreconditionError("ready", 0)).toMatch(/0 segments/);
  });

  it("returns null when preconditions are satisfied", () => {
    expect(resynthPreconditionError("ready", 15)).toBeNull();
  });
});
