/**
 * Provenance on the canvas (WP-454): the small mark of a stage node, a task row, a rule node or an entry marker, and
 * the right-click menu entries "Auf Vorlage zurücksetzen" and "Ausblenden" (the delete of a template element is a
 * `hide`, as on the panes). Reads the shared helper (R1); the canvas state applies the ops through its `commit`.
 */
import type { Op } from '../../doc';
import {
  canReset,
  hidesInsteadOfDeletes,
  provenanceOf,
  resetOps,
  type ProvenanceInfo,
} from '../shared/provenance';
import { elementPaths, ELEMENT_KINDS, type ElementRef } from '../shared/provenance-elements';
import type { BuilderContext } from '../shell/context';
import type { MenuItem } from './state.svelte';

/** Where the element comes from; undefined in a project without a template (no mark). */
export const infoOf = (ctx: BuilderContext, ref: ElementRef): ProvenanceInfo | undefined =>
  provenanceOf(ctx.doc(), elementPaths(ctx.doc(), ctx.type, ref));

const HIDE_TITLE = {
  [ELEMENT_KINDS.task]: 'tp_hide_title',
  [ELEMENT_KINDS.rule]: 'rp_hide_title',
  [ELEMENT_KINDS.stage]: 'stage_hide_title',
} as const;
const HIDE_BODY = {
  [ELEMENT_KINDS.task]: 'tp_hide_body',
  [ELEMENT_KINDS.rule]: 'rp_hide_body',
  [ELEMENT_KINDS.stage]: 'stage_hide_body',
} as const;

export const hideTitleKey = (kind: ElementRef['kind']) => HIDE_TITLE[kind];
export const hideBodyKey = (kind: ElementRef['kind']) => HIDE_BODY[kind];
export const hides = (ctx: BuilderContext, ref: ElementRef): boolean =>
  hidesInsteadOfDeletes(infoOf(ctx, ref));

/** The menu entries for provenance: the reset (only for a changed element), disabled when the template locks it. */
export function resetItems(
  ctx: BuilderContext,
  ref: ElementRef,
  apply: (ops: readonly Op[]) => void,
): readonly MenuItem[] {
  const info = infoOf(ctx, ref);
  if (!canReset(info)) return [];
  const paths = elementPaths(ctx.doc(), ctx.type, ref);
  return [
    {
      label: ctx.t('prov_reset'),
      disabled: info?.lock !== undefined,
      run: () => apply(resetOps(ctx.doc(), paths)),
    },
  ];
}

/** The delete entry: "Ausblenden" for a template element, locked when the template pins it. */
export function deleteItem(
  ctx: BuilderContext,
  ref: ElementRef,
  deleteLabel: string,
  run: () => void,
): MenuItem {
  const info = infoOf(ctx, ref);
  return {
    label: hidesInsteadOfDeletes(info) ? ctx.t('prov_hide') : deleteLabel,
    destructive: true,
    disabled: info?.lock !== undefined,
    run,
  };
}
