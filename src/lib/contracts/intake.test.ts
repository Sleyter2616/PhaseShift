import { describe, expect, it } from "vitest";
import { intakeSchema, safeParseIntake } from "./intake";
import { intake20Min, intake40Min, intakeInvalid } from "../fixtures/intake";

describe("intakeSchema", () => {
  it("accepts the 40-minute golden intake", () => {
    expect(() => intakeSchema.parse(intake40Min)).not.toThrow();
  });

  it("accepts the 20-minute golden intake", () => {
    expect(() => intakeSchema.parse(intake20Min)).not.toThrow();
  });

  it("rejects invalid intake with at least 3 distinct validation errors", () => {
    const result = safeParseIntake(intakeInvalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects goal_statement beginning with "I want"', () => {
    const result = safeParseIntake({
      ...intake40Min,
      goal_statement: "I want the senior role at Meridian Labs.",
    });
    expect(result.success).toBe(false);
  });
});
