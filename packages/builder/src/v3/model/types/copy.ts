/**
 * Copy an Objektart into a project file (WP-419, S3-19; v3 `duplicateWorkflow`): "Duplizieren" copies within the project,
 * "Aus Projekt importieren" from another project's deployed file. The copy is the type, its tasks (with their automatic actions) and its views
 * as `add` entries under fresh keys (register a2 row 86). References to another type stay when this project has that type;
 * otherwise the relation, reference property or task target is left out and listed in `dropped`, never silently. An
 * import keeps the permissions of the roles this project has and drops the others (v3 reset them all: "Die
 * Rollenberechtigungen wurden zurückgesetzt"; the roles are the other project's), listing that in `dropped`. Pure: a source file and a target file in, ops out (the builder sidebar will use the same functions).
 */
import { splitAutoId, type KeyPath, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import { slugKey } from '../../../lenses/data-model/ops';
import type { Op } from '../../../doc';
import { relatedTo } from './related';

/** What a copy left out, for the message after it. */
export const DROPPED = {
  relation: 'relation',
  property: 'property',
  target: 'target',
  task: 'task',
  rule: 'rule',
  permissions: 'permissions',
} as const;
export type DroppedKind = (typeof DROPPED)[keyof typeof DROPPED];
export interface Dropped {
  readonly kind: DroppedKind;
  /** The key of the relation, property, task or rule; for a task target the missing type, for a task the type it creates; absent for permissions. */
  readonly key?: string;
  readonly type?: string;
}

export interface TypeCopy {
  readonly key: string;
  readonly ops: readonly Op[];
  readonly tasks: readonly string[];
  readonly rules: readonly string[];
  readonly views: readonly string[];
  readonly dropped: readonly Dropped[];
}

type Json = Record<string, unknown>;
const COPY_WORD: Readonly<Record<string, string>> = { de: 'Kopie', en: 'copy' };

/** '<Name> (Kopie)' in every language the label has (a plain string takes the first language of `lang`). */
export function copyLabel(
  label: LocalizedString | undefined,
  lang: string,
  fallback: string,
): LocalizedString {
  const word = (l: string): string => COPY_WORD[l.split('-')[0] ?? l] ?? COPY_WORD['en'] ?? 'copy';
  if (label === undefined) return { [lang]: `${fallback} (${word(lang)})` };
  if (typeof label === 'string') return { [lang]: `${label} (${word(lang)})` };
  return Object.fromEntries(Object.entries(label).map(([l, v]) => [l, `${v} (${word(l)})`]));
}

/** The key a copy of `type` gets: `<type>_kopie`, then `_2`, … unique among the types of `target`. */
export const freshTypeKey = (target: TemplateFile, type: string): string =>
  slugKey(`${type}_kopie`, new Set(Object.keys(target.types ?? {})));

const taken = (target: TemplateFile, section: 'tasks' | 'views'): Set<string> =>
  new Set(Object.keys(target[section] ?? {}));

/** `types.<k>` path. */
const at = (section: string, key: string): KeyPath => `${section}.${key}` as KeyPath;

function copyType(
  source: TemplateFile,
  type: string,
  key: string,
  known: ReadonlySet<string>,
  label: LocalizedString,
  roles: ReadonlySet<string> | undefined,
  dropped: Dropped[],
): Json {
  const def = structuredClone(source.types?.[type]) as unknown as Json & {
    label: LocalizedString;
    properties: Record<string, Json>;
    relations?: Record<string, Json>;
    permissions?: unknown;
  };
  def.label = label;
  const exists = (t: unknown): boolean => t === type || (typeof t === 'string' && known.has(t));
  const remap = (t: unknown): unknown => (t === type ? key : t);
  const properties: Record<string, Json> = {};
  for (const [k, p] of Object.entries(def.properties)) {
    if (p['type'] === 'reference' && p['to'] !== undefined) {
      if (!exists(p['to'])) {
        dropped.push({ kind: DROPPED.property, key: k, type: String(p['to']) });
        continue;
      }
      p['to'] = remap(p['to']);
    }
    properties[k] = p;
  }
  def.properties = properties;
  const relations: Record<string, Json> = {};
  for (const [k, r] of Object.entries(def.relations ?? {})) {
    const inverse = typeof r['inverse_of'] === 'string' ? r['inverse_of'].split('.')[0] : undefined;
    if (!exists(r['to']) || (inverse !== undefined && !exists(inverse))) {
      dropped.push({ kind: DROPPED.relation, key: k, type: String(r['to']) });
      continue;
    }
    r['to'] = remap(r['to']);
    if (inverse === type && typeof r['inverse_of'] === 'string')
      r['inverse_of'] = `${key}${r['inverse_of'].slice(type.length)}`;
    relations[k] = r;
  }
  if (def.relations !== undefined) {
    if (Object.keys(relations).length === 0) delete def.relations;
    else def.relations = relations;
  }
  if (roles !== undefined && def.permissions !== undefined) {
    const kept = onlyRoles(def.permissions, roles);
    if (kept.changed) dropped.push({ kind: DROPPED.permissions });
    def.permissions = kept.value;
  }
  return def;
}

/** An audience (`$all` or role keys) without the roles `roles` lacks; a map of audiences (per property) likewise. */
function onlyRoles(node: unknown, roles: ReadonlySet<string>): { value: unknown; changed: boolean } {
  if (Array.isArray(node)) {
    const value = node.filter((r) => typeof r !== 'string' || roles.has(r));
    return { value, changed: value.length !== node.length };
  }
  if (node === null || typeof node !== 'object') return { value: node, changed: false };
  let changed = false;
  const value = Object.fromEntries(
    Object.entries(node).map(([k, v]) => {
      const r = onlyRoles(v, roles);
      changed ||= r.changed;
      return [k, r.value];
    }),
  );
  return { value, changed };
}

/**
 * The ops that add a copy of `type` (in `source`) to `target` under `key`, with `label`. `source` is `target` for a
 * duplicate. Returns no ops when `source` has no such type.
 */
export function copyTypeOps(
  source: TemplateFile,
  type: string,
  target: TemplateFile,
  key: string,
  label: LocalizedString,
  mode: 'duplicate' | 'import',
): TypeCopy {
  const dropped: Dropped[] = [];
  if (source.types?.[type] === undefined) return { key, ops: [], tasks: [], rules: [], views: [], dropped };
  const known = new Set(Object.keys(target.types ?? {}));
  const ops: Op[] = [
    {
      kind: 'add',
      path: at('types', key),
      value: copyType(
        source,
        type,
        key,
        known,
        label,
        mode === 'import' ? new Set(Object.keys(target.roles ?? {})) : undefined,
        dropped,
      ),
    },
  ];
  const rel = relatedTo(source, type);
  const usedTasks = taken(target, 'tasks');
  const taskKeys = new Map<string, string>();
  const copies = new Map<string, Json & { auto?: Record<string, Json & { after?: string }> }>();
  for (const old of rel.tasks) {
    // A task of the type that creates another type writes a reference to the original (`set: { parent: self }`): a copy
    // of it would point the new object at the original type, so it stays out and is listed.
    const creates = source.tasks?.[old]?.creates;
    if (creates !== undefined && creates !== type) {
      dropped.push({ kind: DROPPED.task, key: old, type: creates });
      continue;
    }
    const task = structuredClone(source.tasks?.[old]) as unknown as Json & { on: string | string[] };
    const nk = slugKey(`${old}_kopie`, usedTasks);
    usedTasks.add(nk);
    taskKeys.set(old, nk);
    copies.set(old, task);
    const keep = (t: string): boolean => t === type || known.has(t);
    if (Array.isArray(task.on)) {
      for (const t of task.on)
        if (!t.startsWith('$') && !keep(t)) dropped.push({ kind: DROPPED.target, key: old, type: t });
      task.on = task.on.filter((t) => t.startsWith('$') || keep(t)).map((t) => (t === type ? key : t));
    } else if (task.on === type) task.on = key;
    if (task['creates'] === type) task['creates'] = key;
    ops.push({ kind: 'add', path: at('tasks', nk), value: task });
  }
  // The automatic actions travel inside their task. Both ends must be copied tasks: an action that runs after a task of
  // another type is left out and listed, and so is one of a task that stays behind that runs after a copied task.
  const ruleKeys: string[] = [];
  for (const id of rel.rules) {
    const { task: old, name } = splitAutoId(id);
    const copy = copies.get(old);
    const entry = copy?.auto?.[name];
    if (copy === undefined || entry === undefined) {
      dropped.push({ kind: DROPPED.rule, key: id });
      continue;
    }
    const after = entry.after === undefined ? undefined : taskKeys.get(entry.after);
    if (entry.after !== undefined && after === undefined) {
      delete copy.auto?.[name];
      dropped.push({ kind: DROPPED.rule, key: id });
      continue;
    }
    if (after !== undefined) entry.after = after;
    ruleKeys.push(`${taskKeys.get(old)}.${name}`);
  }
  for (const copy of copies.values())
    if (copy.auto !== undefined && Object.keys(copy.auto).length === 0) delete copy.auto;
  const usedViews = taken(target, 'views');
  const viewKeys: string[] = [];
  for (const old of rel.views) {
    const view = structuredClone(source.views?.[old]) as unknown as Json & {
      label?: LocalizedString;
      source: { type: string };
      layers?: Record<string, { source?: { type?: string } }>;
    };
    view.source.type = key;
    for (const layer of Object.values(view.layers ?? {}))
      if (layer.source?.type === type) layer.source.type = key;
    view.label = copyLabel(view.label, 'de', old);
    const nk = slugKey(`${old}_kopie`, usedViews);
    usedViews.add(nk);
    viewKeys.push(nk);
    ops.push({ kind: 'add', path: at('views', nk), value: view });
  }
  return { key, ops, tasks: [...taskKeys.values()], rules: ruleKeys, views: viewKeys, dropped };
}
