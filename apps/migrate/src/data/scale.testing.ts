/** The shared body of the scale specs (R1): convert an N-feature v3 export and check the fold equals the expected v4 state. */
import { servedSql } from '@ueberblick/core';
import { expect } from 'vitest';
import { runMigration } from './index';
import { expectedTree, syntheticExport, world } from './testing';

export async function convertsAndFoldsAsExpected(N: number): Promise<void> {
  const w = world();
  const v3 = syntheticExport(N);
  const r = await runMigration(w.store, v3, w.converted.mapping, {
    target: w.target,
    geo: w.geo,
    configVersion: w.configVersion,
  });
  expect(r.problems).toEqual([]);
  const rows = w.db
    .prepare<{ id: string; type: string; properties: string }>(
      `SELECT id, type, properties FROM features WHERE ${servedSql('lifecycle')}`,
    )
    .all();
  expect(rows.filter((x) => x.type === 'baum')).toHaveLength(N);
  expect(rows.filter((x) => x.type === 'baumart')).toHaveLength(2);
  const byId = new Map(rows.map((x) => [x.id, x]));
  const art = new Map([
    ['Linde', r.ids.get('art_linde')],
    ['Eiche', r.ids.get('art_eiche')],
  ]);
  for (let i = 0; i < N; i++) {
    const row = byId.get(r.ids.get(`t${i}`) as string);
    const p = JSON.parse(row?.properties ?? '{}') as Record<string, unknown>;
    const e = expectedTree(i);
    if (
      p['vitalitaet'] !== `v${e.vitality}` ||
      p['hoehe_m'] !== e.height ||
      JSON.stringify((p['geom'] as { coordinates: number[] }).coordinates) !==
        JSON.stringify([e.lon, e.lat]) ||
      p['art'] !== (e.art === undefined ? undefined : art.get(e.art)) ||
      p['stage'] !== (i % 2 === 0 ? 'erfasst' : 'kontrolliert')
    )
      expect.fail(`tree t${i} differs: ${JSON.stringify(p)} against ${JSON.stringify(e)}`);
  }
}
