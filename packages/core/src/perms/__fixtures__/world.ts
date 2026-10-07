/** A small project with permissions of every shape, and a way to build actors and eval contexts over it. */
import { createGeo } from '../../geo';
import type { EvalContext, FeatureAccess } from '../../expr/contract';
import type { Actor, FeatureId, FeatureState, Json, Key } from '../../model';
import { compile } from '../../schema/compile';
import type { CompiledConfig } from '../../schema/compile/contract';
import { TemplateFileSchema } from '../../schema/file';
import { actorValue } from '../actor';
import { goldenAssets } from '../../testing/golden';

export const NOW = '2026-09-29T12:00:00.000Z';

export const ROLES = ['kontrolle', 'bauhof', 'verwaltung'] as const;

const FILE = {
  schema: 'ueberblick/1',
  template: { key: 'permtest', version: '1.0.0' },
  roles: Object.fromEntries(ROLES.map((r) => [r, { label: { de: r } }])),
  types: {
    baum: {
      label: { de: 'Baum' },
      permissions: {
        see: { intern_notiz: ['kontrolle'] },
        visible_when: "self.zustaendig == actor.id || !('bauhof' in actor.roles)",
        create: ['kontrolle'],
        delete: ['verwaltung'],
        write: { vitalitaet: ['kontrolle'], stage: ['kontrolle', 'bauhof'] },
      },
      properties: {
        stage: { type: 'text' },
        vitalitaet: { type: 'text' },
        intern_notiz: { type: 'text' },
        zustaendig: { type: 'text' },
        befund: { type: 'text' },
      },
    },
    flaeche: {
      label: { de: 'Fläche' },
      permissions: { see: '$all' },
      properties: { name: { type: 'text' } },
    },
    meldung: {
      label: { de: 'Meldung' },
      permissions: {
        see: ['kontrolle'],
        visible_when: "self.stage == 'offen'",
        create: '$all',
        delete: ['kontrolle', 'verwaltung'],
        write: ['kontrolle'],
      },
      properties: { stage: { type: 'text' }, titel: { type: 'text' } },
    },
    frist: {
      label: { de: 'Frist' },
      permissions: { see: '$all', visible_when: 'self.bis > now' },
      properties: { bis: { type: 'datetime' } },
    },
    ort: {
      label: { de: 'Ort' },
      permissions: { see: '$all', visible_when: 'within(self.standort, self.standort)' },
      properties: { standort: { type: 'geometry', geometry_type: 'point' } },
    },
    zaun: {
      label: { de: 'Zaun' },
      permissions: { see: '$all' },
      properties: { stage: { type: 'text' }, standort: { type: 'geometry', geometry_type: 'point' } },
      relations: { beet: { to: 'beet', derive: 'within(self.standort, other.umriss)', cardinality: 'one' } },
    },
    beet: {
      label: { de: 'Beet' },
      permissions: { see: '$all', visible_when: "self.zaeune.exists(z, z.stage == 'offen')" },
      properties: { umriss: { type: 'geometry', geometry_type: 'polygon' } },
      relations: { zaeune: { to: 'zaun', inverse_of: 'zaun.beet' } },
    },
    geheim: { label: { de: 'Geheim' }, properties: { x: { type: 'text' } } },
  },
};

export const worldResult = () => compile(TemplateFileSchema.parse(FILE), { assets: goldenAssets });

export function world(): CompiledConfig {
  const r = worldResult();
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

/** An eval context whose `features` read from the given list; `actor` as the planner builds it. */
export function ctxFor(a: Actor, all: readonly FeatureState[]): EvalContext {
  const byId = new Map(all.map((f) => [f.id as string, f]));
  const features: FeatureAccess = {
    property: (id, key) => byId.get(id)?.properties[key],
    related: () => [],
    history: () => [],
    type: (id) => byId.get(id)?.type,
  };
  return {
    vars: new Map([['actor', actorValue(a)]]),
    features,
    now: NOW,
    relations: new Map(),
    geo: createGeo(),
  };
}
