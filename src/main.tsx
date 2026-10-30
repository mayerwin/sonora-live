import '@fontsource-variable/instrument-sans';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './ui/styles.css';
import { render } from 'preact';
import { session } from './app/session.ts';
import { setupPwa } from './app/pwa.ts';
import { App } from './ui/App.tsx';

session.boot();
render(<App />, document.getElementById('app')!);
document.getElementById('boot')?.remove();
setupPwa(() => session.phase.peek() === 'room');

// development and tests: reach the session from the console
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { sonora: unknown }).sonora = session;
}
