# Contributing to Sonora Live

Thank you for helping music teachers and students. Bug reports from real lessons are the most valuable contribution
of all: every network, browser and instrument is a little different.

## Reporting a problem

[Open an issue](https://github.com/mayerwin/sonora-live/issues/new/choose) and say, for **each side** of the lesson:

- the device and system (e.g. Windows 11 laptop, iPad, Android phone), the browser and its version;
- the instrument, if any, and how it is connected (USB, Bluetooth, which app or adapter);
- what you did, what you expected, what happened instead.

The connection log helps a lot: add `?debug` to the address (`https://mayerwin.github.io/sonora-live/?debug#ROOMCODE`),
reproduce the problem, open the browser's developer tools (F12) and copy the console lines that start with
`[sonora]`. **Settings → Connection** in the app shows the path, the round trip and the codec.

Security issues: see [SECURITY.md](SECURITY.md), please do not open a public issue.

## Working on the code

You need Node.js 22.18 or newer.

```sh
npm install
npm run dev          # http://localhost:5173, with a local relay (no internet needed)
```

Two browser tabs can meet in the same room locally. Before sending a change:

```sh
npm run typecheck
npm test             # unit tests
npm run e2e          # browser tests: real WebRTC between Chromium instances
npm run build
```

[CI](.github/workflows/ci.yml) runs all of them, the browser tests both on the development server and on the
production build.

### Guidelines

- **Reliability first.** A lesson must never stop because of us: handle every failure path (permissions refused,
  devices unplugged, networks changing, messages lost or duplicated), and add a test for each bug you fix.
- **Sound is sacred.** No processing on the instrument path in pure mode, no buffering that is not needed, nothing
  between the network and the speakers.
- **Plain words in the interface.** Teachers and students are musicians, not network engineers.
- **Every word on screen goes through `t()`** (or `tn()` for plurals) from [`src/app/i18n.ts`](src/app/i18n.ts), written
  in English as a whole sentence, with `{placeholders}` and, where needed, `<b>`, `<code>` or `<a>` (rendered by
  `<Rich>`). Add its French in [`src/app/fr.ts`](src/app/fr.ts): `npm test` fails on a missing or left-over
  translation. A new language is a new dictionary next to it.
- Keep the code in the style of the files around it: TypeScript strict, small modules, comments that explain *why*.
- Where it fits, write tests in `tests/unit` (Vitest) or `tests/e2e` (Playwright; `tests/e2e/fake-midi.ts` provides a
  pretend MIDI instrument).

## Project layout

See [the README](README.md#project-layout).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
