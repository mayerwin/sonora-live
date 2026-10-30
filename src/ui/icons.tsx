import { Eye, GraduationCap, Music4 } from 'lucide-preact';
import type { Role } from '../net/room.ts';

/** The Sonora Live mark: a sound wave rising out of the keys. */
export function Logo({ size = 34, class: cls = 'brand-mark' }: { size?: number; class?: string }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sl-bg" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2a2633" />
          <stop offset="1" stop-color="#16141b" />
        </linearGradient>
        <linearGradient id="sl-wave" x1="10" y1="10" x2="54" y2="44" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ffd58a" />
          <stop offset="1" stop-color="#f09a2c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="url(#sl-bg)" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="16.5" stroke="#fff" stroke-opacity=".09" />
      <g fill="#f4efe7">
        <rect x="11" y="40" width="9" height="15" rx="2.2" />
        <rect x="22" y="40" width="9" height="15" rx="2.2" />
        <rect x="33" y="40" width="9" height="15" rx="2.2" />
        <rect x="44" y="40" width="9" height="15" rx="2.2" />
      </g>
      <g fill="#16141b">
        <rect x="17.5" y="40" width="5" height="8.5" rx="1.4" />
        <rect x="28.5" y="40" width="5" height="8.5" rx="1.4" />
        <rect x="41.5" y="40" width="5" height="8.5" rx="1.4" />
      </g>
      <path
        d="M11.5 30.5c4.2-9.6 8.6-14.4 13-14.4 7.6 0 7.4 15.8 15 15.8 4.4 0 8.4-4.8 13-14.4"
        stroke="url(#sl-wave)"
        stroke-width="5.2"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span class="brand-word">
      Sonora <em>Live</em>
    </span>
  );
}

export function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function RoleIcon({ role, size = 20 }: { role: Role; size?: number }) {
  if (role === 'teacher') return <Music4 size={size} />;
  if (role === 'observer') return <Eye size={size} />;
  return <GraduationCap size={size} />;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = [...parts[0]][0] ?? '';
  const b = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : '';
  return (a + b).toUpperCase();
}
