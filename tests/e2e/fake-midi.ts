// A pretend digital piano for browsers without MIDI hardware (CI, screenshots): installs navigator.requestMIDIAccess
// with one instrument (an input and an output port). The page can play it with window.__midiPlay([status, d1, d2]);
// what the app sends to it is recorded in window.__midiOut. With `thru`, the instrument echoes what it receives back
// out of its input, like an instrument with MIDI thru enabled (to test loop prevention).

export function fakeMidiScript(name: string, thru = false): string {
  return `(() => {
    const NAME = ${JSON.stringify(name)};
    const THRU = ${thru ? 'true' : 'false'};
    window.__midiOut = [];
    const input = {
      id: 'in-1', name: NAME, manufacturer: 'Test', type: 'input', state: 'connected', connection: 'open',
      onmidimessage: null, onstatechange: null,
      addEventListener() {}, removeEventListener() {}, open() { return Promise.resolve(this); }, close() { return Promise.resolve(this); },
    };
    const output = {
      id: 'out-1', name: NAME, manufacturer: 'Test', type: 'output', state: 'connected', connection: 'open', onstatechange: null,
      send(data) {
        const m = Array.from(data);
        window.__midiOut.push(m);
        if (THRU) setTimeout(() => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(m) }), 5);
      },
      clear() {}, addEventListener() {}, removeEventListener() {}, open() { return Promise.resolve(this); }, close() { return Promise.resolve(this); },
    };
    const access = {
      inputs: new Map([['in-1', input]]),
      outputs: new Map([['out-1', output]]),
      sysexEnabled: false, onstatechange: null, addEventListener() {}, removeEventListener() {},
    };
    navigator.requestMIDIAccess = () => Promise.resolve(access);
    window.__midiPlay = (m) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(m) });
  })();`;
}
