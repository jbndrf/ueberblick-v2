/**
 * The builder frame's plug points (WP-330), keyed like v3's inspector `registry.ts`: a later work
 * package registers its middle view or its inspector and the frame needs no edit. Until something is
 * registered the frame shows a placeholder for that view or selection kind.
 */
import type { Component } from 'svelte';
import type { ProblemItem } from '../../problems/model';
import type { BuilderContext } from './context';

/** The centre views of the toolbar switch, in toolbar order (v3: Workflow, Modell, Code). */
export const BUILDER_VIEWS = ['workflow', 'model', 'code'] as const;
export type BuilderView = (typeof BUILDER_VIEWS)[number];
export const DEFAULT_VIEW: BuilderView = 'workflow';

/** What the right pane edits (v3 `Selection['type']`); `none` is nothing selected. */
export const SELECTION_KINDS = ['none', 'type', 'stage', 'task', 'rule', 'field', 'form'] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];

/** One selected entity: its kind, and its key (a stage option, task, rule or property key). */
export interface Selection {
  readonly kind: SelectionKind;
  readonly id?: string;
}
export const NO_SELECTION: Selection = { kind: 'none' };

/**
 * The right pane's width per mode, in px, as v3 sets them (reference/.../builder/SharedSidebar.svelte:159-188,
 * task-canvas/TaskConfigSidebar.svelte:228, inspector/InspectorHost.svelte:36-91). The canvas shrinks beside it.
 */
export const PANE_WIDTHS = {
  default: 360,
  task: 320,
  quick: 320,
  form: 640,
  field: 360,
  tags: 360,
  settings: 352,
  wide: 520,
  widePalette: 650,
  wideStage: 720,
} as const;
export type PaneWidth = keyof typeof PANE_WIDTHS;

export interface InspectorEntry {
  readonly component: Component;
  /** Which width of `PANE_WIDTHS` the pane takes (v3: each mode sets its own). */
  readonly width: PaneWidth;
}

/** Tries to take a problem to its entity; true when it did. Hooks run in registration order. */
export type FocusHook = (item: ProblemItem, ctx: BuilderContext) => boolean;

export type InspectorWrap = (inner: Component | undefined) => Component;

export interface BuilderRegistry {
  registerView(view: BuilderView, component: Component): void;
  registerInspector(
    kind: SelectionKind,
    component: Component,
    options?: { readonly width?: PaneWidth },
  ): void;
  /** A problem entry was activated: the first hook that returns true wins; the frame selects the entity otherwise. */
  registerFocus(hook: FocusHook): void;
  /**
   * Wraps the inspector of `kind` whenever it is looked up, so the wrapper exists whatever the order of the
   * registrations (v3's Formular | YAML toggle). `wrap` gets the registered component, or `undefined` when no
   * pane is registered for the kind, and returns the one to show.
   */
  registerInspectorWrap(kind: SelectionKind, wrap: InspectorWrap): void;
  view(view: BuilderView): Component | undefined;
  inspector(kind: SelectionKind): InspectorEntry | undefined;
  focus(item: ProblemItem, ctx: BuilderContext): boolean;
}

export function createBuilderRegistry(): BuilderRegistry {
  const views = new Map<BuilderView, Component>();
  const inspectors = new Map<SelectionKind, InspectorEntry>();
  const hooks: FocusHook[] = [];
  const wraps = new Map<SelectionKind, InspectorWrap>();
  // One wrapped component per registered pane, so a lookup returns the same component every time.
  const wrapped = new Map<SelectionKind, { inner: Component | undefined; component: Component }>();
  return {
    registerView: (view, component) => void views.set(view, component),
    registerInspector: (kind, component, options) =>
      void inspectors.set(kind, { component, width: options?.width ?? 'default' }),
    registerFocus: (hook) => void hooks.push(hook),
    view: (view) => views.get(view),
    registerInspectorWrap: (kind, wrap) => void wraps.set(kind, wrap),
    inspector: (kind) => {
      const entry = inspectors.get(kind);
      const wrap = wraps.get(kind);
      if (wrap === undefined) return entry;
      let w = wrapped.get(kind);
      if (w === undefined || w.inner !== entry?.component) {
        w = { inner: entry?.component, component: wrap(entry?.component) };
        wrapped.set(kind, w);
      }
      return { component: w.component, width: entry?.width ?? 'default' };
    },
    focus: (item, ctx) => hooks.some((h) => h(item, ctx)),
  };
}

/** The view a `?view=` value names; the default when absent or unknown. */
export function parseView(value: string | null | undefined): BuilderView {
  return (BUILDER_VIEWS as readonly string[]).includes(value ?? '') ? (value as BuilderView) : DEFAULT_VIEW;
}

/** `search` (a URL's query string) with `?view=` set; other parameters stay. */
export function withView(search: string, view: BuilderView): string {
  const params = new URLSearchParams(search);
  params.set('view', view);
  return `?${params.toString()}`;
}
