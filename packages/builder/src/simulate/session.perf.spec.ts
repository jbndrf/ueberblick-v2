// WP-202 budget (simulate one run <= 50 ms) is measured in bench/ (WP-147: no time is asserted in a unit spec).
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key } from '@ueberblick/core';
import { actorOf, loadScenario } from './scenario-runner';

describe('simulate one run', () => {
  it('a three-run rule chain (submit + 2 rule runs) commits nothing and repeats', () => {
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
    const run = {
      task: 'bewerten' as Key,
      actor: actorOf(w, 'sabine'),
      feature: id as FeatureId,
      input: { prioritaet: 'hoch' },
    };
    w.sim.submit(run, { commit: false }); // warm-up: JIT and the geometry engine
    for (let i = 0; i < 3; i += 1) expect(w.sim.submit(run, { commit: false }).ok).toBe(true);
  });
});
