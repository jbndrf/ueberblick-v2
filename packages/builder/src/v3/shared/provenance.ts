/**
 * Where an element comes from, for the marks next to the places where it is edited (the form field cards, the task
 * pane): the template ("Vorlage"), changed against it ("Geändert") or added by the project ("Hinzugefügt"), and the
 * two things an admin can do about it, "Auf Vorlage zurücksetzen" and "Ausblenden". Pure, no DOM: one reading of
 * `Doc.provenance` for every place (R1); the ops are the ordinary `reset` / `hide` ops of the document.
 */
import { parseKeyPath, type KeyPath, type Provenance } from '@ueberblick/core';
import { lockOf, type Doc, type Op } from '../../doc';
import { removeOp } from '../../lenses/data-model/ops';
import type { MessageKey } from '../../shell/messages';

export interface ProvenanceInfo {
  readonly kind: Provenance;
  /** The template lock that covers the element (a path of the template's `lock`); undefined when it is free. */
  readonly lock: KeyPath | undefined;
}

/** The message that names a mark (typed: a new provenance without a message fails to compile). */
export const provenanceLabel = (p: Provenance): MessageKey => `dm_provenance_${p}`;

/** A project without a template (a blank one) has nothing to be "from": it shows no marks. */
export const hasTemplate = (doc: Doc): boolean => {
  const t = doc.template;
  return [t.types, t.tasks].some((m) => m !== undefined && Object.keys(m).length > 0);
};

const isPrefix = (a: readonly string[], b: readonly string[]): boolean => a.every((s, i) => b[i] === s);

const RANK: Record<Provenance, number> = { template: 0, changed: 1, added: 2 };

/**
 * The provenance of an element made of several paths (a field card is its property and its form entry): the
 * strongest wins, added over changed over template. `undefined` for a project without a template.
 */
export function provenanceOf(doc: Doc, paths: readonly KeyPath[]): ProvenanceInfo | undefined {
  if (!hasTemplate(doc)) return undefined;
  let kind: Provenance = 'template';
  for (const p of paths) {
    const k = doc.provenance(p);
    if (RANK[k] > RANK[kind]) kind = k;
  }
  const lock = paths.map((p) => lockOf(doc, p)).find((l) => l !== undefined);
  return { kind, lock };
}

/**
 * The ops that put the element at `paths` back to what the template says: every overlay entry (`override`,
 * `add`) at or below a path is reset, and a `hide` below it is lifted. Empty when nothing is changed.
 */
export function resetOps(doc: Doc, paths: readonly KeyPath[]): readonly Op[] {
  const ov = doc.overlay();
  const entries = [...Object.keys(ov.override ?? {}), ...Object.keys(ov.add ?? {})];
  const hides = ov.hide ?? [];
  const ops: Op[] = [];
  const seen = new Set<string>();
  const once = (op: Op): void => {
    const id = `${op.kind} ${op.path}`;
    if (!seen.has(id)) {
      seen.add(id);
      ops.push(op);
    }
  };
  for (const p of paths) {
    const segs = parseKeyPath(p) ?? [];
    // Only entries at or below the element: an entry above it (an added task) is not this element's to reset.
    const below = (k: string): boolean => isPrefix(segs, parseKeyPath(k) ?? []);
    for (const k of entries.filter(below)) once({ kind: 'reset', path: k });
    for (const h of hides.filter((x) => isPrefix(segs, parseKeyPath(x) ?? [])))
      once({ kind: 'unhide', path: h });
  }
  return ops;
}

/** "Ausblenden": a template element is hidden, an added one is dropped (`removeOp`). */
export const hideOps = (doc: Doc, path: KeyPath): readonly Op[] => [removeOp(doc, path)];

/** What an element's menu offers: reset when it is changed; the wording "Ausblenden" when it comes from the template. */
export const canReset = (info: ProvenanceInfo | undefined): boolean => info?.kind === 'changed';
export const hidesInsteadOfDeletes = (info: ProvenanceInfo | undefined): boolean =>
  info !== undefined && info.kind !== 'added';
