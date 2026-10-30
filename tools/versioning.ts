// Content-based cache busting (after Boom Buds). GitHub Pages serves every file with a 10-minute cache that cannot
// be changed, and the service worker keeps a copy for offline use, so every URL changes with its content:
//  - code, styles and fonts already have a content hash in their file names (Vite);
//  - the files of public/ that the app loads keep their names, and production builds add ?v=<hash of the
//    content>: the emoji names per file, the piano samples per set (module virtual:sonora-assets), the icons
//    and favicon linked from index.html;
//  - index.html carries a build id, a hash of its own content (which names every hashed file) and of those
//    hashes; the build also writes it to version.json, which the running app compares with its own
//    (src/app/update.ts) to load a newer build as soon as one is online.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

const VIRTUAL = 'virtual:sonora-assets';
const RESOLVED = '\0' + VIRTUAL;

function hashOf(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 10);
}

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, out);
    else out.push(p);
  }
  return out;
}

/** One hash for a whole folder: its files' paths and contents. */
export function hashTree(dir: string): string {
  const h = createHash('sha256');
  for (const f of filesUnder(dir).sort()) h.update(relative(dir, f).split('\\').join('/')).update(readFileSync(f));
  return h.digest('hex').slice(0, 10);
}

export interface AssetVersions {
  /** the piano samples, all formats */
  piano: string;
  /** emoji data, by language */
  emoji: Record<string, string>;
}

export function versioning(): Plugin {
  let config: ResolvedConfig;
  let assets: AssetVersions = { piano: '', emoji: {} };
  let buildId = '';
  const building = () => config.command === 'build' && !config.isWorker;
  return {
    name: 'sonora-versioning',
    configResolved(c) {
      config = c;
    },
    buildStart() {
      if (!building()) return;
      const emojiDir = join(config.publicDir, 'emoji');
      assets = {
        piano: hashTree(join(config.publicDir, 'piano')),
        emoji: Object.fromEntries(
          readdirSync(emojiDir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => [f.replace(/\.json$/, ''), hashOf(readFileSync(join(emojiDir, f)))]),
        ),
      };
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      // the dev server always serves the current files: no query there
      if (id === RESOLVED) return `export default ${JSON.stringify(building() ? assets : { piano: '', emoji: {} })};`;
      return null;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!building()) return html;
        html = html.replace(/href="\.?\/?((?:icons\/)?[^"?#/]+\.(?:png|ico|svg))"/g, (all, path: string) => {
          try {
            return `href="./${path}?v=${hashOf(readFileSync(join(config.publicDir, path)))}"`;
          } catch {
            return all;
          }
        });
        buildId = createHash('sha256').update(html).update(JSON.stringify(assets)).digest('hex').slice(0, 12);
        return html.replace('</head>', `  <meta name="sonora-build" content="${buildId}" />\n  </head>`);
      },
    },
    closeBundle() {
      if (!building() || !buildId) return;
      writeFileSync(
        join(resolve(config.root, config.build.outDir), 'version.json'),
        `${JSON.stringify({ build: buildId })}\n`,
      );
    },
  };
}
