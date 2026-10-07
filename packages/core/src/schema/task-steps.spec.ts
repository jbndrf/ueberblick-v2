// WP-616: the schema of multi-step tasks, the button presentation and the confirmation.
import { describe, expect, it } from 'vitest';
import { TASK_STEP_KINDS } from '../registry';
import { goldenAssets } from '../testing/golden';
import { compile } from './compile';
import { TemplateFileSchema } from './file';
import { TaskSchema } from './task';
import { stepProperties, stepsOf } from './steps-of';

const base = { label: 'Pflege', on: 'baum' };
const ok = (t: object): boolean => TaskSchema.safeParse({ ...base, ...t }).success;

describe('task steps schema', () => {
  it('knows the three kinds from the registry', () => {
    expect(TASK_STEP_KINDS.keys).toEqual(['form', 'quick_edit', 'location']);
  });
  it('accepts each kind and keeps the order', () => {
    const t = TaskSchema.parse({
      ...base,
      form: { befund: {} },
      steps: [
        { kind: 'location', property: 'geom' },
        { kind: 'form' },
        { kind: 'quick_edit', properties: ['art'] },
      ],
    });
    expect(t.steps?.map((s) => s.kind)).toEqual(['location', 'form', 'quick_edit']);
    expect(stepProperties(t)).toEqual(['geom', 'art']);
  });
  it('refuses an unknown kind, unknown keys and empty lists', () => {
    expect(ok({ steps: [{ kind: 'photo' }] })).toBe(false);
    expect(ok({ steps: [{ kind: 'location', property: 'geom', extra: 1 }] })).toBe(false);
    expect(ok({ steps: [{ kind: 'quick_edit', properties: [] }] })).toBe(false);
    expect(ok({ steps: [] })).toBe(false);
  });
  it('ties the form step to the task form', () => {
    expect(ok({ form: { a: {} }, steps: [{ kind: 'location', property: 'geom' }] })).toBe(false);
    expect(ok({ steps: [{ kind: 'form' }, { kind: 'location', property: 'geom' }] })).toBe(false);
    expect(ok({ form: { a: {} }, steps: [{ kind: 'form' }] })).toBe(false);
    const two = [{ kind: 'form' }, { kind: 'form' }, { kind: 'location', property: 'g' }];
    expect(ok({ form: { a: {} }, steps: two })).toBe(false);
    expect(ok({ form: { a: {} }, steps: [{ kind: 'form' }, { kind: 'location', property: 'g' }] })).toBe(
      true,
    );
  });
  it('refuses a property written by two steps', () => {
    const steps = [{ kind: 'form' }, { kind: 'quick_edit', properties: ['a'] }];
    expect(ok({ form: { a: {} }, steps })).toBe(false);
  });
  it('a task without steps is its form', () => {
    expect(stepsOf({ form: {} })).toEqual([{ kind: 'form' }]);
    expect(stepsOf({})).toEqual([]);
  });
  it('button presentation and confirm round-trip', () => {
    const input = {
      ...base,
      button: { label: { de: 'Mangel', en: 'Defect' }, color: 'danger', icon: 'triangle-alert' },
      confirm: { de: 'Wirklich melden?', en: 'Report it?' },
    };
    expect(TaskSchema.parse(input)).toEqual(input);
    expect(ok({ button: { color: '#c0392b' } })).toBe(true);
    expect(ok({ button: { color: 'crimson' } })).toBe(false);
    expect(ok({ button: { icon: 'Not An Icon' } })).toBe(false);
    expect(ok({ button: { size: 'big' } })).toBe(false);
  });
});

describe('task steps at compile time', () => {
  const file = (task: object): unknown => ({
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
          stufe: { type: 'select', options: { neu: 'Neu', fertig: 'Fertig' } },
        },
        process: { property: 'stufe', start: 'neu', end: ['fertig'] },
      },
    },
    tasks: { t: { label: 'T', on: 'baum', ...task } },
  });
  const codes = (task: object): string[] => {
    const r = compile(TemplateFileSchema.parse(file(task)), { assets: goldenAssets });
    return r.ok ? [] : r.problems.map((p) => p.code);
  };

  it('accepts quick edit and a location step on a geometry property', () => {
    const steps = [
      { kind: 'quick_edit', properties: ['art'] },
      { kind: 'location', property: 'geom' },
    ];
    expect(codes({ steps })).toEqual([]);
  });
  it('refuses a location step on a non-geometry property', () => {
    expect(codes({ steps: [{ kind: 'location', property: 'art' }] })).toContain('task_step_property_invalid');
  });
  it('refuses an unknown property', () => {
    expect(codes({ steps: [{ kind: 'quick_edit', properties: ['nope'] }] })).toContain('dangling_reference');
  });
  it('a step may not write the process property', () => {
    expect(codes({ steps: [{ kind: 'quick_edit', properties: ['stufe'] }] })).toContain(
      'process_property_written',
    );
  });
});
