// WP-104: the golden runner (WP-050) drives the SQLite run store. Named skips come from fixtures/golden/runner/known-skips.ts.
import { describe, expect, it } from 'vitest';
import {
  loadScenario,
  runScenario,
  scenarioPaths,
  type ScenarioResult,
} from '../../../../../fixtures/golden/runner/runner';
import { storeScenarioFactory } from './scenario-server.testkit';

const results: ScenarioResult[] = [];

describe('golden scenarios against the run store', () => {
  for (const path of scenarioPaths())
    it(path, () => {
      const r = runScenario(loadScenario(path), undefined, storeScenarioFactory);
      results.push(r);
      expect(r.failures, `${path}\n${r.failures.join('\n')}`).toEqual([]);
    });

  it('executes steps and reports every skip with a reason', () => {
    const ran = results.reduce((n, r) => n + r.stepsRun, 0);
    const total = results.reduce((n, r) => n + r.stepsTotal, 0);
    const named = [...new Set(results.flatMap((r) => r.namedSkips))];
    process.stdout.write(
      `golden on the run store: ${results.length} scenarios, ${results.filter((r) => r.stepsRun > 0).length} executed steps, ${ran}/${total} steps, named skips: ${named.join('; ')}\n`,
    );
    expect(results.reduce((n, r) => n + r.stepsRun, 0)).toBeGreaterThan(30);
    expect(results.flatMap((r) => r.skips).filter((s) => s.reason.trim() === '')).toEqual([]);
  });
});
