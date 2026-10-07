/**
 * WP-402 oracle (R1): for random role sets and changes, an OGC write is accepted exactly when the same run, submitted
 * the way the app submits it (`store.submit`), is accepted. The server holds no second permission check.
 */
import type { Json, Key } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IDS } from '../../store/run/testkit';
import { ogcWorld, type OgcWorld } from './testkit';

const ROLES = ['kontrolle', 'bauhof', 'verwaltung'] as const;
const pt = { type: 'Point', coordinates: [7.1031, 50.7331] };

interface Change {
  readonly name: string;
  readonly type: string;
  readonly task: string;
  readonly feature?: string;
  /** Form input of the run; `geometrie` travels as the GeoJSON geometry over OGC. */
  readonly input: { readonly [k: string]: Json };
}
const CHANGES: readonly Change[] = [
  { name: 'erfassen', type: 'baum', task: 'erfassen', input: { geometrie: pt, vitalitaet: 'v2' } },
  { name: 'baumart', type: 'baumart', task: 'baumart_anlegen', input: { name_de: 'Eiche' } },
  { name: 'befund', type: 'baum', task: 'befund_ergaenzen', feature: IDS.t_in, input: { befund: 'neu' } },
  {
    name: 'kontrolle',
    type: 'baum',
    task: 'kontrolle',
    feature: IDS.t_in,
    input: { vitalitaet: 'v4', befund: 'Pilz' },
  },
  { name: 'verschieben', type: 'baum', task: 'verschieben', feature: IDS.t_in, input: { geometrie: pt } },
  { name: 'zuweisen', type: 'baum', task: 'zuweisen', feature: IDS.t_in, input: { zustaendig: 'bernd' } },
  { name: 'flaeche', type: 'flaeche', task: 'flaeche_bearbeiten', feature: IDS.park, input: { name: 'neu' } },
];

const outcomes = (w: OgcWorld) =>
  w.ctx.db
    .prepare<{ outcome: string }>('SELECT outcome FROM runs WHERE actor_kind = ? ORDER BY rowid')
    .all('participant')
    .map((r) => r.outcome);

async function viaOgc(roles: readonly Key[], c: Change): Promise<{ ok: boolean; w: OgcWorld }> {
  const w = await ogcWorld({ annaRoles: roles });
  const { geometrie, ...properties } = c.input;
  const body = { type: 'Feature', geometry: geometrie ?? null, properties };
  const base = `/collections/${c.type}/items`;
  const r =
    c.feature === undefined
      ? await w.send('POST', base, body, w.cookies.anna)
      : await w.send('PATCH', `${base}/${c.feature}?task=${c.task}`, body, w.cookies.anna);
  return { ok: r.status >= 200 && r.status < 300, w };
}

async function viaApp(roles: readonly Key[], c: Change): Promise<{ ok: boolean; w: OgcWorld }> {
  const w = await ogcWorld({ annaRoles: roles });
  const actor = { id: 'anna', kind: 'participant' as const, roles };
  const run = w.ctx.run(c.task, actor, { ...c.input }, c.feature as never);
  return { ok: w.ctx.store.submit(run).outcome !== 'refused', w };
}

describe('OGC write acceptance equals the app plan acceptance (oracle)', () => {
  it('holds for random role sets and changes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.subarray([...ROLES]), fc.constantFrom(...CHANGES), async (roles, change) => {
        const keys = roles as unknown as readonly Key[];
        const ogc = await viaOgc(keys, change);
        const app = await viaApp(keys, change);
        expect(ogc.ok, `${change.name} as [${roles.join(',')}]`).toBe(app.ok);
        // a refusal writes no feature and no accepted run
        if (!ogc.ok) expect(outcomes(ogc.w)).not.toContain('accepted');
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
