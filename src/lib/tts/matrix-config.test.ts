import { describe, expect, it } from "vitest";
import {
  buildTtsMatrixPlan,
  estimateMatrixCreditCost,
  formatMatrixSettings,
  matrixFilename,
} from "./matrix-config";

describe("matrix-config", () => {
  it("builds six model x preset combinations", () => {
    const plan = buildTtsMatrixPlan();
    expect(plan).toHaveLength(6);
    expect(plan.map((run) => run.filename)).toContain(
      matrixFilename("eleven_flash_v2_5", "high-similarity"),
    );
    expect(plan.map((run) => run.filename)).toContain(
      matrixFilename("eleven_multilingual_v2", "max-similarity"),
    );
  });

  it("estimates flash=1 credit and v2=2 credits per synthesis", () => {
    expect(estimateMatrixCreditCost(250)).toBe(9);
  });

  it("formats settings for the preview table", () => {
    expect(formatMatrixSettings({ stability: 0.4, similarity_boost: 0.9 })).toBe(
      "stability=0.4, similarity_boost=0.9",
    );
  });
});
