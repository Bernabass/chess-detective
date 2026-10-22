import {
  clonePosition,
  createRng,
  initialPosition,
  legalMoves,
  targetKey,
} from '@retrograde/engine';
import { isSwitchback } from './beam';
import type { Candidate } from './candidates';
import { playAndDescribe, type MoveInfo } from './moves';

/**
 * Move weights for random candidate games (SPEC §7.2): captures x3, promotions x5,
 * underpromotions x8, castling x3, en passant x6, a piece returning to a square it visited x2,
 * other moves x1.
 */
export function randomWeight(info: MoveInfo, switchback: boolean): number {
  if (info.promotion !== null) return info.promotion.toLowerCase() === 'q' ? 5 : 8;
  if (info.enPassant) return 6;
  if (info.castling) return 3;
  if (info.captured !== null) return 3;
  if (switchback) return 2;
  return 1;
}

/**
 * `count` random candidate games with lengths drawn uniformly from [minPlies, maxPlies]. Each
 * candidate's game comes from its own seed (derived from `seed` and its index), so the list is
 * the same however it is later split across workers.
 */
export function randomCandidates(
  seed: number,
  count: number,
  minPlies: number,
  maxPlies: number,
  firstIndex: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const index = firstIndex + i;
    const rng = createRng(seed ^ Math.imul(index + 0x51ed, 0x2c1b3c6d));
    const plies = minPlies + rng.nextInt(maxPlies - minPlies + 1);
    const p = initialPosition();
    const infos: MoveInfo[] = [];
    for (let ply = 0; ply < plies; ply++) {
      const options = legalMoves(p).map((m) => {
        const scratch = clonePosition(p);
        const info = playAndDescribe(scratch, m);
        return { m, info, weight: randomWeight(info, isSwitchback(infos, info)) };
      });
      let chosen = options.at(-1);
      if (chosen === undefined) break;
      let r = rng.nextFloat() * options.reduce((sum, o) => sum + o.weight, 0);
      for (const o of options) {
        r -= o.weight;
        if (r < 0) {
          chosen = o;
          break;
        }
      }
      infos.push(playAndDescribe(p, chosen.m));
    }
    if (infos.length !== plies) continue; // ended early in mate or stalemate
    out.push({ index, moves: infos.map((x) => x.uci), target: targetKey(p), source: 'random' });
  }
  return out;
}
