import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core/model';
import { localizedWith } from '@ueberblick/ui';
import { quickEditForm, quickEditInput } from './quick-edit';

describe('quick edit form (WP-1068)', () => {
  it('a file property gets the photo tool, other types none', () => {
    const form = quickEditForm(['foto', 'name'] as Key[], { foto: { type: 'file' }, name: { type: 'text' } });
    expect(form).toEqual({ foto: { tool: 'photo' }, name: {} });
  });
});

const picked = ['beschreibung' as Key];
const current = { beschreibung: { de: 'Alte Eiche', en: 'Old oak' } };

describe('quick edit of a localized_text property (WP-676)', () => {
  it('writes the whole localized value with only the participant locale changed', () => {
    const edited = { beschreibung: localizedWith(current.beschreibung, 'de', 'Sehr alte Eiche') };
    expect(quickEditInput(picked, current, edited)).toEqual({
      beschreibung: { de: 'Sehr alte Eiche', en: 'Old oak' },
    });
  });
  it('clearing one locale keeps the rest; clearing the last is an explicit null', () => {
    const one = { beschreibung: localizedWith(current.beschreibung, 'de', '') };
    expect(quickEditInput(picked, current, one)).toEqual({ beschreibung: { en: 'Old oak' } });
    const last = { beschreibung: localizedWith({ de: 'x' }, 'de', '') };
    expect(quickEditInput(picked, { beschreibung: { de: 'x' } }, last)).toEqual({ beschreibung: null });
  });
});
