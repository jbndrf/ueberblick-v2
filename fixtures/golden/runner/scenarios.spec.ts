// WP-050: every golden scenario runs against core.plan and core.fold. Skips are named and listed, never silent.
import { describe, expect, it } from 'vitest';
import { KNOWN_SKIPS, hitKey } from './known-skips';
import { loadScenario, runScenario, scenarioPaths, type ScenarioResult } from './runner';

const results: ScenarioResult[] = [];

describe('golden scenarios', () => {
  for (const path of scenarioPaths()) {
    it(path, () => {
      const r = runScenario(loadScenario(path));
      results.push(r);
      expect(r.failures, `${path}\n${r.failures.join('\n')}`).toEqual([]);
    });
  }

  it('every skip carries a reason', () => {
    const skips = results.flatMap((r) => r.skips);
    expect(skips.filter((s) => s.reason.trim() === '')).toEqual([]);
  });

  it('every named skip is still needed (a stale entry fails so the list only shrinks)', () => {
    const used = new Set(results.flatMap((r) => r.namedSkips));
    const missing = KNOWN_SKIPS.flatMap((k) => [
      ...(k.refusal ? [hitKey(k)] : []),
      ...(k.at ?? []).map((a) => hitKey(k, a)),
    ]).filter((key) => !used.has(key));
    expect(missing).toEqual([]);
  });

  it('reports what ran and what was skipped', () => {
    const ran = results.reduce((n, r) => n + r.stepsRun, 0);
    const total = results.reduce((n, r) => n + r.stepsTotal, 0);
    const skipped = results.reduce((n, r) => n + r.skips.length, 0);
    process.stdout.write(`golden runner: ${results.length} scenarios, ${ran}/${total} steps executed, ${skipped} named skips\n`);
    expect(ran).toBeGreaterThan(0);
  });
});
