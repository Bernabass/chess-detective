/**
 * Fixed-size transposition table for the solver (SPEC §6.4): (64-bit Zobrist key, remaining
 * plies) -> solution count from that node, saturated at the search's cap. Always-replace.
 * The full 64-bit key is stored and compared, so only a true 64-bit collision could return a
 * wrong entry.
 */
export class TranspositionTable {
  private readonly hi: Uint32Array;
  private readonly lo: Uint32Array;
  /** Remaining plies + 1; 0 marks an empty slot. */
  private readonly plies: Int16Array;
  private readonly counts: Int32Array;
  private readonly mask: number;

  constructor(bits: number) {
    const size = 1 << Math.max(4, Math.min(26, Math.floor(bits)));
    this.hi = new Uint32Array(size);
    this.lo = new Uint32Array(size);
    this.plies = new Int16Array(size);
    this.counts = new Int32Array(size);
    this.mask = size - 1;
  }

  private index(lo: number, remaining: number): number {
    return (lo ^ Math.imul(remaining + 1, 0x9e3779b1)) & this.mask;
  }

  /** The stored count, or -1 if there is no entry for this key and ply count. */
  get(hi: number, lo: number, remaining: number): number {
    const i = this.index(lo, remaining);
    if (this.plies[i] !== remaining + 1 || this.hi[i] !== hi || this.lo[i] !== lo) return -1;
    return this.counts[i]!;
  }

  set(hi: number, lo: number, remaining: number, count: number): void {
    const i = this.index(lo, remaining);
    this.hi[i] = hi;
    this.lo[i] = lo;
    this.plies[i] = remaining + 1;
    this.counts[i] = Math.min(count, 0x7fffffff); // saturate rather than wrap
  }
}
