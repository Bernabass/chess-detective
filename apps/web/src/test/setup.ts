import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Some test files run in Node (no DOM): only the jsdom ones need cleaning up and stubs.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (hasDom) cleanup();
});

// jsdom has no matchMedia (the theme code asks for prefers-color-scheme): always "light".
if (hasDom && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
