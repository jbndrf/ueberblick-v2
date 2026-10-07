/**
 * Reference completion for the Code view (v3 `code-view/yaml-ref-complete.ts`): on a key that points at an
 * entity of the project (a property, stage, role, task or Objektart) the author sees the entity's name
 * and the key goes in. Headless: the CodeMirror adapter (`editor.ts`) only translates. v3 also completed
 * fixed vocabularies (effects, field types); here the schema-driven completion of the YAML lens does not
 * exist on this path, so only the references are ported (see the work package Log).
 */
import { processesOf, type LocalizedString } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { labelOf } from '../../shell/location';

export const REF_KINDS = ['property', 'stage', 'role', 'task', 'type'] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** An entity the YAML can name: its stable `key` (inserted) and its display `label` (shown). */
export interface RefItem {
  readonly key: string;
  readonly label: string;
}
export type RefSources = Partial<Record<RefKind, readonly RefItem[]>>;

export interface RefOption {
  readonly label: string;
  readonly apply: string;
  readonly detail?: string;
  readonly kind: RefKind;
}
export interface RefCompletion {
  /** Offset where the replaced word starts. */
  readonly from: number;
  readonly options: readonly RefOption[];
}

/** The keys of the template file whose value names an entity (`docs/05`, `core/template/references.ts`). */
const REF_KEYS: Readonly<Record<string, RefKind>> = {
  property: 'property',
  geometry: 'property',
  sort: 'property',
  properties: 'property',
  start: 'stage',
  end: 'stage',
  roles: 'role',
  after: 'task',
  on: 'type',
  creates: 'type',
  to: 'type',
};
/** Keys below which every entry's value is a list of roles (`permissions.see|create|write`). */
const ROLE_PARENTS = ['see', 'create', 'write'];
const ROLE_KEYS = ['see', 'create', 'write'];

const INLINE_KEY = /^(\s*)(?:-\s+)?([A-Za-z0-9_$]+):\s*(.*)$/;
const LIST_ITEM = /^(\s*)-\s+(.*)$/;
const ANY_KEY = /^(\s*)(?:-\s+)?([A-Za-z0-9_$]+):/;
const indentOf = (s: string): number => s.match(/^\s*/)?.[0].length ?? 0;

/** Mapping keys above line `at` (0-based) at strictly decreasing indentation, nearest first. */
function ancestorKeys(lines: readonly string[], at: number, indent: number): string[] {
  const out: string[] = [];
  let need = indent;
  for (let i = at - 1; i >= 0; i--) {
    const prev = lines[i] ?? '';
    if (prev.trim() === '' || indentOf(prev) >= need) continue;
    const m = ANY_KEY.exec(prev);
    if (m?.[2] !== undefined) out.push(m[2]);
    need = indentOf(prev);
    if (need === 0) break;
  }
  return out;
}

interface Where {
  readonly key: string;
  readonly ancestors: readonly string[];
  /** Offset in `text` where the typed word starts. */
  readonly from: number;
}

/** The start of the word being typed in the value `typed` (after a `[`, a `,` or an opening quote). */
const wordStart = (typed: string): number => {
  const cut = Math.max(
    typed.lastIndexOf('['),
    typed.lastIndexOf(','),
    typed.lastIndexOf('"'),
    typed.lastIndexOf("'"),
  );
  const rest = typed.slice(cut + 1);
  return cut + 1 + (rest.length - rest.trimStart().length);
};

function locate(text: string, pos: number): Where | undefined {
  const lines = text.split('\n');
  const before = text.slice(0, pos).split('\n');
  const at = before.length - 1;
  const upTo = before[at] ?? '';
  const lineStart = pos - upTo.length;
  const inline = INLINE_KEY.exec(upTo);
  if (inline?.[2] !== undefined) {
    const typed = inline[3] ?? '';
    const valueAt = upTo.length - typed.length;
    return {
      key: inline[2],
      ancestors: ancestorKeys(lines, at, inline[1]?.length ?? 0),
      from: lineStart + valueAt + wordStart(typed),
    };
  }
  const item = LIST_ITEM.exec(upTo);
  if (item) {
    const itemIndent = item[1]?.length ?? 0;
    const typed = item[2] ?? '';
    for (let i = at - 1; i >= 0; i--) {
      const prev = lines[i] ?? '';
      if (prev.trim() === '' || indentOf(prev) >= itemIndent) continue;
      const parent = ANY_KEY.exec(prev);
      if (parent?.[2] === undefined) return undefined;
      return {
        key: parent[2],
        ancestors: ancestorKeys(lines, i, indentOf(prev)),
        from: pos - typed.length,
      };
    }
  }
  return undefined;
}

function kindOf(where: Where): RefKind | undefined {
  const { key, ancestors } = where;
  if (key === 'to' && !ancestors.includes('properties')) return undefined;
  if (key === 'properties' && !ancestors.includes('views')) return undefined;
  if (ROLE_KEYS.includes(key) || ancestors.some((a) => ROLE_PARENTS.includes(a))) {
    if (ancestors.includes('permissions') || ROLE_KEYS.includes(key)) return 'role';
  }
  return REF_KEYS[key];
}

/** What to offer at `pos` of `text`; `undefined` when the cursor is not on a completable value. */
export function completeRefs(text: string, pos: number, sources: RefSources): RefCompletion | undefined {
  const where = locate(text, pos);
  if (where === undefined) return undefined;
  const kind = kindOf(where);
  if (kind === undefined) return undefined;
  const items = sources[kind] ?? [];
  if (items.length === 0) return undefined;
  return {
    from: where.from,
    options: items.map((it): RefOption => ({
      label: it.label === '' ? it.key : it.label,
      apply: it.key,
      ...(it.key !== it.label && it.label !== '' ? { detail: it.key } : {}),
      kind,
    })),
  };
}

/** The project's keys the references draw from: properties and stages of the Objektart, roles, tasks, Objektarten. */
export function refSources(doc: Doc, type: string, locale: string): RefSources {
  const file = doc.effective();
  const featureType = file.types?.[type];
  const process = featureType === undefined ? undefined : processesOf(featureType)[0];
  const items = (
    map: Readonly<Record<string, { readonly label?: LocalizedString | undefined } | undefined>> | undefined,
  ): RefItem[] =>
    Object.entries(map ?? {}).map(([key, v]) => ({ key, label: labelOf(v?.label, locale, key) }));
  const options = process === undefined ? {} : (featureType?.properties[process.property]?.options ?? {});
  return {
    property: items(featureType?.properties),
    stage: Object.entries(options).map(([key, label]) => ({ key, label: labelOf(label, locale, key) })),
    role: items(file.roles),
    task: items(file.tasks),
    type: items(file.types),
  };
}
