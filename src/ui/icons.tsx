import { Eye, GraduationCap, Music4 } from 'lucide-preact';
import type { Role } from '../net/room.ts';

/** The Sonora Live mark: piano keys sounding live, both ways (teacher and student). */
export function Logo({ size = 34, class: cls = 'brand-mark' }: { size?: number; class?: string }) {
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sl-bg" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2b2734" />
          <stop offset="1" stop-color="#141218" />
        </linearGradient>
        <linearGradient id="sl-gold" x1="8" y1="12" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ffd98f" />
          <stop offset="1" stop-color="#f0962a" />
        </linearGradient>
        <linearGradient id="sl-ivory" x1="0" y1="14" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <stop stop-color="#fffaf2" />
          <stop offset="1" stop-color="#e6ddcf" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="url(#sl-bg)" />
      <rect x=".5" y=".5" width="63" height="63" rx="16.5" stroke="#fff" stroke-opacity=".08" />
      <rect x="21" y="16" width="10.4" height="32" rx="3" fill="url(#sl-ivory)" />
      <rect x="32.6" y="16" width="10.4" height="32" rx="3" fill="url(#sl-ivory)" />
      <rect x="27.6" y="16" width="8.8" height="19" rx="2.2" fill="#141218" />
      <g stroke="url(#sl-gold)" stroke-width="4.4" stroke-linecap="round">
        <path d="M16.44 42.9a19 19 0 0 1 0-21.8M47.56 21.1a19 19 0 0 1 0 21.8" />
        <path d="M9.05 45.25a26.5 26.5 0 0 1 0-26.5M54.95 18.75a26.5 26.5 0 0 1 0 26.5" stroke-opacity=".55" />
      </g>
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
