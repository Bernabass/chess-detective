import { PAWN, WHITE, fileOf, rankOf, type Side } from '../core/board';

/**
 * Pawn capture accounting (SPEC §5.2.1).
 *
 * A pawn changes file only by capturing, one file per capture, and it can't change files
 * faster than it advances. So every pawn can be assigned a starting file within `distance
 * advanced` files of where it stands, each starting file holding one pawn. The cheapest such
 * assignment (sum of file distances) is the fewest captures those pawns can have made.
 */
export type PawnAccounting =
  /** `capturingPawns`: pawns not on their starting file in one cheapest assignment. */
  | { kind: 'ok'; minCaptures: number; capturingPawns: number[] }
  /**
   * No assignment exists. `unmatched` is a pawn a maximum matching leaves without a file;
   * `group` (which includes it) could only have started on `files`, one file too few.
   */
  | { kind: 'impossible'; unmatched: number; group: number[]; files: number[] }
  /** More than 8 pawns, which TOO_MANY_PAWNS already reports. */
  | { kind: 'skipped' };

export function pawnAccounting(board: Int8Array, side: Side): PawnAccounting {
  const pawn = side === WHITE ? PAWN : -PAWN;
  const pawns: number[] = [];
  for (let sq = 0; sq < 128; sq++) {
    // Pawns on a back rank are impossible anyway (PAWN_ON_BACK_RANK) and have no start file.
    if ((sq & 0x88) === 0 && board[sq] === pawn && rankOf(sq) !== 0 && rankOf(sq) !== 7) {
      pawns.push(sq);
    }
  }
  if (pawns.length > 8) return { kind: 'skipped' };

  // Least advanced pawns first, so the pawn left unmatched is the most "suspicious" one.
  if (side !== WHITE) pawns.sort((a, b) => rankOf(b) - rankOf(a) || fileOf(a) - fileOf(b));

  // allowed[i]: bitmask of the starting files pawn i can have come from.
  const allowed = pawns.map((sq) => {
    const advanced = side === WHITE ? rankOf(sq) - 1 : 6 - rankOf(sq);
    let mask = 0;
    for (let file = 0; file < 8; file++) {
      if (Math.abs(fileOf(sq) - file) <= advanced) mask |= 1 << file;
    }
    return mask;
  });

  const blocked = findHallViolation(pawns, allowed);
  if (blocked) return blocked;
  return cheapestAssignment(pawns, allowed);
}

/**
 * Maximum bipartite matching (augmenting paths) between pawns and files. If some pawn can't be
 * matched, the pawns and files reachable from it by alternating paths form a group S with
 * |N(S)| = |S| - 1 files, so Hall's condition fails and no assignment exists.
 */
function findHallViolation(
  pawns: readonly number[],
  allowed: readonly number[],
): PawnAccounting | null {
  const pawnOfFile = new Array<number>(8).fill(-1);

  const augment = (i: number, seen: boolean[]): boolean => {
    for (let file = 0; file < 8; file++) {
      if (((allowed[i]! >> file) & 1) === 0 || seen[file]) continue;
      seen[file] = true;
      const holder = pawnOfFile[file]!;
      if (holder < 0 || augment(holder, seen)) {
        pawnOfFile[file] = i;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < pawns.length; i++) {
    if (augment(i, new Array<boolean>(8).fill(false))) continue;

    // Pawn i is unmatched: collect everything reachable by alternating paths.
    const group = new Set<number>([i]);
    const files = new Set<number>();
    const queue = [i];
    while (queue.length > 0) {
      const pawn = queue.pop()!;
      for (let file = 0; file < 8; file++) {
        if (((allowed[pawn]! >> file) & 1) === 0 || files.has(file)) continue;
        files.add(file);
        const holder = pawnOfFile[file]!; // matched: otherwise pawn i could have taken it
        if (holder >= 0 && !group.has(holder)) {
          group.add(holder);
          queue.push(holder);
        }
      }
    }
    return {
      kind: 'impossible',
      unmatched: pawns[i]!,
      group: [...group].map((g) => pawns[g]!).sort((a, b) => a - b),
      files: [...files].sort((a, b) => a - b),
    };
  }
  return null;
}

/**
 * Exact minimum-cost assignment by dynamic programming over bitmasks of used files:
 * best[mask] is the cheapest way to give the first popcount(mask) pawns the files in `mask`.
 * Each state tries the next pawn on every free allowed file: at most 2^8 * 8 steps.
 */
function cheapestAssignment(pawns: readonly number[], allowed: readonly number[]): PawnAccounting {
  const best = new Array<number>(256).fill(Infinity);
  const lastFile = new Int8Array(256).fill(-1);
  best[0] = 0;
  let fullMask = -1;
  for (let mask = 0; mask < 256; mask++) {
    const cost = best[mask]!;
    if (cost === Infinity) continue;
    const i = popcount(mask);
    if (i === pawns.length) {
      if (fullMask < 0 || cost < best[fullMask]!) fullMask = mask;
      continue;
    }
    const pawnFile = fileOf(pawns[i]!);
    for (let file = 0; file < 8; file++) {
      if ((mask >> file) & 1 || ((allowed[i]! >> file) & 1) === 0) continue;
      const next = mask | (1 << file);
      const nextCost = cost + Math.abs(pawnFile - file);
      if (nextCost < best[next]!) {
        best[next] = nextCost;
        lastFile[next] = file;
      }
    }
  }

  // Walk back through the choices to see which pawns changed file.
  const capturingPawns: number[] = [];
  let mask = fullMask;
  for (let i = pawns.length - 1; i >= 0; i--) {
    const file = lastFile[mask]!;
    if (file !== fileOf(pawns[i]!)) capturingPawns.push(pawns[i]!);
    mask &= ~(1 << file);
  }
  return {
    kind: 'ok',
    minCaptures: best[fullMask]!,
    capturingPawns: capturingPawns.sort((a, b) => a - b),
  };
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x; v !== 0; v &= v - 1) n++;
  return n;
}
