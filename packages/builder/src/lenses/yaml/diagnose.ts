/**
 * The problems of the overlay text, mapped to text ranges, and the plan for saving it.
 * Three stages, in order, and the first failing one is the answer:
 *   1. the text must be YAML,
 *   2. it must be an overlay of this document's template (file schema),
 *   3. its ops must apply to the document model and reproduce exactly what was typed.
 * Only when all three hold does a save produce ops; invalid text never reaches the document.
 * Once it is applicable, the effective file's problems (merge, compile) are shown at the override,
 * add or hide entry they come from; they do not block saving (the problems panel shows them too).
 */
import { isMap, isNode, isScalar, isSeq, parseDocument, type Document } from 'yaml';
import { OverlayFileSchema, parseKeyPath, type KeyPath, type OverlayFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { labelOf } from '../../shell/location';
import { overlayOps, sameValue } from './overlay-ops';

export interface Diagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** `yaml`, `overlay`, `apply` or the problem code of the document model. */
  readonly code: string;
}

export interface Diagnosis {
  /** No error: the text can be saved. Warnings (problems of the effective file) do not block. */
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  /** The ops that turn the document into the typed overlay; empty unless `ok`. */
  readonly ops: readonly Op[];
  /** The typed overlay as data; set when `ok`. */
  readonly target?: OverlayFile;
  /** Problems of the effective file that no line of the overlay text is responsible for. */
  readonly unplaced: number;
}

export type SavePlan =
  | { readonly ok: true; readonly ops: readonly Op[]; readonly target: OverlayFile }
  | { readonly ok: false; readonly errors: readonly Diagnostic[] };

/** 1-based line number of `offset`. */
export function lineOf(text: string, offset: number): number {
  let n = 1;
  const end = Math.min(offset, text.length);
  for (let i = text.indexOf('\n'); i >= 0 && i < end; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

type Range = readonly [number, number];

const firstLine = (text: string): Range => [
  0,
  Math.max(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')),
];

/** The range of the key at `path`, else of the value there, else of the nearest ancestor that has one. */
function rangeAt(ydoc: Document, path: readonly (string | number)[], text: string): Range {
  for (let n = path.length; n > 0; n--) {
    const at = path.slice(0, n);
    const parent = ydoc.getIn(at.slice(0, -1), true);
    const last = at[at.length - 1];
    if (isMap(parent)) {
      const pair = parent.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === last);
      if (pair !== undefined && isNode(pair.key) && pair.key.range)
        return [pair.key.range[0], pair.key.range[1]];
    }
    const node = ydoc.getIn(at, true);
    if (isNode(node) && node.range) return [node.range[0], node.range[1]];
  }
  return firstLine(text);
}

function yamlErrors(ydoc: Document, text: string): Diagnostic[] {
  return ydoc.errors.map((e) => {
    const [from, to] = e.pos;
    return {
      from,
      to: Math.max(to, Math.min(from + 1, text.length)),
      severity: 'error',
      message: e.message.split('\n')[0] as string,
      code: 'yaml',
    };
  });
}

/** Stage 2: the file schema, and "this overlay extends this template". */
function overlayErrors(ydoc: Document, text: string, doc: Doc): { errors: Diagnostic[]; data?: OverlayFile } {
  const parsed = OverlayFileSchema.safeParse(ydoc.toJS());
  const at = (path: readonly (string | number)[], message: string): Diagnostic => {
    const [from, to] = rangeAt(ydoc, path, text);
    return { from, to, severity: 'error', message, code: 'overlay' };
  };
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.flatMap((i) => {
        const path = i.path.filter((p): p is string | number => typeof p !== 'symbol');
        if (i.code === 'unrecognized_keys') {
          return i.keys.map((k) =>
            at(
              [...path, k],
              `Unknown key "${k}". An overlay has: schema, extends, inputs, override, add, hide.`,
            ),
          );
        }
        return [at(path, i.message)];
      }),
    };
  }
  const errors: Diagnostic[] = [];
  const t = doc.template.template;
  const [key, major] = parsed.data.extends.split('@') as [string, string];
  if (key !== t.key || major !== t.version.split('.')[0]) {
    errors.push(
      at(
        ['extends'],
        `This project builds on ${t.key}@${t.version.split('.')[0]}, not ${parsed.data.extends}.`,
      ),
    );
  } else if (parsed.data.extends !== doc.overlay().extends) {
    errors.push(
      at(
        ['extends'],
        `extends stays ${doc.overlay().extends}; change the template version in the versions area.`,
      ),
    );
  }
  if (parsed.data.schema !== doc.overlay().schema)
    errors.push(at(['schema'], `schema stays ${doc.overlay().schema}.`));
  return { errors, data: parsed.data };
}

const isPrefix = (a: readonly string[], b: readonly string[]): boolean =>
  a.length <= b.length && a.every((s, i) => s === b[i]);

/** The text range of the overlay entry a problem at `path` comes from; the deepest entry wins. */
function placeProblem(ydoc: Document, path: KeyPath, text: string): Range | undefined {
  const segs = parseKeyPath(path);
  if (segs === undefined) return undefined;
  let best: { depth: number; range: Range } | undefined;
  const offer = (depth: number, range: Range): void => {
    if (best === undefined || depth > best.depth) best = { depth, range };
  };
  for (const section of ['override', 'add']) {
    const node = ydoc.get(section, true);
    if (!isMap(node)) continue;
    for (const pair of node.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
      const kp = parseKeyPath(key);
      if (kp === undefined || !isPrefix(kp, segs)) continue;
      const rest = segs.slice(kp.length);
      offer(kp.length, rangeAt(ydoc, [section, key, ...rest], text));
    }
  }
  const hide = ydoc.get('hide', true);
  if (isSeq(hide)) {
    for (const item of hide.items) {
      const kp = parseKeyPath(String(isScalar(item) ? item.value : item));
      if (kp !== undefined && isPrefix(kp, segs) && isNode(item) && item.range)
        offer(kp.length, [item.range[0], item.range[1]]);
    }
  }
  const input = segs[0] === 'inputs' ? segs[1] : undefined;
  if (input !== undefined && ydoc.hasIn(['inputs', input])) offer(2, rangeAt(ydoc, ['inputs', input], text));
  return (best as { range: Range } | undefined)?.range;
}

/** An empty section and an absent one mean the same (the document model drops empty sections). */
export function withoutEmpty(o: OverlayFile): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => !(typeof v === 'object' && v !== null && Object.keys(v).length === 0),
    ),
  );
}

/** Stage 3: apply the ops to a copy of the document; the copy must end up as the typed overlay. */
function dryRun(
  doc: Doc,
  data: OverlayFile,
  ydoc: Document,
  text: string,
): { ops: Op[]; errors: Diagnostic[]; result: Doc } {
  const ops = overlayOps(doc.overlay(), data);
  let cur = doc;
  const errors: Diagnostic[] = [];
  for (const op of ops) {
    const r = cur.apply(op);
    if (r.refused) {
      const [from, to] = placeProblem(ydoc, op.path, text) ?? firstLine(text);
      errors.push({ from, to, severity: 'error', message: r.refused.message, code: 'apply' });
      continue;
    }
    cur = r.doc;
  }
  if (errors.length === 0 && !sameValue(withoutEmpty(cur.overlay()), withoutEmpty(data))) {
    const [from, to] = firstLine(text);
    errors.push({
      from,
      to,
      severity: 'error',
      message:
        'This text cannot be saved as typed: an entry sits in a section the document model would place elsewhere (for example an override inside an added entity). Write it in the section that holds the entity.',
      code: 'apply',
    });
  }
  return { ops, errors, result: cur };
}

export function diagnose(text: string, doc: Doc, locale = 'en'): Diagnosis {
  const ydoc = parseDocument(text);
  const syntax = yamlErrors(ydoc, text);
  if (syntax.length > 0) return { ok: false, diagnostics: syntax, ops: [], unplaced: 0 };
  const shape = overlayErrors(ydoc, text, doc);
  if (shape.data === undefined || shape.errors.length > 0) {
    return { ok: false, diagnostics: shape.errors, ops: [], unplaced: 0 };
  }
  const run = dryRun(doc, shape.data, ydoc, text);
  if (run.errors.length > 0) return { ok: false, diagnostics: run.errors, ops: [], unplaced: 0 };
  let unplaced = 0;
  const diagnostics: Diagnostic[] = [];
  for (const p of run.result.problems()) {
    const range = placeProblem(ydoc, p.path, text);
    if (range === undefined) {
      unplaced++;
      continue;
    }
    const hint = p.hint === undefined ? '' : ` (${p.hint})`;
    diagnostics.push({
      from: range[0],
      to: Math.max(range[1], range[0] + 1),
      severity: 'warning',
      message: `${labelOf(p.message, locale, p.code)}${hint}`,
      code: p.code,
    });
  }
  return { ok: true, diagnostics, ops: run.ops, target: shape.data, unplaced };
}

export function planSave(text: string, doc: Doc, locale = 'en'): SavePlan {
  const d = diagnose(text, doc, locale);
  return d.ok && d.target ? { ok: true, ops: d.ops, target: d.target } : { ok: false, errors: d.diagnostics };
}
