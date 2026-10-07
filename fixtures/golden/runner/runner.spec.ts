// WP-050: the runner itself. It must be able to fail, and it must never skip silently.
import { describe, expect, it } from 'vitest';
import type { FeatureId, RunId } from '../../../packages/core/src/model';
import { simServerFactory, type ScenarioServerFactory } from '../../../packages/core/src/testing';
import { runScenario } from './runner';
import { bindRuleCreated } from './steps';
import { buildWorld } from './world';
import type { ScenarioDoc } from './world';

const doc = (over: Partial<ScenarioDoc> & { then?: Record<string, unknown> }): ScenarioDoc => ({
  scenario: 'synthetic',
  title: 't',
  given: {
    project: 'projects/musterstadt-plain.yaml',
    include: ['seeds/musterstadt-geo.yaml'],
    now: '2026-05-01T08:00:00Z',
  },
  when: [
    { id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: { befund: 'Neu' } },
  ],
  then: { steps: { s1: { outcome: 'accepted' } }, features: { t_in: { properties: { befund: 'Neu' } } } },
  ...over,
});

describe('runner', () => {
  it('passes a correct scenario', () => {
    const r = runScenario(doc({}));
    expect(r.failures).toEqual([]);
    expect(r.stepsRun).toBe(1);
  });

  it('fails a wrong outcome, a wrong state value and a missing observation', () => {
    const r = runScenario(
      doc({
        then: {
          steps: { s1: { outcome: 'refused', observations: [{ feature: 't_in', property: 'befund', result: 'anders' }] } },
          features: { t_in: { properties: { befund: 'anders' } } },
        },
      }),
    );
    expect(r.failures.join('\n')).toContain('outcome accepted, expected refused');
    expect(r.failures.join('\n')).toContain('missing observation');
    expect(r.failures.join('\n')).toContain('befund is');
  });

  it('a refusal is checked with its code and leaves no trace', () => {
    const r = runScenario(
      doc({
        when: [{ id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: {} }],
        then: { steps: { s1: { outcome: 'refused', refusal: 'required_missing', no_trace: true } } },
      }),
    );
    expect(r.failures).toEqual([]);
  });

  it('fails an unclassified step kind, result key and then key instead of ignoring them', () => {
    const r = runScenario(
      doc({
        when: [{ id: 's1', kind: 'teleport' }],
        then: { steps: {}, bogus_key: 1 },
      }),
    );
    expect(r.failures.join('\n')).toContain('unclassified step kind "teleport"');
    expect(r.failures.join('\n')).toContain('then.bogus_key: unclassified');
    const r2 = runScenario(doc({ then: { steps: { s1: { outcome: 'accepted', wat: 1 } } } }));
    expect(r2.failures.join('\n')).toContain('unclassified result key "wat"');
  });

  it('reports skipped step kinds and unchecked keys by name, and stops asserting state a skipped step may change', () => {
    const r = runScenario(
      doc({
        when: [
          { id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: { befund: 'Neu' } },
          { id: 's2', kind: 'advance', to: '2027-01-01T00:00:00Z' },
        ],
        then: { steps: { s1: { outcome: 'accepted', rule_runs: [] } }, features: { t_in: { properties: { befund: 'egal' } } } },
      }),
    );
    expect(r.failures).toEqual([]);
    const where = r.skips.map((s) => s.where);
    expect(where).toContain('s2');
    expect(where).toContain('s1.rule_runs');
    expect(where).toContain('then.features');
    expect(r.skips.every((s) => s.reason.length > 0)).toBe(true);
  });

  it('a batch is atomic: one refused item refuses all and leaves no trace', () => {
    const r = runScenario(
      doc({
        when: [
          {
            id: 's1',
            kind: 'batch',
            atomic: true,
            runs: [
              { task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: { befund: 'A' } },
              { task: 'befund_ergaenzen', actor: 'anna', feature: 't_hole', input: {} },
            ],
          },
        ],
        then: {
          steps: { s1: { outcome: 'refused', refusal: 'batch_failed', failed_item: 2, item_refusal: { code: 'required_missing' }, no_trace: true } },
          features: { t_in: { properties: { befund: 'unauffällig' } } },
        },
      }),
    );
    expect(r.failures).toEqual([]);
  });

  it('replaying a run id returns the stored result and adds nothing', () => {
    const r = runScenario(
      doc({
        when: [
          { id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: { befund: 'Erst' } },
          { id: 's2', kind: 'replay', of: 's1' },
        ],
        then: {
          steps: { s1: { outcome: 'accepted' }, s2: { outcome: 'accepted', same_result_as: 's1', new_observations: 0 } },
          features: { t_in: { properties: { befund: 'Erst' } } },
          ledger: { runs_total: 1 },
        },
      }),
    );
    expect(r.failures).toEqual([]);
  });

  describe('replay_refused (WP-778)', () => {
    const replayDoc = (over: Record<string, unknown>): ScenarioDoc =>
      doc({
        when: [
          { id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', input: { befund: 'Erst' } },
          { id: 's2', kind: 'replay_refused', of: 's1', ...over },
        ],
        then: {
          steps: { s1: { outcome: 'accepted' }, s2: { outcome: 'refused', refusal: 'id_taken', no_trace: true, new_observations: 0 } },
          features: { t_in: { properties: { befund: 'Erst' } } },
          ledger: { runs_total: 1 },
        },
      });
    /** A server whose ledger binds a run id to its actor and payload (the run store's behaviour since WP-754). */
    const binding: ScenarioServerFactory = (c, p, k, g, l) => {
      const inner = simServerFactory(c, p, k, g, l);
      const first = new Map<string, string>();
      return {
        ...inner,
        get head() {
          return inner.head;
        },
        submit(batch, atomic, asBatch) {
          const run = batch[0];
          const key = JSON.stringify([run?.actor, run?.task, run?.input]);
          if (run && first.has(run.id) && first.get(run.id) !== key)
            return { replayed: false, results: [{ runId: run.id, entry: { ok: false, refusal: { code: 'id_taken', message: 'taken' } } }] };
          if (run) first.set(run.id, key);
          return inner.submit(batch, atomic, asBatch);
        },
      };
    };

    /** A server whose ledger answers any known run id, like the sim did before WP-780. */
    const nonBinding: ScenarioServerFactory = simServerFactory;
    const lax: ScenarioServerFactory = (c, p, k, g, l) => {
      const inner = nonBinding(c, p, k, g, l);
      const done = new Map<string, ReturnType<typeof inner.submit>>();
      return {
        ...inner,
        get head() {
          return inner.head;
        },
        submit(batch, atomic, asBatch) {
          const run = batch[0];
          const seen = run ? done.get(run.id) : undefined;
          if (seen) return { ...seen, replayed: true };
          const res = inner.submit(batch, atomic, asBatch);
          if (run) done.set(run.id, res);
          return res;
        },
      };
    };

    it('runs on the simulated server too, which binds a replay to actor and payload', () => {
      const r = runScenario(replayDoc({ input: { befund: 'Zweit' } }));
      expect(r.failures).toEqual([]);
      expect(r.stepsRun).toBe(2);
      expect(r.skips).toEqual([]);
      expect(runScenario(replayDoc({ actor: 'bernd' })).failures).toEqual([]);
    });

    it('asserts a changed payload and another actor are refused with id_taken and no trace', () => {
      expect(runScenario(replayDoc({ input: { befund: 'Zweit' } }), [], binding).failures).toEqual([]);
      expect(runScenario(replayDoc({ actor: 'bernd' }), [], binding).failures).toEqual([]);
    });

    it('fails when the server answers the replay instead of refusing it', () => {
      const r = runScenario(replayDoc({ input: { befund: 'Zweit' } }), [], lax);
      expect(r.failures.join('\n')).toContain('outcome accepted, expected refused');
    });
  });

  it('a named skip matches only a step that differs, and its entry is reported', () => {
    const known = [{ issue: 'X-1', reason: 'because', at: ['synthetic/s1'] }];
    const bad = doc({ then: { steps: { s1: { outcome: 'refused' } } } });
    const r = runScenario(bad, known);
    expect(r.failures).toEqual([]);
    expect(r.skips.map((s) => s.reason)).toContain('X-1: because');
    expect(r.namedSkips).toEqual(['X-1@synthetic/s1']);
    // a passing step is never covered by a skip
    expect(runScenario(doc({}), known).namedSkips).toEqual([]);
  });

  it('a named skip taints only the feature it concerns: a mismatch on another feature still fails', () => {
    const known = [{ issue: 'X-2', reason: 'because', at: ['synthetic/s1'] }];
    const step = (id: string, feature: string, befund: string) => ({
      id,
      kind: 'run',
      task: 'befund_ergaenzen',
      actor: 'anna',
      feature,
      input: { befund },
    });
    const r = runScenario(
      doc({
        when: [step('s1', 't_in', 'A'), step('s2', 't_in', 'B'), step('s3', 't_hole', 'C')],
        then: {
          steps: { s1: { outcome: 'refused' }, s2: { outcome: 'refused' }, s3: { outcome: 'refused' } },
          features: { t_in: { properties: { befund: 'x' } }, t_hole: { properties: { befund: 'y' } } },
        },
      }),
      known,
    );
    const failed = r.failures.join('\n');
    expect(failed).toContain('s3: outcome accepted');
    expect(failed).toContain('features.t_hole');
    expect(failed).not.toContain('s2:');
    expect(failed).not.toContain('features.t_in');
    expect(r.skips.map((x) => x.where)).toEqual(expect.arrayContaining(['s1', 's2', 'then.features']));
  });

  it('a rule-created feature named only in rule_runs gets bound and checked', () => {
    const r = runScenario(
      doc({
        when: [
          { id: 's1', kind: 'run', task: 'kontrolle', actor: 'anna', feature: 't_in', input: { vitalitaet: 'v3', befund: 'Pilz' } },
        ],
        then: {
          steps: { s1: { outcome: 'accepted', rule_runs: [{ rule: 'massnahme_anlegen.massnahme_bei_schaden', feature: '$new:m1' }] } },
          features: { m1: { type: 'massnahme', properties: { baum: 't_in', art: 'schnitt' } } },
          edges: [{ from: 'm1', relation: 'baum', to: 't_in', derived: false }],
        },
      }),
    );
    expect(r.failures).toEqual([]);
  });

  it('a step recorded against another config version is skipped by name, not run', () => {
    const r = runScenario(
      doc({
        when: [
          { id: 's1', kind: 'run', task: 'befund_ergaenzen', actor: 'anna', feature: 't_in', config_version: 9, input: { befund: 'A' } },
        ],
        then: { steps: { s1: { outcome: 'review' } } },
      }),
    );
    expect(r.failures).toEqual([]);
    expect(r.stepsRun).toBe(0);
    expect(r.skips[0]?.reason).toContain('config version 9');
  });

  it('binds each rule-created alias by the rule id, so entry order does not matter', () => {
    const rules = new Map<string, string>();
    const w = buildWorld(doc({}), (c, p, k, g, l) => ({ ...simServerFactory(c, p, k, g, l), ruleOf: (id) => rules.get(id) as never }));
    const mk = (n: number, rule: string): void => void rules.set(`r${n}`, rule);
    mk(1, 'massnahme_anlegen.massnahme_bei_schaden');
    mk(2, 'art_anlegen');
    const obs = (n: number, id: string) => ({ featureId: id as FeatureId, property: '$type', result: 'x', seq: n, runId: `r${n}` as RunId });
    const got = { kind: 'run', runs: [{ id: 'r0' }], observations: [obs(1, 'f-massnahme'), obs(2, 'f-art')] } as never;
    // the scenario lists them in the opposite order to the run order
    const want = { rule_runs: [{ rule: 'art_anlegen', feature: '$new:art' }, { rule: 'massnahme_anlegen.massnahme_bei_schaden', feature: '$new:m1' }] };
    expect(bindRuleCreated(w, want, got)).toEqual([]);
    expect(w.aliases.id('m1')).toBe('f-massnahme');
    expect(w.aliases.id('art')).toBe('f-art');
  });

  it('fails loudly when a `$new:` rule created nothing, instead of shifting aliases', () => {
    const w = buildWorld(doc({}));
    const got = { kind: 'run', runs: [], observations: [] } as never;
    const want = { rule_runs: [{ rule: 'massnahme_anlegen.massnahme_bei_schaden', feature: '$new:m1' }] };
    expect(bindRuleCreated(w, want, got).join()).toContain('$new:m1');
    expect(w.aliases.has('$new:m1')).toBe(false);
  });
});
