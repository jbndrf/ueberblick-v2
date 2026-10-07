// WP-755: a reference value and a then-step target must be live, of the declared type and visible to the actor.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'refvis', version: '1.0.0' },
  roles: { staff: { label: 'Staff' } },
  types: {
    meldung: {
      label: 'Meldung',
      permissions: {
        see: '$all',
        create: '$all',
        write: '$all',
        delete: '$all',
        visible_when: 'self.owner == actor.id',
      },
      properties: {
        owner: { type: 'text' },
        titel: { type: 'text' },
        kopie: { type: 'text' },
        kommentar: { type: 'text' },
        geheim: { type: 'text', personal: { subject: 'feature' } },
        ziel: { type: 'reference', to: 'meldung' },
        ding: { type: 'reference', to: 'ding' },
        anzahl: { type: 'number' },
      },
      relations: { kinder: { to: 'meldung', inverse_of: 'meldung.ziel', cardinality: 'many' } },
    },
    ding: {
      label: 'Ding',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { name: { type: 'text' } },
    },
  },
  tasks: {
    verweisen: { label: 'Verweisen', on: 'meldung', form: { ziel: {} } },
    verweisen_ding: { label: 'Ding', on: 'meldung', form: { ding: {} } },
    anlegen: { label: 'Anlegen', on: '$none', creates: 'meldung', form: { owner: {}, ziel: {} } },
    zaehlen: { label: 'Zählen', on: 'meldung', then: [{ set: { anzahl: 'size(self.kinder)' } }] },
    pruefen: { label: 'Prüfen', on: 'meldung', when: 'self.kinder.exists(k, k.titel == "geheim")' },
    kopieren: { label: 'Kopieren', on: 'meldung', then: [{ set: { kopie: 'self.ziel.titel' } }] },
    kommentieren: {
      label: 'Kommentieren',
      on: 'meldung',
      then: [{ of: 'self.ziel', set: { kommentar: "'x'" } }],
    },
    loeschen: { label: 'Löschen', on: 'meldung', then: [{ of: 'self.ziel', lifecycle: 'deleted' }] },
    schwaerzen: {
      label: 'Schwärzen',
      on: 'meldung',
      then: [{ redact: { subject: 'feature', of: 'self.ziel' } }],
    },
  },
};

const bernd = actor('participant', 'bernd', ['staff']);
const root = actor('admin', 'root');
const MINE = fid(1);
const HIDDEN = fid(2);
const VISIBLE = fid(3);
const DING = fid(4);

let n = 0;
function setup(ziel?: FeatureId) {
  const config = build(file);
  const w = new World(config);
  w.add(MINE, 'meldung', { owner: 'bernd', titel: 'meins', ...(ziel ? { ziel } : {}) });
  w.add(HIDDEN, 'meldung', { owner: 'anna', titel: 'Annas Geheimnis', geheim: 'pers' });
  w.add(VISIBLE, 'meldung', { owner: 'bernd', titel: 'offen' });
  w.add(DING, 'ding', { name: 'd' });
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (
    task: string,
    input: Record<string, Json> = {},
    by = bernd,
    featureId: FeatureId | undefined = MINE,
  ): PlanResult => {
    const r: Run = {
      id: rid(++n),
      task: task as Key,
      actor: by,
      configVersion: 1,
      input,
      ...(featureId ? { featureId } : {}),
    };
    return api.planFor([r], oneVersion(config, perms), p);
  };
  return { w, go };
}
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('a reference value is live, of the declared type and visible (H2, H4b, H5)', () => {
  it('H2: a reference to a hidden feature is refused', () => {
    const r = setup().go('verweisen', { ziel: HIDDEN });
    expect(code(r)).toBe('not_permitted');
  });
  it('H5: a reference to a missing id is refused', () => {
    expect(code(setup().go('verweisen', { ziel: 'not-a-feature' }))).toBe('unknown_feature');
  });
  it('H4b: a reference to a deleted feature is refused', () => {
    const s = setup();
    s.w.append(rid(0), [{ featureId: VISIBLE, property: '$lifecycle', result: 'deleted' }]);
    expect(code(s.go('verweisen', { ziel: VISIBLE }))).toBe('case_closed');
  });
  it('a reference of the wrong type is refused', () => {
    expect(code(setup().go('verweisen', { ziel: DING }))).toBe('invalid_input');
    expect(code(setup().go('verweisen_ding', { ding: VISIBLE }))).toBe('invalid_input');
  });
  it('a visible live feature of the right type is accepted, also on create', () => {
    const s = setup();
    expect(code(s.go('verweisen', { ziel: VISIBLE }))).toBe('ok');
    expect(code(s.go('verweisen_ding', { ding: DING }))).toBe('ok');
    expect(code(s.go('anlegen', { owner: 'bernd', ziel: VISIBLE }, bernd, undefined))).toBe('ok');
    expect(code(s.go('anlegen', { owner: 'bernd', ziel: HIDDEN }, bernd, undefined))).toBe('not_permitted');
  });
  it('an admin is not bound by visibility', () => {
    expect(code(setup().go('verweisen', { ziel: HIDDEN }, root))).toBe('ok');
  });
});

describe('then-step targets must be visible (H3)', () => {
  it('H3: set with an `of` the actor cannot see is refused and writes nothing', () => {
    const s = setup(HIDDEN);
    const r = s.go('kommentieren');
    expect(code(r)).toBe('not_permitted');
    expect(s.w.feature(HIDDEN)?.properties['kommentar']).toBeUndefined();
  });
  it('H3: lifecycle with an `of` the actor cannot see is refused', () => {
    expect(code(setup(HIDDEN).go('loeschen'))).toBe('not_permitted');
  });
  it('H3: redact with an `of` the actor cannot see is refused', () => {
    expect(code(setup(HIDDEN).go('schwaerzen'))).toBe('not_permitted');
  });
  it('H3: an `of` that is not live reaches nothing and writes nothing', () => {
    const s = setup(VISIBLE);
    s.w.append(rid(0), [{ featureId: VISIBLE, property: '$lifecycle', result: 'archived' }]);
    for (const task of ['kommentieren', 'loeschen', 'schwaerzen']) {
      const r = s.go(task);
      if (r.ok)
        expect(r.runs.flatMap((x) => x.observations).filter((o) => o.featureId === VISIBLE)).toEqual([]);
    }
  });
  it('legitimate targets still pass, and an admin may reach any target', () => {
    expect(code(setup(VISIBLE).go('kommentieren'))).toBe('ok');
    expect(code(setup(VISIBLE).go('schwaerzen'))).toBe('ok');
    expect(code(setup(HIDDEN).go('kommentieren', {}, root))).toBe('ok');
  });
  it('H3: reading through a hidden reference does not copy its value', () => {
    const s = setup(HIDDEN);
    const r = s.go('kopieren');
    expect(JSON.stringify(r.ok ? r.runs : [])).not.toContain('Annas Geheimnis');
  });
});

const count = (r: PlanResult): Json | undefined =>
  r.ok ? r.runs.flatMap((x) => x.observations).find((o) => o.property === 'anzahl')?.result : undefined;

describe('a relation list holds only visible, live features (WP-765)', () => {
  // MINE has children: VISIBLE (bernd's), HIDDEN (anna's) and a deleted one of bernd's.
  const withKinder = () => {
    const s = setup();
    s.w.append(rid(0), [
      { featureId: VISIBLE, property: 'ziel', result: MINE },
      { featureId: HIDDEN, property: 'ziel', result: MINE },
    ]);
    const gone = fid(8);
    s.w.add(gone, 'meldung', { owner: 'bernd', titel: 'weg', ziel: MINE });
    s.w.append(rid(0), [{ featureId: gone, property: '$lifecycle', result: 'deleted' }]);
    return s;
  };
  it('a bound actor counts only visible, live children; an admin counts all live ones', () => {
    const s = withKinder();
    expect(count(s.go('zaehlen'))).toBe(1);
    expect(count(s.go('zaehlen', {}, root))).toBe(2);
  });
  it('exists() does not see a hidden child', () => {
    const s = withKinder();
    s.w.append(rid(0), [{ featureId: HIDDEN, property: 'titel', result: 'geheim' }]);
    expect(code(s.go('pruefen'))).toBe('not_available');
    expect(code(s.go('pruefen', {}, root))).toBe('ok');
  });
  it('an `of` at a hidden id stays refused loudly (an explicit pointer is not a list)', () => {
    expect(code(setup(HIDDEN).go('kommentieren'))).toBe('not_permitted');
  });
});

describe('property: the outcome of an accepted participant run does not depend on hidden features', () => {
  it('for any number of hidden children', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (hidden) => {
        const s = setup();
        for (let i = 0; i < hidden; i++)
          s.w.add(fid(20 + i), 'meldung', { owner: 'anna', titel: 'x', ziel: MINE });
        const r = s.go('zaehlen');
        expect(code(r)).toBe('ok');
        expect(count(r)).toBe(0);
      }),
      { numRuns: 20 },
    );
  });
});

describe('property: an accepted participant run never touches a feature the actor cannot see', () => {
  it('for random ownership of the target', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('bernd', 'anna'),
        fc.constantFrom('verweisen', 'kommentieren', 'loeschen', 'schwaerzen'),
        (owner, task) => {
          const s = setup();
          const target = fid(9);
          s.w.add(target, 'meldung', { owner, titel: 't' });
          s.w.append(rid(0), [{ featureId: MINE, property: 'ziel', result: target }]);
          const r = s.go(task, task === 'verweisen' ? { ziel: target } : {});
          if (!r.ok) return;
          const seen = owner === 'bernd';
          for (const pr of r.runs)
            for (const o of pr.observations)
              if (o.featureId === target || o.result === target) expect(seen).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
