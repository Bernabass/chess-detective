/** A ply range and its share of the pool (SPEC §7.2). */
export interface PlyQuota {
  min: number;
  max: number;
  share: number;
}

export const PLY_QUOTAS: readonly PlyQuota[] = [
  { min: 5, max: 6, share: 0.15 },
  { min: 7, max: 8, share: 0.28 },
  { min: 9, max: 9, share: 0.15 },
  { min: 10, max: 11, share: 0.28 },
  { min: 12, max: 12, share: 0.14 },
];

/** Most puzzles in the pool that share their first PREFIX_PLIES moves. */
export const MAX_PER_PREFIX = 3;
export const PREFIX_PLIES = 6;

export interface PoolEntry {
  index: number;
  moves: readonly string[];
  score: number;
}

export interface PoolResult<T> {
  chosen: T[];
  /** Per quota: how many were wanted and how many were found before topping up. */
  quotas: { quota: PlyQuota; wanted: number; found: number }[];
}

/**
 * Chooses `count` puzzles: each ply range gets its share (rounded so the shares sum to `count`),
 * highest scores first, with at most MAX_PER_PREFIX puzzles sharing a 6-ply prefix. Ranges are
 * filled longest first: long puzzles are scarce and share prefixes with shorter ones, so they get
 * the prefix allowance first. A range that runs short is topped up from the best remaining
 * puzzles with lengths in [minPlies, maxPlies] (default: the quotas' span). Output is sorted by
 * candidate index.
 */
export function choosePool<T extends PoolEntry>(
  accepted: readonly T[],
  count: number,
  quotas: readonly PlyQuota[] = PLY_QUOTAS,
  minPlies = Math.min(...quotas.map((q) => q.min)),
  maxPlies = Math.max(...quotas.map((q) => q.max)),
): PoolResult<T> {
  const byScore = [...accepted].sort((a, b) => b.score - a.score || a.index - b.index);
  const perPrefix = new Map<string, number>();
  const taken = new Set<number>();
  const chosen: T[] = [];
  const take = (entry: T): boolean => {
    if (taken.has(entry.index)) return false;
    const prefix = entry.moves.slice(0, PREFIX_PLIES).join(' ');
    const used = perPrefix.get(prefix) ?? 0;
    if (used >= MAX_PER_PREFIX) return false;
    perPrefix.set(prefix, used + 1);
    taken.add(entry.index);
    chosen.push(entry);
    return true;
  };

  // Largest-remainder rounding, so the quotas add up to exactly `count`.
  const exact = quotas.map((q) => q.share * count);
  const wanted = exact.map(Math.floor);
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; wanted.reduce((s, x) => s + x, 0) < count; k++) {
    const i = order[k % order.length]?.i ?? 0;
    wanted[i] = (wanted[i] ?? 0) + 1;
  }

  const found = quotas.map(() => 0);
  const longestFirst = quotas
    .map((_, i) => i)
    .sort((a, b) => (quotas[b]?.max ?? 0) - (quotas[a]?.max ?? 0));
  for (const i of longestFirst) {
    const quota = quotas[i];
    const want = wanted[i] ?? 0;
    if (quota === undefined) continue;
    for (const entry of byScore) {
      if ((found[i] ?? 0) >= want) break;
      const n = entry.moves.length;
      if (n >= quota.min && n <= quota.max && take(entry)) found[i] = (found[i] ?? 0) + 1;
    }
  }
  const report = quotas.map((quota, i) => ({
    quota,
    wanted: wanted[i] ?? 0,
    found: found[i] ?? 0,
  }));

  for (const entry of byScore) {
    if (chosen.length >= count) break;
    const n = entry.moves.length;
    if (n >= minPlies && n <= maxPlies) take(entry);
  }
  chosen.sort((a, b) => a.index - b.index);
  return { chosen, quotas: report };
}
