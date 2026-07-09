/** JIT decode bookkeeping (D16): at most maxAlive decoded buffers. */
export class JitDecodeWindow {
  private readonly alive = new Map<number, unknown>();
  private readonly order: number[] = [];

  constructor(private readonly maxAlive = 3) {}

  has(seq: number): boolean {
    return this.alive.has(seq);
  }

  get<T = unknown>(seq: number): T | undefined {
    return this.alive.get(seq) as T | undefined;
  }

  markDecoded(seq: number, buffer: unknown): void {
    if (this.alive.has(seq)) return;
    this.alive.set(seq, buffer);
    this.order.push(seq);
    this.evictIfNeeded();
  }

  markPlayed(seq: number): void {
    if (!this.alive.has(seq)) return;
    this.alive.delete(seq);
    const index = this.order.indexOf(seq);
    if (index >= 0) this.order.splice(index, 1);
  }

  /** Seqs that should be decoded one tick before playback need. */
  decodeTargets(
    currentSeq: number | null,
    upcomingSeqs: ReadonlyArray<number>,
  ): number[] {
    const candidates = new Set<number>();
    if (currentSeq != null) candidates.add(currentSeq);
    for (const seq of upcomingSeqs) candidates.add(seq);

    return [...candidates].filter((seq) => !this.alive.has(seq));
  }

  aliveCount(): number {
    return this.alive.size;
  }

  aliveSeqs(): number[] {
    return [...this.order];
  }

  private evictIfNeeded(): void {
    while (this.order.length > this.maxAlive) {
      const evictSeq = this.order.shift();
      if (evictSeq != null) this.alive.delete(evictSeq);
    }
  }
}
