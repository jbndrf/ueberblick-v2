/**
 * Budget (docs/12): participant shell JS <= 250 KB gzipped. This is the core share of it: a
 * participant-style import (subpaths: model, ports, registry, /hydrate + /expr + /sync + /fold) must not pull Zod, the checker,
 * the parser or JSTS (WP-122, course check 002). /geo is measured separately because it loads lazily.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build, type Plugin } from 'esbuild';
import { compile } from 'svelte/compiler';
import { beforeAll, describe, expect, it } from 'vitest';
import { defineBudget, docBudget, report } from '../harness/budget.mjs';

interface Measured {
  readonly gzipKb: number;
  readonly inputs: readonly string[];
}

async function measure(entry: string): Promise<Measured> {
  const result = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('esbuild produced no output');
  return {
    gzipKb: Math.round((gzipSync(out.contents).length / 1024) * 10) / 10,
    inputs: Object.keys(result.metafile.inputs),
  };
}

const has = (inputs: readonly string[], part: string): boolean => inputs.some((i) => i.includes(part));

const BANNED = [
  'node_modules/zod',
  'expr/check/check',
  'expr/check/functions',
  'expr/check/chain-shapes',
  'expr/parse/parser',
  'expr/parse/lexer',
  'expr/cql2',
  'registry/compile',
  'registry/expr-errors',
  'jsts',
  'proj4',
  'polylabel',
];

describe('participant shell: core share', () => {
  it('bundles without zod, the checker, the parser or JSTS', async () => {
    const m = await measure('./participant-entry.ts');
    console.log(`participant core: ${m.inputs.length} modules, ${m.gzipKb} KB gzip`);
    for (const banned of BANNED) expect(has(m.inputs, banned), banned).toBe(false);
    report(
      defineBudget({
        id: 'core-participant-gzip',
        limit: 30,
        unit: 'KB',
        derivedFrom: 'shell-js-gzip: the core share of the 250 KB shell',
        device: 'measured',
      }),
      m.gzipKb,
    );
  });

  it('bundles @ueberblick/core/memory without JSTS, proj4, zod, the checker or the parser (WP-543)', async () => {
    const m = await measure('./memory-entry.ts');
    console.log(`core/memory: ${m.inputs.length} modules, ${m.gzipKb} KB gzip`);
    for (const banned of BANNED) expect(has(m.inputs, banned), banned).toBe(false);
  });

  it('records the /geo cost separately (JSTS + proj4)', async () => {
    const m = await measure('./geo-entry.ts');
    expect(has(m.inputs, 'jsts')).toBe(true);
    expect(has(m.inputs, 'proj4')).toBe(true);
    report(
      defineBudget({
        id: 'core-geo-gzip',
        limit: 400,
        unit: 'KB',
        derivedFrom: 'shell-js-gzip: /geo loads lazily, it is not in the shell (lazy by default)',
        device: 'measured',
      }),
      m.gzipKb,
    );
  });
});

/** Compiles `.svelte` files (runes, TypeScript, injected CSS) the way the app build does. */
const sveltePlugin: Plugin = {
  name: 'svelte',
  setup(b) {
    b.onLoad({ filter: /\.svelte$/ }, (args) => {
      const out = compile(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        generate: 'client',
        css: 'injected',
      });
      return {
        contents: out.js.code,
        loader: 'js',
        resolveDir: new URL('.', `file://${args.path}`).pathname,
      };
    });
  },
};

interface Split {
  readonly initialKb: number;
  readonly lazy: readonly { readonly name: string; readonly kb: number }[];
  readonly initialInputs: readonly string[];
  readonly lazyInputs: readonly string[];
}

/** Bundles with code splitting: the entry chunk is what the shell loads first, dynamic imports are lazy chunks. */
async function measureSplit(entry: string): Promise<Split> {
  const result = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    minify: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    outdir: '/out',
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins: [sveltePlugin],
  });
  const meta = result.metafile.outputs;
  const kb = (contents: Uint8Array): number => Math.round((gzipSync(contents).length / 1024) * 10) / 10;
  let initialKb = 0;
  const initialInputs: string[] = [];
  const lazyInputs: string[] = [];
  const lazy: { name: string; kb: number }[] = [];
  for (const file of result.outputFiles) {
    const name = file.path.split('/').pop() ?? file.path;
    const entry = Object.entries(meta).find(([k]) => k.endsWith(`/${name}`));
    const inputs = entry ? Object.keys(entry[1].inputs) : [];
    if (name === 'shell-entry.js') {
      initialKb = kb(file.contents);
      initialInputs.push(...inputs);
    } else {
      lazy.push({ name, kb: kb(file.contents) });
      lazyInputs.push(...inputs);
    }
  }
  return { initialKb, lazy, initialInputs, lazyInputs };
}

describe('participant shell: real ui + client entries (docs/12: shell JS <= 250 KB gz)', () => {
  beforeAll(() => {
    // Paraglide messages are generated (gitignored); compile them when missing.
    if (!existsSync(new URL('../../packages/ui/src/paraglide/messages.js', import.meta.url))) {
      spawnSync('npm run i18n -w @ueberblick/ui', { shell: true, stdio: 'inherit' });
    }
  }, 120_000);

  it('bundles ui + client without zod, the checker, the parser or JSTS in the shell chunk', async () => {
    const m = await measureSplit('./shell-entry.ts');
    console.log(
      `shell (ui + client): ${m.initialInputs.length} modules, initial ${m.initialKb} KB gzip; lazy chunks: ` +
        (m.lazy.map((c) => `${c.name} ${c.kb} KB`).join(', ') || 'none'),
    );
    for (const banned of BANNED) expect(has(m.initialInputs, banned), banned).toBe(false);
    // Lazy chunks may hold maplibre-gl (map mount) and, when a tool needs it, JSTS; record which.
    console.log(
      `JSTS lazy chunk: ${has(m.lazyInputs, 'jsts')}; maplibre lazy chunk: ${has(m.lazyInputs, 'node_modules/maplibre-gl/')}`,
    );
    expect(has(m.initialInputs, 'node_modules/maplibre-gl/')).toBe(false);
    report(docBudget('shell-js-gzip'), m.initialKb);
  }, 120_000);
});
