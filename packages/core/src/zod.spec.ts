import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../scripts/testing/plant.mjs';
import { z } from './zod';

describe('zod config', () => {
  it('runs jitless once the wrapper is imported', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });
  it('does not probe new Function when parsing an object', () => {
    const real = globalThis.Function;
    let probed = false;
    globalThis.Function = new Proxy(real, {
      construct() {
        probed = true;
        throw new Error('blocked');
      },
    });
    try {
      z.object({ a: z.string() }).parse({ a: 'x' });
    } finally {
      globalThis.Function = real;
    }
    expect(probed).toBe(false);
  });

  // R1, WP-975: every value import of zod goes through the wrapper, so whoever brings zod also brings the config
  // (the participant shell must not import zod eagerly just to configure it).
  it('no value import of zod bypasses the wrapper', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', '.svelte-kit', 'build'].includes(name)) continue;
        const full = join(dir, name);
        if (isPlanted(full)) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|svelte)$/.test(name)) files.push(full);
      }
    };
    for (const pkg of ['core', 'server', 'client', 'ui', 'builder', 'tools']) walk(join(root, pkg));
    walk(join(root, '..', 'apps'));
    const bare =
      /^\s*(?:import\s+(?!type\b)[^;]*?from\s*|import\s*|export\s+(?!type\b)[^;]*?from\s*)['"]zod(?:\/[^'"]*)?['"]/m;
    const offenders = files
      .filter((f) => !f.endsWith('zod.ts') && !f.endsWith('zod.spec.ts'))
      .filter((f) => bare.test(readFileSync(f, 'utf8')))
      .map((f) => relative(join(root, '..'), f));
    expect(offenders).toEqual([]);
  });
});
