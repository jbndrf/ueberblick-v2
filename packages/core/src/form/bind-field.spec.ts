// WP-434 (A-047): a bind field sees the bound Objekt's value as its own; a missing Objekt makes it not relevant.
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import type { EvalContext } from '../expr/contract';
import type { FeatureId, Json, Key } from '../model';
import { formApi } from './index';
import { NOW, world } from './__fixtures__';

const config = world({
  schema: 'ueberblick/1',
  template: { key: 'bf', version: '1.0.0' },
  roles: { boss: { label: 'Boss' } },
  types: {
    person: { label: 'Prüfer', properties: { name: { type: 'text' }, telefon: { type: 'text' } } },
    baum: {
      label: 'Baum',
      properties: { art: { type: 'text' }, pruefer: { type: 'reference', to: 'person' } },
    },
  },
  tasks: {
    t: {
      label: 'T',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: {
        'pruefer.telefon': {
          constraint: "value.startsWith('+49')",
          readonly: "form['pruefer.name'] == 'Anna'",
        },
        'pruefer.name': { relevant: 'true' },
      },
    },
  },
});
const T = 't' as Key;
const P = 'p1' as FeatureId;

function ctx(present: boolean, props: Readonly<Record<string, Json>>): EvalContext {
  return {
    vars: new Map<string, Json | { $feature: FeatureId }>([
      ['self', { $feature: 'b1' as FeatureId }],
      ['pruefer', present ? { $feature: P } : null],
      ['actor', { id: 'u1', role: 'boss', roles: ['boss'] }],
    ]),
    features: {
      property: (f, k) => (f === P ? props[k] : undefined),
      related: () => [],
      history: () => [],
      type: (f) => (f === P ? ('person' as never) : undefined),
    },
    now: NOW,
    relations: config.relations,
    geo: createGeo(),
  };
}
const present = ctx(true, { telefon: '+49 1', name: 'Berta' });

describe('bind field in core.form', () => {
  it('initial prefills the field from the bound Objekt; a preset wins', () => {
    expect(formApi.initial(T, config, present)).toEqual({
      'pruefer.telefon': '+49 1',
      'pruefer.name': 'Berta',
    });
    expect(formApi.initial(T, config, present, { 'pruefer.telefon': '+49 9' })['pruefer.telefon']).toBe(
      '+49 9',
    );
  });
  it('the field carries the bound property type and the bound Objektart (origin)', () => {
    const ev = formApi.evaluate(T, config, formApi.initial(T, config, present), present);
    const f = ev.fields.find((x) => x.key === 'pruefer.telefon');
    expect(f?.propertyType).toBe('text');
    expect(f?.bind).toEqual({ name: 'pruefer', type: 'person' });
    expect(ev.fields.find((x) => x.key === 'pruefer.name')?.bind?.type).toBe('person');
  });
  it('the constraint sees the bound value as `value`', () => {
    const bad = ctx(true, { telefon: '0123', name: 'Berta' });
    const ev = formApi.evaluate(T, config, formApi.initial(T, config, bad), bad);
    expect(ev.fields.find((x) => x.key === 'pruefer.telefon')?.issues.map((i) => i.issue)).toEqual([
      'constraint',
    ]);
  });
  it('an expression reads the bound value through `form`: readonly follows the name', () => {
    const anna = ctx(true, { telefon: '+49 1', name: 'Anna' });
    const ev = formApi.evaluate(T, config, formApi.initial(T, config, anna), anna);
    const f = ev.fields.find((x) => x.key === 'pruefer.telefon');
    expect(f?.readonly).toBe(true);
    expect(f?.value).toBe('+49 1');
  });
  it('a missing bound Objekt: every field of that bind is not relevant and not submitted', () => {
    const none = ctx(false, {});
    const ev = formApi.evaluate(T, config, { 'pruefer.telefon': '+49 5' }, none);
    expect(ev.fields.every((f) => !f.relevant)).toBe(true);
    expect(ev.valid).toBe(true);
    expect(formApi.submitValues(ev)).toEqual({});
  });
  it('a bound Objekt that is not on the device (no property reads) is not relevant either', () => {
    const gone: EvalContext = { ...present, features: { ...present.features, type: () => undefined } };
    const ev = formApi.evaluate(T, config, {}, gone);
    expect(ev.fields.every((f) => !f.relevant)).toBe(true);
  });
});
