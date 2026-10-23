// Applies the saved colour theme before first paint, so the page never flashes the wrong theme.
// Loaded as a small external script in <head> (not inline), so the strict CSP of SPEC §11.1
// needs no 'unsafe-inline' or hashes. Keep in sync with src/lib/theme.ts.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('retrograde-theme') || 'system';
  } catch {
    // Storage can be blocked (private windows, strict settings): follow the system.
  }
  var dark =
    pref === 'dark' ||
    (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
