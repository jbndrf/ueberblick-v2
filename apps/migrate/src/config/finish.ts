/** Phase 3: the finished v4 feature types, with stage, geometry, permissions and record columns. */
import type { FeatureType, Property } from '@ueberblick/core';
import { valueProp, type Ctx, type TypeInfo } from './ctx';
import type { Entry } from './build';
import { slug } from './keys';
import { hasRole, quote } from './exprs';
import type { Rec, SrcType } from './model';
import { applyLook } from './classify';

type Audience = NonNullable<FeatureType['permissions']>['create'];

const GEOMETRY: Record<string, string> = { point: 'point', line: 'linestring', polygon: 'polygon' };
const LIFECYCLE_LABEL: Record<string, string> = {
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
  deleted: 'Gelöscht',
};

const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
/** The roles a v3 list names that exist; `undefined` when the list is empty (unrestricted). */
const roleList = (x: unknown, ctx: Ctx): string[] | undefined => {
  const raw = (Array.isArray(x) ? x : []).filter((r): r is string => typeof r === 'string');
  if (raw.length === 0) return undefined;
  return raw
    .map((r) => ctx.knownRole(r.replace(/^@[a-z]+\//, '')))
    .filter((r): r is string => r !== undefined);
};

function stageProperty(src: SrcType, info: TypeInfo): Property | undefined {
  if (src.stages.length === 0) return undefined;
  const options: Record<string, string> = {};
  for (const s of src.stages) options[info.stageOptions.get(s.key) as string] = s.name;
  const start = src.stages.find((s) => s.type === 'start') ?? src.stages[0];
  return {
    type: 'select',
    label: { de: 'Status', en: 'Status' },
    options,
    default: info.stageOptions.get((start as { key: string }).key) as string,
  };
}

function record(
  src: SrcType,
  info: TypeInfo,
  ctx: Ctx,
): { label: string; description?: string; hidden: boolean; rowRoles: string[] | undefined } {
  const r = src.record;
  const target = `types.${info.key}`;
  const { report } = ctx;
  const active = r['is_active'] !== false;
  const visible = roleList(r['visible_to_roles'], ctx);
  if ('is_active' in r) {
    if (active) report.mapped(`${src.id}.is_active`, `${target}.permissions.see`);
    else
      report.approximated(
        `${src.id}.is_active`,
        'an inactive workflow is hidden from every role (see is empty)',
        `${target}.permissions.see`,
      );
  }
  if (r['private_instances'] === true) {
    report.approximated(
      `${src.id}.private_instances`,
      'kept as a row filter on a "created by" property that tasks set on creation',
      `${target}.permissions.visible_when`,
    );
  } else if ('private_instances' in r)
    report.mapped(`${src.id}.private_instances`, `${target}.permissions.visible_when`);
  report.columns(src.id, r, {
    name: ['mapped', undefined, `${target}.label`],
    description: ['mapped', undefined, `${target}.description`],
    geometry_type: ['mapped', undefined, `${target}.geometry`],
    // classify.ts escalates these when something is not carried
    icon_config: ['mapped', undefined, `${target}.marker.icon`],
    marker_color: ['mapped', undefined, `${target}.marker.color`],
    filter_value_icons: ['mapped', undefined, `${target}.classify.values`],
    visible_to_roles: ['mapped', undefined, `${target}.permissions.see`],
    sort_order: ['mapped', undefined, 'the order of feature types and views'],
    workflow_type: ['dropped', 'incident and survey are both feature types in v4'],
  });
  return {
    label: str(r['name']) ?? info.v3Key,
    ...(str(r['description']) ? { description: str(r['description']) as string } : {}),
    hidden: !active,
    rowRoles: visible,
  };
}

/** The `see`, `visible_when` and `write` parts of a type's permissions. */
function permissions(
  e: Entry,
  hidden: boolean,
  rowRoles: string[] | undefined,
  props: Record<string, Property>,
): FeatureType['permissions'] {
  const { info } = e;
  if (info.fromTable) return { see: '$all' };
  const see: Record<string, string[]> = {};
  const write: Record<string, string[] | '$all'> = {};
  for (const p of info.props.values()) {
    if (p.relation !== undefined) continue;
    if (p.view !== undefined) see[p.key] = [...p.view];
    const by = info.computedBy.get(p.key);
    write[p.key] =
      p.writeMode === 'computed'
        ? by === undefined
          ? []
          : by === 'all'
            ? '$all'
            : [...by]
        : p.write !== undefined
          ? [...p.write]
          : '$all';
  }
  for (const k of Object.keys(props)) if (!(k in write)) write[k] = '$all';
  const perms: NonNullable<FeatureType['permissions']> = {};
  const parts: string[] = [];
  if (info.needsCreator && e.src?.record['private_instances'] === true) {
    parts.push(`self.${info.creatorKey} == actor.id`);
  }
  if (Object.keys(see).length === 0) {
    perms.see = hidden ? [] : (rowRoles ?? '$all');
  } else {
    // Per-property visibility takes the `see` slot, so the row restriction moves into `visible_when`.
    perms.see = see;
    if (hidden) parts.push('false');
    else if (rowRoles) {
      parts.push(rowRoles.length === 0 ? 'false' : hasRole(rowRoles.map(quote)));
    }
  }
  if (parts.length > 0) {
    const cond = parts.map((p) => (/ (\|\||&&) /.test(p) ? `(${p})` : p)).join(' && ');
    perms.visible_when = `actor.kind != 'participant' || ${parts.length > 1 ? `(${cond})` : cond}`;
  }
  const create: Audience =
    info.createRoles === 'all' ? '$all' : info.createRoles ? [...info.createRoles] : undefined;
  if (create !== undefined) perms.create = create;
  const allOpen = Object.values(write).every((a) => a === '$all');
  perms.write = allOpen ? '$all' : write;
  return perms;
}

/** Stages, edges and field tags: what each became, and the property `index` that a filterable tag asks for. */
function structure(src: SrcType, info: TypeInfo, props: Record<string, Property>, ctx: Ctx): void {
  const { report } = ctx;
  const target = `types.${info.key}`;
  report.mapped(src.id, target);
  for (const s of src.stages) {
    const option = `${target}.properties.${info.stageKey}.options.${info.stageOptions.get(s.key)}`;
    if (s.type === 'end')
      report.approximated(s.id, 'the "end" kind has no v4 meaning; the stage is an ordinary option', option);
    else report.mapped(s.id, option);
  }
  for (const e of src.edges) {
    report.dropped(
      e.id,
      'edges are drawing only in v3; what moves a feature between stages is a transition step in a task',
    );
  }
  for (const tag of src.tags) {
    const pk = tag.prop
      ? valueProp(info, tag.prop)?.key
      : tag.filterBy === 'stage'
        ? info.stageKey
        : undefined;
    const p = pk ? props[pk] : undefined;
    if (!p) {
      report.dropped(tag.id, 'the tagged field does not exist');
      continue;
    }
    p.index = true;
    report.approximated(
      tag.id,
      'a filterable tag becomes a database index on the property; filtering itself is done by views',
      `${target}.properties.${pk}.index`,
    );
  }
}

export function finishTypes(entries: readonly Entry[], ctx: Ctx): Record<string, FeatureType> {
  const out: Record<string, FeatureType> = {};
  for (const e of entries) {
    const { info, src } = e;
    const props: Record<string, Property> = {};
    if (info.geomKey && src) {
      const g = GEOMETRY[str(src.record['geometry_type']) ?? 'point'] ?? 'point';
      props[info.geomKey] = {
        type: 'geometry',
        geometry_type: g as Property['geometry_type'],
        required: true,
        label: { de: 'Position', en: 'Position' },
      };
    }
    const stage = src ? stageProperty(src, info) : undefined;
    if (stage) props[info.stageKey] = stage;
    for (const p of info.props.values()) if (p.relation === undefined) props[p.key] = p.def;
    if (info.needsCreator) {
      props[info.creatorKey] = { type: 'participant', label: { de: 'Erstellt von', en: 'Created by' } };
    }
    if (info.statuses.size > 0) {
      const statuses = ['active', ...[...info.statuses].filter((s) => s !== 'active')];
      const options: Record<string, string> = {};
      for (const s of statuses) options[slug(s, 's')] = LIFECYCLE_LABEL[s] ?? s;
      props[info.lifecycleKey] = {
        type: 'select',
        label: { de: 'Zustand', en: 'State' },
        options,
        default: 'active',
      };
    }
    if (src) structure(src, info, props, ctx);
    const meta = src
      ? record(src, info, ctx)
      : {
          label: (e.table?.record as Rec | undefined)?.['name'] as string | undefined,
          hidden: false,
          rowRoles: undefined,
        };
    const type: FeatureType = { label: meta.label ?? info.v3Key, properties: props };
    if ('description' in meta && meta.description) type.description = meta.description;
    if (info.geomKey) type.geometry = info.geomKey;
    if (Object.keys(e.relations).length > 0) type.relations = e.relations;
    if (src) applyLook(src, info, type, props, ctx);
    type.permissions = permissions(e, meta.hidden, meta.rowRoles, props);
    out[info.key] = type;
  }
  return out;
}
