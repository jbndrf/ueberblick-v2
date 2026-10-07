// WP-616: a multi-step task (form + location + quick edit) is planned as one run.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const point = (x: number): Json => ({ type: 'Point', coordinates: [x, 50] });
const file = {
  schema: 'ueberblick/1',
  template: { key: 'steps', version: '1.0.0' },
  roles: { r: { label: 'R' } },
  types: {
    baum: {
      label: 'Baum',
      geometry: 'geom',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        geom: { type: 'geometry', geometry_type: 'point' },
        art: { type: 'text' },
        hoehe: { type: 'number' },
        pflicht: { type: 'text', required: true },
        befund: { type: 'text' },
      },
    },
  },
  tasks: {
    pflege: {
      label: 'Pflege',
      on: 'baum',
      form: { befund: { required: true } },
      steps: [{ kind: 'form' }, { kind: 'location', property: 'geom' }],
      confirm: { de: 'Wirklich?', en: 'Really?' },
      button: { label: { de: 'Pflege', en: 'Care' }, color: 'success', icon: 'leaf' },
    },
    bearbeiten: {
      label: 'Bearbeiten',
      on: 'baum',
      steps: [{ kind: 'quick_edit', properties: ['art', 'hoehe', 'pflicht'] }],
    },
  },
};
const user = actor('participant', 'u', ['r']);
const F: FeatureId = fid(7);

let n = 0;
function setup() {
  const config = build(file);
  const w = new World(config);
  w.add(F, 'baum', { geom: point(1), art: 'Linde', hoehe: 12, pflicht: 'x' });
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (task: string, input: Record<string, Json>): PlanResult => {
    const r: Run = { id: rid(++n), task: task as Key, actor: user, configVersion: 1, input, featureId: F };
    return api.planFor([r], oneVersion(config, perms), p);
  };
  return { go, config };
}
const props = (r: PlanResult): string[] =>
  r.ok ? r.runs.flatMap((x) => x.observations.map((o) => o.property)) : [];

describe('multi-step task: one run', () => {
  it('a form + location task writes both steps in one run', () => {
    const r = setup().go('pflege', { befund: 'gesund', geom: point(2) });
    expect(r.ok && r.runs).toHaveLength(1);
    expect(props(r).sort()).toEqual(['befund', 'geom']);
  });
  it('a refusal in the form step refuses the run', () => {
    const r = setup().go('pflege', { geom: point(2) });
    expect(!r.ok && r.refusal.code).toBe('required_missing');
  });
  it('a refusal in the location step refuses the run', () => {
    const r = setup().go('pflege', { befund: 'ok', geom: 'not a geometry' });
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
  });
  it('an input outside every step is refused', () => {
    const r = setup().go('pflege', { befund: 'ok', art: 'Eiche' });
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
  });
  it('a location-only change leaves the form out when the form step was not given', () => {
    const r = setup().go('pflege', { befund: 'ok' });
    expect(props(r)).toEqual(['befund']);
  });
});

describe('location step: an equal geometry writes nothing', () => {
  it('the stored geometry sent again is dropped; a moved one is written', () => {
    const { go } = setup();
    expect(props(go('pflege', { befund: 'ok', geom: point(1) }))).toEqual(['befund']);
    expect(props(go('pflege', { befund: 'ok', geom: point(2) })).sort()).toEqual(['befund', 'geom']);
  });
  it('property: a geometry is written exactly when it differs from the stored one', () => {
    const { go } = setup();
    fc.assert(
      fc.property(fc.integer({ min: -170, max: 170 }), (x) => {
        const written = props(go('pflege', { befund: 'ok', geom: point(x) })).includes('geom');
        expect(written).toBe(x !== 1);
      }),
    );
  });
});

describe('quick edit', () => {
  it('an emptied value clears the property with a null observation', () => {
    const r = setup().go('bearbeiten', { art: '' });
    expect(r.ok && r.runs[0]?.observations).toEqual([{ featureId: F, property: 'art', result: null }]);
  });
  it('null clears as well', () => {
    const r = setup().go('bearbeiten', { hoehe: null });
    expect(r.ok && r.runs[0]?.observations).toEqual([{ featureId: F, property: 'hoehe', result: null }]);
  });
  it('an unchanged value writes nothing', () => {
    const r = setup().go('bearbeiten', { art: 'Linde', hoehe: 12 });
    expect(r.ok && r.runs[0]?.observations).toEqual([]);
  });
  it('a changed value is written; omitted properties stay untouched', () => {
    const r = setup().go('bearbeiten', { art: 'Eiche' });
    expect(r.ok && r.runs[0]?.observations).toEqual([{ featureId: F, property: 'art', result: 'Eiche' }]);
  });
  it('a required property cannot be emptied', () => {
    const r = setup().go('bearbeiten', { pflicht: '' });
    expect(!r.ok && r.refusal.code).toBe('required_missing');
  });
  it('a value of the wrong type is refused', () => {
    const r = setup().go('bearbeiten', { hoehe: 'hoch' });
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
  });
});

describe('presentation reaches the contract', () => {
  it('confirm and button are on the compiled task', () => {
    const t = setup().config.file.tasks?.pflege;
    expect(t?.confirm).toEqual({ de: 'Wirklich?', en: 'Really?' });
    expect(t?.button).toEqual({ label: { de: 'Pflege', en: 'Care' }, color: 'success', icon: 'leaf' });
  });
});
