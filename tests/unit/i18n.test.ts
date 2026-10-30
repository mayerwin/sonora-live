import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FR } from '../../src/app/fr.ts';
import { browserLang, lang, t, tn } from '../../src/app/i18n.ts';

/** Every source file of the app. */
function sources(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Reads the string literal at `i` ('…', "…" or `…` without ${}), or null when the argument is not one. */
function literal(src: string, i: number): { text: string; end: number } | null {
  while (/\s/.test(src[i])) i++;
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      out += src[++j];
      continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') return null;
    if (c === q) return { text: out, end: j + 1 };
    out += c;
  }
  return null;
}

/** The English strings the code translates: t('…') and the two forms of tn(n, '…', '…'). */
function used(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources()) {
    if (file.endsWith('fr.ts')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?<![\w.])(t|tn)\(/g)) {
      let i = m.index! + m[0].length;
      if (m[1] === 'tn') {
        // skip the count, up to the first comma outside brackets
        let depth = 0;
        for (; i < src.length; i++) {
          const c = src[i];
          if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) depth--;
          else if (c === ',' && depth === 0) break;
        }
        const one = literal(src, i + 1);
        const other =
          one && src.slice(one.end).match(/^\s*,/) ? literal(src, one.end + src.slice(one.end).indexOf(',') + 1) : null;
        if (one) found.set(one.text, file);
        if (other) found.set(other.text, file);
      } else {
        const s = literal(src, i);
        if (s) found.set(s.text, file);
      }
    }
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const markup = (s: string) => [...s.matchAll(/<\/?(b|code|a)>/g)].map((m) => m[0]);

describe('French translation', () => {
  const strings = used();

  it('finds the strings in the code', () => {
    expect(strings.size).toBeGreaterThan(300);
    expect(strings.has("You're in. Waiting for others…")).toBe(true);
    expect(strings.has('{n} people')).toBe(true);
  });

  it('translates every string the code shows', () => {
    const missing = [...strings].filter(([s]) => !(s in FR)).map(([s, file]) => `${file}: ${s}`);
    expect(missing).toEqual([]);
  });

  it('has no translation left over from text the code no longer shows', () => {
    expect(Object.keys(FR).filter((k) => !strings.has(k))).toEqual([]);
  });

  it('keeps the placeholders and the markup of each string', () => {
    for (const [en, fr] of Object.entries(FR)) {
      expect(placeholders(fr), en).toEqual(placeholders(en));
      expect(markup(fr), en).toEqual(markup(en));
    }
  });

  it('follows French typography: no plain space before a colon, a question mark or a percent sign', () => {
    for (const fr of Object.values(FR)) expect(fr).not.toMatch(/ [:;?!%»]/);
  });
});

describe('languages', () => {
  it('picks the first language of the browser that Sonora Live speaks', () => {
    expect(browserLang(['fr-FR', 'en-US'])).toBe('fr');
    expect(browserLang(['fr-CA'])).toBe('fr');
    expect(browserLang(['de-DE', 'en-GB', 'fr'])).toBe('en');
    expect(browserLang(['de-DE', 'fr'])).toBe('fr');
    expect(browserLang(['ja'])).toBe('en');
    expect(browserLang([])).toBe('en');
  });

  it('translates, fills placeholders and uses each language’s plural rules', () => {
    const before = lang.peek();
    try {
      lang.value = 'en';
      expect(t('{name} joined', { name: 'Clara' })).toBe('Clara joined');
      expect(tn(0, '{n} person', '{n} people')).toBe('0 people');
      expect(tn(1, '{n} person', '{n} people')).toBe('1 person');
      lang.value = 'fr';
      expect(t('Leave')).toBe('Quitter');
      expect(t('{name} joined', { name: 'Clara' })).toBe('Clara vient d’arriver');
      // in French, 0 and 1 are singular
      expect(tn(0, '{n} person', '{n} people')).toBe('0 personne');
      expect(tn(1, '{n} person', '{n} people')).toBe('1 personne');
      expect(tn(2, '{n} person', '{n} people')).toBe('2 personnes');
      expect(t('Sound: {mode}', { mode: 'Voix' })).toBe('Son : Voix');
    } finally {
      lang.value = before;
    }
  });
});
