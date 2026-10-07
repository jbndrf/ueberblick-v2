// WP-534.1: erase a participant on the server while devices are working; every device ends in the server's state.
import { describe, expect, it } from 'vitest';
import { compilePerms } from '../perms';
import type { Actor, Key } from '../model';
import type { RunDraft, Workload } from './contract';
import { DEFAULT_OPTIONS, simulateWorld } from './sim';
import { Aliases, goldenConfig, goldenYaml, seedFeatures, type SeedFeatures } from './golden';
import type { SimServer } from './server';

const actor = (kind: Actor['kind'], id: string, roles: readonly string[] = []): Actor => ({
  id,
  kind,
  roles: roles as readonly Key[],
});

function meldungen(): Workload {
  const config = goldenConfig('projects/stadtwerke-meldungen.yaml');
  const seed = goldenYaml('seeds/stadtwerke.yaml') as { features: SeedFeatures };
  const draft = (task: string, who: Actor, input: RunDraft['input']): RunDraft =>
    ({ task: task as Key, actor: who, input }) as RunDraft;
  return {
    config,
    perms: compilePerms(config),
    participants: [
      actor('participant', 'mia', ['melder']),
      actor('participant', 'sabine', ['sachbearbeiter']),
    ],
    admin: actor('admin', 'root'),
    seed: (store) => seedFeatures(store, seed.features, new Aliases()),
    nextRun: (rng, _view, who) =>
      draft('melden', who, {
        geometrie: { type: 'Point', coordinates: [7.05 + rng.next() * 0.1, 50.72 + rng.next() * 0.05] },
        kategorie: 'strasse',
        beschreibung: { de: `Mangel ${rng.int(1000)}` },
      }),
    adminBatch: (_rng, _view, admin) => [draft('erase_subject', admin, { subject: 'mia' })],
  };
}

const leftovers = (server: SimServer): string[] => {
  const out: string[] = [];
  for (const e of server.erasures) {
    for (const o of server.store.log) {
      const hit = e.purge.some((p) => p.featureId === o.featureId && p.property === o.property);
      if (hit && o.seq <= e.lastSeq && o.result !== null) out.push(`${o.featureId}.${o.property}@${o.seq}`);
    }
  }
  return out;
};

// 15 self-contained bands of 2 seeds (seeds 1..30), each well inside the test timeout (WP-575).
describe('erasure on the simulated server and devices', () => {
  it.each(Array.from({ length: 15 }, (_, i) => i))(
    'converges with faults; no purged value remains in the server log; devices agree: band %i (2 seeds)',
    (band) => {
      let erased = 0;
      for (let seed = band * 2 + 1; seed <= band * 2 + 2; seed++) {
        const w = simulateWorld(meldungen(), { ...DEFAULT_OPTIONS, seed, ticks: 50, adminRate: 0.1 });
        expect(w.report.violations, `seed ${seed}`).toEqual([]);
        expect(leftovers(w.input.server), `seed ${seed}`).toEqual([]);
        erased += w.input.server.erasures.filter((e) => e.purge.length > 0).length;
        for (const e of w.input.server.erasures) {
          for (const p of e.purge) {
            for (const d of w.input.devices) {
              expect(d.store.feature(p.featureId)?.properties[p.property] ?? null, `seed ${seed}`).toBeNull();
            }
          }
        }
      }
      expect(erased).toBeGreaterThan(0);
    },
  );
});
