/**
 * The Code view's engine (WP-332): the effective YAML of one entity with provenance per line, and the
 * overlay ops that an edited text stands for. Headless; `Doc.entityYaml` / `Doc.applyEntityYaml` call here.
 */
import { LineCounter, isMap, isScalar, parseDocument, stringify } from 'yaml';
import {
  compile,
  formatKeyPath,
  NO_ASSETS,
  parseKeyPath,
  type KeyPath,
  type Problem,
} from '@ueberblick/core';
import type { Doc, EntityYaml, EntityYamlLine, EntityYamlProblem, EntityYamlResult, Op } from './contract';
import { applyOps } from './apply-ops';
import { lockOf } from './lock';
import { sameData, valueAt } from './ops';

export type Segs = readonly string[];
export type Data = Record<string, unknown>;

const SECTIONS: readonly string[] = ['types', 'tasks'];

/** `types.<t>`, `tasks.<k>`, `tasks.<k>.auto.<n>` (an automatic action) or `types.<t>.properties.<p>`; else `undefined`. */
function entitySegs(path: KeyPath): Segs | undefined {
  const s = parseKeyPath(path);
  if (!s || !SECTIONS.includes(s[0] ?? '')) return undefined;
  if (s.length === 2) return s;
  if (s.length !== 4) return undefined;
  return (s[0] === 'types' && s[2] === 'properties') || (s[0] === 'tasks' && s[2] === 'auto') ? s : undefined;
}

export const isData = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);
export const render = (v: unknown): string => stringify(v, { lineWidth: 0 });

/** The lines of `text`, each tagged with the deepest key path it sits in. */
export function lineMap(text: string, base: Segs): string[] {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  const count = text.replace(/\n$/, '').split('\n').length;
  const out: string[] = new Array<string>(count).fill(formatKeyPath([...base]));
  const walk = (node: unknown, segs: Segs): void => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const here = [...segs, key];
      const range = (pair.key as { range?: [number, number, number] } | null)?.range;
      if (!range) continue;
      const first = lc.linePos(range[0]).line;
      const vr = (pair.value as { range?: [number, number, number] } | null)?.range;
      const last = vr ? Math.max(first, lc.linePos(Math.max(vr[1] - 1, range[0])).line) : first;
      const p = formatKeyPath([...here]);
      for (let l = first; l <= Math.min(last, count); l++) out[l - 1] = p;
      walk(pair.value, here);
    }
  };
  walk(doc.contents, base);
  return out;
}

export function entityYaml(doc: Doc, path: KeyPath): EntityYaml {
  const segs = entitySegs(path);
  const value = segs ? valueAt(doc.effective(), segs) : undefined;
  if (!segs || !isData(value)) return { text: '', lines: [] };
  const text = render(value);
  const lines: EntityYamlLine[] = lineMap(text, segs).map((p, i) => ({
    line: i + 1,
    path: p,
    provenance: doc.provenance(p),
  }));
  return { text, lines };
}

/** The minimal ops from `old` to `next` below `segs`; lists and scalars are atomic. */
export function diff(doc: Doc, old: Data, next: Data, segs: Segs, ops: Op[]): void {
  const template = doc.template;
  const hidden = new Set(doc.overlay().hide ?? []);
  for (const [k, v] of Object.entries(next)) {
    const at = [...segs, k];
    const path = formatKeyPath(at);
    if (!(k in old)) {
      if (hidden.has(path)) ops.push({ kind: 'unhide', path });
      const tpl = valueAt(template, at);
      if (!hidden.has(path) || !sameData(tpl, v)) {
        ops.push({ kind: hidden.has(path) ? 'set' : 'add', path, value: v });
      }
      continue;
    }
    const o = old[k];
    if (isData(o) && isData(v)) diff(doc, o, v, at, ops);
    else if (!sameData(o, v)) {
      const back = doc.provenance(path) === 'changed' && sameData(valueAt(template, at), v);
      ops.push(back ? { kind: 'reset', path } : { kind: 'set', path, value: v });
    }
  }
  for (const k of Object.keys(old)) {
    if (k in next) continue;
    const at = [...segs, k];
    const path = formatKeyPath(at);
    ops.push(valueAt(template, at) !== undefined ? { kind: 'hide', path } : { kind: 'reset', path });
  }
}

export const fail = (problems: EntityYamlProblem[]): EntityYamlResult => ({ ok: false, problems });
export const problem = (
  path: KeyPath,
  code: Problem['code'],
  message: string,
  hint: string,
): EntityYamlProblem => ({
  path,
  code,
  message,
  hint,
});

const key = (p: Problem): string => `${p.code} ${p.path}`;

export function applyEntityYaml(doc: Doc, path: KeyPath, text: string): EntityYamlResult {
  const segs = entitySegs(path);
  const old = segs ? valueAt(doc.effective(), segs) : undefined;
  if (!segs || !isData(old)) {
    return fail([
      problem(
        path,
        'unknown_path',
        `${path} is not an entity of the effective file.`,
        'use types.<t>, tasks.<k>, rules.<k> or types.<t>.properties.<p>',
      ),
    ]);
  }
  const lc = new LineCounter();
  const parsed = parseDocument(text, { lineCounter: lc });
  if (parsed.errors.length > 0) {
    return fail(
      parsed.errors.map((e) => {
        const [pos] = e.linePos ?? [];
        return {
          ...problem(path, 'schema_invalid', e.message, 'fix the YAML at this position'),
          ...(pos ? { line: pos.line, column: pos.col } : {}),
        };
      }),
    );
  }
  const next: unknown = parsed.toJS();
  if (!isData(next)) {
    return fail([
      {
        ...problem(path, 'schema_invalid', 'An entity is a map of keys.', 'write key: value lines'),
        line: 1,
        column: 1,
      },
    ]);
  }
  const ops: Op[] = [];
  diff(doc, old, next, segs, ops);
  return checkOps(doc, ops);
}

/**
 * What an edit's ops must pass before they are handed to the caller: no locked path (the template's
 * `lock`, Q30), `applyOps` takes them all, and the effective file gets no compile problem it did not have.
 */
export function checkOps(doc: Doc, ops: readonly Op[]): EntityYamlResult {
  const locked = ops.flatMap((op) => {
    return lockOf(doc, op.path, op.kind) !== undefined
      ? [
          problem(
            op.path,
            'lock_violation',
            `The template locks ${op.path}; the overlay may not change it.`,
            'undo this edit',
          ),
        ]
      : [];
  });
  if (locked.length > 0) return fail(locked);
  const trial = applyOps(doc, ops);
  if ('refused' in trial) {
    return fail([problem(trial.refused.path, 'unknown_path', trial.refused.message, 'undo this edit')]);
  }
  if (ops.length > 0) {
    const before = compile(doc.effective(), { assets: NO_ASSETS });
    const after = compile(trial.doc.effective(), { assets: NO_ASSETS });
    if (!after.ok) {
      const known = new Set((before.ok ? [] : before.problems).map(key));
      const fresh = after.problems.filter((p) => !known.has(key(p)));
      if (fresh.length > 0) return fail([...fresh]);
    }
  }
  return { ok: true, ops };
}
