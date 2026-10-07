// WP-434 (A-047, owner A5): a form field `<bind>.<property>` shows and edits a property of a bound Objekt.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult, PlannedRun } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'bindfield', version: '1.0.0' },
  roles: { boss: { label: 'Boss' }, worker: { label: 'Worker' } },
  types: {
    person: {
      label: 'Prüfer',
      permissions: { see: '$all', create: '$all', write: { telefon: ['boss'], name: ['boss', 'worker'] } },
      properties: { name: { type: 'text' }, telefon: { type: 'text' } },
    },
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        art: { type: 'text' },
        pruefer: { type: 'reference', to: 'person' },
      },
    },
  },
  tasks: {
    kontrolle: {
      label: 'Kontrolle',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: {
        art: {},
        'pruefer.telefon': { constraint: "value.startsWith('+49')", constraint_message: 'Nur +49' },
      },
    },
    nur_lesen: {
      label: 'Nur lesen',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: { 'pruefer.telefon': { readonly: true } },
    },
    pflicht: {
      label: 'Pflicht',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: { 'pruefer.telefon': { required: true } },
    },
    name_aendern: {
      label: 'Name',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: { 'pruefer.name': {} },
    },
  },
};
const boss = actor('participant', 'b', ['boss']);
const worker = actor('participant', 'w', ['worker']);
const TREE = fid(1);
const PERSON = fid(2);
const OTHER = fid(3);

let n = 0;
function setup(withPruefer = true) {
  const config = build(file);
  const w = new World(config);
  w.add(PERSON, 'person', { name: 'Anna', telefon: '+49 1' });
  w.add(OTHER, 'person', { name: 'Berta', telefon: '+49 2' });
  w.add(TREE, 'baum', withPruefer ? { art: 'Eiche', pruefer: PERSON } : { art: 'Eiche' });
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (task: string, input: Record<string, Json>, by = boss): PlanResult => {
    const r: Run = { id: rid(++n), task: task as Key, actor: by, configVersion: 1, input, featureId: TREE };
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { w, go };
}
const first = (r: PlanResult): PlannedRun => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.code} ${r.refusal.message}`);
  return r.runs[0] as PlannedRun;
};

describe('bind field: write', () => {
  it('sets pruefer.telefon: one observation on the bound Objekt, in the same run, none on the subject', () => {
    const s = setup();
    const run = first(s.go('kontrolle', { art: 'Buche', 'pruefer.telefon': '+49 99' }));
    expect(run.observations).toContainEqual(
      expect.objectContaining({ featureId: PERSON, property: 'telefon', result: '+49 99' }),
    );
    expect(run.observations.filter((o) => o.property.includes('.'))).toEqual([]);
    expect(s.w.feature(PERSON)?.properties.telefon).toBe('+49 99');
    expect(s.w.feature(TREE)?.properties.art).toBe('Buche');
  });
  it('without write permission on that property the run is refused with the field path, and nothing is written', () => {
    const s = setup();
    const r = s.go('kontrolle', { art: 'Buche', 'pruefer.telefon': '+49 99' }, worker);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('not_permitted');
      expect(r.refusal.path).toBe('form.pruefer.telefon');
    }
    expect(s.w.feature(PERSON)?.properties.telefon).toBe('+49 1');
    expect(s.w.feature(TREE)?.properties.art).toBe('Eiche');
  });
  it('a property the actor may write (name) is written', () => {
    const s = setup();
    first(s.go('name_aendern', { 'pruefer.name': 'Anja' }, worker));
    expect(s.w.feature(PERSON)?.properties.name).toBe('Anja');
  });
});

describe('bind field: prefill and validation see the bound value', () => {
  it('an omitted field is prefilled from the bound value: nothing is written for an unchanged value', () => {
    const s = setup();
    const run = first(s.go('kontrolle', { art: 'Buche' }));
    expect(run.observations.some((o) => o.featureId === PERSON)).toBe(false);
  });
  it('the constraint judges the input value; a bad value is refused with the field path', () => {
    const s = setup();
    const r = s.go('kontrolle', { 'pruefer.telefon': '0123' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('constraint_failed');
      expect(r.refusal.path).toBe('form.pruefer.telefon');
    }
  });
  it('required is satisfied by the bound value', () => {
    const s = setup();
    expect(s.go('pflicht', {}).ok).toBe(true);
  });
  it('required fails when the bound value is empty and nothing is given', () => {
    const s = setup();
    s.w.append(rid(900), [{ featureId: PERSON, property: 'telefon', result: null }], boss.id);
    const r = s.go('pflicht', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('required_missing');
  });
});

describe('bind field: readonly and missing Objekt', () => {
  it('readonly: a submitted value is never written', () => {
    const s = setup();
    const run = first(s.go('nur_lesen', { 'pruefer.telefon': '+49 77' }));
    expect(run.observations.some((o) => o.featureId === PERSON)).toBe(false);
    expect(s.w.feature(PERSON)?.properties.telefon).toBe('+49 1');
  });
  it('a missing bound Objekt: the field is not relevant, the run goes through and writes nothing for it', () => {
    const s = setup(false);
    const run = first(s.go('kontrolle', { art: 'Buche', 'pruefer.telefon': '+49 99' }));
    expect(run.observations.some((o) => o.property === 'telefon')).toBe(false);
    expect(s.w.feature(TREE)?.properties.art).toBe('Buche');
  });
  it('a missing bound Objekt: required does not fire', () => {
    const s = setup(false);
    expect(s.go('pflicht', {}).ok).toBe(true);
  });
});

describe('bind field: property', () => {
  it('writes only to the bound Objekt, never to another Objekt', () => {
    fc.assert(
      fc.property(fc.constantFrom('+49 1', '+49 22', '+49 333'), fc.boolean(), (tel, withArt) => {
        const s = setup();
        const run = first(s.go('kontrolle', { ...(withArt ? { art: 'X' } : {}), 'pruefer.telefon': tel }));
        const ids = new Set<FeatureId>(run.observations.map((o) => o.featureId));
        for (const id of ids) expect([TREE, PERSON]).toContain(id);
        expect(s.w.feature(OTHER)?.properties.telefon).toBe('+49 2');
        expect(s.w.feature(OTHER)?.properties.name).toBe('Berta');
      }),
      { numRuns: 25 },
    );
  });
});

describe('bindsFor: the one bind resolver (WP-807)', () => {
  const resolve = (s: ReturnType<typeof setup>, by = boss, task = 'kontrolle') =>
    api.bindsFor(
      task as Key,
      { feature: TREE },
      by,
      oneVersion(build(file), compilePerms(build(file))),
      ports(s.w),
    );
  it('gives the same Objekt scope() binds: the planned run writes to it', () => {
    const s = setup();
    expect(resolve(s).get('pruefer')).toEqual({ $feature: PERSON });
    const run = first(s.go('kontrolle', { 'pruefer.telefon': '+49 99' }));
    expect(run.observations.some((o) => o.featureId === PERSON)).toBe(true);
  });
  it('a bind without an Objekt is null', () => {
    expect(resolve(setup(false)).get('pruefer')).toBeNull();
  });
  it('an Objekt the actor may not see keeps its pointer, exactly like scope() (a write is then refused)', () => {
    const hidden = {
      ...file,
      types: {
        ...file.types,
        person: { ...file.types.person, permissions: { ...file.types.person.permissions, see: ['boss'] } },
      },
    };
    const config = build(hidden);
    const w = new World(config);
    w.add(PERSON, 'person', { name: 'Anna', telefon: '+49 1' });
    w.add(TREE, 'baum', { art: 'Eiche', pruefer: PERSON });
    const get = (by: typeof boss) =>
      api.bindsFor(
        'kontrolle' as Key,
        { feature: TREE },
        by,
        oneVersion(config, compilePerms(config)),
        ports(w),
      );
    expect(get(boss).get('pruefer')).toEqual({ $feature: PERSON });
    expect(get(worker).get('pruefer')).toEqual({ $feature: PERSON });
  });
  it('an unknown task has no binds', () => {
    expect(resolve(setup(), boss, 'nope').size).toBe(0);
  });
});

describe('contextFor: the form expressions read what the actor may see (WP-816)', () => {
  const hidden = {
    ...file,
    types: {
      ...file.types,
      person: { ...file.types.person, permissions: { ...file.types.person.permissions, see: ['boss'] } },
    },
  };
  const ctxOf = (by: typeof boss) => {
    const config = build(hidden);
    const w = new World(config);
    w.add(PERSON, 'person', { name: 'Anna', telefon: '+49 1' });
    w.add(TREE, 'baum', { art: 'Eiche', pruefer: PERSON });
    return api.contextFor({ feature: TREE }, by, oneVersion(config, compilePerms(config)), ports(w));
  };
  it('a hidden Objekt reads as absent: no property, no type', () => {
    const c = ctxOf(worker);
    expect(c.features.property(PERSON, 'name' as Key)).toBeUndefined();
    expect(c.features.type(PERSON)).toBeUndefined();
  });
  it('the actor who may see it reads it; self is in the context', () => {
    const c = ctxOf(boss);
    expect(c.features.property(PERSON, 'name' as Key)).toBe('Anna');
    expect(c.vars.get('self')).toEqual({ $feature: TREE });
  });
  it('no target: no self', () => {
    const config = build(hidden);
    const c = api.contextFor(
      { none: true },
      worker,
      oneVersion(config, compilePerms(config)),
      ports(new World(config)),
    );
    expect(c.vars.has('self')).toBe(false);
  });
});
