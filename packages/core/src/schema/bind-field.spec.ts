// WP-434 (A-047): `form` keys of the form `<bind>.<property>` parse, and compile checks bind and property.
import { describe, expect, it } from 'vitest';
import { goldenAssets } from '../testing/golden';
import { compile } from './compile';
import { TaskSchema } from './task';
import { TemplateFileSchema } from './file';

const base = (form: Record<string, unknown>, bind: Record<string, string> = { pruefer: 'self.pruefer' }) => ({
  schema: 'ueberblick/1',
  template: { key: 'bf', version: '1.0.0' },
  roles: { boss: { label: 'Boss' } },
  types: {
    person: {
      label: 'Prüfer',
      properties: {
        name: { type: 'text' },
        telefon: { type: 'text' },
        baum: { type: 'reference', to: 'baum' },
      },
    },
    baum: {
      label: 'Baum',
      properties: {
        art: { type: 'text' },
        pruefer: { type: 'reference', to: 'person' },
      },
      relations: { helfer: { to: 'person', inverse_of: 'person.baum', cardinality: 'many' } },
    },
  },
  tasks: { kontrolle: { label: 'Kontrolle', on: 'baum', bind, form } },
});
const run = (form: Record<string, unknown>, bind?: Record<string, string>) =>
  compile(TemplateFileSchema.parse(base(form, bind)), { assets: goldenAssets });

describe('form key `<bind>.<property>`', () => {
  it('parses; plain keys stay plain; two dots, a leading dot and bad characters do not parse', () => {
    const ok = (k: string): boolean =>
      TaskSchema.safeParse({ label: 'x', on: 'baum', form: { [k]: {} } }).success;
    expect(ok('pruefer.telefon')).toBe(true);
    expect(ok('telefon')).toBe(true);
    expect(ok('a.b.c')).toBe(false);
    expect(ok('.b')).toBe(false);
    expect(ok('a.')).toBe(false);
    expect(ok('A.b')).toBe(false);
  });
  it('a valid bind field compiles', () => {
    expect(run({ art: {}, 'pruefer.telefon': {} }).ok).toBe(true);
  });
  it('an unknown bind is a dangling bound_feature', () => {
    const r = run({ 'nobody.telefon': {} });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems).toContainEqual(
        expect.objectContaining({
          code: 'dangling_reference',
          params: expect.objectContaining({ what: 'bound_feature', value: 'nobody' }),
        }),
      );
  });
  it('an unknown property of the bound type is a dangling property_of', () => {
    const r = run({ 'pruefer.nummer': {} });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems).toContainEqual(
        expect.objectContaining({
          code: 'dangling_reference',
          params: expect.objectContaining({ what: 'property_of', value: 'nummer' }),
        }),
      );
  });
  it('a list-valued bind is a typed problem: a form edits one Objekt', () => {
    const r = run({ 'helfer.telefon': {} }, { helfer: 'self.helfer' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('expression_type');
  });
  it('a plain key is still checked against the task subject, not the bound type', () => {
    const r = run({ telefon: {} });
    expect(r.ok).toBe(false);
  });
});
