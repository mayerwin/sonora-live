// Renders the app icons, favicon PNGs and the social preview image from tools/brand/mark.svg with Chromium
// (Playwright). Run after changing the mark: `npm run icons` (PW_CHROMIUM=/path/to/chrome to use a local one).

import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const mark = readFileSync('tools/brand/mark.svg', 'utf8');
/** the mark without its rounded frame, for full-bleed icons (maskable, Apple) */
const inner = mark
  .replace(/<rect width="64" height="64" rx="17" fill="url\(#bg\)"\/>/, '')
  .replace(/<rect x="\.5" y="\.5"[^>]*\/>/, '');

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
mkdirSync('public/icons', { recursive: true });
mkdirSync('public/social', { recursive: true });

async function shot(html: string, size: number, path: string, transparent = true) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path, omitBackground: transparent });
}

const svg = (s: string, size: number) => s.replace('<svg ', `<svg width="${size}" height="${size}" `);
const bleed = (size: number, scale: number) =>
  `<div style="width:${size}px;height:${size}px;background:linear-gradient(#2b2734,#141218);display:grid;place-items:center">${svg(inner, Math.round(size * scale))}</div>`;

for (const s of [192, 512]) await shot(svg(mark, s), s, `public/icons/icon-${s}.png`);
await shot(svg(mark, 32), 32, 'public/icons/favicon-32.png');
// maskable: the platform crops to a circle or squircle, so the artwork stays inside the central 80 %
await shot(bleed(512, 0.78), 512, 'public/icons/icon-maskable-512.png', false);
await shot(bleed(180, 0.92), 180, 'public/icons/apple-touch-icon.png', false);
// notification badge (Android): white silhouette
await shot(
  svg(
    inner
      .replace(/url\(#ivory\)/g, '#fff')
      .replace(/url\(#gold\)/g, '#fff')
      .replace(/fill="#141218"/g, 'fill="#000" fill-opacity="0"'),
    96,
  ),
  96,
  'public/icons/badge-96.png',
);
await browser.close();
console.log('icons written to public/icons');
