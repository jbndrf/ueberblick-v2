/** Phase 1 of a conversion: feature types (from workflows and custom tables), their properties and relations. */
import type { Relation } from '@ueberblick/core';
import type { Ctx, PropInfo, TypeInfo } from './ctx';
import { KeySpace } from './keys';
import type { Rec, SrcProject, SrcTable, SrcType } from './model';
import { buildColumn, buildProperty, type PropDeps } from './properties';
import { V3_GEOMETRY_TYPES } from './registry';

/** A v4 feature type in the making: its info, and the v3 source it comes from. */
export interface Entry {
  readonly info: TypeInfo;
  readonly src?: SrcType;
  readonly table?: SrcTable;
  /** Relations declared on this type (from the v3 relation catalog). */
  readonly relations: Record<string, Relation>;
}

const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);

function shell(v3Key: string, key: string, fromTable: boolean, record: Rec): TypeInfo {
  const keys = new KeySpace();
  const stageKey = keys.take('stage');
  const geometry = str(record['geometry_type']);
  return {
    v3Key,
    key,
    fromTable,
    keys,
    props: new Map(),
    stageOptions: new Map(),
    stageKey,
    ...(geometry && (V3_GEOMETRY_TYPES as readonly string[]).includes(geometry)
      ? { geomKey: keys.take('geom') }
      : {}),
    creatorKey: keys.take('created_by'),
    lifecycleKey: keys.take('lifecycle'),
    needsCreator: record['private_instances'] === true,
    statuses: new Set(),
    entryTasks: [],
    createRoles: undefined,
    refTo: new Map(),
    computedBy: new Map(),
  };
}

/** Creates a feature type for every workflow and every custom table, and registers them in `ctx`. */
export function createShells(project: SrcProject, ctx: Ctx, space: KeySpace): Entry[] {
  const entries: Entry[] = [];
  for (const w of project.types) {
    const info = shell(w.key, space.take(w.key), false, w.record);
    const stages = new KeySpace();
    for (const s of w.stages) info.stageOptions.set(s.key, stages.take(s.key, 's'));
    ctx.types.set(w.key, info);
    entries.push({ info, src: w, relations: {} });
  }
  for (const t of project.tables) {
    const info = shell(t.key, space.take(t.key), true, {});
    ctx.tables.set(t.key, info);
    entries.push({ info, table: t, relations: {} });
  }
  return entries;
}

/** Properties for fields and columns; a reference property records itself in `refTo` of its type. */
export function createProperties(entries: readonly Entry[], project: SrcProject, ctx: Ctx): void {
  const deps: PropDeps = {
    report: ctx.report,
    knownRole: (v3) => ctx.knownRole(v3),
    tableType: (v3) => ctx.tables.get(v3)?.key,
    workflowType: (v3) => ctx.types.get(v3)?.key,
    roleOptions: () =>
      Object.fromEntries(project.roles.map((r) => [ctx.role(r.key), str(r.record['name']) ?? r.key])),
  };
  for (const e of entries) {
    const add = (p: PropInfo): void => {
      e.info.props.set(p.v3Key, p);
      if (p.to && p.relation === undefined && !e.info.refTo.has(p.to)) e.info.refTo.set(p.to, p.key);
    };
    for (const p of e.src?.props ?? []) add(buildProperty(p, e.info.keys, deps));
    for (const c of e.table?.columns ?? []) add(buildColumn(c, e.info.keys, ctx.report));
  }
  for (const e of entries) addInverses(e, entries);
}

/**
 * A many-valued v3 reference becomes a relation of cardinality many on the owner, read from a reference property
 * on the target type (one feature points back at its owner); no edge is stored twice.
 */
function addInverses(owner: Entry, entries: readonly Entry[]): void {
  for (const p of owner.info.props.values()) {
    if (p.relation === undefined) continue;
    const target = entries.find((t) => t.info.key === p.relation?.type);
    if (target === undefined) continue;
    const back = target.info.keys.take(owner.info.key);
    p.relation.property = back;
    target.info.props.set(`relation:${owner.info.v3Key}.${p.v3Key}`, {
      v3Key: `relation:${owner.info.v3Key}.${p.v3Key}`,
      key: back,
      type: 'reference',
      options: new Map(),
      to: owner.info.key,
      writeMode: 'observation',
      constraints: [],
      view: undefined,
      write: undefined,
      def: { type: 'reference', to: owner.info.key, ...(p.def.label ? { label: p.def.label } : {}) },
    });
    if (!target.info.refTo.has(owner.info.key)) target.info.refTo.set(owner.info.key, back);
    owner.relations[p.key] = {
      to: target.info.key,
      inverse_of: `${target.info.key}.${back}`,
      cardinality: 'many',
    };
  }
}

/**
 * The v3 relation catalog: the child type gets a reference property to the parent, the parent type an
 * inverse relation (`inverse_of`), so no edge is stored twice.
 */
export function createRelations(entries: readonly Entry[], project: SrcProject, ctx: Ctx): void {
  const byInfo = new Map(entries.map((e) => [e.info, e]));
  for (const rel of project.relations) {
    const r = rel.record;
    const parent = ctx.types.get(str(r['parent_workflow_id'])?.replace(/^@[a-z]+\//, '') ?? '');
    const child = ctx.types.get(str(r['child_workflow_id'])?.replace(/^@[a-z]+\//, '') ?? '');
    if (!parent || !child) {
      ctx.report.dropped(rel.id, 'the parent or child workflow does not exist');
      ctx.report.columns(rel.id, r, {});
      continue;
    }
    const propKey = child.keys.take(rel.key);
    const label = str(r['name']) ?? rel.key;
    const many = (str(r['multiplicity']) ?? 'many') === 'many';
    child.props.set(`relation:${rel.key}`, {
      v3Key: `relation:${rel.key}`,
      key: propKey,
      type: 'reference',
      options: new Map(),
      to: parent.key,
      writeMode: 'observation',
      constraints: [],
      view: undefined,
      write: undefined,
      def: { type: 'reference', to: parent.key, label },
    });
    if (!child.refTo.has(parent.key)) child.refTo.set(parent.key, propKey);
    const relKey = parent.keys.take(`${rel.key}_${child.key}`);
    const parentEntry = byInfo.get(parent);
    if (parentEntry) {
      parentEntry.relations[relKey] = {
        to: child.key,
        inverse_of: `${child.key}.${propKey}`,
        cardinality: many ? 'many' : 'one',
      };
    }
    const target = `types.${parent.key}.relations.${relKey}`;
    const kind = str(r['kind']) ?? 'parent_child';
    if (kind === 'peer') {
      ctx.report.approximated(
        rel.id,
        'a peer relation is stored as a reference from the second type to the first, with an inverse on the first',
        target,
      );
    } else ctx.report.mapped(rel.id, target);
    ctx.report.columns(rel.id, r, {
      name: ['mapped', undefined, `types.${child.key}.properties.${propKey}.label`],
      parent_workflow_id: ['mapped', undefined, target],
      child_workflow_id: ['mapped', undefined, target],
      kind:
        kind === 'peer'
          ? ['approximated', 'peer relations are asymmetric in v4: a reference and its inverse']
          : ['mapped'],
      multiplicity: ['mapped', undefined, `${target}.cardinality`],
      attachment: [
        'dropped',
        'v4 tasks decide where a feature can be created from; there is no "only from the parent" rule',
      ],
      geometry_mode: ['dropped', 'the geometry of a spawned feature is set by the spawning task'],
      on_parent_delete: ['dropped', 'v4 has no delete cascade; features are removed by tasks'],
    });
  }
}
