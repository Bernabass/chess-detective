import { describe, expect, it } from 'vitest';
import { createRng } from '../src/index';

describe('createRng (splitmix32)', () => {
  it('produces the reference sequence', () => {
    // Expected values computed independently in Python from the splitmix32 definition.
    const rng = createRng(42);
    expect(Array.from({ length: 5 }, () => rng.nextUint32())).toEqual([
      939911724, 3948730756, 321366731, 3317318717, 527392959,
    ]);
    const zero = createRng(0);
    expect([zero.nextUint32(), zero.nextUint32(), zero.nextUint32()]).toEqual([
      2462723854, 1020716019, 454327756,
    ]);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const seqA = Array.from({ length: 10 }, () => a.nextUint32());
    expect(Array.from({ length: 10 }, () => b.nextUint32())).toEqual(seqA);
    expect(Array.from({ length: 10 }, () => c.nextUint32())).not.toEqual(seqA);
  });

  it('nextFloat is in [0, 1) and nextInt in [0, n)', () => {
    const rng = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.nextInt(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
      seen.add(n);
    }
    expect(seen.size).toBe(6);
  });
});
