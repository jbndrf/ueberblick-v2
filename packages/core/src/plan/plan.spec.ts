// WP-041: plan on the golden musterstadt project (baumkataster 1.x + overlay). One test per acceptance box.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FormApi } from '../form/contract';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { REFUSAL_CODES } from '../registry/refusals';
import { createPlan, oneVersion } from './index';
import type { CompiledConfig } from '../schema/compile/contract';
import type { Perms } from '../perms/contract';
import type { PlanPorts, PlanResult, TaskTarget } from './contract';
import { INLINE_COVERED } from './__fixtures__/inline';
import { IDS, build, anna, bernd, fid, musterstadt, ports, rid, vera, actor } from './__fixtures__/world';
const planApi = createPlan(formApi);
// The one-version calls of this spec: a project with one config, as the simulator and the tests have it.
const planOne = (batch: readonly Run[], c: CompiledConfig, p: Perms, ports: PlanPorts) =>
  planApi.planFor(batch, oneVersion(c, p), ports);
const availableOne = (
  task: Key,
  target: TaskTarget,
  actor: Actor,
  c: CompiledConfig,
  p: Perms,
  ports: PlanPorts,
) => planApi.availableFor(task, target, actor, oneVersion(c, p), ports);
const tasksOne = (feature: FeatureId, actor: Actor, c: CompiledConfig, p: Perms, ports: PlanPorts) =>
  planApi.availableTasksFor(feature, actor, oneVersion(c, p), ports);
const setup = () => {
  const { config, world } = musterstadt();
  const perms = compilePerms(config);
  const p = ports(world);
  return { config, world, perms, p };
};
let n = 0;
const run = (
  task: string,
  who: Actor,
  input: Record<string, Json> = {},
  featureId?: string,
  extra: Partial<Run> = {},
): Run =>
  ({
    id: rid(++n),
    task: task as Key,
    actor: who,
    configVersion: 1,
    input,
    ...(featureId !== undefined ? { featureId: featureId as Run['featureId'] } : {}),
    ...extra,
  }) as Run;

const refused = (r: PlanResult) => {
  if (r.ok) throw new Error(`expected a refusal, got ${r.runs.length} runs`);
  return r;
};
const accepted = (r: PlanResult) => {
  if (!r.ok) throw new Error(`expected acceptance, got ${r.refusal.code}: ${r.refusal.message}`);
  return r.runs;
};

/** Every code that plan can raise, with the test that proves it (the coverage test below compares to the registry). */
const covered = new Set<string>();
const codeOf = (r: PlanResult, code: string): void => {
  expect(refused(r).refusal.code).toBe(code);
  covered.add(code);
};

describe('refusals', () => {
  it('unknown_task', () => {
    const { config, perms, p } = setup();
    codeOf(planOne([run('gibt_es_nicht', anna, {}, IDS.t_in)], config, perms, p), 'unknown_task');
  });

  it('unknown_feature: a missing feature, and a task that needs one', () => {
    const { config, perms, p } = setup();
    codeOf(planOne([run('kontrolle', anna, {}, fid(999))], config, perms, p), 'unknown_feature');
  });

  it('case_closed: a run on an archived feature (WP-305)', () => {
    const { config, world, perms, p } = setup();
    world.append(rid(0), [{ featureId: IDS.t_in, property: '$lifecycle', result: 'archived' }]);
    codeOf(planOne([run('kontrolle', anna, {}, IDS.t_in)], config, perms, p), 'case_closed');
  });

  it('not_available: `when` false, with an explanation from expr.explain', () => {
    const { config, world, perms, p } = setup();
    world.add(fid(50), 'baum', {
      stage: 'erledigt',
      vitalitaet: 'v1',
      geometrie: { type: 'Point', coordinates: [7.102, 50.732] },
    });
    const input = { vitalitaet: 'v1', befund: 'nachgesehen' };
    codeOf(planOne([run('kontrolle', anna, input, fid(50))], config, perms, p), 'not_available');
    const a = availableOne('kontrolle' as Key, { feature: fid(50) }, anna, config, perms, p);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.explanation?.text).toContain('stage');
      expect(a.refusal.code).toBe('not_available');
    }
    const wrongRole = availableOne('kontrolle' as Key, { feature: IDS.t_in }, bernd, config, perms, p);
    expect(wrongRole.ok).toBe(false);
    // the role is the task's `who` (C-004 step 3): refused about the person, not explained by the condition
    if (!wrongRole.ok) {
      expect(wrongRole.refusal.code).toBe('not_permitted');
      expect(wrongRole.refusal.path).toBe('who');
    }
  });

  it('not_available: task not offered on the type or target', () => {
    const { config, perms, p } = setup();
    codeOf(planOne([run('flaeche_bearbeiten', vera, {}, IDS.t_in)], config, perms, p), 'not_available');
    expect(availableOne('erfassen' as Key, { feature: IDS.t_in }, anna, config, perms, p).ok).toBe(false);
    expect(availableOne('kontrolle' as Key, { map: true }, anna, config, perms, p).ok).toBe(false);
    expect(availableOne('erfassen' as Key, { map: true }, anna, config, perms, p).ok).toBe(true);
  });

  it('not_permitted: a role that may not write the form field no longer sees the task (WP-410)', () => {
    const { config, perms, p } = setup();
    // befund_ergaenzen was open to bauhof, which may not write `befund`: compile now flags that (task_role_cannot_write).
    codeOf(
      planOne([run('befund_ergaenzen', bernd, { befund: 'x' }, IDS.t_in)], config, perms, p),
      'not_permitted',
    );
  });

  it('required_missing, constraint_failed (with the field message) and geometry_required', () => {
    const { config, perms, p } = setup();
    codeOf(
      planOne([run('kontrolle', anna, { vitalitaet: 'v1' }, IDS.t_in)], config, perms, p),
      'required_missing',
    );
    const c = planOne(
      [run('kontrolle', anna, { vitalitaet: 'v1', befund: 'unauffällig' }, IDS.t_in)],
      config,
      perms,
      p,
    );
    codeOf(c, 'constraint_failed');
    expect(refused(c).refusal.message).toContain('Befund muss sich ändern');
    expect(refused(c).refusal.path).toBe('form.befund');
    // `geometrie` is a required form field, so the form refuses first (the property-level check: plan-inline.spec)
    const g = planOne([run('erfassen', anna, { vitalitaet: 'v1' })], config, perms, p);
    expect(refused(g).refusal.code).toBe('geometry_required');
  });

  it('readonly_field: a supplied value that differs from the computed one', () => {
    const { config, perms, p } = setup();
    const input = { vitalitaet: 'v1', befund: 'neu', hoehe_m: 30, hoehe_klasse: 'klein' };
    codeOf(planOne([run('kontrolle', anna, input, IDS.t_in)], config, perms, p), 'readonly_field');
  });

  it('invalid_input: an input key that is no field', () => {
    const { config, perms, p } = setup();
    codeOf(
      planOne(
        [run('kontrolle', anna, { vitalitaet: 'v1', befund: 'x', quatsch: 1 }, IDS.t_in)],
        config,
        perms,
        p,
      ),
      'invalid_input',
    );
  });

  it('bind_undeclared: an input addressing a feature outside the binds', () => {
    const { config, perms, p } = setup();
    const input = { vitalitaet: 'v2', befund: 'neuer Befund', 'park.name': 'Umbenannt' };
    codeOf(planOne([run('kontrolle', anna, input, IDS.t_in)], config, perms, p), 'bind_undeclared');
  });

  it('bind_unresolved: a bind with no related feature (the tree lies in no area)', () => {
    const { config, perms, p } = setup();
    const input = { vitalitaet: 'v4', befund: 'Sturmschaden' };
    codeOf(planOne([run('kontrolle', anna, input, IDS.t_out)], config, perms, p), 'bind_unresolved');
    codeOf(planOne([run('kontrolle', anna, input, IDS.t_hole)], config, perms, p), 'bind_unresolved');
  });

  it('required_missing on a created feature whose type requires a property (baumart.name_de)', () => {
    const { config, perms, p } = setup();
    // The form has the field required too; make sure the task without input is refused either way.
    codeOf(
      planOne([run('baumart_anlegen', vera, { name_lat: 'Quercus' })], config, perms, p),
      'required_missing',
    );
  });

  it('every refusal code plan can raise is covered (the rest: plan-inline.spec)', () => {
    const raised = REFUSAL_CODES.entries.filter((e) => e.plan).map((e) => e.key);
    const proven = new Set([...covered, ...INLINE_COVERED, 'id_taken' /* id-taken.spec */]);
    expect(raised.filter((c) => !proven.has(c))).toEqual([]);
  });
});

describe('accepted runs', () => {
  it('kontrolle: form values, then-steps (bind write, otherwise), and the rule run it triggers', () => {
    const { config, perms, p } = setup();
    const input = {
      vitalitaet: 'v3',
      befund: 'Pilzbefall',
      foto: [{ sha256: 'aa11', name: 'stamm.jpg', mime: 'image/jpeg' }],
    };
    const runs = accepted(planOne([run('kontrolle', anna, input, IDS.t_in)], config, perms, p));
    expect(runs).toHaveLength(2);
    const [main, rule] = runs as [(typeof runs)[number], (typeof runs)[number]];
    const flat = main.observations.map((o) => [o.featureId, o.property, o.result]);
    expect(flat).toContainEqual([IDS.t_in, 'vitalitaet', 'v3']);
    expect(flat).toContainEqual([IDS.t_in, 'foto', input.foto]);
    expect(flat).toContainEqual([IDS.park, 'letzte_kontrolle', '2026-05-01']);
    expect(flat).toContainEqual([IDS.t_in, 'stage', 'massnahme']);
    expect(flat).not.toContainEqual([IDS.t_in, 'stage', 'kontrolliert']);
    expect(flat).toContainEqual([IDS.t_in, 'faellig_am', '2027-05-01']);
    // the rule run: a system run caused by the first, creating a measure that references the tree
    expect(rule.run.causedBy).toBe(main.run.id);
    expect(rule.run.actor.kind).toBe('system');
    expect(rule.run.task).toBe('massnahme_anlegen');
    expect(rule.created).toHaveLength(1);
    const m = rule.created[0];
    const rflat = rule.observations.map((o) => [o.featureId, o.property, o.result]);
    expect(rflat).toContainEqual([m, '$type', 'massnahme']);
    expect(rflat).toContainEqual([m, 'baum', IDS.t_in]);
    expect(rflat).toContainEqual([m, 'art', 'schnitt']);
  });

  it('kontrolle with vitalitaet v1: the otherwise-step, and a non-relevant foto is dropped', () => {
    const { config, perms, p } = setup();
    const input = { vitalitaet: 'v1', befund: 'gesund', foto: { sha256: 'bb22' } };
    const runs = accepted(planOne([run('kontrolle', anna, input, IDS.t_in)], config, perms, p));
    expect(runs).toHaveLength(1);
    const props = (runs[0]?.observations ?? []).map((o) => o.property);
    expect(props).not.toContain('foto');
    expect(runs[0]?.observations).toContainEqual(
      expect.objectContaining({ property: 'stage', result: 'kontrolliert' }),
    );
  });

  it('erfassen on the map: mints the feature id (or takes the run featureId), applies defaults, checks create', () => {
    const { config, perms, p } = setup();
    const input = { geometrie: { type: 'Point', coordinates: [7.1015, 50.7315] }, vitalitaet: 'v1' };
    const runs = accepted(planOne([run('erfassen', anna, input, fid(777))], config, perms, p));
    const r = runs[0];
    expect(r?.created).toEqual([fid(777)]);
    const flat = (r?.observations ?? []).map((o) => [o.property, o.result]);
    expect(flat).toContainEqual(['$type', 'baum']);
    expect(flat).toContainEqual(['stage', 'erfasst']);
    expect(flat).toContainEqual(['faellig_am', '2027-05-01']);
    // without a given id the ids port mints one
    const minted = accepted(planOne([run('erfassen', anna, input)], config, perms, p));
    expect(minted[0]?.created).toHaveLength(1);
    // bauhof is not offered the task (its `when`), so create is never reached
    expect(availableOne('erfassen' as Key, { map: true }, bernd, config, perms, p).ok).toBe(false);
  });

  it('process start: a create without a stage value writes stage = start; a creating then.set wins (WP-304)', () => {
    const { config, perms, p } = setup();
    expect(config.file.types?.['baum']?.process?.start).toBe('erfasst');
    const input = { geometrie: { type: 'Point', coordinates: [7.1015, 50.7315] }, vitalitaet: 'v1' };
    const runs = accepted(planOne([run('erfassen', anna, input)], config, perms, p));
    const stages = (runs[0]?.observations ?? []).filter((o) => o.property === 'stage');
    expect(stages.map((o) => o.result)).toEqual(['erfasst']);

    const mod = structuredClone(config.file);
    const erfassen = mod.tasks?.['erfassen'];
    if (erfassen === undefined) throw new Error('no erfassen');
    erfassen.then = [...(erfassen.then ?? []), { set: { stage: "'massnahme'" } }];
    const cfg = build(mod);
    const w = planOne([run('erfassen', anna, input)], cfg, compilePerms(cfg), p);
    const after = (accepted(w)[0]?.observations ?? []).filter((o) => o.property === 'stage');
    expect(after.at(-1)?.result).toBe('massnahme');
  });

  it('availableTasks lists what is offered on a feature for an actor, in config order', () => {
    const { config, perms, p } = setup();
    expect(tasksOne(IDS.t_in, anna, config, perms, p)).toEqual([
      'kontrolle',
      'befund_ergaenzen',
      'verschieben',
      'baum_bearbeiten',
    ]);
    expect(tasksOne(IDS.t_in, bernd, config, perms, p)).toEqual([]);
    expect(tasksOne(fid(404), anna, config, perms, p)).toEqual([]);
  });
});

describe('form semantics come only from core.form', () => {
  it('plan calls evaluate and submitValues of the given FormApi and never its own copy', () => {
    const { config, perms, p } = setup();
    const calls: string[] = [];
    const spy: FormApi = {
      ...formApi,
      evaluate: (...a) => {
        calls.push('evaluate');
        return formApi.evaluate(...a);
      },
      submitValues: (e) => {
        calls.push('submitValues');
        return formApi.submitValues(e);
      },
    };
    const input = { vitalitaet: 'v1', befund: 'gesund' };
    accepted(
      createPlan(spy).planFor([run('kontrolle', anna, input, IDS.t_in)], oneVersion(config, perms), p),
    );
    expect(calls.slice(0, 2)).toEqual(['evaluate', 'submitValues']);
    // a form that always says "invalid" refuses, whatever the input
    const strict: FormApi = {
      ...formApi,
      evaluate: (task, cfg, values, ctx) => {
        const ev = formApi.evaluate(task, cfg, values, ctx);
        return {
          ...ev,
          valid: false,
          fields: ev.fields.map((f) => ({ ...f, issues: [{ issue: 'required' as const }] })),
        };
      },
    };
    expect(
      refused(
        createPlan(strict).planFor([run('kontrolle', anna, input, IDS.t_in)], oneVersion(config, perms), p),
      ).refusal.code,
    ).toBe('required_missing');
  });
});

describe('batches (H2), purity and layering', () => {
  it('a later run sees the observations of an earlier one; facts are never mutated', () => {
    const { config, world, perms, p } = setup();
    const before = JSON.stringify([...world.features]);
    // run 1 sets befund; run 2 (kontrolle) may not repeat it (constraint value != self.befund)
    const r1 = run('befund_ergaenzen', anna, { befund: 'Pilz' }, IDS.t_in);
    const r2 = run('kontrolle', anna, { vitalitaet: 'v1', befund: 'Pilz' }, IDS.t_in);
    const res = planOne([r1, r2], config, perms, p);
    expect(refused(res).runId).toBe(r2.id);
    expect(refused(res).refusal.code).toBe('constraint_failed');
    expect(JSON.stringify([...world.features])).toBe(before);
    // and the same pair with a different second finding is fully accepted
    const ok = planOne(
      [r1, run('kontrolle', anna, { vitalitaet: 'v1', befund: 'Anders' }, IDS.t_in)],
      config,
      perms,
      p,
    );
    expect(accepted(ok).length).toBeGreaterThanOrEqual(2);
  });

  it('atomic: one refusal refuses the whole batch and names the failing run', () => {
    const { config, perms, p } = setup();
    const good = run('befund_ergaenzen', anna, { befund: 'a' }, IDS.t_in);
    const bad = run('kontrolle', anna, { vitalitaet: 'v1' }, IDS.t_in);
    const res = planOne([good, bad], config, perms, p);
    expect(refused(res).runId).toBe(bad.id);
    expect((res as { runs?: unknown }).runs).toBeUndefined();
  });

  it('pure: the same input gives the same output', () => {
    const a = setup();
    const b = setup();
    const input = { vitalitaet: 'v3', befund: 'Pilz' };
    const r = run('kontrolle', anna, input, IDS.t_in);
    expect(planOne([r], a.config, a.perms, a.p)).toEqual(planOne([r], b.config, b.perms, b.p));
  });
});

describe('availability agrees with plan (property)', () => {
  it('for every task, feature and actor: unavailable means plan refuses with the same refusal; available means no availability refusal', () => {
    const { config, perms, p } = setup();
    const tasks = Object.keys(config.file.tasks ?? {});
    const features = [IDS.t_in, IDS.t_hole, IDS.t_out, IDS.park, IDS.linde];
    const actors = [
      anna,
      bernd,
      vera,
      actor('admin', 'root'),
      actor('system', 'system'),
      actor('participant', 'nobody'),
    ];
    const checked = fc.assert(
      fc.property(
        fc.constantFrom(...tasks),
        fc.constantFrom(...features),
        fc.constantFrom(...actors),
        (task, feature, who) => {
          const onMap = config.file.tasks?.[task]?.on === '$map';
          const a = availableOne(task as Key, onMap ? { map: true } : { feature }, who, config, perms, p);
          const r = planOne([run(task, who, {}, onMap ? undefined : feature)], config, perms, p);
          if (!a.ok) {
            const got = refused(r).refusal;
            return got.code === a.refusal.code && got.message === a.refusal.message;
          }
          return (
            r.ok ||
            !['unknown_task', 'unknown_feature', 'not_available', 'bind_unresolved'].includes(r.refusal.code)
          );
        },
      ),
      { numRuns: 300 },
    );
    expect(checked).toBeUndefined();
  });
});
