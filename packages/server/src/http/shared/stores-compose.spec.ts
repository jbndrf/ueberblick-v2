import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';

describe('one store composition (R1, WP-170)', () => {
  const root = resolve(import.meta.dirname, '../../../../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (name === 'node_modules' || name === '.svelte-kit' || name === 'build' || isPlanted(name)) return [];
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  it('createStore( is called only inside composeProjectStore (plus tests, testkits and benches)', () => {
    const files = ['packages', 'apps', 'scripts']
      .flatMap((d) => walk(join(root, d)))
      .map((f) => relative(root, f))
      .filter((f) => /\.(ts|mjs|js|svelte)$/.test(f) && !/\.spec\.ts$/.test(f) && !/testkit\.ts$/.test(f))
      .filter((f) => !f.startsWith('packages/server/src/store/run/')); // the definition and its contract prose
    const offenders = files.filter((f) =>
      /(^|[^.\w])createStore\(/.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(offenders).toEqual(['packages/server/src/http/shared/stores.ts']);
  });
});
