import { describe, expect, it } from 'vitest';
import { diff, type TemplateFile } from '@ueberblick/core';
import { blockersOf, groupsOf, mappingsOf, type PlanInput } from './plan-view';

const perms = { see: '$all', create: '$all', write: '$all' };
const file = (types: Record<string, unknown>, tasks: Record<string, unknown> = {}): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'k', version: '1.0.0' },
    roles: {},
    types,
    tasks,
  }) as unknown as TemplateFile;

const baum = (options: Record<string, string>, label = 'Baum') => ({
  label: { de: label },
  permissions: perms,
  process: { property: 'stage', start: 'a', end: ['c'] },
  properties: {
    stage: { type: 'select', label: { de: 'Phase' }, options },
    note: { type: 'text', label: { de: 'Notiz' } },
  },
});
const input = (
  before: TemplateFile | undefined,
  after: TemplateFile,
  affected: PlanInput['affected'] = [],
): PlanInput => ({
  before,
  after,
  diff: diff(before ?? { schema: after.schema, template: after.template }, after),
  versions: [],
  affected,
  locale: 'de',
});

describe('groupsOf', () => {
  it('the first deploy shows each Objektart as new, without a list of everything it has', () => {
    const groups = groupsOf(input(undefined, file({ baum: baum({ a: 'A', c: 'C' }) })));
    expect(groups).toEqual([
      { type: 'baum', label: 'Baum', isNew: true, isRemoved: false, objects: 0, entries: [] },
    ]);
  });

  it('collapses several edits of one element to one line and names a removed stage "Phase"', () => {
    const before = file({ baum: baum({ a: 'A', b: 'B', c: 'C' }) });
    const after = file({ baum: baum({ a: 'A', c: 'C' }, 'Baum neu') });
    const [group] = groupsOf(input(before, after, [{ type: 'baum', features: 7 }]));
    expect(group).toMatchObject({ type: 'baum', label: 'Baum neu', isNew: false, objects: 7 });
    const lines = group?.entries ?? [];
    expect(lines.find((e) => e.path === 'types.baum')).toMatchObject({ change: 'changed', name: 'Baum neu' });
    expect(lines.find((e) => e.path === 'types.baum.properties.stage.options.b')).toMatchObject({
      change: 'removed',
      breaking: true,
      stage: true,
    });
    expect(lines.filter((e) => e.path === 'types.baum')).toHaveLength(1);
  });

  it('an Objektart whose only change is a reorder lists the line and has no Objekte count (WP-411)', () => {
    const before = file({ baum: baum({ a: 'A', c: 'C' }) });
    const b = baum({ a: 'A', c: 'C' });
    const after = file({
      baum: { ...b, properties: { note: b.properties.note, stage: b.properties.stage } },
    });
    // `buildPlan` lists no affected count for a reorder-only type (plan-order.spec.ts)
    const [group] = groupsOf(input(before, after, []));
    expect(group?.entries.map((e) => e.change)).toEqual(['order_changed']);
    expect(group?.objects).toBe(0);
  });

  it('a removed Objektart is marked, a task and a rule belong to the Objektart they act on', () => {
    const before = file(
      { baum: baum({ a: 'A', c: 'C' }), zaun: { label: { de: 'Zaun' }, permissions: perms, properties: {} } },
      { pruefen: { label: { de: 'Prüfen' }, on: 'baum' } },
    );
    const after = file(
      { baum: baum({ a: 'A', c: 'C' }) },
      { pruefen: { label: { de: 'Kontrolle' }, on: 'baum' } },
    );
    const groups = groupsOf(input(before, after));
    expect(groups.find((g) => g.type === 'zaun')).toMatchObject({ isRemoved: true });
    expect(groups.find((g) => g.type === 'baum')?.entries.map((e) => e.path)).toContain('tasks.pruefen');
  });
});

describe('mappingsOf', () => {
  it('lists the breaking entries with the sibling targets, their labels and the affected count', () => {
    const before = file({ baum: baum({ a: 'A', b: 'B', c: 'C' }) });
    const after = file({ baum: baum({ a: 'Anfang', c: 'C' }) });
    const base = input(before, after);
    const withCount = { ...base, diff: base.diff.map((e) => (e.breaking ? { ...e, affected: 4 } : e)) };
    const [row] = mappingsOf(
      withCount,
      // what the builder's `buildPlan` lists for this change (the siblings left in the file)
      [{ path: 'types.baum.properties.stage.options.b', choices: ['a', 'c'] }],
    );
    expect(row).toMatchObject({
      path: 'types.baum.properties.stage.options.b',
      name: 'B',
      type: 'baum',
      stage: true,
      affected: 4,
    });
    expect(row?.choices).toEqual([
      { key: 'a', label: 'Anfang' },
      { key: 'c', label: 'C' },
    ]);
  });
});

describe('blockersOf', () => {
  it('keeps the Objektart the builder shows the problem under', () => {
    const items = [
      { id: '0', path: 'types.baum.x', code: 'x', message: 'm', location: { type: 'baum' } },
      { id: '1', path: 'roles.r', code: 'x', message: 'n', location: {} },
    ] as never;
    expect(blockersOf(items).map((b) => b.type)).toEqual(['baum', null]);
  });
});
