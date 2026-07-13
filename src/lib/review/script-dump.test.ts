import { describe, expect, it } from "vitest";
import { formatScriptDump } from "./script-dump";

describe("formatScriptDump", () => {
  it("prints segment metadata and full text in review order", () => {
    const output = formatScriptDump(
      [
        {
          seq: 1,
          phase: "beta",
          step: 1,
          title: "Opening",
          pacing_wpm: 130,
          target_duration_sec: 120,
          pause_after_ms: 2000,
          text: "Breathe in slowly.",
        },
      ],
      { scriptId: "abc-123" },
    );

    expect(output).toContain("Script: abc-123");
    expect(output).toContain("--- Segment 1 ---");
    expect(output).toContain("Phase: beta");
    expect(output).toContain("Step: 1");
    expect(output).toContain("Title: Opening");
    expect(output).toContain("Pacing: 130 wpm");
    expect(output).toContain("target 120s");
    expect(output).toContain("pause after 2000ms");
    expect(output).toContain("Text:");
    expect(output).toContain("Breathe in slowly.");
  });
});
