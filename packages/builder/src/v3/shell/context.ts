/**
 * The builder context (v3 `builder-context.svelte.ts`): what every pane reads, so adding an
 * inspector or a view never touches the frame. Getters, not values: the frame's state changes.
 */
import { getContext, setContext } from 'svelte';
import type { ApplyOpsResult, ApplyResult, Doc, Op } from '../../doc';
import type { Translate } from '../../shell/messages';
import type { BuilderView, PaneWidth, Selection } from './registry';

/** How the host's write of the overlay went (the draft client says; the frame shows). */
export const SAVE_OUTCOMES = ['saved', 'conflict', 'failed'] as const;
export type SaveOutcome = (typeof SAVE_OUTCOMES)[number];

/** Where the host's other pages are, for the panes that point out of the builder (WP-437: the type settings' icons link). */
export interface BuilderLinks {
  /** The Objektart's data page, which holds the icon designer ("Standardfilter & Marker-Symbole"). */
  readonly icons?: string;
}

export interface BuilderContext {
  /** The key of the feature type (Objektart) this builder edits. */
  readonly type: string;
  readonly locale: string;
  readonly t: Translate;
  /** The current document; every edit replaces it (a Doc is immutable). */
  doc(): Doc;
  view(): BuilderView;
  selection(): Selection;
  select(selection: Selection): void;
  /**
   * The address of another Objektart's builder (the host knows its routes): sub-process links are anchors, so a
   * click, a middle-click and the unsaved-changes guard of the host all work as for any link. Absent: no links.
   */
  typeHref?: ((type: string) => string) | undefined;
  /** The one write path: `Doc.apply`. A refusal comes back in `refused`; the doc is then unchanged. */
  apply(op: Op): ApplyResult;
  /** A pane asks for another width than it registered with (v3 `ui.paletteExpanded`: the stage pane widens with its field palette); `undefined` gives it back. */
  setPaneWidth(width: PaneWidth | undefined): void;
  /** The host's pages a pane may link to. */
  readonly links: BuilderLinks;
  /** Several ops as one edit (`Doc.applyBatch`): all or none, the file schema checked on the end state; one step for the frame's `onchange`. */
  applyBatch(ops: readonly Op[]): ApplyOpsResult;
}

const KEY = Symbol.for('ueberblick.builder.context');

export const setBuilderContext = (ctx: BuilderContext): BuilderContext => setContext(KEY, ctx);

export function getBuilderContext(): BuilderContext {
  const ctx = getContext<BuilderContext | undefined>(KEY);
  if (ctx === undefined) throw new Error('getBuilderContext() outside the builder frame');
  return ctx;
}
