import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lazily loaded routes can take over a second to appear when the whole suite runs at once.
configure({ asyncUtilTimeout: 5000 });

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

// jsdom lacks <dialog>'s modal methods and scrollIntoView; browsers all have them.
if (hasDom) {
  const dialog = window.HTMLDialogElement.prototype;
  if (typeof dialog.showModal !== 'function') {
    dialog.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = () => undefined;
  }
}
