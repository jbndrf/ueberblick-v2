// WP-534.1: the `redact` then-step resolves a subject's personal (feature, property) pairs and plans the erasure.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult, PlannedRun } from './contract';
import { erasure } from './__fixtures__/erasure';
import { World, actor, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const admin = actor('admin', 'root');
const who = (id: string): Actor => actor('participant', id, ['worker']);

let n = 0;
const run = (task: string, by: Actor, input: Record<string, Json> = {}, featureId?: FeatureId): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: by,
  configVersion: 1,
  input,
  ...(featureId !== undefined ? { featureId } : {}),
});

function setup() {
  const config = erasure();
  const w = new World(config);
  const perms = compilePerms(config);
  const p = ports(w);
  /** Plans one run and commits it as the server does (observations with the run's actor). */
  const go = (r: Run): PlanResult => {
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  const ok = (r: Run): PlannedRun => {
    const res = go(r);
    if (!res.ok) throw new Error(`${res.refusal.code}: ${res.refusal.message}`);
    return res.runs[0] as PlannedRun;
  };
  return { config, w, perms, p, go, ok };
}

const keys = (pairs: readonly { featureId: string; property: string }[]): string[] =>
  pairs.map((x) => `${x.featureId}\u0000${x.property}`).sort();

describe('redact step (actor subject)', () => {
  it('purges the personal pairs of the erased actor only, and plans one null observation per pair', () => {
    const s = setup();
    const a1 = s.ok(run('add_position', who('anna'), { wo: 'Park', note: 'x' }));
    s.ok(run('add_position', who('bernd'), { wo: 'Markt', note: 'y' }));
    const e = s.ok(run('erase_subject', admin, { subject: 'anna' }));
    const feature = a1.created[0] as FeatureId;
    expect(e.purge).toEqual([{ featureId: feature, property: 'wo' }]);
    expect(e.erased).toEqual([{ subject: 'anna', purge: [{ featureId: feature, property: 'wo' }] }]);
    expect(e.observations).toContainEqual({ featureId: feature, property: 'wo', result: null });
    // the non-personal property of anna's feature stays
    expect(s.w.feature(feature)?.properties['note']).toBe('x');
    expect(s.w.feature(feature)?.properties['wo']).toBeNull();
  });

  it('a subject with no personal values purges nothing', () => {
    const s = setup();
    s.ok(run('add_position', who('anna'), { wo: 'Park' }));
    const e = s.ok(run('erase_subject', admin, { subject: 'nobody' }));
    expect(e.purge).toEqual([]);
    expect(e.erased).toEqual([{ subject: 'nobody', purge: [] }]);
  });

  it('property test: purge equals an independent model of who wrote which personal value', () => {
    const ids = ['a', 'b', 'c'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            by: fc.constantFrom(...ids),
            kind: fc.constantFrom('position', 'meldung', 'person'),
            melder: fc.constantFrom(...ids),
          }),
          { maxLength: 12 },
        ),
        fc.constantFrom(...ids),
        (ops, victim) => {
          const s = setup();
          const wo: string[] = [];
          const telefon: string[] = [];
          for (const op of ops) {
            const input: Record<string, Json> =
              op.kind === 'position'
                ? { wo: 'here' }
                : op.kind === 'meldung'
                  ? { melder: op.melder, telefon: '0170' }
                  : { name: 'N' };
            const pr = s.ok(run(`add_${op.kind}`, who(op.by), input));
            const id = pr.created[0] as FeatureId;
            if (op.kind === 'position' && op.by === victim) wo.push(`${id}\u0000wo`);
            if (op.kind === 'meldung' && op.melder === victim) telefon.push(`${id}\u0000telefon`);
          }
          const byActor = s.ok(run('erase_subject', admin, { subject: victim }));
          expect(keys(byActor.purge)).toEqual(wo.sort());
          const byMelder = s.ok(run('erase_melder', admin, { subject: victim }));
          expect(keys(byMelder.purge)).toEqual(telefon.sort());
          for (const pr of [byActor, byMelder]) {
            expect(keys(pr.observations.filter((o) => o.result === null))).toEqual(
              keys(pr.purge).filter((k) =>
                pr.observations.some((o) => `${o.featureId}\u0000${o.property}` === k),
              ),
            );
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('redact step (property and feature subjects)', () => {
  it('property:<key> purges the personal properties of every feature naming the participant', () => {
    const s = setup();
    const m1 = s.ok(run('add_meldung', who('anna'), { melder: 'karl', telefon: '0170', ort: 'A' }));
    s.ok(run('add_meldung', who('anna'), { melder: 'lisa', telefon: '0171', ort: 'B' }));
    const e = s.ok(run('erase_melder', admin, { subject: 'karl' }));
    expect(e.purge).toEqual([{ featureId: m1.created[0], property: 'telefon' }]);
    expect(e.erased).toEqual([{ subject: 'karl', purge: e.purge }]);
  });

  it('a required personal property blanked by erasure does not refuse a later run on that feature', () => {
    const s = setup();
    const m = s.ok(run('add_meldung', who('anna'), { melder: 'karl', telefon: '0170', ort: 'A' }));
    s.ok(run('erase_melder', admin, { subject: 'karl' }));
    const id = m.created[0] as FeatureId;
    expect(s.w.feature(id)?.properties['telefon']).toBeNull();
    expect(s.go(run('erase_melder', admin, { subject: 'karl' })).ok).toBe(true);
  });

  it('feature subject purges the personal properties of the task feature', () => {
    const s = setup();
    const person = s.ok(run('add_person', who('anna'), { name: 'Karl', note: 'n' }));
    const id = person.created[0] as FeatureId;
    const e = s.ok(run('erase_person', admin, {}, id));
    expect(e.purge).toEqual([{ featureId: id, property: 'name' }]);
    expect(e.erased).toEqual([{ subject: id, purge: [{ featureId: id, property: 'name' }] }]);
    expect(s.w.feature(id)?.properties['name']).toBeNull();
    expect(s.w.feature(id)?.properties['note']).toBe('n');
  });
});

describe('PlannedRun.erased (one entry per redact step)', () => {
  it('two redact steps for different subjects give two entries, each with exactly its own pairs', () => {
    const s = setup();
    const a = s.ok(run('add_position', who('anna'), { wo: 'Park' })).created[0] as FeatureId;
    const b = s.ok(run('add_position', who('bernd'), { wo: 'Markt' })).created[0] as FeatureId;
    const e = s.ok(run('erase_two', admin, { a: 'anna', b: 'bernd' }));
    expect(e.erased).toEqual([
      { subject: 'anna', purge: [{ featureId: a, property: 'wo' }] },
      { subject: 'bernd', purge: [{ featureId: b, property: 'wo' }] },
    ]);
    expect(keys(e.purge)).toEqual(keys([...(e.erased[0]?.purge ?? []), ...(e.erased[1]?.purge ?? [])]));
  });

  it('property test: purge is the deduplicated union of erased[].purge, each entry deduplicated', () => {
    const ids = ['a', 'b', 'c'];
    fc.assert(
      fc.property(
        fc.array(fc.record({ by: fc.constantFrom(...ids) }), { maxLength: 8 }),
        fc.constantFrom(...ids),
        fc.constantFrom(...ids),
        (ops, x, y) => {
          const s = setup();
          for (const op of ops) s.ok(run('add_position', who(op.by), { wo: 'here' }));
          const e = s.ok(run('erase_two', admin, { a: x, b: y }));
          expect(e.erased.map((r) => r.subject)).toEqual([x, y]);
          for (const r of e.erased) expect(new Set(keys(r.purge)).size).toBe(r.purge.length);
          const union = [...new Set(e.erased.flatMap((r) => keys(r.purge)))].sort();
          expect(keys(e.purge)).toEqual(union);
          expect(new Set(keys(e.purge)).size).toBe(e.purge.length);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('PlannedRun.purge', () => {
  it('is [] (and erased is []) for every run that redacts nothing, rule runs included', () => {
    const s = setup();
    const r = s.go(run('add_position', who('anna'), { wo: 'Park' }));
    if (!r.ok) throw new Error('refused');
    for (const pr of r.runs) {
      expect(pr.purge).toEqual([]);
      expect(pr.erased).toEqual([]);
    }
  });
});

describe('refusal payloads carry no personal input values (B-005)', () => {
  const SECRET = 74310;
  it('an expression that fails on a submitted value names codes and paths, not the value', () => {
    const s = setup();
    const z = s.ok(run('add_zaehler', who('anna'), { n: 1 })).created[0] as FeatureId;
    const r = s.go(run('pick', who('anna'), { n: SECRET }, z));
    if (r.ok) throw new Error('expected a refusal');
    expect(r.refusal.code).toBe('invalid_input');
    expect(JSON.stringify(r.refusal)).not.toContain(String(SECRET));
  });

  it('a string that is not a date does not appear in the refusal (date(), toMs)', () => {
    const s = setup();
    const z = s.ok(run('add_zaehler', who('anna'), { n: 1 })).created[0] as FeatureId;
    const r = s.go(run('pick_date', who('anna'), { d: 'geheim-0815' }, z));
    if (r.ok) throw new Error('expected a refusal');
    expect(r.refusal.code).toBe('invalid_input');
    expect(r.refusal.message).toContain('not a valid date');
    expect(JSON.stringify(r.refusal)).not.toContain('geheim');
  });

  it('a value of the wrong type does not appear in the refusal', () => {
    const s = setup();
    const r = s.go(run('add_position', who('anna'), { wo: 987654321 }));
    if (r.ok) throw new Error('expected a refusal');
    expect(JSON.stringify(r.refusal)).not.toContain('987654321');
  });

  it('an erasure without a subject is refused before anything is planned', () => {
    const s = setup();
    const r = s.go(run('erase_subject', admin, {}));
    if (r.ok) throw new Error('expected a refusal');
    expect(r.refusal.code).toBe('required_missing');
  });
});
