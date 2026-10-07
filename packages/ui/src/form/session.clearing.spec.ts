import { describe, expect, it } from 'vitest';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import type { Json, SessionOptions } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;
const properties = { vitalitaet: P('integer', { min: 0, max: 5 }), befund: P('text'), foto: P('text') };

type Form = Parameters<typeof buildFormModel>[0]['form'];
function make(form: Form, self: Record<string, Json> = {}, opts: Partial<SessionOptions> = {}) {
  const input = { form, properties };
  return createFormSession(buildFormModel(input), sessionOptions(input, self, opts));
}

describe('clearing guard (owner Q5)', () => {
  const guarded: Form = { vitalitaet: {}, foto: { relevant: 'form.vitalitaet >= 3' }, befund: {} };

  it('lists a now-hidden field that holds a stored value, and submits null for it', () => {
    const s = make(guarded, { foto: 'blob', befund: 'rot' }, { initial: { vitalitaet: 1 } });
    expect(s.clearing().map((c) => c.key)).toEqual(['foto']);
    expect(s.submitValuesCleared()).toEqual({ vitalitaet: 1, foto: null });
    // The plain submit values still drop it (decision 0015).
    expect(s.submitValues()).toEqual({ vitalitaet: 1 });
  });

  it('does not list a hidden field with nothing stored, nor a relevant untouched one', () => {
    expect(make(guarded, {}, { initial: { vitalitaet: 1 } }).clearing()).toEqual([]);
    expect(make(guarded, { foto: 'blob' }, { initial: { vitalitaet: 4 } }).clearing()).toEqual([]);
  });

  it('follows the edits: hiding the field lists it, showing it again does not', () => {
    const s = make(guarded, { foto: 'blob' }, { initial: { vitalitaet: 4 } });
    s.set('vitalitaet', 0);
    expect(s.clearing().map((c) => c.key)).toEqual(['foto']);
    s.set('vitalitaet', 5);
    expect(s.clearing()).toEqual([]);
  });

  it('lists a field the user emptied, and not one left untouched', () => {
    const s = make(guarded, { befund: 'rot' }, { initial: { vitalitaet: 4 } });
    expect(s.clearing()).toEqual([]);
    s.set('befund', '');
    expect(s.clearing().map((c) => c.key)).toEqual(['befund']);
    expect(s.submitValuesCleared()).toMatchObject({ befund: null });
  });

  it('carries the localized label', () => {
    const labelled = {
      foto: P('text', { label: { de: 'Foto', en: 'Photo' } }),
      vitalitaet: properties.vitalitaet,
    };
    const input = {
      form: { vitalitaet: {}, foto: { relevant: 'form.vitalitaet >= 3' } } as Form,
      properties: labelled,
    };
    const s = createFormSession(
      buildFormModel(input),
      sessionOptions(input, { foto: 'x' }, { initial: { vitalitaet: 0 }, locale: 'de' }),
    );
    expect(s.clearing()).toEqual([{ key: 'foto', label: 'Foto' }]);
  });
});
