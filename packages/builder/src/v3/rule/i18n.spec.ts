import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname;
const components = readdirSync(here)
  .filter((f) => f.endsWith('.svelte') && !f.includes('.testing.'))
  .map((f) => join(here, f));

function markupOf(code: string): string {
  return code.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
}

function literalText(code: string): string[] {
  let markup = markupOf(code);
  // Svelte blocks and expressions nest: peel the innermost braces until none are left.
  for (let prev = ''; prev !== markup;) {
    prev = markup;
    markup = markup.replace(/\{[^{}]*\}/g, '');
  }
  return [...markup.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? '').trim()).filter((t) => /\p{L}/u.test(t));
}

function literalAttrs(code: string): string[] {
  return [...markupOf(code).matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)].map(
    (m) => m[1] ?? '',
  );
}

describe('the rule pane goes through Paraglide', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThanOrEqual(5);
  });

  it.each(components)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(literalText(code)).toEqual([]);
    expect(literalAttrs(code)).toEqual([]);
  });
});
