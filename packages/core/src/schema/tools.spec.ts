// WP-613: availability per role, option schemas, effective values and the on/off switch.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOOL_AVAILABILITY, TOOL_CONTRIBUTIONS } from '../registry';
import {
  BUILTIN_TOOL_SCHEMAS,
  effectiveToolValues,
  toolIsOn,
  validateToolOptions,
  type ToolOptions,
} from '../registry/tools';
import { goldenAssets, newestTemplate } from '../testing/golden';
import { compile } from './compile';
import { TemplateFileSchema, RoleAppSchema, type TemplateFile } from './index';

describe('registries', () => {
  it('two availability levels, no required level (owner answer)', () => {
    expect(TOOL_AVAILABILITY.keys).toEqual(['offered', 'active']);
  });
  it('six contribution points', () => {
    expect(TOOL_CONTRIBUTIONS.keys).toEqual([
      'tools-sheet',
      'filter-tab',
      'layer-section',
      'feature-action',
      'settings-section',
      'form-field',
    ]);
  });
});

describe('roles.<r>.app.tools.<key>', () => {
  const parse = (tools: unknown) => RoleAppSchema.safeParse({ tools });
  it('takes availability from the registry only', () => {
    expect(parse({ search: { availability: 'offered' }, measure: { availability: 'active' } }).success).toBe(
      true,
    );
    expect(parse({ search: { availability: 'required' } }).success).toBe(false);
    expect(parse({ search: { availability: 'pflicht' } }).success).toBe(false);
  });
  it('takes role settings under `settings`, nothing else', () => {
    expect(parse({ search: { settings: { sources: ['a.b'] } } }).success).toBe(true);
    expect(parse({ search: { sources: ['a.b'] } }).success).toBe(false);
  });
});

const opts: ToolOptions = {
  unit: { type: 'select', options: ['m', 'ft'], default: 'm' },
  n: { type: 'integer', min: 1, max: 10 },
  on: { type: 'boolean' },
  tags: { type: 'string_list' },
};

describe('validateToolOptions', () => {
  it('accepts fitting values', () => {
    expect(validateToolOptions(opts, { unit: 'ft', n: 3, on: true, tags: ['a'] })).toEqual([]);
  });
  it.each([
    [{ unit: 'km' }, ['unit']],
    [{ n: 11 }, ['n']],
    [{ n: 1.5 }, ['n']],
    [{ on: 'yes' }, ['on']],
    [{ tags: ['a', 2] }, ['tags', 1]],
    [{ nope: 1 }, ['nope']],
  ])('refuses %j with its path', (values, path) => {
    expect(validateToolOptions(opts, values).map((i) => i.path)).toEqual([path]);
  });
});

describe('effective values: defaults, project, role, person (property)', () => {
  const schemas = {
    settings: { a: { type: 'integer', default: 0 }, s: { type: 'integer', default: 5 } },
    preferences: { p: { type: 'integer', default: 0 }, a: { type: 'integer' } },
  } as const;
  const layer = fc.dictionary(fc.constantFrom('a', 's', 'p', 'x'), fc.integer({ min: 0, max: 9 }));
  it('merge order: later layers win; a person never changes a settings-only key', () => {
    fc.assert(
      fc.property(layer, layer, layer, (project, role, personal) => {
        const e = effectiveToolValues(schemas, { project, role, personal });
        expect(e.settings.s).toBe(role.s ?? project.s ?? 5);
        expect(e.settings.a).toBe(role.a ?? project.a ?? 0);
        expect(e.preferences.p).toBe(personal.p ?? role.p ?? project.p ?? 0);
        expect(e.preferences.a).toBe(personal.a ?? role.a ?? project.a);
        expect(Object.keys(e.settings).every((k) => k === 'a' || k === 's')).toBe(true);
        expect(Object.keys(e.preferences).every((k) => k === 'p' || k === 'a')).toBe(true);
      }),
    );
  });
  it('without layers: the schema defaults', () => {
    expect(effectiveToolValues(schemas, {})).toEqual({ settings: { a: 0, s: 5 }, preferences: { p: 0 } });
  });
});

describe('toolIsOn', () => {
  it('offered is off at first, active is on at first, the person switches either way', () => {
    expect(toolIsOn('offered', undefined)).toBe(false);
    expect(toolIsOn('offered', true)).toBe(true);
    expect(toolIsOn('active', undefined)).toBe(true);
    expect(toolIsOn('active', false)).toBe(false);
  });
  it('an absent tool is never on, whatever the person stored', () => {
    expect(toolIsOn(undefined, undefined)).toBe(false);
    expect(toolIsOn(undefined, true)).toBe(false);
  });
});

type Mutable = {
  tools: Record<string, unknown>;
  roles: { kontrolle: { app: { tools: Record<string, unknown> } } };
};

describe('compile checks tool settings against the tool schema', () => {
  const base = (): TemplateFile => structuredClone(newestTemplate('baumkataster', '2'));
  const problems = (mutate: (f: Mutable) => void) => {
    const f = base() as unknown as Mutable;
    mutate(f);
    const r = compile(TemplateFileSchema.parse(f), { assets: goldenAssets });
    return r.ok ? [] : r.problems.filter((p) => p.code === 'tool_setting_invalid');
  };
  it('a wrong project option is an error with its path', () => {
    const p = problems((f) => (f.tools.photo = { maxEdge: 5 }));
    expect(p.map((x) => x.path)).toEqual(['tools.photo["maxEdge"]']);
    expect(p[0]?.hint?.length).toBeGreaterThan(0);
  });
  it('an unknown option is an error', () => {
    expect(problems((f) => (f.tools.photo = { colour: 1 })).map((x) => x.path)).toEqual([
      'tools.photo.colour',
    ]);
  });
  it('a wrong role setting is an error with the role path', () => {
    const p = problems((f) => (f.roles.kontrolle.app.tools.photo = { settings: { quality: 3 } }));
    expect(p.map((x) => x.path)).toEqual(['roles.kontrolle.app.tools.photo.settings.quality']);
  });
  it('fitting settings pass, and a tool without a known schema stays unchecked', () => {
    expect(
      problems((f) => ((f.tools.photo = { maxEdge: 1024 }), (f.tools.mystery = { anything: 1 }))),
    ).toEqual([]);
  });
  it('the shipped tools have a schema', () => {
    expect(Object.keys(BUILTIN_TOOL_SCHEMAS).sort()).toEqual(['chat', 'draw', 'measure', 'photo', 'search']);
  });
});
