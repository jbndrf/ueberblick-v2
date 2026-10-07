// WP-129: /model re-exports config types type-only; its built entry must not pull Zod.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const entry = new URL('./model.ts', import.meta.url).pathname;

describe('/model entry', () => {
  it('bundles without zod or any schema module', async () => {
    const r = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(r.metafile.inputs);
    expect(inputs.some((i) => i.includes('node_modules/zod'))).toBe(false);
    expect(inputs.some((i) => i.includes('/schema/'))).toBe(false);
  });

  it('re-exports the config types with export type only', () => {
    const src = readFileSync(entry, 'utf8');
    expect(src).toMatch(/export type \{[^}]*\bView\b[^}]*\} from '\.\/schema'/s);
    expect(src).not.toMatch(/^export (?!type)[^\n]*from '\.\/schema/m);
  });
});
