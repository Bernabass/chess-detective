/** A small deterministic random number generator. Same seed, same sequence, on every machine. */
export interface Rng {
  /** Uniform 32-bit unsigned integer. */
  nextUint32(): number;
  /** Uniform float in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, n). */
  nextInt(n: number): number;
}

/**
 * splitmix32: a 32-bit counter (golden-ratio increment) passed through a murmur3-style mixer.
 * Fast, allocation-free and good enough for Zobrist keys and random games.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const nextFloat = (): number => nextUint32() / 0x1_0000_0000;
  return {
    nextUint32,
    nextFloat,
    nextInt: (n: number): number => Math.floor(nextFloat() * n),
  };
}
