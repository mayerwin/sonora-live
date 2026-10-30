// Languages: English, the text written in the code, and French. The browser's language decides, unless one is
// chosen in Settings. Strings are looked up by their English text (as gettext does), so the code stays readable;
// a unit test checks that every string the code passes to t() or tn() has its translation.

import { effect, signal } from '@preact/signals';
import { settings } from './settings.ts';
import { FR } from './fr.ts';

export type Lang = 'en' | 'fr';
export type LanguageSetting = 'auto' | Lang;

/** Each language in its own words. */
export const LANGUAGES: { value: Lang; name: string }[] = [
  { value: 'en', name: 'English' },
  { value: 'fr', name: 'Français' },
];

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, fr: FR };

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
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}

const resolve = (s: LanguageSetting | undefined): Lang => (s === 'en' || s === 'fr' ? s : browserLang());

export const lang = signal<Lang>(resolve(settings.peek().language));

effect(() => {
  lang.value = resolve(settings.value.language);
  if (typeof document !== 'undefined') document.documentElement.lang = lang.value;
});

type Vars = Record<string, string | number>;

function fill(s: string, vars: Vars): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The text in the current language; `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Vars): string {
  const s = DICTS[lang.value]?.[text] ?? text;
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
