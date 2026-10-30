// Screenshots for the README, the web app manifest and the social preview, taken from a real lesson: two Chromium
// instances (teacher and student) meet through the development server's local relay, with stand-in camera
// scenes (tools/brand/scenes.html) and a short piano phrase as the microphone.
//
//   npx vite --port 5180 &            (development server with the local relay)
//   node tools/screenshots.ts         (PW_CHROMIUM=/path/to/chrome to use a local Chromium)

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { fakeMidiScript } from '../tests/e2e/fake-midi.ts';

const URL = process.env.APP_URL ?? 'http://localhost:5180/';
const TMP = resolve('tmp/screens');
const DOCS = resolve('docs/screenshots');
mkdirSync(TMP, { recursive: true });
mkdirSync(DOCS, { recursive: true });
mkdirSync('public/social', { recursive: true });
const exe = process.env.PW_CHROMIUM || undefined;

// 1. camera scenes -> Y4M files Chromium can use as a fake camera
{
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  for (const s of ['keys', 'score']) {
    await p.goto(`file://${resolve('tools/brand/scenes.html')}?scene=${s}`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${TMP}/${s}.png` });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', `${TMP}/${s}.png`, '-t', '1', '-r', '10', '-pix_fmt', 'yuv420p', `${TMP}/${s}.y4m`]);
  }
  await b.close();
}
// 2. a soft C major chord as the microphone (so the level meters move without clipping)
if (!existsSync(`${TMP}/piano.wav`)) {
  const f = (n: string) => ['-i', `public/piano/ogg/${n}.ogg`];
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...f('mf-c2'), ...f('mf-c3'), ...f('mf-e3'), ...f('mf-g3'),
    '-filter_complex', '[1]adelay=250|250[b];[2]adelay=500|500[c];[3]adelay=750|750[d];[0][b][c][d]amix=inputs=4:normalize=0,volume=0.35,aloop=loop=-1:size=2e6',
    '-t', '20', '-ar', '48000', '-ac', '2', `${TMP}/piano.wav`,
  ]);
}

async function launch(scene: string): Promise<Browser> {
  return chromium.launch({
    executablePath: exe,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${TMP}/${scene}.y4m`,
      `--use-file-for-fake-audio-capture=${TMP}/piano.wav`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

async function person(b: Browser, opts: { name: string; role: string; piano: string; hash?: string; w: number; h: number; dpr?: number; mobile?: boolean }): Promise<Page> {
  const ctx = await b.newContext({
    viewport: { width: opts.w, height: opts.h },
    deviceScaleFactor: opts.dpr ?? 1,
    isMobile: opts.mobile,
    hasTouch: opts.mobile,
    permissions: ['camera', 'microphone'],
  });
  await ctx.addInitScript(fakeMidiScript(opts.piano));
  const p = await ctx.newPage();
  await p.goto(`${URL}${opts.hash ? `#${opts.hash}` : ''}`);
  await p.getByPlaceholder('e.g. Clara').fill(opts.name);
  await p.locator(`button.role[data-role=${opts.role}]`).click();
  await p.waitForTimeout(700);
  return p;
}

const settle = (p: Page, ms = 900) => p.waitForTimeout(ms);
const hideToasts = (p: Page) => p.addStyleTag({ content: '.toasts{display:none!important}' });

const teacherB = await launch('score');
const studentB = await launch('keys');

// lobby
const teacher = await person(teacherB, { name: 'Clara', role: 'teacher', piano: 'Roland FP-30X', w: 1600, h: 900 });
await settle(teacher, 1500);
await teacher.screenshot({ path: `${DOCS}/lobby.png` });
await teacher.locator('.join-card .btn-primary').click();
await settle(teacher, 1200);
await teacher.screenshot({ path: `${DOCS}/waiting.png` });
const code = await teacher.evaluate(() => location.hash.slice(1));

// the student joins from a phone
const student = await person(studentB, { name: 'Leo', role: 'student', piano: 'Yamaha P-125', hash: code, w: 390, h: 844, dpr: 2, mobile: true });
await student.locator('.join-card .btn-primary').click();
await teacher.waitForFunction(() => (window as any).sonora.peers.value.some((p: any) => p.link === 'connected' && p.remote));
await settle(teacher, 2500);

// both connect their digital piano: tap MIDI, pick it
for (const [p, name] of [[teacher, 'Roland FP-30X'], [student, 'Yamaha P-125']] as const) {
  await p.getByTestId('btn-midi').click();
  await p.getByTestId('midi-instrument').filter({ hasText: name }).click();
  await settle(p, 300);
  await p.keyboard.press('Escape');
}
await settle(teacher, 1200);

// a little conversation
const say = async (p: Page, text: string) => {
  if (!(await p.getByTestId('chat').isVisible())) await p.getByTestId('btn-chat').click();
  await p.getByRole('textbox', { name: 'Message' }).fill(text);
  await p.getByRole('textbox', { name: 'Message' }).press('Enter');
  await settle(p, 400);
};
await say(teacher, 'Lovely tone in the opening! Can you play bars 5–8 again, a little slower?');
await say(student, 'Sure! The left hand jump is still tricky 😅');
await say(teacher, 'Keep the wrist loose and look one beat ahead. Watch my hands 🎹');
await say(student, '👍👍');
await student.getByRole('button', { name: 'Close chat' }).click();

// the student plays a chord with the pedal down on their piano (it lights up, and sounds, at the teacher's)
await student.evaluate(() => {
  const play = (window as any).__midiPlay;
  play([0xb0, 64, 127]);
  for (const n of [48, 55, 64, 67, 72]) play([0x90, n, 88]);
});
await teacher.evaluate(() => {
  const play = (window as any).__midiPlay;
  for (const n of [60, 76]) play([0x90, n, 70]);
});
await settle(teacher, 1500);
await hideToasts(teacher);
await teacher.screenshot({ path: `${DOCS}/lesson.png` });
await teacher.screenshot({ path: 'public/social/screenshot-wide.png' });
await hideToasts(student);
await settle(student, 600);
await student.screenshot({ path: `${DOCS}/mobile.png` });
await student.screenshot({ path: 'public/social/screenshot-narrow.png' });

// the MIDI sheet and the settings
await teacher.getByTestId('btn-midi').click();
await settle(teacher, 1200);
await teacher.screenshot({ path: `${DOCS}/midi.png` });
await teacher.keyboard.press('Escape');
await teacher.getByTestId('btn-settings').click();
await settle(teacher, 600);
await teacher.screenshot({ path: `${DOCS}/settings.png` });
await teacher.getByRole('tab', { name: 'Connection' }).click();
await settle(teacher, 2500);
await teacher.screenshot({ path: `${DOCS}/connection.png` });
await teacher.keyboard.press('Escape');

// social preview (1200 x 630): the brand next to the lesson
{
  const p = await (await teacherB.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`${URL}`);
  await p.waitForTimeout(800);
  const shot = `data:image/png;base64,${(await teacher.screenshot({ type: 'png' })).toString('base64')}`;
  // keep the app's stylesheet (its fonts), replace the page
  await p.evaluate((html) => {
    document.body.innerHTML = html;
  }, `<style>
    body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0f0e13;color:#f4efe7;font-family:'Instrument Sans Variable',system-ui,sans-serif}
    .glow{position:absolute;inset:0;background:radial-gradient(800px 500px at 0% 0%,rgba(245,181,68,.18),transparent 60%),radial-gradient(700px 500px at 100% 100%,rgba(82,214,180,.12),transparent 60%)}
    .copy{position:absolute;left:64px;top:70px;width:470px}
    h1{font:400 66px/1 'Instrument Serif',Georgia,serif;margin:26px 0 18px;letter-spacing:-.01em}
    h1 em{color:#f5b544}
    p{font-size:22px;line-height:1.4;color:#cfc8bd;margin:0}
    .tags{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}
    .tags span{padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.07);font-weight:600;font-size:16px;color:#e9e1d4}
    .shot{position:absolute;left:580px;top:70px;width:760px;border-radius:22px;border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 80px rgba(0,0,0,.6)}
    .brand{display:flex;align-items:center;gap:14px;font:400 34px 'Instrument Serif',Georgia,serif}
    .brand em{color:#f5b544}
  </style><div class="glow"></div>
  <div class="copy"><div class="brand">${(await import('node:fs')).readFileSync('tools/brand/mark.svg', 'utf8').replace('<svg ', '<svg width="56" height="56" ')}<span>Sonora <em>Live</em></span></div>
  <h1>Music lessons, <em>face to face</em>, from anywhere.</h1>
  <p>Pure instrument sound and two-way MIDI between pianos. Peer to peer, in the browser.</p>
  <div class="tags"><span>Pure sound</span><span>Piano ↔ piano MIDI</span><span>Low latency</span><span>No account</span></div></div>
  <img class="shot" src="${shot}">`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'public/social/og-image.png' });
}

await teacherB.close();
await studentB.close();
console.log('screenshots written to docs/screenshots and public/social');
