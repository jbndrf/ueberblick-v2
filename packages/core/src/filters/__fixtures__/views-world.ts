/** The project for the view-builder specs (WP-665): a type with a process, several editor kinds and system metadata. */
import { createGeo } from '../../geo';
import type { EvalContext, FeatureAccess } from '../../expr/contract';
import type { Actor, FeatureId, FeatureState, Json, Key } from '../../model';
import { actorValue, compilePerms } from '../../perms';
import { readSystemField } from '../../registry/system-fields';
import { compile } from '../../schema/compile';
import type { CompiledConfig } from '../../schema/compile/contract';
import { TemplateFileSchema } from '../../schema/file';
import { goldenAssets } from '../../testing/golden';

export const NOW = '2026-10-10T08:00:00.000Z';

export const VIEWS_FILE = {
  schema: 'ueberblick/1',
  template: { key: 'viewstest', version: '1.0.0' },
  roles: { kontrolle: { label: { de: 'Kontrolle' } }, bauhof: { label: { de: 'Bauhof' } } },
  types: {
    baum: {
      label: { de: 'Baum', en: 'Tree' },
      permissions: { see: { intern: ['kontrolle'] }, create: '$all', write: '$all' },
      process: { property: 'stufe', start: 'neu', end: ['fertig'] },
      geometry: 'standort',
      properties: {
        standort: { type: 'geometry', geometry_type: 'point' },
        stufe: {
          type: 'select',
          label: { de: 'Stufe' },
          options: { neu: { de: 'Neu' }, geprueft: { de: 'Geprüft' }, fertig: { de: 'Fertig' } },
        },
        name: { type: 'text', label: { de: 'Name' } },
        hoehe: { type: 'number', label: { de: 'Höhe' } },
        stamm: { type: 'integer', label: { de: 'Stämme' } },
        pflanzdatum: { type: 'date', label: { de: 'Pflanzdatum' } },
        kontrolliert: { type: 'datetime', label: { de: 'Kontrolliert' } },
        art: {
          type: 'select',
          label: { de: 'Art' },
          options: { eiche: { de: 'Eiche' }, linde: { de: 'Linde' } },
        },
        tags: { type: 'multiselect', label: { de: 'Merkmale' }, options: { a: { de: 'A' }, b: { de: 'B' } } },
        foto: { type: 'file', label: { de: 'Foto' } },
        ok: { type: 'boolean', label: { de: 'In Ordnung' } },
        intern: { type: 'text', label: { de: 'Intern' } },
      },
    },
    bank: {
      label: { de: 'Bank' },
      permissions: { see: '$all' },
      geometry: 'standort',
      properties: {
        standort: { type: 'geometry', geometry_type: 'point' },
        material: { type: 'text', label: { de: 'Material' } },
      },
    },
    notiz: { label: { de: 'Notiz' }, permissions: { see: '$all' }, properties: { text: { type: 'text' } } },
  },
};

export function viewsWorld(): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(VIEWS_FILE), { assets: goldenAssets });
  if (!r.ok) throw new Error(`fixture does not compile: ${JSON.stringify(r.problems)}`);
  return r.config;
}

export const actorOf = (roles: readonly string[], id = 'u1'): Actor => ({
  id,
  kind: 'participant',
  roles: roles as readonly Key[],
});

export interface Meta {
  readonly createdBy?: string;
  readonly createdAt?: string;
  readonly changedAt?: string;
}

export const featureOf = (
  id: string,
  type: string,
  properties: Readonly<Record<string, Json>> = {},
  meta: Meta = {},
): FeatureState => ({
  id: id as FeatureId,
  type: type as Key,
  properties,
  lifecycle: 'active',
  updatedSeq: 1,
  ...meta,
});

/** The evaluation environment over `all`: system fields are read as the device does (`readSystemField`). */
export function envOver(config: CompiledConfig, a: Actor, all: readonly FeatureState[]) {
  const byId = new Map(all.map((f) => [f.id as string, f]));
  const features: FeatureAccess = {
    property: (id, key) => {
      const f = byId.get(id);
      if (f === undefined) return undefined;
      return key.startsWith('$') ? readSystemField(f, key) : f.properties[key];
    },
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
