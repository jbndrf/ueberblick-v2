/**
 * The completion source of the YAML lens: keys and values from the JSON Schema at the cursor path.
 * The overlay's `override` and `add` keys are key paths into the project file, so below such a key
 * the schema of the *template file* at that path applies (docs/05: an overlay entry is a value of
 * the file). Headless (no DOM): the CodeMirror adapter in `editor.ts` only translates.
 */
import { formatKeyPath, parseKeyPath } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { cursorContext, type CursorContext } from './cursor';
import { childKeys, fileSchema, schemaAt, valueOptions, type SchemaNode } from './schema-path';

export interface CompletionOption {
  readonly label: string;
  readonly detail?: string;
}

export interface Completions {
  /** Offset where the replaced word starts. */
  readonly from: number;
  readonly options: readonly CompletionOption[];
}

const NONE = (from: number): Completions => ({ from, options: [] });
const PATH_SECTIONS = ['override', 'add'];

function getAt(value: unknown, segs: readonly string[]): unknown {
  let cur: unknown = value;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/** Key paths one segment below what has been typed (`tasks.kon` offers `tasks.kontrolle`). */
function pathOptions(file: unknown, prefix: string, withSchema: boolean): CompletionOption[] {
  const dot = prefix.lastIndexOf('.');
  const parent = dot < 0 ? [] : parseKeyPath(prefix.slice(0, dot));
  if (parent === undefined) return [];
  const node = getAt(file, parent);
  const keys = new Map<string, string | undefined>();
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of Object.keys(node)) keys.set(k, undefined);
  }
  if (withSchema) {
    for (const o of childKeys(schemaAt(fileSchema('template'), parent))) {
      if (!keys.has(o.key)) keys.set(o.key, o.description);
    }
  }
  return [...keys].map(([k, description]) => ({
    label: formatKeyPath([...parent, k]),
    ...(description === undefined ? {} : { detail: description }),
  }));
}

/** The schema nodes for the map or value at `segs` of the overlay text. */
function nodesFor(segs: readonly string[]): SchemaNode[] {
  const [head, entry, ...rest] = segs;
  if (head !== undefined && PATH_SECTIONS.includes(head) && entry !== undefined) {
    const kp = parseKeyPath(entry);
    return kp === undefined ? [] : schemaAt(fileSchema('template'), [...kp, ...rest]);
  }
  return schemaAt(fileSchema('overlay'), segs);
}

function keyOptions(ctx: CursorContext, doc: Doc): CompletionOption[] {
  const { path } = ctx;
  const head = path[0];
  if (path.length === 1 && head !== undefined && PATH_SECTIONS.includes(head)) {
    return pathOptions(doc.effective(), ctx.prefix, head === 'add');
  }
  if (path.length === 1 && head === 'inputs') {
    return Object.entries(doc.template.inputs ?? {}).map(([k, v]) => ({
      label: k,
      ...(v.description === undefined ? {} : { detail: String(v.description) }),
    }));
  }
  return childKeys(nodesFor(path)).map((o) => ({
    label: o.key,
    ...(o.description === undefined ? {} : { detail: o.description }),
  }));
}

function valueOptionsFor(ctx: CursorContext, doc: Doc): CompletionOption[] {
  const key = ctx.key as string;
  if (ctx.path.length === 0 && key === 'extends') {
    const major = doc.template.template.version.split('.')[0] ?? '1';
    return [{ label: `${doc.template.template.key}@${major}` }];
  }
  const [head] = ctx.path;
  if (ctx.path.length === 1 && head !== undefined && PATH_SECTIONS.includes(head)) {
    const kp = parseKeyPath(key);
    return kp === undefined
      ? []
      : valueOptions(schemaAt(fileSchema('template'), kp)).map((label) => ({ label }));
  }
  return valueOptions(nodesFor([...ctx.path, key])).map((label) => ({ label }));
}

export function completeAt(text: string, pos: number, doc: Doc): Completions {
  const ctx = cursorContext(text, pos);
  if (ctx === undefined) return NONE(pos);
  let options: CompletionOption[];
  if (ctx.mode === 'value') options = valueOptionsFor(ctx, doc);
  else if (ctx.mode === 'item') {
    options =
      ctx.path[0] === 'hide'
        ? pathOptions(doc.template, ctx.prefix, false)
        : valueOptions(nodesFor(ctx.path)).map((label) => ({ label }));
  } else options = keyOptions(ctx, doc).filter((o) => !ctx.siblings.includes(o.label));
  const want = ctx.prefix.toLowerCase();
  return {
    from: ctx.from,
    options: options.filter((o) => o.label.toLowerCase().startsWith(want) && o.label !== ctx.prefix),
  };
}
