// WP-506: the change list says WHAT of an element changed (form entries, button, rule parts, settings), not only that it did.
import { describe, expect, it } from 'vitest';
import { diff, type TemplateFile } from '@ueberblick/core';
import { groupsOf, type PlanInput } from './plan-view';

const perms = { see: '$all', create: '$all', write: '$all' };
const base = (extra: Record<string, unknown>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'k', version: '1.0.0' },
    types: { baum: { label: { de: 'Baum' }, permissions: perms, properties: {} } },
    ...extra,
  }) as unknown as TemplateFile;
const run = (before: TemplateFile, after: TemplateFile): PlanInput => ({
  before,
  after,
  diff: diff(before, after),
  versions: [],
  affected: [{ type: 'baum', features: 12 }],
  locale: 'de',
});
const linesOf = (before: TemplateFile, after: TemplateFile) =>
  groupsOf(run(before, after)).flatMap((g) => g.entries);

describe('change parts', () => {
  it('a task: names the form entries that changed and the Objekte of its type', () => {
    const t = (form: Record<string, unknown>) => ({
      tasks: { pruefen: { label: { de: 'Prüfen' }, on: 'baum', form } },
    });
    const before = base(t({ a: { label: { de: 'A' } }, b: { label: { de: 'B' } } }));
    const after = base(t({ a: { label: { de: 'A2' } }, c: { label: { de: 'C' } } }));
    const groups = groupsOf(run(before, after));
    const line = groups[0]?.entries.find((e) => e.path === 'tasks.pruefen');
    expect(line?.parts).toEqual(['form.a', 'form.b', 'form.c']);
    expect(groups[0]?.objects).toBe(12);
  });

  it('a task: a changed button is named', () => {
    const t = (button: string) => ({
      tasks: { pruefen: { label: { de: 'P' }, on: 'baum', button: { label: { de: button } } } },
    });
    const line = linesOf(base(t('x')), base(t('y'))).find((e) => e.path === 'tasks.pruefen');
    expect(line?.parts).toEqual(['button']);
  });

  it('an automatic action: its changed parts are named', () => {
    const r = (when: string) => ({
      tasks: { pruefen: { label: { de: 'P' }, on: 'baum', auto: { warn: { label: { de: 'W' }, when } } } },
    });
    const line = linesOf(base(r('true')), base(r('false'))).find((e) => e.path === 'tasks.pruefen.auto.warn');
    expect(line?.parts).toEqual(['when']);
  });

  it('a setting: a changed map key is one line of its own', () => {
    const m = (zoom: number) => ({ map: { zoom } });
    const lines = linesOf(base(m(1)), base(m(2)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ path: 'map.zoom', change: 'changed' });
  });

  it('an element added has no parts', () => {
    const after = base({ tasks: { n: { label: { de: 'N' }, on: 'baum' } } });
    const line = linesOf(base({ tasks: {} }), after).find((e) => e.path === 'tasks.n');
    expect(line).toMatchObject({ change: 'added' });
    expect(line?.parts).toBeUndefined();
  });

  it('a property: a changed label is named', () => {
    const p = (l: string): TemplateFile =>
      ({
        ...base({}),
        types: {
          baum: {
            label: { de: 'B' },
            permissions: perms,
            properties: { n: { type: 'text', label: { de: l } } },
          },
        },
      }) as unknown as TemplateFile;
    const line = linesOf(p('x'), p('y')).find((e) => e.path === 'types.baum.properties.n');
    expect(line?.parts).toEqual(['label']);
  });
});
