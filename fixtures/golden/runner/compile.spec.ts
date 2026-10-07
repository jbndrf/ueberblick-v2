// WP-542: compile steps run through template.merge and compile(); the assertions can fail.
import { describe, expect, it } from 'vitest';
import { runScenario } from './runner';
import type { ScenarioDoc } from './world';

const bad = 'projects/musterstadt-locked-violation.yaml';
const good = 'projects/musterstadt-baeume.yaml';
const problems = [
  { problem: 'unknown_path', path: 'inputs.unbekannt', message: 'The template has no input unbekannt.' },
  {
    problem: 'lock_violation',
    path: 'types.baum.properties.stage.options',
    message:
      'The template locks types.baum.properties.stage.options; the overlay may not touch types.baum.properties.stage.options.',
  },
  {
    problem: 'hidden_referenced',
    path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after',
    message:
      'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after refers to tasks.kontrolle, which the overlay hides.',
  },
  {
    problem: 'hidden_referenced',
    path: 'roles.kontrolle.app.shortcuts',
    message: 'roles.kontrolle.app.shortcuts refers to tasks.kontrolle, which the overlay hides.',
  },
];

const doc = (want: Record<string, unknown>, project: string): ScenarioDoc => ({
  scenario: 'synthetic_compile',
  title: 't',
  given: { project },
  when: [{ id: 's1', kind: 'compile' }],
  then: { steps: { s1: want } },
});
const run = (want: Record<string, unknown>, project = bad): string => runScenario(doc(want, project)).failures.join('\n');

describe('compile steps', () => {
  it('pass when outcome and problems match in merge order, and count as executed', () => {
    const r = runScenario(doc({ outcome: 'failed', problems, nothing_deployed: true }, bad));
    expect(r.failures).toEqual([]);
    expect(r.stepsRun).toBe(1);
    expect(r.skips).toEqual([]);
  });

  it('fail a wrong outcome', () => {
    expect(run({ outcome: 'accepted', problems })).toContain('outcome failed, expected accepted');
  });

  it('fail a wrong order, code, path or message', () => {
    expect(run({ problems: [problems[1], problems[0], problems[2], problems[3]] })).toContain('problem 1');
    expect(run({ problems: [{ ...problems[0], problem: 'lock_violation' }, problems[1], problems[2], problems[3]] })).toContain('problem 1');
    expect(run({ problems: [{ ...problems[0], path: 'inputs.x' }, problems[1], problems[2], problems[3]] })).toContain('problem 1');
    expect(run({ problems: [{ ...problems[0], message: 'other' }, problems[1], problems[2], problems[3]] })).toContain('problem 1');
  });

  it('fail an unexpected extra problem and a missing one', () => {
    expect(run({ problems: problems.slice(0, 2) })).toContain('4 problems, expected 2');
    expect(run({ problems: [...problems, problems[0]] })).toContain('4 problems, expected 5');
  });

  it('assert the core hint when the scenario names one', () => {
    const hint = 'address a path that exists in the template, or use `add` for a new element';
    expect(run({ problems: [{ ...problems[0], hint }, problems[1], problems[2], problems[3]] })).toBe('');
    expect(run({ problems: [{ ...problems[0], hint: 'wrong' }, problems[1], problems[2], problems[3]] })).toContain('hint');
  });

  it('a project that merges cleanly compiles and reports no problems', () => {
    expect(run({ outcome: 'accepted', problems: [], resolved_template: 'baumkataster@1.1.0' }, good)).toBe('');
    expect(run({ problems: [] })).toContain('4 problems, expected 0');
    expect(run({ resolved_template: 'baumkataster@9.9.9' }, good)).toContain('resolved_template');
  });

  it('assert origin and absent from the merge provenance', () => {
    const origin = {
      'tasks.kontrolle.label': 'changed',
      'types.baum.properties.patenschaft': 'added',
      'tasks.kontrolle.form': 'template',
    };
    expect(run({ origin, absent: ['tasks.erfassung_import'] }, good)).toBe('');
    expect(run({ origin: { 'tasks.kontrolle.label': 'added' } }, good)).toContain('origin');
    expect(run({ absent: ['tasks.kontrolle'] }, good)).toContain('absent');
  });

  it('still fail an unclassified result key', () => {
    expect(run({ wat: 1 })).toContain('unclassified result key "wat" for step kind compile');
  });
});
