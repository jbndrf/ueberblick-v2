import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { condition } from '../expr/evaluate';
import type { Key } from '../model';
import { PROPERTY_TYPES } from '../registry';
import { FILTER_OPERATORS_BY_TYPE } from '../registry/filter';
import { compile } from '../schema/compile';
import { RoleAppSchema, TemplateFileSchema } from '../schema';
import { goldenAssets } from '../testing/golden';
import { validatePrefValue, type SavedFilter } from '../prefs';
import { actor, envFor, feature, FILE, world } from './__fixtures__/world';
import {
  type FilterSource,
  applyFilter,
  checkFilterPresets,
  compileFilter,
  filterFields,
  filterTerm,
  joinTerms,
} from './index';

const compiled = (filters: Record<string, string>) => {
  const r = compileFilter(world(), filters);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.filter;
};

describe('schema: filter_presets', () => {
  it('accepts presets with a label and one expression per type', () => {
    const r = RoleAppSchema.safeParse({
      filter_presets: { a: { label: { de: 'A' }, filters: { baum: 'true' } } },
    });
    expect(r.success).toBe(true);
  });
  it('refuses a preset without a label, or with a non-string filter', () => {
    expect(RoleAppSchema.safeParse({ filter_presets: { a: { filters: {} } } }).success).toBe(false);
    expect(
      RoleAppSchema.safeParse({ filter_presets: { a: { label: { de: 'A' }, filters: { baum: 3 } } } })
        .success,
    ).toBe(false);
  });
  it('the fixture file with a preset still compiles', () => {
    expect(compile(TemplateFileSchema.parse(FILE), { assets: goldenAssets }).ok).toBe(true);
  });
});

describe('checkFilterPresets', () => {
  const withPreset = (filters: Record<string, string>) =>
    TemplateFileSchema.parse({
      ...FILE,
      roles: {
        ...FILE.roles,
        bauhof: { label: { de: 'B' }, app: { filter_presets: { x: { label: { de: 'X' }, filters } } } },
      },
    });
  const path = (t: string) => `roles.bauhof.app.filter_presets.x.filters.${t}`;

  it('is empty for valid presets', () => {
    expect(checkFilterPresets(TemplateFileSchema.parse(FILE))).toEqual([]);
  });
  it('compile() refuses a file with a bad preset, with the path', () => {
    const r = compile(withPreset({ baum: 'self.nope == 1' }), { assets: goldenAssets });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((x) => x.path)).toContain(path('baum'));
  });
  it('reports a syntax error with the path', () => {
    const p = checkFilterPresets(withPreset({ baum: 'self.hoehe >' }));
    expect(p.map((x) => [x.path, x.code])).toEqual([[path('baum'), 'expression_parse']]);
  });
  it('reports a type error and an unknown property with the path', () => {
    const p = checkFilterPresets(withPreset({ baum: 'self.hoehe == "x"', bank: 'self.nope == 1' }));
    expect(p.map((x) => x.path).sort()).toEqual([path('bank'), path('baum')]);
    expect(p.every((x) => x.code === 'expression_type')).toBe(true);
  });
  it('reports an unknown type and a non-boolean expression', () => {
    const p = checkFilterPresets(withPreset({ wolke: 'true', baum: 'self.hoehe' }));
    expect(p.map((x) => [x.path, x.code]).sort()).toEqual([
      [path('baum'), 'expression_type'],
      [path('wolke'), 'dangling_reference'],
    ]);
  });
});

describe('compileFilter', () => {
  it('compiles per type', () => {
    const f = compiled({ baum: 'self.hoehe > 3', bank: 'self.material == "holz"' });
    expect([...f.predicates.keys()].sort()).toEqual(['bank', 'baum']);
  });
  it('refuses with the type as path (saved filters are plain strings)', () => {
    const r = compileFilter(world(), { baum: 'self.hoehe >', wolke: 'true' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.path).sort()).toEqual(['filters.baum', 'filters.wolke']);
  });
});

describe('applyFilter', () => {
  const trees = [
    feature('b1', 'baum', { status: 'ok', hoehe: 5, zustaendig: 'u1', intern_notiz: 'zu fällen' }),
    feature('b2', 'baum', { status: 'krank', hoehe: 2, zustaendig: 'u2', intern_notiz: 'x' }),
    feature('b3', 'baum', { status: 'geheim', hoehe: 9, zustaendig: 'u1' }),
  ];
  const ids = (fs: readonly { id: string }[]) => fs.map((f) => f.id);

  it('keeps the features that pass; a type without a predicate passes everything visible', () => {
    const env = envFor(world(), actor(['kontrolle']), trees);
    expect(ids(applyFilter(env, compiled({ baum: 'self.hoehe > 3' }), 'baum', trees))).toEqual(['b1']);
    expect(ids(applyFilter(env, compiled({ bank: 'true' }), 'baum', trees))).toEqual(['b1', 'b2']);
  });
  it('skips features that are not live: completed stays, archived and deleted drop out', () => {
    const lc = (id: string, lifecycle: 'completed' | 'archived' | 'deleted') => ({
      ...feature(id, 'baum', { status: 'ok', hoehe: 5 }),
      lifecycle,
    });
    const all = [
      lc('c', 'completed'),
      lc('a', 'archived'),
      lc('d', 'deleted'),
      feature('l', 'baum', { hoehe: 5 }),
    ];
    const env = envFor(world(), actor(['kontrolle']), all);
    expect(ids(applyFilter(env, compiled({ baum: 'self.hoehe > 3' }), 'baum', all))).toEqual(['c', 'l']);
  });
  it('"ich" is actor.id', () => {
    const env = envFor(world(), actor(['kontrolle'], 'u2'), trees);
    const f = compiled({ baum: 'self.zustaendig == actor.id' });
    expect(ids(applyFilter(env, f, 'baum', trees))).toEqual(['b2']);
  });
  it('never returns a feature the actor cannot see, even if the filter matches it', () => {
    const env = envFor(world(), actor(['kontrolle']), trees);
    expect(ids(applyFilter(env, compiled({ baum: 'self.hoehe > 8' }), 'baum', trees))).toEqual([]);
  });
  it('never lets a property the actor cannot read decide the result', () => {
    const env = envFor(world(), actor(['bauhof']), trees);
    const sources = [
      "self.intern_notiz == 'zu fällen'",
      "self.intern_notiz != 'zu fällen'",
      'has(self.intern_notiz)',
      '!has(self.intern_notiz)',
      "self.intern_notiz.contains('x')",
    ];
    for (const src of sources) {
      expect(ids(applyFilter(env, compiled({ baum: src }), 'baum', trees)), src).toEqual([]);
    }
    const kontrolle = envFor(world(), actor(['kontrolle']), trees);
    const f = compiled({ baum: "self.intern_notiz == 'zu fällen'" });
    expect(ids(applyFilter(kontrolle, f, 'baum', trees))).toEqual(['b1']);
  });
  it('a type the config does not declare yields nothing', () => {
    const env = envFor(world(), actor(['kontrolle']), trees);
    expect(applyFilter(env, compiled({}), 'wolke', trees)).toEqual([]);
  });

  it('agrees with core.expr on random features (property)', () => {
    const src = "self.hoehe >= 3 && self.status in ['ok', 'krank'] || self.zustaendig == actor.id";
    const filter = compiled({ baum: src });
    const typed = filter.predicates.get('baum' as Key);
    if (typed === undefined) throw new Error('no predicate');
    const arb = fc.record({
      status: fc.constantFrom('ok', 'krank'),
      hoehe: fc.integer({ min: 0, max: 12 }),
      zustaendig: fc.constantFrom('u1', 'u2'),
    });
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 20 }), (rows) => {
        const all = rows.map((r, i) => feature(`f${i}`, 'baum', r));
        const env = envFor(world(), actor(['kontrolle']), all);
        const direct = all.filter((f) => {
          const vars = new Map(env.ctx.vars);
          vars.set('self', { $feature: f.id });
          return condition(typed, { ...env.ctx, vars }).value;
        });
        expect(ids(applyFilter(env, filter, 'baum', all))).toEqual(ids(direct));
      }),
    );
  });
});

describe('filterFields', () => {
  const keys = (a: ReturnType<typeof actor>) => filterFields(world(), 'baum', a).map((f) => f.key);

  it('offers declared properties the actor can read, not the others', () => {
    expect(keys(actor(['kontrolle']))).toContain('intern_notiz');
    expect(keys(actor(['bauhof']))).not.toContain('intern_notiz');
    expect(keys(actor(['bauhof']))).toContain('hoehe');
  });
  it('offers "ich" (is_me) only on participant properties', () => {
    const fields = filterFields(world(), 'baum', actor(['kontrolle']));
    expect(fields.some((f) => f.type === 'participant')).toBe(true);
    for (const f of fields) expect(f.operators.includes('is_me'), f.key).toBe(f.type === 'participant');
  });
  it('carries operators from the registry and select options', () => {
    const f = filterFields(world(), 'baum', actor(['kontrolle'])).find((x) => x.key === 'status');
    expect(f?.operators).toEqual(FILTER_OPERATORS_BY_TYPE.select);

    expect(Object.keys(f?.options ?? {})).toEqual(['ok', 'krank', 'geheim']);
  });
  it('offers nothing for an undeclared type; every property type has operators', () => {
    expect(filterFields(world(), 'wolke', actor(['kontrolle']))).toEqual([]);
    for (const k of PROPERTY_TYPES.keys) expect(FILTER_OPERATORS_BY_TYPE[k].length).toBeGreaterThan(0);
  });
});

describe('filterTerm: the builder writes the rule language (every v3 operator)', () => {
  const trees = [
    feature('b1', 'baum', {
      status: 'ok',
      hoehe: 5,
      zustaendig: 'u1',
      tags: ['a'],
      kontrolliert: '2026-09-25T10:00:00.000Z',
      name: 'Eiche',
    }),
    feature('b2', 'baum', {
      status: 'krank',
      hoehe: 2,
      zustaendig: 'u2',
      tags: ['b'],
      kontrolliert: '2026-06-01T10:00:00.000Z',
      name: 'Linde',
    }),
    feature('b3', 'baum', { status: 'ok', tags: [] }),
  ];
  const f = (key: string) => {
    const type = world().file.types?.baum?.properties[key]?.type;
    if (type === undefined) throw new Error(key);
    return { key, type };
  };
  const run = (term: string | null, me = 'u1') => {
    if (term === null) throw new Error('empty clause');
    const env = envFor(world(), actor(['kontrolle'], me), trees);
    return applyFilter(env, compiled({ baum: term }), 'baum', trees).map((x) => x.id);
  };
  it('eq, between (also half open), in, not_in', () => {
    expect(run(filterTerm(f('name'), 'eq', 'o"k'))).toEqual([]);
    expect(run(filterTerm(f('hoehe'), 'eq', 2))).toEqual(['b2']);
    expect(run(filterTerm(f('hoehe'), 'between', [3, 9]))).toEqual(['b1']);
    expect(run(filterTerm(f('hoehe'), 'between', [null, 3]))).toEqual(['b2']);
    expect(run(filterTerm(f('status'), 'in', ['krank', 'x']))).toEqual(['b2']);
    expect(run(filterTerm(f('status'), 'not_in', ['krank']))).toEqual(['b1', 'b3']);
  });
  it('multiselect: is any of / none of', () => {
    expect(run(filterTerm(f('tags'), 'in', ['b']))).toEqual(['b2']);
    expect(run(filterTerm(f('tags'), 'not_in', ['b']))).toEqual(['b1', 'b3']);
  });
  it('text: contains / not_contains', () => {
    expect(run(filterTerm(f('name'), 'contains', 'ich'))).toEqual(['b1']);
    expect(run(filterTerm(f('name'), 'not_contains', 'ich'))).toEqual(['b2']);
  });
  it('dates: between with date(), older / newer than N days against now', () => {
    expect(run(filterTerm(f('kontrolliert'), 'between', ['2026-09-01', '2026-09-30']))).toEqual(['b1']);
    expect(run(filterTerm(f('kontrolliert'), 'older_than_days', 30))).toEqual(['b2']);
    expect(run(filterTerm(f('kontrolliert'), 'newer_than_days', 30))).toEqual(['b1']);
  });
  it('time: "HH:MM" strings compare as strings; between (also half open) and the empty checks', () => {
    const times = [
      feature('t1', 'baum', { uhrzeit: '07:30' }),
      feature('t2', 'baum', { uhrzeit: '09:00' }),
      feature('t3', 'baum', { uhrzeit: '17:00' }),
      feature('t4', 'baum', {}),
    ];
    const runT = (term: string | null) => {
      if (term === null) throw new Error('empty clause');
      const env = envFor(world(), actor(['kontrolle']), times);
      return applyFilter(env, compiled({ baum: term }), 'baum', times).map((x) => x.id);
    };
    expect(FILTER_OPERATORS_BY_TYPE.time).toEqual(['between', 'is_empty', 'is_not_empty']);
    expect(runT(filterTerm(f('uhrzeit'), 'between', ['08:00', '17:00']))).toEqual(['t2', 't3']);
    expect(runT(filterTerm(f('uhrzeit'), 'between', ['08:00', null]))).toEqual(['t2', 't3']);
    expect(runT(filterTerm(f('uhrzeit'), 'between', [null, '08:00']))).toEqual(['t1']);
    expect(runT(filterTerm(f('uhrzeit'), 'is_empty'))).toEqual(['t4']);
    expect(runT(filterTerm(f('uhrzeit'), 'is_not_empty'))).toEqual(['t1', 't2', 't3']);
  });
  it('is_empty / is_not_empty, and "ich" for participant properties', () => {
    expect(run(filterTerm(f('hoehe'), 'is_not_empty'))).toEqual(['b1', 'b2']);
    expect(run(filterTerm(f('hoehe'), 'is_empty'))).toEqual(['b3']);
    expect(run(filterTerm(f('zustaendig'), 'is_me'), 'u2')).toEqual(['b2']);
  });
  it('an empty clause writes nothing (as v3); clauses join with AND', () => {
    expect(filterTerm(f('status'), 'in', [])).toBeNull();
    expect(filterTerm(f('hoehe'), 'between', [null, null])).toBeNull();
    expect(filterTerm(f('name'), 'contains', '  ')).toBeNull();
    expect(joinTerms([null, null])).toBeNull();
    const both = joinTerms([
      filterTerm(f('hoehe'), 'between', [3, 9]),
      filterTerm(f('status'), 'in', ['ok']),
    ]);
    expect(run(both)).toEqual(['b1']);
  });
  it('every operator of every offered field compiles', () => {
    const samples: Record<string, unknown> = {
      eq: 1,
      between: [1, 2],
      older_than_days: 3,
      newer_than_days: 3,
      in: ['a'],
      not_in: ['a'],
      contains: 'x',
      not_contains: 'x',
    };
    for (const field of filterFields(world(), 'baum', actor(['kontrolle']))) {
      for (const op of field.operators) {
        const betweenSample =
          field.type === 'datetime'
            ? ['2026-01-01', '2026-02-01']
            : field.type === 'time'
              ? ['08:00', '17:00']
              : [1, 2];
        const sample = op === 'between' ? betweenSample : samples[op];
        const term = filterTerm(field, op, sample as never);
        expect(term !== null && compileFilter(world(), { baum: term }).ok, `${field.key} ${op}`).toBe(true);
      }
    }
  });
});

describe('prefs: a saved filter is this format', () => {
  it('SavedFilter.filters is a FilterSource: a saved filter compiles like a preset', () => {
    const saved: SavedFilter = {
      id: 's1',
      name: 'Hohe Bäume',
      filters: { baum: filterTerm({ key: 'hoehe', type: 'number' }, 'between', [3, null]) ?? 'true' },
    };
    const source: FilterSource = saved.filters;
    expect(compileFilter(world(), source).ok).toBe(true);
    expect(validatePrefValue('filters.saved', [saved]).ok).toBe(true);
  });
});
