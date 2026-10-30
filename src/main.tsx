import '@fontsource-variable/instrument-sans';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './ui/styles.css';
import { render } from 'preact';
import { session } from './app/session.ts';
import { setupPwa } from './app/pwa.ts';
import { watchForUpdates } from './app/update.ts';
import { App } from './ui/App.tsx';

// a page served from a cache right after a release reloads before anything else
watchForUpdates(() => session.phase.value);
session.boot();
render(<App />, document.getElementById('app')!);
document.getElementById('boot')?.remove();
setupPwa();

// development and tests: reach the session from the console
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { sonora: unknown }).sonora = session;
}
