// Diagnostics in the console: on in development, or with ?debug in the address (useful to report a problem).

const on =
  typeof location !== 'undefined' && (import.meta.env?.DEV || new URLSearchParams(location.search).has('debug'));

export function log(...args: unknown[]): void {
  if (on) console.debug('[sonora]', ...args);
}
