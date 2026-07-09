export interface ClockWatchContext {
  readonly currentTime: number;
}

export async function ensureClockAlive(
  ctx: ClockWatchContext,
  options?: {
    waitMs?: number;
    delay?: (ms: number) => Promise<void>;
  },
): Promise<boolean> {
  const waitMs = options?.waitMs ?? 300;
  const delay =
    options?.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const t0 = ctx.currentTime;
  await delay(waitMs);
  return ctx.currentTime > t0;
}
