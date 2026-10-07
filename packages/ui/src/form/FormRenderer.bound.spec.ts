// @vitest-environment jsdom
// WP-434 (A-047): a `<bind>.<property>` field is drawn like any field, with a small origin label naming the
// Objektart of the bound Objekt (v3 CmmnFieldChrome.svelte:42-47 "from parent" badge, there for a related field).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { compile } from '@ueberblick/core/compile';
import { createGeo } from '@ueberblick/core/geo';
import type { EvalContext } from '@ueberblick/core/expr';
import type { FeatureId, Property } from '@ueberblick/core/model';
import { TemplateFileSchema, type JsonValue } from '@ueberblick/core/schema';
import { goldenAssets } from '@ueberblick/core/testing';
import FormRenderer from './FormRenderer.svelte';
import { FormModelError } from './contract';
import { buildFormModel } from './model';
import { createFormSession } from './session';
import '../components/ui/jsdom-shims.testing';

const person = {
  name: { type: 'text', label: 'Name' },
  telefon: { type: 'text', label: 'Telefon' },
} as unknown as Record<string, Property>;
const file = {
  schema: 'ueberblick/1',
  template: { key: 'bf', version: '1.0.0' },
  roles: { kontrolle: { label: 'K' } },
  types: {
    person: { label: { de: 'Prüfer', en: 'Inspector' }, properties: person },
    baum: {
      label: 'Baum',
      properties: { art: { type: 'text', label: 'Art' }, pruefer: { type: 'reference', to: 'person' } },
    },
  },
  tasks: {
    t: {
      label: 'T',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: { art: {}, 'pruefer.telefon': {}, 'pruefer.name': { readonly: true } },
    },
  },
};
const compiled = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
const config = compiled.config;
const P = 'p1' as FeatureId;
const values: Record<string, JsonValue> = { telefon: '+49 1', name: 'Anna' };
const ctx: EvalContext = {
  vars: new Map<string, JsonValue | { $feature: FeatureId }>([
    ['self', { $feature: 'b1' as FeatureId }],
    ['pruefer', { $feature: P }],
    ['actor', { id: 'u1', role: 'kontrolle', roles: ['kontrolle'] }],
  ]),
  features: {
    property: (f, k) => (f === P ? values[k] : undefined),
    related: () => [],
    history: () => [],
    type: () => 'person' as never,
  },
  now: '2026-09-29T12:00:00.000Z',
  relations: config.relations,
  geo: createGeo(),
};
const input = {
  form: file.tasks.t.form as never,
  properties: file.types.baum.properties as unknown as Record<string, Property>,
  bound: { pruefer: { label: { de: 'Prüfer', en: 'Inspector' }, properties: person } },
};

describe('a bind field in the form', () => {
  it('the model takes the field from the bound Objektart and carries its name as origin', () => {
    const m = buildFormModel(input);
    const f = m.fields.find((x) => x.key === 'pruefer.telefon');
    expect(f?.type).toBe('text');
    expect(f?.label).toBe('Telefon');
    expect(f?.origin).toEqual({ de: 'Prüfer', en: 'Inspector' });
    expect(m.fields.find((x) => x.key === 'art')?.origin).toBeUndefined();
  });
  it('a bind the caller does not supply, or an unknown property, is a typed error', () => {
    expect(() => buildFormModel({ ...input, bound: {} })).toThrow(FormModelError);
    expect(() => buildFormModel({ ...input, bound: { pruefer: { label: 'x', properties: {} } } })).toThrow(
      FormModelError,
    );
  });
  it('renders prefilled from the bound value, labelled with its origin; plain fields have none', () => {
    const session = createFormSession(buildFormModel(input), {
      task: 't' as never,
      config,
      ctx,
      locale: 'de',
    });
    render(FormRenderer, { session, onsubmit: vi.fn(), oncancel: () => {} });
    expect((screen.getByLabelText(/Telefon/) as HTMLInputElement).value).toBe('+49 1');
    const origins = screen.getAllByTestId('field-origin');
    expect(origins).toHaveLength(2);
    expect(origins[0]?.textContent).toContain('Prüfer');
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).disabled).toBe(true);
  });
  it('submits the edited value under the bind field key', async () => {
    const session = createFormSession(buildFormModel(input), {
      task: 't' as never,
      config,
      ctx,
      locale: 'de',
    });
    session.set('pruefer.telefon', '+49 77');
    expect(session.submitValues()['pruefer.telefon']).toBe('+49 77');
  });
});
