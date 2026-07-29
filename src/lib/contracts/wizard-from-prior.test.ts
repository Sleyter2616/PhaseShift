import { describe, expect, it } from "vitest";
import { buildCompilerInput } from "../session/derive";
import { intake15Min, intake45Min } from "../fixtures/intake";
import {
  draftFromPriorScript,
  summarizePriorSession,
} from "./wizard-from-prior";
import { draftToIntake } from "./wizard";

describe("wizard-from-prior", () => {
  it("prefills draft from compiler_input raw answers", () => {
    const compilerInput = buildCompilerInput(
      intake45Min,
      "550e8400-e29b-41d4-a716-446655440000",
    );
    const draft = draftFromPriorScript({
      compilerInput,
      entrainment_mode: "binaural",
      voice_profile_id: null,
      stock_voice_id: "stock-voice-1",
    });

    expect(draft).not.toBeNull();
    expect(draft!.goal_statement).toBe(intake45Min.goal_statement);
    expect(draft!.localization).toEqual(intake45Min.localization);
    expect(draft!.triangulation).toEqual(intake45Min.triangulation);
    expect(draft!.not_list).toEqual(intake45Min.not_list);
    expect(draft!.features).toEqual(intake45Min.features);
    expect(draft!.session.duration_min).toBe(45);
    expect(draft!.session.middle_count).toBe(10);
    expect(draft!.session.entrainment_mode).toBe("binaural");
    expect(draft!.session.senses_emphasis).toEqual(intake45Min.session.senses_emphasis);
    expect(draft!.stock_voice_id).toBe("stock-voice-1");

    // Round-trip through draftToIntake preserves the reused answers.
    const intake = draftToIntake(draft!);
    expect(intake.goal_statement).toBe(intake45Min.goal_statement);
    expect(intake.session.duration_min).toBe(45);
  });

  it("preserves shorter length when reusing a 15-min session", () => {
    const compilerInput = buildCompilerInput(
      intake15Min,
      "550e8400-e29b-41d4-a716-446655440001",
    );
    const draft = draftFromPriorScript({ compilerInput });
    expect(draft?.session.duration_min).toBe(15);
    expect(draft?.session.middle_count).toBe(2);
  });

  it("summarizes prior sessions for the picker list", () => {
    const compilerInput = buildCompilerInput(
      intake45Min,
      "550e8400-e29b-41d4-a716-446655440000",
    );
    const summary = summarizePriorSession({
      id: "script-1",
      created_at: "2026-07-28T12:00:00.000Z",
      compiler_input: compilerInput,
    });
    expect(summary).toMatchObject({
      id: "script-1",
      goal_statement: intake45Min.goal_statement,
      duration_min: 45,
    });
  });

  it("returns null when compiler_input is missing raw intake", () => {
    expect(draftFromPriorScript({ compilerInput: null })).toBeNull();
    expect(
      summarizePriorSession({
        id: "x",
        created_at: "2026-07-28T12:00:00.000Z",
        compiler_input: {},
      }),
    ).toBeNull();
  });
});
