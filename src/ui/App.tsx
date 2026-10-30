import { useEffect } from 'preact/hooks';
import { ArrowRight, Plus, RotateCcw } from 'lucide-preact';
import { session } from '../app/session.ts';
import { prettyCode } from '../net/code.ts';
import { Toasts } from './common.tsx';
import { Logo } from './icons.tsx';
import { Lobby } from './Lobby.tsx';
import { Room } from './Room.tsx';

export function App() {
  const phase = session.phase.value;
  // leaving the page by accident in the middle of a lesson
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (session.phase.peek() === 'room' && session.peers.peek().length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <>
      {phase === 'lobby' && <Lobby />}
      {phase === 'room' && <Room />}
      {phase === 'left' && <Left />}
      <Toasts />
    </>
  );
}

function Left() {
  const code = session.code.value;
  return (
    <div class="left-page">
      <div class="atmos" />
      <div class="card center-card" style="position:relative">
        <Logo size={56} />
        <h2>You left the lesson</h2>
        <p>Camera and microphone are off. The room stays open for the others.</p>
        <div class="code-actions" style="justify-content:center">
          <button
            class="btn btn-primary"
            onClick={() => {
              session.useCode(code);
              session.phase.value = 'lobby';
            }}
          >
            <RotateCcw /> Rejoin {prettyCode(code)}
          </button>
          <button
            class="btn"
            onClick={() => {
              session.newRoom();
              session.phase.value = 'lobby';
            }}
          >
            <Plus /> New room
          </button>
        </div>
        <a class="link-btn" href="https://github.com/mayerwin/sonora-live/issues" target="_blank" rel="noopener">
          Something not right? Tell us <ArrowRight size={14} style="vertical-align:-2px" />
        </a>
      </div>
    </div>
  );
}
