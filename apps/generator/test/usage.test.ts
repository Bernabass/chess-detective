import { ENGINE_VERSION } from '@retrograde/engine';
import { describe, expect, it } from 'vitest';
import { usage } from '../src/usage';

describe('usage', () => {
  it('names the engine version and the three commands', () => {
    const text = usage();
    expect(text).toContain(`engine ${ENGINE_VERSION}`);
    for (const command of ['generate', 'verify', 'stats']) {
      expect(text).toContain(`generator ${command}`);
    }
  });
});
