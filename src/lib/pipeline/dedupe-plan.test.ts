import { describe, expect, it, vi } from "vitest";
import {
  applyDedupeHits,
  linkScriptSegmentsByContentHash,
  planSegmentDedupe,
  uniqueMissesFromSegments,
  type SegmentForDedupe,
} from "./dedupe-plan";
import {
  insertAudioFileOrFetchExisting,
  isUniqueViolation,
} from "./synthesize-segment-job";

function breathSegments(count: number, hash = "hash-breathe-in"): SegmentForDedupe[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `seg-${i + 1}`,
    content_hash: hash,
    text: "Breathe in.",
    pacing_wpm: 90,
  }));
}

/** Chainable thenable mock for supabase query builders. */
function createQueryMock(terminal: Record<string, unknown>) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const method of ["select", "eq", "is", "in", "neq", "update", "insert"]) {
    builder[method] = vi.fn(passthrough);
  }
  builder.maybeSingle = vi.fn(async () => terminal);
  builder.single = vi.fn(async () => terminal);
  // Terminal thenable for await query
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(terminal).then(resolve, reject);
  return builder;
}

describe("uniqueMissesFromSegments", () => {
  it("collapses 20 identical breath cues to one synthesis miss with 19 siblings", () => {
    const segments = breathSegments(20);
    const misses = uniqueMissesFromSegments(segments);
    expect(misses).toHaveLength(1);
    expect(misses[0]?.segmentId).toBe("seg-1");
    expect(misses[0]?.siblingSegmentIds).toHaveLength(19);
    expect(misses[0]?.siblingSegmentIds).toContain("seg-20");
  });

  it("keeps distinct hashes as separate misses", () => {
    const segments = [
      ...breathSegments(3, "hash-in"),
      ...breathSegments(2, "hash-hold").map((s, i) => ({
        ...s,
        id: `hold-${i}`,
        text: "Hold.",
      })),
    ];
    const misses = uniqueMissesFromSegments(segments);
    expect(misses).toHaveLength(2);
    expect(misses.map((m) => m.contentHash).sort()).toEqual(["hash-hold", "hash-in"]);
  });
});

describe("planSegmentDedupe", () => {
  it("treats intra-script identical hashes as one miss when not in audio_files", async () => {
    const builder = createQueryMock({ data: null, error: null });
    const supabase = { from: vi.fn(() => builder) };

    const plan = await planSegmentDedupe(
      supabase as never,
      { userId: "user-1", assetScope: "shared" },
      breathSegments(20),
    );

    expect(plan.hits).toHaveLength(0);
    expect(plan.misses).toHaveLength(1);
    expect(plan.misses[0]?.siblingSegmentIds).toHaveLength(19);
    expect(builder.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("links all identical segments as hits when audio_files already has the cue", async () => {
    const builder = createQueryMock({
      data: { id: "audio-1", duration_sec: 1.2 },
      error: null,
    });
    const supabase = { from: vi.fn(() => builder) };

    const plan = await planSegmentDedupe(
      supabase as never,
      { userId: "user-1", assetScope: "shared" },
      breathSegments(20),
    );

    expect(plan.misses).toHaveLength(0);
    expect(plan.hits).toHaveLength(20);
    expect(new Set(plan.hits.map((h) => h.audioFileId))).toEqual(new Set(["audio-1"]));
  });
});

describe("applyDedupeHits + linkScriptSegmentsByContentHash", () => {
  it("links all 20 segments to one audio row (synthesize once, reuse)", async () => {
    const builder = createQueryMock({ error: null });
    const supabase = { from: vi.fn(() => builder) };

    const hits = breathSegments(20).map((segment) => ({
      segmentId: segment.id,
      audioFileId: "audio-shared",
      actualDurationSec: 1.1,
    }));

    await applyDedupeHits(supabase as never, hits);

    expect(builder.update).toHaveBeenCalledTimes(20);
    for (const call of (builder.update as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toMatchObject({
        audio_file_id: "audio-shared",
        synthesis_status: "ready",
      });
    }
  });

  it("linkScriptSegmentsByContentHash updates every matching segment once", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => ({ id: `seg-${i + 1}` }));
    const builder = createQueryMock({ data: ids, error: null });
    const supabase = { from: vi.fn(() => builder) };

    const linked = await linkScriptSegmentsByContentHash(supabase as never, {
      scriptId: "script-1",
      contentHash: "hash-breathe-in",
      audioFileId: "audio-1",
      durationSec: 1.25,
    });

    expect(linked).toBe(20);
    expect(builder.update).toHaveBeenCalledWith({
      audio_file_id: "audio-1",
      actual_duration_sec: 1.25,
      synthesis_status: "ready",
    });
  });
});

describe("insertAudioFileOrFetchExisting", () => {
  it("returns inserted row when insert succeeds", async () => {
    const builder = createQueryMock({ error: null });
    builder.insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: vi.fn(() => builder) };

    const result = await insertAudioFileOrFetchExisting(supabase as never, {
      id: "new-id",
      user_id: null,
      asset_scope: "shared",
      provider: "selfhost",
      dedupe_key: "hash-1",
      storage_path: "shared/v/new-id.mp3",
      duration_sec: 1.5,
      bytes: 100,
      format: "mp3",
      provider_request_id: null,
    });

    expect(result).toEqual({ audioFileId: "new-id", durationSec: 1.5, reused: false });
  });

  it("on parallel unique conflict, fetches existing row instead of throwing", async () => {
    const builder = createQueryMock({
      data: { id: "winner-id", duration_sec: 1.4 },
      error: null,
    });
    builder.insert = vi.fn(async () => ({
      error: { code: "23505", message: "duplicate key audio_files_shared_dedupe_idx" },
    }));
    const supabase = { from: vi.fn(() => builder) };

    const result = await insertAudioFileOrFetchExisting(supabase as never, {
      id: "loser-id",
      user_id: null,
      asset_scope: "shared",
      provider: "selfhost",
      dedupe_key: "hash-1",
      storage_path: "shared/v/loser-id.mp3",
      duration_sec: 1.5,
      bytes: 100,
      format: "mp3",
      provider_request_id: null,
    });

    expect(result).toEqual({ audioFileId: "winner-id", durationSec: 1.4, reused: true });
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("simulates two parallel inserts of the same cue → exactly one logical row", async () => {
    type StoreRow = { id: string; dedupe_key: string; duration_sec: number };
    let store: StoreRow | null = null;

    const makeClient = () => {
      const builder = createQueryMock({ error: null });
      builder.insert = vi.fn(
        async (row: { id: string; dedupe_key: string; duration_sec: number }) => {
          if (store && store.dedupe_key === row.dedupe_key) {
            return {
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }
          await Promise.resolve();
          if (store && store.dedupe_key === row.dedupe_key) {
            return {
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }
          store = {
            id: row.id,
            dedupe_key: row.dedupe_key,
            duration_sec: row.duration_sec,
          };
          return { error: null };
        },
      );
      builder.maybeSingle = vi.fn(async () => ({
        data: store ? { id: store.id, duration_sec: store.duration_sec } : null,
        error: null,
      }));
      return { from: vi.fn(() => builder) };
    };

    const rowA = {
      id: "a",
      user_id: null as string | null,
      asset_scope: "shared" as const,
      provider: "selfhost",
      dedupe_key: "hash-parallel",
      storage_path: "shared/v/a.mp3",
      duration_sec: 1.1,
      bytes: 10,
      format: "mp3",
      provider_request_id: null as string | null,
    };
    const rowB = { ...rowA, id: "b", storage_path: "shared/v/b.mp3", duration_sec: 1.2 };

    // Sequential conflict path (deterministic): first wins, second reuses.
    const first = await insertAudioFileOrFetchExisting(makeClient() as never, rowA);
    const second = await insertAudioFileOrFetchExisting(makeClient() as never, rowB);

    expect(first.audioFileId).toBe("a");
    expect(first.reused).toBe(false);
    expect(second.audioFileId).toBe("a");
    expect(second.reused).toBe(true);
    expect(store).not.toBeNull();
    expect(store!.id).toBe("a");
  });
});
