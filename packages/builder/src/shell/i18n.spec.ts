import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from './messages';
import { isSorted } from '../../../../scripts/messages-sort.mjs';

const src = join(import.meta.dirname, '..');
const components = ['problems']
  .flatMap((d) => readdirSync(join(src, d)).map((f) => join(src, d, f)))
  .filter((f) => f.endsWith('.svelte'));

function literalText(code: string): string[] {
  const markup = code
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\{[^{}]*\}/g, '');
  return [...markup.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? '').trim()).filter((t) => /\p{L}/u.test(t));
}

function literalAttrs(code: string): string[] {
  const markup = code.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return [...markup.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)].map((m) => m[1] ?? '');
}

describe('builder strings go through Paraglide', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it.each(components)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(literalText(code)).toEqual([]);
    expect(literalAttrs(code)).toEqual([]);
  });

  it('every message exists in every locale', () => {
    const load = (l: string) =>
      Object.keys(JSON.parse(readFileSync(join(src, `../messages/${l}.json`), 'utf8')) as object);
    expect(load('de').sort()).toEqual(load('en').sort());
  });

  it.each(['de', 'en'])('%s messages are sorted (run npm run messages:sort)', (l) => {
    expect(isSorted(readFileSync(join(src, `../messages/${l}.json`), 'utf8'))).toBe(true);
  });

  it('translates with parameters, per call, without global state', () => {
    expect(messages('de')('problems_count', { n: 3 })).toBe('3 Probleme');
    expect(messages('en')('problems_count', { n: 3 })).toBe('3 problems');
    expect(messages('de-AT')('problems')).toBe('Probleme');
    expect(messages('fr')('problems')).toBe('Problems');
  });
});
