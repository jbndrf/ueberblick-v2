// WP-672: a page title and description (`page`), a `placeholder` per field, and `appearance` checked against the registry.
import { describe, expect, it } from 'vitest';
import { FORM_APPEARANCES } from '../registry';
import { goldenAssets } from '../testing/golden';
import { compile } from './compile';
import { TemplateFileSchema } from './file';
import { FormFieldSchema, TaskSchema } from './task';

const ok = (f: unknown): boolean => FormFieldSchema.safeParse(f).success;

describe('form field: page, placeholder, appearance', () => {
  it('accepts a page title and description, localized or plain', () => {
    expect(ok({ page: { label: 'Zustand', hint: { de: 'Bitte prüfen', en: 'Please check' } } })).toBe(true);
    expect(ok({ page: {} })).toBe(true);
    expect(ok({ page: { label: { de: 'Zustand' } } })).toBe(true);
  });
  it('refuses a page of the wrong type or with unknown keys', () => {
    expect(ok({ page: 'Zustand' })).toBe(false);
    expect(ok({ page: true })).toBe(false);
    expect(ok({ page: { label: 3 } })).toBe(false);
    expect(ok({ page: { hint: [] } })).toBe(false);
    expect(ok({ page: { title: 'x' } })).toBe(false);
  });
  it('accepts a localized placeholder and refuses other types', () => {
    expect(ok({ placeholder: 'Name' })).toBe(true);
    expect(ok({ placeholder: { de: 'Name', en: 'Name' } })).toBe(true);
    expect(ok({ placeholder: 3 })).toBe(false);
    expect(ok({ placeholder: false })).toBe(false);
  });
  it('validates appearance tokens against the registry', () => {
    expect(FORM_APPEARANCES.keys).toEqual(['multiline', 'email']);
    for (const k of FORM_APPEARANCES.keys) expect(ok({ appearance: k })).toBe(true);
    expect(ok({ appearance: 'multiline email' })).toBe(true);
    expect(ok({ appearance: 'compact' })).toBe(false);
    expect(ok({ appearance: 'multiline  nope' })).toBe(false);
  });
  it('`page` is no appearance token: one way to start a page', () => {
    expect(ok({ appearance: 'page' })).toBe(false);
  });
});

describe('the compiled config carries page and placeholder', () => {
  const file = {
    schema: 'ueberblick/1',
    template: { key: 't', version: '1.0.0' },
    roles: { r: { label: 'R' } },
    types: {
      baum: {
        label: 'Baum',
        geometry: 'geom',
        permissions: { see: '$all', create: '$all', write: '$all' },
        properties: {
          geom: { type: 'geometry', geometry_type: 'point' },
          art: { type: 'text' },
          n: { type: 'text' },
        },
      },
    },
    tasks: {
      t: {
        label: 'T',
        on: 'baum',
        form: {
          art: { placeholder: { de: 'z. B. Linde' } },
          n: { page: { label: { de: 'Zweite Seite' }, hint: { de: 'Beschreibung' } } },
        },
      },
    },
  };
  it('keeps the values on the task form', () => {
    expect(TaskSchema.safeParse(file.tasks.t).success).toBe(true);
    const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const form = r.config.file.tasks?.['t']?.form;
    expect(form?.['art']?.placeholder).toEqual({ de: 'z. B. Linde' });
    expect(form?.['n']?.page).toEqual({ label: { de: 'Zweite Seite' }, hint: { de: 'Beschreibung' } });
  });
});
