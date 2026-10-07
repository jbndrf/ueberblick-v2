/**
 * What the data page header reads and writes (WP-418, S3-19; v3 `updateWorkflowMeta` `W/+page.server.ts:538-603`), as builder
 * document ops. v3 kept name, description, roles, `workflow_type`, `geometry_type` and `private_instances` on the
 * `workflows` record; here they are the type's `label`, `description`, `permissions.see`, `geometry` (map or form), the
 * geometry property's `geometry_type` and `permissions.visible_when`. Every edit is an overlay op on the draft and the
 * publish bar picks it up. The roles and private ops are the permission matrix's own (`permissionCellOp`, `privateOp`:
 * R1), the name and description are the Tabellen header's (`updateTable`). Headless: a function takes a `Doc` and
 * returns the next one; `header.server.ts` saves it.
 */
import {
  permissionCellOp,
  privateOp,
  privateState,
  removeOp,
  typeAudience,
  type Doc,
  type Op,
} from '@ueberblick/builder';
import {
  GEOMETRY_TYPES,
  localize,
  type GeometryTypeKey,
  type KeyPath,
  type TemplateFile,
} from '@ueberblick/core';
import type {
  HeaderAudience,
  HeaderCall,
  HeaderErrorCode,
  HeaderState,
} from '../../../../../../../lib/admin/data/header-types';
import { run as runOps, updateTable } from '../../tables/table-ops';

export type HeaderEdit =
  | { readonly ok: true; readonly doc: Doc }
  | { readonly ok: false; readonly code: HeaderErrorCode; readonly detail?: string };

type Source = { effective(): TemplateFile };

/** The Tabellen header's apply (`table-ops.run`, R1): a refusal or a new problem refuses the edit. */
function run(doc: Doc, ops: readonly Op[], locale: string): HeaderEdit {
  const r = runOps(doc, ops, locale);
  if (r.ok) return { ok: true, doc: r.doc };
  return fail(r.code === 'problem' ? 'problem' : 'refused', r.detail);
}

const fail = (code: HeaderErrorCode, detail?: string): HeaderEdit => ({
  ok: false,
  code,
  ...(detail === undefined ? {} : { detail }),
});
/** The key a new geometry property gets when a form becomes a map and the type has none (the golden templates' own). */
const NEW_GEOMETRY = 'geometrie';

function audienceOf(file: TemplateFile, type: string): HeaderAudience {
  const a = typeAudience(file, type, 'see');
  return a === undefined ? { kind: 'property' } : a;
}

/** The header of one type as the draft has it (or the deployed file when there is no draft yet). */
export function headerState(source: Source, type: string, locale: string, featureCount: number): HeaderState {
  const file = source.effective();
  const def = file.types?.[type];
  const key = def?.geometry;
  const raw = key === undefined ? undefined : def?.properties[key]?.geometry_type;
  const kind = GEOMETRY_TYPES.keys.find((k): k is GeometryTypeKey => k === raw);
  const when = def?.permissions?.visible_when;
  return {
    description: def?.description === undefined ? '' : localize(def.description, [locale]),
    roles: Object.entries(file.roles ?? {}).map(([k, r]) => ({
      key: k,
      label: localize(r.label, [locale]) || k,
    })),
    audience: audienceOf(file, type),
    private: privateState(file, type),
    ...(when !== undefined && privateState(file, type) === 'custom' ? { privateWhen: when } : {}),
    shape: { map: key !== undefined, ...(kind === undefined ? {} : { kind }) },
    featureCount,
  };
}

function mapOps(doc: Doc, type: string, on: boolean): readonly Op[] {
  const def = doc.effective().types?.[type];
  if (def === undefined) return [];
  const path = `types.${type}.geometry` as KeyPath;
  if (!on) return def.geometry === undefined ? [] : [removeOp(doc, path)];
  if (def.geometry !== undefined) return [];
  const existing = Object.entries(def.properties).find(([, p]) => p.type === 'geometry')?.[0];
  if (existing !== undefined) return [{ kind: 'set', path, value: existing }];
  return [
    {
      kind: 'add',
      path: `types.${type}.properties.${NEW_GEOMETRY}` as KeyPath,
      value: { type: 'geometry', geometry_type: 'point', required: true },
    },
    { kind: 'set', path, value: NEW_GEOMETRY },
  ];
}

/** One edit of the header, applied to `doc`. */
export function headerEdit(doc: Doc, type: string, call: HeaderCall, locale: string): HeaderEdit {
  const def = doc.effective().types?.[type];
  if (def === undefined) return fail('unknown_type');
  switch (call.action) {
    case 'name':
    case 'description': {
      const patch = call.action === 'name' ? { name: call.value } : { description: call.value };
      const r = updateTable(doc, type, patch, locale);
      if (r.ok) return { ok: true, doc: r.doc };
      return fail(
        r.code === 'name_empty' ? 'name_empty' : r.code === 'unknown_table' ? 'unknown_type' : 'refused',
        r.detail,
      );
    }
    case 'roles': {
      const next =
        call.roles.length === 0 ? ({ kind: 'all' } as const) : { kind: 'roles' as const, roles: call.roles };
      if (typeAudience(doc.effective(), type, 'see') === undefined) return fail('locked');
      const op = permissionCellOp(doc.effective(), type, { action: 'see' }, next);
      return run(doc, op === undefined ? [] : [op], locale);
    }
    case 'private': {
      if (privateState(doc.effective(), type) === 'custom') return fail('locked');
      const op = privateOp(doc, type, call.on);
      return run(doc, op === undefined ? [] : [op], locale);
    }
    case 'map':
      return run(doc, mapOps(doc, type, call.on), locale);
    case 'geometry': {
      const key = def.geometry;
      if (key === undefined) return fail('no_geometry');
      const path = `types.${type}.properties.${key}.geometry_type` as KeyPath;
      return def.properties[key]?.geometry_type === call.kind
        ? { ok: true, doc }
        : run(doc, [{ kind: 'set', path, value: call.kind }], locale);
    }
  }
}
