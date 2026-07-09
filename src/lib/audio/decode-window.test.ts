import { describe, expect, it } from "vitest";
import { JitDecodeWindow } from "./decode-window";

describe("JitDecodeWindow", () => {
  it("keeps at most 3 decoded buffers and evicts oldest", () => {
    const window = new JitDecodeWindow(3);
    window.markDecoded(1, {});
    window.markDecoded(2, {});
    window.markDecoded(3, {});
    expect(window.aliveCount()).toBe(3);

    window.markDecoded(4, {});
    expect(window.aliveSeqs()).toEqual([2, 3, 4]);
    expect(window.has(1)).toBe(false);
  });

  it("drops played buffers explicitly", () => {
    const window = new JitDecodeWindow(3);
    window.markDecoded(1, {});
    window.markDecoded(2, {});
    window.markPlayed(1);
    expect(window.has(1)).toBe(false);
    expect(window.aliveSeqs()).toEqual([2]);
  });

  it("returns decode targets for current and upcoming segments", () => {
    const window = new JitDecodeWindow(3);
    window.markDecoded(1, {});
    const targets = window.decodeTargets(2, [3, 4]);
    expect(targets).toEqual([2, 3, 4]);
  });
});
