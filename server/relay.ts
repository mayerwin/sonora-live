// Local stand-in for the public MQTT brokers (src/net/relay.ts, LocalRelay): a tiny publish/subscribe hub on
// the WebSocket path /relay of the development and preview servers. It lets the app run without internet
// (`npm run dev`, then open `?relay=local`) and the browser tests (tests/e2e) run hermetically.
//
// Protocol (JSON text frames):
//   client -> server  {type:'sub', topic} | {type:'unsub', topic} | {type:'pub', topic, data}
//   server -> client  {type:'msg', topic, data}          data: base64 payload, opaque to the server

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

export const RELAY_PATH = '/relay';

export function attachRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const topics = new Map<string, Set<WebSocket>>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.endsWith(RELAY_PATH)) return; // Vite's HMR socket and others
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const mine = new Set<string>();
    ws.on('message', (raw) => {
      let m: { type?: string; topic?: string; data?: string };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (typeof m.topic !== 'string' || m.topic.length > 200) return;
      if (m.type === 'sub') {
        let set = topics.get(m.topic);
        if (!set) topics.set(m.topic, (set = new Set()));
        set.add(ws);
        mine.add(m.topic);
      } else if (m.type === 'unsub') {
        topics.get(m.topic)?.delete(ws);
        mine.delete(m.topic);
      } else if (m.type === 'pub' && typeof m.data === 'string') {
        const out = JSON.stringify({ type: 'msg', topic: m.topic, data: m.data });
        for (const peer of topics.get(m.topic) ?? []) if (peer.readyState === peer.OPEN) peer.send(out);
      }
    });
    ws.on('close', () => {
      for (const t of mine) {
        const set = topics.get(t);
        set?.delete(ws);
        if (set && !set.size) topics.delete(t);
      }
    });
  });
}
