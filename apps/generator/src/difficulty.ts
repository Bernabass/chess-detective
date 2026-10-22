import type { FeatureCounts } from './features';

/**
 * Difficulty score (SPEC §7.3):
 * plies + 1.5·captures + 3·promotions + 4·underpromotions + 2·castling + 3·enPassant
 *   + 2·switchbacks + 2·tempo + log2(solverNodes) / 4
 * Rounded to 2 decimals, so the output doesn't depend on floating-point noise.
 */
export function difficultyScore(plies: number, c: FeatureCounts, solverNodes: number): number {
  const score =
    plies +
    1.5 * c.captures +
    3 * c.promotions +
    4 * c.underpromotions +
    2 * c.castling +
    3 * c.enPassant +
    2 * c.switchbacks +
    2 * c.tempo +
    Math.log2(Math.max(1, solverNodes)) / 4;
  return Math.round(score * 100) / 100;
}

/** Upper rank fractions of ★ to ★★★★ (the weekly ramp, SPEC §7.3 and §8.7); the rest is ★★★★★. */
export const STAR_CUTS = [1 / 7, 3 / 7, 5 / 7, 6 / 7] as const;

/**
 * Stars by rank in the pool: the lowest 1/7 of scores get ★, up to 3/7 ★★, up to 5/7 ★★★, up to
 * 6/7 ★★★★, the rest ★★★★★. Ties are broken by id, so the mapping is deterministic. Returns the
 * stars in input order.
 */
export function assignStars(items: readonly { id: string; score: number }[]): number[] {
  const n = items.length;
  const order = items
    .map((item, i) => ({ ...item, i }))
    .sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stars = new Array<number>(n).fill(5);
  order.forEach((item, rank) => {
    const level = STAR_CUTS.findIndex((cut) => rank < Math.round(cut * n));
    stars[item.i] = level === -1 ? 5 : level + 1;
  });
  return stars;
}
