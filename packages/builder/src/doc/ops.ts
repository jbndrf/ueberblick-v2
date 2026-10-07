/**
 * Edit operations on the overlay's YAML Document. Only the overlay is ever touched (docs/05: every
 * edit is an overlay entry). `yaml` keeps comments, key order and formatting of what is not edited.
 * Lists stay atomic (A-005): a path never addresses a list element; `hide` is the one list, edited
 * by entry.
 */
import { isCollection, isMap, isNode, isSeq, isScalar, type Document } from 'yaml';
import { parseKeyPath, type KeyPath } from '@ueberblick/core';
import type { Op } from './contract';

type Segs = readonly string[];

/** Thrown inside an op when it cannot be done as asked; `applyOp` turns it into a refusal with the reason. */
class OpRefused extends Error {
  constructor(
    message: string,
    readonly shown: string,
  ) {
    super(message);
  }
}

/** The value at `segs` inside plain data (a list is atomic), or `undefined`. */
export function valueAt(root: unknown, segs: Segs): unknown {
  let node = root;
  for (const s of segs) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[s];
  }
  return node;
}

/** Structural equality of plain data. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every(
        (k) => k in b && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

const isPrefix = (a: Segs, b: Segs): boolean => a.length <= b.length && a.every((s, i) => s === b[i]);
const isProperPrefix = (a: Segs, b: Segs): boolean => a.length < b.length && isPrefix(a, b);
const same = (a: Segs, b: Segs): boolean => a.length === b.length && isPrefix(a, b);

/** The entries of a top-level overlay map (`override`, `add`), as key path text. */
function keysOf(doc: Document, section: string): string[] {
  const node = doc.get(section, true);
  if (!isMap(node)) return [];
  return node.items.map((p) => String(isScalar(p.key) ? p.key.value : p.key));
}

/** A scalar goes in as is (`yaml` keeps the comment and style of the node it replaces); a structure as a node. */
const wrap = (doc: Document, v: unknown): unknown =>
  v !== null && typeof v === 'object' ? doc.createNode(v) : v;

/** Index of the first proper ancestor of `at` that exists as a scalar (so `at` cannot be reached), else -1. */
function scalarAncestor(doc: Document, at: readonly string[]): number {
  for (let i = 1; i < at.length; i++) {
    const node = doc.getIn(at.slice(0, i), true); // a raw value when set from JS, else a Scalar
    if (node !== undefined && !isCollection(node)) return i - 1;
  }
  return -1;
}

/** A scalar entry sits where the path needs a map (an earlier `set` of a parent): never overwritten silently. */
function blocked(at: readonly string[], blocker: number): OpRefused {
  const parent = at.slice(1, blocker + 1);
  const shown = parent.length > 0 ? parent.join('.') : (at[0] ?? '');
  const text = `An earlier edit set ${shown} to a single value, so nothing below it can be edited. Reset ${shown} first.`;
  return new OpRefused(text, shown);
}

/** Sets the value at `at`; a replaced structure hands its comments and flow style to the new one. */
function put(doc: Document, at: readonly string[], value: unknown): void {
  const blocker = scalarAncestor(doc, at);
  if (blocker >= 0) throw blocked(at, blocker);
  const next = wrap(doc, value);
  const prev = doc.getIn(at, true);
  if (isNode(next) && isNode(prev)) {
    if (prev.comment !== undefined) next.comment = prev.comment;
    if (prev.commentBefore !== undefined) next.commentBefore = prev.commentBefore;
    if (prev.spaceBefore) next.spaceBefore = true;
    if (isMap(next) && isMap(prev) && prev.flow !== undefined) next.flow = prev.flow;
  }
  doc.setIn(at, next);
}

/** Drop an overlay section once its last entry is gone, so the file stays tidy. */
function tidy(doc: Document, section: string): void {
  const node = doc.get(section, true);
  if ((isMap(node) || isSeq(node)) && node.items.length === 0) doc.delete(section);
}

/** The entry of `section` that contains `segs` (equal or ancestor), with the rest of the path. */
function containing(doc: Document, section: string, segs: Segs): { key: string; rest: Segs } | undefined {
  for (const key of keysOf(doc, section)) {
    const k = parseKeyPath(key);
    if (k && isPrefix(k, segs)) return { key, rest: segs.slice(k.length) };
  }
  return undefined;
}

function writeAt(doc: Document, section: string, hit: { key: string; rest: Segs }, value: unknown): void {
  put(doc, [section, hit.key, ...hit.rest], value);
}

/** `inputs.<key>` and `inputs.<key>.default` address the overlay's `inputs`. */
function inputKey(segs: Segs): string | undefined {
  if (segs[0] !== 'inputs' || segs.length < 2 || segs.length > 3) return undefined;
  return segs.length === 2 || segs[2] === 'default' ? segs[1] : undefined;
}

function setValue(
  doc: Document,
  template: unknown,
  path: KeyPath,
  segs: Segs,
  value: unknown,
  allowOverride: boolean,
): void {
  const input = allowOverride ? inputKey(segs) : undefined;
  if (input !== undefined) return put(doc, ['inputs', input], value);
  const added = containing(doc, 'add', segs);
  if (added) return writeAt(doc, 'add', added, value);
  if (!allowOverride) return put(doc, ['add', path], value);
  // `override` only changes what the template has (merge skips the rest), so a value it lacks is an `add` (docs/05).
  const overridden = containing(doc, 'override', segs);
  if (overridden) return writeAt(doc, 'override', overridden, value);
  if (valueAt(template, segs) === undefined) return put(doc, ['add', path], value);
  // A new override at `path` supersedes overrides below it (merge would apply them after it).
  for (const key of keysOf(doc, 'override')) {
    const k = parseKeyPath(key);
    if (k && isProperPrefix(segs, k)) doc.deleteIn(['override', key]);
  }
  put(doc, ['override', path], value);
}

function reset(doc: Document, segs: Segs): void {
  const input = inputKey(segs);
  if (input !== undefined && doc.hasIn(['inputs', input])) {
    doc.deleteIn(['inputs', input]);
    return tidy(doc, 'inputs');
  }
  for (const section of ['override', 'add']) {
    const hit = containing(doc, section, segs);
    if (!hit) continue;
    const at = hit.rest.length === 0 ? [section, hit.key] : [section, hit.key, ...hit.rest];
    const blocker = scalarAncestor(doc, at);
    if (blocker >= 0) throw blocked(at, blocker);
    doc.deleteIn(at);
    return tidy(doc, section);
  }
}

/** An `order` of a map at or below `segs` goes with it: a removed or hidden map has nothing left to order (WP-477). */
function dropOrderUnder(doc: Document, segs: Segs): void {
  for (const key of keysOf(doc, 'order')) {
    const k = parseKeyPath(key);
    if (k && isPrefix(segs, k)) doc.deleteIn(['order', key]);
  }
  tidy(doc, 'order');
}

function hideIndex(doc: Document, path: KeyPath): number {
  const node = doc.get('hide', true);
  return isSeq(node) ? node.items.findIndex((i) => (isScalar(i) ? i.value : i) === path) : -1;
}

/** The outcome of `applyOp`: the overlay changed or not, or the op could not be done and why. */
export type OpOutcome = { readonly changed: boolean } | { readonly refused: string; readonly shown: string };

/** Applies `op` to `doc` in place (`template` decides between `override` and `add`). */
export function applyOp(doc: Document, template: unknown, op: Op, segs: Segs): OpOutcome {
  const before = String(doc);
  try {
    switch (op.kind) {
      case 'set':
        setValue(doc, template, op.path, segs, op.value, true);
        break;
      case 'add':
        setValue(doc, template, op.path, segs, op.value, false);
        break;
      case 'hide':
        dropOrderUnder(doc, segs);
        if (hideIndex(doc, op.path) < 0) {
          if (isSeq(doc.get('hide', true))) doc.addIn(['hide'], op.path);
          else doc.set('hide', doc.createNode([op.path]));
        }
        break;
      case 'unhide': {
        const i = hideIndex(doc, op.path);
        if (i >= 0) {
          doc.deleteIn(['hide', i]);
          tidy(doc, 'hide');
        }
        break;
      }
      case 'reset':
        reset(doc, segs);
        dropOrderUnder(doc, segs);
        break;
      case 'order':
        put(doc, ['order', op.path], op.keys);
        break;
    }
  } catch (e) {
    if (e instanceof OpRefused) return { refused: e.message, shown: e.shown };
    throw e;
  }
  return { changed: String(doc) !== before };
}

export { same as sameSegments, isPrefix, isProperPrefix };
