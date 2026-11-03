// ICE servers. Public STUN servers let two browsers find a direct path through their routers, which works for
// the vast majority of home, school and mobile networks. A few networks (strict company firewalls, some
// carrier-grade NATs) block every direct path; a TURN relay gets through those. It can be configured at build
// time (repository variables, see README) or by the user in Settings → Connection.
//
//   VITE_TURN_URLS        comma separated, e.g. "turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443"
//   VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
//   VITE_TURN_API         URL answering with a JSON array of RTCIceServer (e.g. Metered's credentials API)

export interface TurnConfig {
  urls: string;
  username: string;
  credential: string;
}

const STUN: RTCIceServer = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };

let apiServers: RTCIceServer[] | null = null;
let apiFetchedAt = 0;

async function fromApi(url: string): Promise<RTCIceServer[]> {
  if (apiServers && Date.now() - apiFetchedAt < 30 * 60_000) return apiServers;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const j = await r.json();
    const list = (Array.isArray(j) ? j : j?.iceServers) as RTCIceServer[] | undefined;
    if (Array.isArray(list)) {
      apiServers = list.filter((s) => s && s.urls);
      apiFetchedAt = Date.now();
      return apiServers;
    }
  } catch {
    // no TURN this time: direct connections still work for most networks
  }
  return [];
}

function splitUrls(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^(stun|turns?):/i.test(u));
}

/**
 * A server entry the browser accepts: TURN needs a username and a credential (without them, creating any
 * connection throws), so TURN addresses without both are left out; STUN ones are kept.
 */
export function usable(urls: string[], username?: string, credential?: string): RTCIceServer | null {
  const ok = urls.filter((u) => /^stun:/i.test(u) || (!!username && !!credential));
  if (!ok.length) return null;
  return ok.some((u) => /^turns?:/i.test(u)) ? { urls: ok, username, credential } : { urls: ok };
}

export async function iceServers(user?: TurnConfig | null): Promise<RTCIceServer[]> {
  const list: RTCIceServer[] = [STUN];
  const env = import.meta.env ?? {};
  const add = (s: RTCIceServer | null) => s && list.push(s);
  add(usable(splitUrls(String(env.VITE_TURN_URLS ?? '')), env.VITE_TURN_USERNAME, env.VITE_TURN_CREDENTIAL));
  if (env.VITE_TURN_API) list.push(...(await fromApi(String(env.VITE_TURN_API))));
  if (user && user.urls.trim())
    add(usable(splitUrls(user.urls), user.username || undefined, user.credential || undefined));
  return list;
}

/** Is any TURN relay configured? (the connection panel says so) */
export function hasBuiltInTurn(): boolean {
  const env = import.meta.env ?? {};
  return !!(String(env.VITE_TURN_URLS ?? '').trim() || env.VITE_TURN_API);
}
