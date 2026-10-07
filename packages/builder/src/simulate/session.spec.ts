// WP-202: the headless simulation session. One test per acceptance box, plus properties.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json, Key } from '@ueberblick/core';
import { actorOf, loadScenario, runStep, type Step, type World } from './scenario-runner';
import { openSimulation } from './session';
import { openProject } from '../doc';
import { musterstadt } from '../testing/golden';

const observed = (w: World, step: string) => {
  const r = w.results.get(step);
  if (!r?.ok) throw new Error(`step ${step} did not succeed`);
  return r;
};

describe('golden scenarios through the headless session', () => {
  it('rule_chain_completes: the submitted run and all three rule runs match the corpus, with depth and cause', () => {
    const w = loadScenario('rules/rule_chain_completes');
    const [s1] = w.scenario.when;
    expect(runStep(w, s1 as never).ok).toBe(true);
    const r = observed(w, 's1');
    const expected = (
      w.scenario.then.steps['s1'] as {
        rule_runs: { rule: string; task: string; depth: number }[];
      }
    ).rule_runs;
    // Depth 0 is the submitted run; each rule run is one deeper than its cause (WP-041.2 made the
    // new report's derived `bezirk` edge visible to plan, so the whole chain fires).
    expect(r.runs.map((x) => [x.depth, x.task, x.rule])).toEqual([
      [0, 'melden', undefined],
      ...expected.map((e) => [e.depth, e.task, e.rule]),
    ]);
    expect(r.runs.slice(1).every((x) => x.actorKind === 'system')).toBe(true);
    r.runs.slice(1).forEach((x, i) => expect(x.causedBy).toBe(r.runs[i]?.runId));
    const m1 = w.sim.feature(w.ids.get('m1') as FeatureId);
    expect(m1?.properties).toMatchObject(
      (w.scenario.then.features as Record<string, { properties: Record<string, Json> }>)['m1']
        ?.properties as object,
    );
    expect(r.committed).toBe(true);
    expect(r.changes.find((c) => c.id === m1?.id)?.before).toBeUndefined();
  });

  it('rule chain of three runs with depth 0, 1, 2 on a seeded report inside its district', () => {
    const w = loadScenario('rules/rule_chain_completes');
    const [id] = w.sim.seed([
      {
        type: 'meldung' as Key,
        properties: {
          geometrie: { type: 'Point', coordinates: [7.1, 50.75] },
          status: 'offen',
          prioritaet: 'hoch',
          kategorie: 'strasse',
          beschreibung: { de: 'Loch' },
        },
      },
    ]);
    const r = w.sim.submit({
      task: 'bewerten' as Key,
      actor: actorOf(w, 'sabine'),
      feature: id as FeatureId,
      input: { prioritaet: 'hoch' },
    });
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs.map((x) => [x.depth, x.task, x.rule])).toEqual([
      [0, 'bewerten', undefined],
      [1, 'zuweisen', 'zuweisen.bewertet_zuweisen'],
      [2, 'benachrichtigen', 'benachrichtigen.zugewiesen_benachrichtigen'],
    ]);
    expect(w.sim.feature(id as FeatureId)?.properties).toMatchObject({
      status: 'zugewiesen',
      zustaendig: 'hans',
    });
  });

  it('kontrolle_bind_updates_related: reproduces the expected observations and state', () => {
    const w = loadScenario('tasks/kontrolle_bind_updates_related');
    const [s1] = w.scenario.when;
    const res = runStep(w, s1 as never);
    expect(res.ok).toBe(true);
    const r = observed(w, 's1');
    const want = (
      w.scenario.then.steps['s1'] as { observations: { feature: string; property: string; result: Json }[] }
    ).observations;
    const got = r.runs.flatMap((x) => x.observations);
    for (const e of want) {
      const hit = got.find((o) => o.featureId === w.ids.get(e.feature) && o.property === e.property);
      expect(hit?.result, `${e.feature}.${e.property}`).toEqual(e.result);
    }
    expect(new Set(got.filter((o) => o.runId === r.runs[0]?.runId).map((o) => o.seq)).size).toBeGreaterThan(
      0,
    );
    expect(w.sim.feature(w.ids.get('t_in') as FeatureId)?.properties).toMatchObject({
      stage: 'kontrolliert',
      faellig_am: '2027-05-01',
    });
  });

  it('task_availability_and_explain: why-not shows the decisive expression, refusals match the corpus', () => {
    const w = loadScenario('tasks/task_availability_and_explain');
    const [s1, s2, s3, s4] = w.scenario.when as [Step, Step, Step, Step];
    const s = w.scenario.then.steps;
    const done = w.ids.get('t_done') as FeatureId;
    const kontrolle = (a: string, f: FeatureId) =>
      w.sim.availability(f, actorOf(w, a as never)).find((x) => x.task === 'kontrolle');

    const a1 = kontrolle(String(s1.actor), done);
    expect(a1?.ok).toBe(false);
    if (a1 && !a1.ok) {
      expect(a1.refusal.code).toBe('not_available');
      for (const because of (s['s1'] as { because: string[] }).because)
        expect(a1.explanation?.text).toContain(because);
      expect(a1.explanation?.value).toBe(false);
    }
    expect(runStep(w, s2)).toMatchObject({ ok: false, refusal: { code: 'not_available' } });
    expect(w.sim.feature(done)?.properties['stage']).toBe('erledigt'); // refused: no trace

    const a3 = kontrolle(String(s3.actor), w.ids.get('t_in') as FeatureId);
    expect(a3?.ok).toBe(false);
    // the role is the task's `who`: refused about the person, with no condition to explain
    if (a3 && !a3.ok) expect(a3.refusal).toMatchObject({ code: 'not_permitted', path: 'who' });
    expect(runStep(w, s4)).toMatchObject({ ok: false, refusal: { code: 'unknown_task' } });
  });
});

describe('session behaviour', () => {
  const file = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();

  it('a file with compile problems does not open and reports them', () => {
    const bad = structuredClone(file()) as { tasks: Record<string, { when?: string }> };
    (bad.tasks['kontrolle'] as { when?: string }).when = 'self.gibt_es_nicht == 1';
    const r = openSimulation(bad as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
  });

  it('generate creates a feature of the type with a value per property and offers its tasks', () => {
    const r = openSimulation(file());
    if (!r.ok) throw new Error('open');
    const id = r.simulation.generate('baum' as Key);
    const f = r.simulation.feature(id);
    expect(f?.type).toBe('baum');
    expect(f?.properties['geometrie']).toMatchObject({ type: 'Point' });
    expect(f?.properties['stage']).toBe('erfasst');
    const other = r.simulation.generate('baum' as Key);
    expect(r.simulation.feature(other)?.properties['geometrie']).not.toEqual(f?.properties['geometrie']);
    const offered = r.simulation.availability(id, {
      id: 'a',
      kind: 'participant',
      roles: ['kontrolle' as Key],
    });
    expect(offered.map((t) => t.task)).toContain('kontrolle');
  });

  it('a dry run reports the change but leaves the sandbox untouched; a batch is atomic', () => {
    const w = loadScenario('tasks/task_availability_and_explain');
    const t = w.ids.get('t_in') as FeatureId;
    const anna = actorOf(w, 'anna');
    const before = JSON.stringify(w.sim.features());
    const dry = w.sim.submit(
      { task: 'kontrolle' as Key, actor: anna, feature: t, input: { vitalitaet: 'v2', befund: 'x' } },
      { commit: false },
    );
    // Whether or not the unpatched golden permits it, a dry run never changes the sandbox.
    expect(JSON.stringify(w.sim.features())).toBe(before);
    if (dry.ok) expect(dry.committed).toBe(false);

    const batch = w.sim.submitBatch([
      { task: 'kontrolle' as Key, actor: anna, feature: t, input: { vitalitaet: 'v2', befund: 'x' } },
      { task: 'gibt_es_nicht' as Key, actor: anna, feature: t },
    ]);
    expect(batch.ok).toBe(false);
    expect(JSON.stringify(w.sim.features())).toBe(before);
  });

  it('property: dry runs never change the sandbox, whatever the actor and input', () => {
    const w = loadScenario('tasks/task_availability_and_explain');
    const ids = ['t_in', 't_hole', 't_out', 't_done'].map((a) => w.ids.get(a) as FeatureId);
    const before = JSON.stringify(w.sim.features());
    fc.assert(
      fc.property(
        fc.constantFrom('anna', 'bernd', 'vera'),
        fc.constantFrom(...ids),
        fc.constantFrom('kontrolle', 'massnahme_erledigen', 'gibt_es_nicht'),
        fc.record({ vitalitaet: fc.constantFrom('v0', 'v1', 'v9'), befund: fc.string() }),
        (who, feature, task, input) => {
          const a = w.sim.submit(
            { task: task as Key, actor: actorOf(w, who), feature, input },
            { commit: false },
          );
          const b = w.sim.submit(
            { task: task as Key, actor: actorOf(w, who), feature, input },
            { commit: false },
          );
          expect(a.ok).toBe(b.ok);
          expect(JSON.stringify(w.sim.features())).toBe(before);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('rule attribution', () => {
  it('two automatic actions on the same task: each run names the action plan says caused it', () => {
    const w = loadScenario('rules/rule_chain_completes', (file) => {
      const task = (file as { tasks: Record<string, { auto?: Record<string, unknown> }> }).tasks['zuweisen'];
      // A second action on the same trigger of the same task as `bewertet_zuweisen`.
      if (task !== undefined)
        task.auto = {
          ...task.auto,
          zweite_zuweisung: {
            after: 'bewerten',
            when: 'self.bezirk.leitung != null',
            with: { zustaendig: 'self.bezirk.leitung' },
          },
        };
    });
    const [id] = w.sim.seed([
      {
        type: 'meldung' as Key,
        properties: {
          geometrie: { type: 'Point', coordinates: [7.1, 50.75] },
          status: 'offen',
          prioritaet: 'hoch',
          kategorie: 'strasse',
          beschreibung: { de: 'Loch' },
        },
      },
    ]);
    const r = w.sim.submit({
      task: 'bewerten' as Key,
      actor: actorOf(w, 'sabine'),
      feature: id as FeatureId,
      input: { prioritaet: 'hoch' },
    });
    if (!r.ok) throw new Error(r.refusal.message);
    const assign = r.runs.filter((x) => x.task === 'zuweisen');
    expect(assign.length).toBeGreaterThan(0);
    expect(
      assign.every((x) => x.rule === 'zuweisen.bewertet_zuweisen' || x.rule === 'zuweisen.zweite_zuweisung'),
    ).toBe(true);
  });
});
