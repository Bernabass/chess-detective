/**
 * Fixed-size transposition table for the solver (SPEC §6.4): (64-bit Zobrist key, remaining
 * plies) -> solution count from that node, saturated at the search's cap. Always-replace.
 * The full 64-bit key is stored and compared, so only a true 64-bit collision could return a
 * wrong entry.
 *
 * Entries carry a generation number: reset() starts a new generation instead of zero-filling
 * megabytes, so one table can serve many short solves (the puzzle generator runs thousands).
 */
export class TranspositionTable {
  readonly bits: number;
  private readonly hi: Uint32Array;
  private readonly lo: Uint32Array;
  /** Remaining plies + 1; 0 marks an empty slot. */
  private readonly plies: Int16Array;
  private readonly counts: Int32Array;
  private readonly generations: Uint16Array;
  private generation = 1;
  private readonly mask: number;

  constructor(bits: number) {
    this.bits = Math.max(4, Math.min(26, Math.floor(bits)));
    const size = 1 << this.bits;
    this.hi = new Uint32Array(size);
    this.lo = new Uint32Array(size);
    this.plies = new Int16Array(size);
    this.counts = new Int32Array(size);
    this.generations = new Uint16Array(size);
    this.mask = size - 1;
  }

  /** Forgets every entry (in O(1), except a full clear every 65,535 resets). */
  reset(): void {
    this.generation++;
    if (this.generation > 0xffff) {
      this.generations.fill(0);
      this.generation = 1;
    }
  }

  private index(lo: number, remaining: number): number {
    return (lo ^ Math.imul(remaining + 1, 0x9e3779b1)) & this.mask;
  }

  /** The stored count, or -1 if there is no entry for this key and ply count. */
  get(hi: number, lo: number, remaining: number): number {
    const i = this.index(lo, remaining);
    if (
      this.generations[i] !== this.generation ||
      this.plies[i] !== remaining + 1 ||
      this.hi[i] !== hi ||
      this.lo[i] !== lo
    ) {
      return -1;
    }
    return this.counts[i]!;
  }

  set(hi: number, lo: number, remaining: number, count: number): void {
    const i = this.index(lo, remaining);
    this.hi[i] = hi;
    this.lo[i] = lo;
    this.plies[i] = remaining + 1;
    this.generations[i] = this.generation;
    this.counts[i] = Math.min(count, 0x7fffffff); // saturate rather than wrap
  }
}

/**
 * Free tables by size, reused across solves. Solves never run concurrently on one thread, and
 * each takes its table out of the pool while it runs, so sharing is safe.
 */
const pool = new Map<number, TranspositionTable[]>();

export function acquireTable(bits: number): TranspositionTable {
  const key = Math.max(4, Math.min(26, Math.floor(bits)));
  const table = pool.get(key)?.pop() ?? new TranspositionTable(key);
  table.reset();
  return table;
}

export function releaseTable(table: TranspositionTable): void {
  const free = pool.get(table.bits) ?? [];
  if (free.length < 2) free.push(table);
  pool.set(table.bits, free);
}
