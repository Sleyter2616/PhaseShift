import { describe, expect, it } from "vitest";
import { intakeSchema, safeParseIntake } from "./intake";
import { intake15Min, intake45Min, intakeInvalid } from "../fixtures/intake";

describe("intakeSchema", () => {
  it("golden fixtures contain no break tags", () => {
    for (const fixture of [intake45Min, intake15Min]) {
      expect(JSON.stringify(fixture).toLowerCase()).not.toContain("<break");
    }
  });

  it("accepts the 45-minute golden intake", () => {
    expect(() => intakeSchema.parse(intake45Min)).not.toThrow();
  });

  it("accepts the 15-minute golden intake", () => {
    const parsed = intakeSchema.parse(intake15Min);
    expect(parsed.session.duration_min).toBe(15);
    expect(parsed.session.middle_count).toBe(2);
  });

  it("defaults to 45-min full-arc sitting when session omitted", () => {
    const { session: _omit, ...rest } = intake45Min;
    void _omit;
    const parsed = intakeSchema.parse(rest);
    expect(parsed.session.duration_min).toBe(45);
    expect(parsed.session.middle_count).toBe(10);
    expect(parsed.session.posture).toBe("sitting");
  });

  it("accepts length_min alias and rejects invalid middle_count", () => {
    const ok = intakeSchema.parse({
      ...intake45Min,
      session: {
        ...intake45Min.session,
        length_min: 10,
        duration_min: 45,
        middle_count: 1,
        middle_start: 5,
      },
    });
    expect(ok.session.duration_min).toBe(10);
    expect(ok.session.middle_start).toBe(5);

    const bad = safeParseIntake({
      ...intake45Min,
      session: {
        ...intake45Min.session,
        duration_min: 15,
        middle_count: 6,
        middle_start: 2,
      },
    });
    expect(bad.success).toBe(false);
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
      ...intake45Min,
      goal_statement: "I want the senior role at Meridian Labs.",
    });
    expect(result.success).toBe(false);
  });
});
