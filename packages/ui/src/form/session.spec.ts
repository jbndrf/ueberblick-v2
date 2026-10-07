import { describe, expect, it } from 'vitest';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import { sessionOptions } from './form.testing';
import type { Json, SessionOptions } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

const properties = {
  vitalitaet: P('integer', { min: 0, max: 5 }),
  befund: P('text'),
  foto: P('text'),
  summe: P('integer'),
};

type Form = Parameters<typeof buildFormModel>[0]['form'];
function make(form: Form, self: Record<string, Json> = {}, opts: Partial<SessionOptions> = {}) {
  const input = { form, properties };
  return createFormSession(buildFormModel(input), sessionOptions(input, self, opts));
}

describe('relevant', () => {
  it('hides non-relevant fields and does not submit their values (0015)', () => {
    const s = make(
      { vitalitaet: {}, foto: { relevant: 'form.vitalitaet >= 3' } },
      {},
      {
        initial: { vitalitaet: 1, foto: 'blob' },
      },
    );
    expect(s.isRelevant('foto')).toBe(false);
    expect(s.visibleFields(0).map((f) => f.key)).toEqual(['vitalitaet']);
    expect(s.submitValues()).toEqual({ vitalitaet: 1 });
    s.set('vitalitaet', 4);
    expect(s.isRelevant('foto')).toBe(true);
    expect(s.submitValues()).toEqual({ vitalitaet: 4, foto: 'blob' });
  });

  it('draft keeps hidden values so the form can be restored', () => {
    const s = make(
      { vitalitaet: {}, foto: { relevant: 'form.vitalitaet >= 3' } },
      {},
      {
        initial: { vitalitaet: 1, foto: 'blob' },
      },
    );
    expect(s.draft()).toEqual({ vitalitaet: 1, foto: 'blob' });
  });

  it('a hidden required field does not block validation', () => {
    const s = make(
      { vitalitaet: {}, foto: { relevant: 'form.vitalitaet >= 3', required: true } },
      {},
      {
        initial: { vitalitaet: 1 },
      },
    );
    expect(s.validateAll()).toEqual([]);
  });
});

describe('calculate', () => {
  it('prefills from the current value once', () => {
    const s = make({ vitalitaet: { calculate: 'self.vitalitaet' } }, { vitalitaet: 2 });
    expect(s.get('vitalitaet')).toBe(2);
  });

  it('editing is never overwritten (the v3 prefill bug)', () => {
    const s = make({ vitalitaet: { calculate: 'self.vitalitaet' }, befund: {} }, { vitalitaet: 2 });
    s.set('vitalitaet', 5);
    s.set('befund', 'x');
    expect(s.get('vitalitaet')).toBe(5);
  });

  it('an initial value wins over the prefill (assistant or draft)', () => {
    const s = make(
      { vitalitaet: { calculate: 'self.vitalitaet' } },
      { vitalitaet: 2 },
      {
        initial: { vitalitaet: 4 },
      },
    );
    expect(s.get('vitalitaet')).toBe(4);
  });

  it('a readonly calculated field follows its inputs', () => {
    const s = make(
      { vitalitaet: {}, summe: { calculate: 'form.vitalitaet * 2', readonly: true } },
      {},
      {
        initial: { vitalitaet: 1 },
      },
    );
    expect(s.get('summe')).toBe(2);
    s.set('vitalitaet', 3);
    expect(s.get('summe')).toBe(6);
  });
});

describe('validation', () => {
  it('required (boolean or expression), min, max, integer', () => {
    const s = make({ vitalitaet: { required: 'true' }, befund: { required: true } });
    expect(s.validateAll().map((i) => [i.fieldKey, i.kind])).toEqual([
      ['vitalitaet', 'required'],
      ['befund', 'required'],
    ]);
    s.set('vitalitaet', 9);
    s.set('befund', 'ok');
    expect(s.validateAll().map((i) => i.fault)).toEqual(['max']);
    s.set('vitalitaet', 2.5);
    expect(s.validateAll().map((i) => i.fault)).toEqual(['integer']);
    s.set('vitalitaet', 3);
    expect(s.validateAll()).toEqual([]);
  });

  it('constraint failure carries the localized constraint_message', () => {
    const s = make(
      {
        befund: {
          constraint: 'value != self.befund',
          constraint_message: { de: 'Muss sich ändern', en: 'Must change' },
        },
      },
      { befund: 'old' },
      { initial: { befund: 'old' }, locale: 'de' },
    );
    expect(s.validateAll()).toEqual([
      expect.objectContaining({ fieldKey: 'befund', kind: 'constraint', message: 'Muss sich ändern' }),
    ]);
    s.set('befund', 'new');
    expect(s.validateAll()).toEqual([]);
  });

  it('constraint is skipped for an empty optional value', () => {
    const s = make({ befund: { constraint: 'value != self.befund' } }, { befund: 'old' });
    expect(s.validateAll()).toEqual([]);
  });

  it('paging: values survive across pages; validation is per page', () => {
    const s = make({ vitalitaet: { required: true }, befund: { page: {}, required: true } });
    expect(s.validatePage(0).map((i) => i.fieldKey)).toEqual(['vitalitaet']);
    expect(s.validatePage(1).map((i) => i.fieldKey)).toEqual(['befund']);
    s.set('vitalitaet', 1);
    expect(s.validatePage(0)).toEqual([]);
    expect(s.get('vitalitaet')).toBe(1);
  });
});

describe('subscribe', () => {
  it('notifies on set and stops after unsubscribe', () => {
    const s = make({ befund: {} });
    let n = 0;
    const off = s.subscribe(() => (n += 1));
    s.set('befund', 'a');
    off();
    s.set('befund', 'b');
    expect(n).toBe(1);
  });
});
