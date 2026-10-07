/** Test helpers for import and export: the golden project, an import actor and ready dependencies. */
import type { Actor, Key } from '@ueberblick/core';
import { setup, type Ctx } from '../store/run/testkit';
import type { ImportDeps, ImportMapping } from './contract';

export const importer: Actor = { id: 'import-1', kind: 'import', roles: ['verwaltung' as Key] };

export function importSetup(): { ctx: Ctx; deps: ImportDeps } {
  const ctx = setup();
  return {
    ctx,
    deps: {
      config: ctx.config,
      configVersion: 1,
      actor: importer,
      ids: ctx.deps.ids,
      geo: ctx.deps.geo,
    },
  };
}

/** The golden `erfassen` task: geometry, species (not mapped), vitality (required). */
export const TREE_MAPPING: ImportMapping = {
  task: 'erfassen' as Key,
  fields: { vitalitaet: 'vit' },
  geometry: { field: 'geometrie', x: 'x', y: 'y', z: 'z' },
};

export const features = (ctx: Ctx): { properties: Record<string, unknown> }[] =>
  ctx.db
    .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baum' ORDER BY rowid")
    .all()
    .map((r) => ({ properties: JSON.parse(r.properties) as Record<string, unknown> }));

export const count = (ctx: Ctx, table: string): number =>
  (ctx.db.prepare<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
