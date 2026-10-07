import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { isSorted } from '../../../scripts/messages-sort.mjs';

const dirs = ['./components/', './form/', './feature-sheet/', './task-sheet/'].map(
  (d) => new URL(d, import.meta.url),
);
const components = dirs.flatMap((d) =>
  readdirSync(d)
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => new URL(f, d)),
);

/** Visible text nodes of a component's markup, outside script, style and `{...}` expressions. */
function literalText(src: string): string[] {
  const markup = src
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/\{[^{}]*\}/g, '');
  return [...markup.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? '').trim()).filter((t) => /\p{L}/u.test(t));
}

/** String-valued attributes users see or hear. */
function literalAttrs(src: string): string[] {
  const markup = src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return [...markup.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)].map((m) => m[1] ?? '');
}

describe('strings go through Paraglide', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThanOrEqual(7);
  });

  it.each(components)('%s has no literal user-visible text', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(literalText(src)).toEqual([]);
    expect(literalAttrs(src)).toEqual([]);
  });

  it('every message exists in every locale', () => {
    const load = (l: string) =>
      Object.keys(
        JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8')) as object,
      );
    expect(load('de').sort()).toEqual(load('en').sort());
  });

  it.each(['de', 'en'])('%s messages are sorted (run npm run messages:sort)', (l) => {
    const text = readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8');
    expect(isSorted(text)).toBe(true);
  });
});
