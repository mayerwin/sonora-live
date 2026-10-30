// Room codes: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L), e.g. "K7Q2MX".
// 31^6 ≈ 887 million codes; a room only exists while somebody is in it.

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function newRoomCode(): string {
  const r = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(r);
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[r[i] % CODE_ALPHABET.length];
  return s;
}

/** Canonical form of a typed or pasted code (case, spaces, dashes and a pasted link do not matter), or null. */
export function normalizeRoomCode(text: string): string | null {
  let t = text.trim();
  const hash = t.lastIndexOf('#');
  if (hash >= 0) t = t.slice(hash + 1);
  const c = t.toUpperCase().replace(/[\s\-_./]/g, '');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** "K7Q2MX" -> "K7Q 2MX" (easier to read out loud). */
export function prettyCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
