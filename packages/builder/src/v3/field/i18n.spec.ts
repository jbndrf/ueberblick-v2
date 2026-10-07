import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROPERTY_TYPES } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { messages, type MessageKey } from '../../shell/messages';

const here = import.meta.dirname;
const components = ['.', '../shared']
  .flatMap((d) => readdirSync(join(here, d)).map((f) => join(here, d, f)))
  .filter((f) => f.endsWith('.svelte') && !f.includes('.testing.'));

const markupOf = (code: string): string =>
  code.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

function literalText(code: string): string[] {
  let markup = markupOf(code);
  // Svelte blocks and expressions nest: peel the innermost braces until none are left.
  for (let prev = ''; prev !== markup;) {
    prev = markup;
    markup = markup.replace(/\{[^{}]*\}/g, '');
  }
  return [...markup.matchAll(/>([^<>]+)</g)].map((m) => (m[1] ?? '').trim()).filter((t) => /\p{L}/u.test(t));
}

const literalAttrs = (code: string): string[] =>
  [...markupOf(code).matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{]+)"/g)].map((m) => m[1] ?? '');

describe('the Felddefinition goes through Paraglide', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThanOrEqual(5);
  });

  it.each(components)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(literalText(code)).toEqual([]);
    expect(literalAttrs(code)).toEqual([]);
  });
});

describe('the type select', () => {
  it('has a label for every property type of the registry', () => {
    const t = messages('de');
    for (const k of PROPERTY_TYPES.keys) expect(t(`field_type_${k}` as MessageKey), k).not.toBe('');
  });
});
