/** A small project for the filter specs: one type with a restricted property and a participant property. */
import { createGeo } from '../../geo';
import type { EvalContext, FeatureAccess } from '../../expr/contract';
import type { Actor, FeatureId, FeatureState, Json, Key } from '../../model';
import { actorValue, compilePerms } from '../../perms';
import { compile } from '../../schema/compile';
import type { CompiledConfig } from '../../schema/compile/contract';
import { TemplateFileSchema } from '../../schema/file';
import { goldenAssets } from '../../testing/golden';

export const NOW = '2026-10-01T08:00:00.000Z';

export const FILE = {
  schema: 'ueberblick/1',
  template: { key: 'filtertest', version: '1.0.0' },
  roles: {
    kontrolle: {
      label: { de: 'Kontrolle' },
      app: {
        filter_presets: {
          meine: { label: { de: 'Meine Bäume' }, filters: { baum: 'self.zustaendig == actor.id' } },
        },
      },
    },
    bauhof: { label: { de: 'Bauhof' } },
  },
  types: {
    baum: {
      label: { de: 'Baum' },
      permissions: {
        see: { intern_notiz: ['kontrolle'] },
        visible_when: "self.status != 'geheim'",
        create: '$all',
        write: '$all',
      },
      properties: {
        status: {
          type: 'select',
          options: { ok: { de: 'In Ordnung' }, krank: { de: 'Krank' }, geheim: { de: 'Geheim' } },
        },
        hoehe: { type: 'number' },
        intern_notiz: { type: 'text' },
        zustaendig: { type: 'participant' },
        standort: { type: 'geometry', geometry_type: 'point' },
        name: { type: 'text' },
        kontrolliert: { type: 'datetime' },
        uhrzeit: { type: 'time' },
        tags: { type: 'multiselect', options: { a: { de: 'A' }, b: { de: 'B' } } },
      },
      geometry: 'standort',
    },
    bank: {
      label: { de: 'Bank' },
      permissions: { see: '$all' },
      properties: { material: { type: 'text' } },
    },
  },
};

export function world(): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(FILE), { assets: goldenAssets });
  if (!r.ok) throw new Error(`fixture does not compile: ${JSON.stringify(r.problems)}`);
  return r.config;
}

export const actor = (roles: readonly string[], id = 'u1'): Actor => ({
  id,
  kind: 'participant',
  roles: roles as readonly Key[],
});

export const feature = (
  id: string,
  type: string,
  properties: Readonly<Record<string, Json>> = {},
): FeatureState => ({
  id: id as FeatureId,
  type: type as Key,
  properties,
  lifecycle: 'active',
  updatedSeq: 1,
});

export function envFor(config: CompiledConfig, a: Actor, all: readonly FeatureState[]) {
  const byId = new Map(all.map((f) => [f.id as string, f]));
  const features: FeatureAccess = {
    property: (id, key) => byId.get(id)?.properties[key],
    related: () => [],
    history: () => [],
    type: (id) => byId.get(id)?.type,
  };
  const ctx: EvalContext = {
    vars: new Map([['actor', actorValue(a)]]),
    features,
    now: NOW,
    relations: new Map(),
    geo: createGeo(),
  };
  return { config, perms: compilePerms(config), actor: a, ctx };
}
