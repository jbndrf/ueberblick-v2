// WP-302: the v3 eval-core corpus (52 condition cases with v3's recorded results) replayed through the converted project.
import { describe, expect, it } from 'vitest';
import { convertConfig } from '../config/convert';
import { diffcheck } from './diffcheck';
import { evalCoreScenario } from './evalcore';
import { summarize } from './format';
import { loadEvalCore } from './testing';

const cases = loadEvalCore();
const scenario = evalCoreScenario(cases);
const converted = convertConfig(scenario.v3Export);
const differences = diffcheck(scenario.runs, converted);
const byRun = new Map(differences.map((d) => [d.runId, d]));
const name = (part: string): string => {
  const found = cases.find((c) => c.name.includes(part));
  if (!found) throw new Error(`no case ${part}`);
  return found.name;
};

describe('eval-core corpus through the converted project', () => {
  it('converts to a project that compiles, with one task per case', () => {
    expect(converted.check.ok).toBe(true);
    expect(scenario.runs).toHaveLength(cases.length);
    expect(Object.keys(converted.template.tasks ?? {}).filter((k) => /^t\d+$/.test(k))).toHaveLength(
      cases.length,
    );
  });

  it('agrees with v3 on every case except the ones listed here, and every difference has a reason', () => {
    const report = summarize(scenario.runs.length, differences);
    expect(report.unexplained).toBe(0);
    expect(report.agreed).toBe(cases.length - byRun.size);
    expect(report.agreed).toBeGreaterThanOrEqual(45);
    expect([...byRun.keys()].sort()).toEqual(
      [
        name('NFD'),
        name('lt non-numeric'),
        name('on $updated → pass'),
        name('instance_status missing context'),
        name('all with one invalid sibling'),
        name('any with one invalid sibling'),
        name('not(related invalid)'),
      ].sort(),
    );
  });

  it('explains each difference by its cause', () => {
    const cause = (part: string) => byRun.get(name(part))?.cause;
    expect(cause('NFD')).toBe('known');
    expect(cause('all with one invalid sibling')).toBe('known');
    // nothing that WP-300.1 fixed is excused by a note any more
    expect([...byRun.values()].filter((d) => d.cause === 'known').map((d) => d.runId)).not.toContain(
      name('case-insensitive'),
    );
    // a field that v4 has no counterpart for: the conversion report says so
    expect(cause('on $updated → pass')).toBe('reported');
    expect(byRun.get(name('on $updated → pass'))?.items).toContain('workflows.w.tasks.t16.conditions.0');
    // a value or a set v4 cannot hold: the run cannot be replayed
    expect(cause('lt non-numeric')).toBe('not_convertible');
  });

  it('agrees on the semantics that v4 keeps: fail closed, vacuous truth, negation, aggregates', () => {
    for (const part of [
      'empty all',
      'empty any',
      'field is_empty with empty slice',
      'not(pass) → fail',
      'role required, none present',
      'ownership self mismatch',
      'aggregate all over history',
      'related none: empty set',
      'nested escalate example: fails',
      // items 2 and 3 of WP-300.1: v3 matched text case-insensitively and related sets hold many features
      'case-insensitive',
      'related any: one child',
      'related none (parent-close',
      'related all: every child',
    ]) {
      expect(byRun.has(name(part)), part).toBe(false);
    }
  });
});
