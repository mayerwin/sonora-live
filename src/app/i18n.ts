// Languages: English, the text written in the code, then French, Spanish, German, Italian and Portuguese. The
// browser's language decides, unless one is chosen in Settings. Strings are looked up by their English text (as
// gettext does), so the code stays readable; a unit test checks that every string the code passes to t() or tn() has
// its translation in each language. Only the language in use is loaded (main.tsx waits for it before the first paint).

import { effect, signal } from '@preact/signals';
import { settings } from './settings.ts';

export type Lang = 'en' | 'fr' | 'es' | 'de' | 'it' | 'pt';
export type LanguageSetting = 'auto' | Lang;

/** Each language in its own words. */
export const LANGUAGES: { value: Lang; name: string }[] = [
  { value: 'en', name: 'English' },
  { value: 'fr', name: 'Français' },
  { value: 'es', name: 'Español' },
  { value: 'de', name: 'Deutsch' },
  { value: 'it', name: 'Italiano' },
  { value: 'pt', name: 'Português' },
];

const CODES = new Set<string>(LANGUAGES.map((l) => l.value));

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Record<string, string>>> = {
  fr: () => import('./fr.ts').then((m) => m.FR),
  es: () => import('./es.ts').then((m) => m.ES),
  de: () => import('./de.ts').then((m) => m.DE),
  it: () => import('./it.ts').then((m) => m.IT),
  pt: () => import('./pt.ts').then((m) => m.PT),
};

/** the dictionaries loaded so far (a new one re-renders what is on screen) */
const dicts = signal<Partial<Record<Lang, Record<string, string>>>>({});
const loading = new Map<Lang, Promise<void>>();

/** Load a language's dictionary (once). */
export function loadLang(l: Lang): Promise<void> {
  if (l === 'en' || dicts.peek()[l]) return Promise.resolve();
  let p = loading.get(l);
  if (!p) {
    p = LOADERS[l]().then(
      (d) => {
        dicts.value = { ...dicts.peek(), [l]: d };
      },
      () => {
        // offline before it was ever cached: English until it can load
        loading.delete(l);
      },
    );
    loading.set(l, p);
  }
  return p;
}

/** The first of the browser's preferred languages that Sonora Live speaks. */
export function browserLang(
  prefs: readonly string[] = typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): Lang {
  for (const p of prefs) {
    const base = (p ?? '').toLowerCase().split('-')[0];
    if (CODES.has(base)) return base as Lang;
  }
  return 'en';
}

const resolve = (s: LanguageSetting | undefined): Lang => (s && s !== 'auto' && CODES.has(s) ? s : browserLang());

export const lang = signal<Lang>(resolve(settings.peek().language));

/** The language in use, loaded: what the first paint waits for. */
export const langReady: Promise<void> = loadLang(lang.peek());

effect(() => {
  lang.value = resolve(settings.value.language);
});

effect(() => {
  void loadLang(lang.value);
  if (typeof document !== 'undefined') document.documentElement.lang = lang.value;
});

type Vars = Record<string, string | number>;

function fill(s: string, vars: Vars): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The text in the current language; `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Vars): string {
  const s = dicts.value[lang.value]?.[text] ?? text;
  return vars ? fill(s, vars) : s;
}

/** Singular or plural by the rules of the current language (in French, 0 and 1 are singular); `{n}` is the count. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const form = new Intl.PluralRules(lang.value).select(n) === 'one' ? one : other;
  return t(form, { n, ...vars });
}

/** The sentence with a capital first letter (when it starts with a name like "this browser"). */
export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A time of day, in the current language's format. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(lang.value, { hour: '2-digit', minute: '2-digit' });
}
