import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROPERTY_TYPES } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { messages, type MessageKey } from '../../shell/messages';
import { PALETTE_TILES, TYPE_ICONS } from './palette';

const here = import.meta.dirname;
const components = readdirSync(here)
  .filter((f) => f.endsWith('.svelte') && !f.includes('.testing.'))
  .map((f) => join(here, f));

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

describe('the form editor goes through Paraglide', () => {
  it('finds the components', () => {
    expect(components.length).toBeGreaterThanOrEqual(8);
  });

  it.each(components)('%s has no literal user-visible text', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(literalText(code)).toEqual([]);
    expect(literalAttrs(code)).toEqual([]);
  });

  it('every tile and every property type has its texts in German and English', () => {
    for (const locale of ['de', 'en']) {
      const t = messages(locale);
      for (const tile of PALETTE_TILES) {
        expect(t(`form_tile_${tile.key}` as MessageKey), tile.key).not.toBe('');
        expect(t(`form_tile_${tile.key}_desc` as MessageKey), tile.key).not.toBe('');
      }
    }
    expect(Object.keys(TYPE_ICONS).sort()).toEqual([...PROPERTY_TYPES.keys].sort());
  });

  it('the English texts are real translations, not the German ones', () => {
    const de = messages('de');
    const en = messages('en');
    for (const key of [
      'form_types',
      'form_library',
      'form_empty_title',
      'form_delete',
      'form_cfg_title',
      'form_cfg_help',
      'form_cfg_prefill_last_value',
      'form_cfg_force_dirty',
      'form_cfg_edit_definition',
      'form_cfg_msg_chars_between',
      'field_computed_expression',
      'field_file_documents',
      'field_date_and_time',
    ] as const) {
      expect(en(key), key).not.toBe(de(key));
    }
  });
});
