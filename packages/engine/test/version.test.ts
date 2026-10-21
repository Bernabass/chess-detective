import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { ENGINE_VERSION } from '../src/index';

describe('ENGINE_VERSION', () => {
  it('matches the package version', () => {
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});
