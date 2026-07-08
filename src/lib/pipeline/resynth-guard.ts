export function resynthPreconditionError(
  status: string,
  segmentCount: number,
): string | null {
  if (status !== "ready") {
    return `FAIL resynth preconditions: script status is '${status}', expected 'ready'`;
  }
  if (segmentCount === 0) {
    return "FAIL resynth preconditions: script has 0 segments — cannot verify idempotency vacuously";
  }
  return null;
}
