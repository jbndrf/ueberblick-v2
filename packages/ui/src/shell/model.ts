// Pure derivation of the shell from a role's app profile (H3). No DOM, no I/O.
import { ME_SECTIONS, THEME_NAMES, type StatusKind, type ThemeName } from '@ueberblick/core/registry';
import { toolAvailabilityFor } from '@ueberblick/core/registry/tools';
import { localize } from '@ueberblick/core/locale';
import type { LocalizedString } from '@ueberblick/core/model';
import type { NavEdge, NavGraph, NavNode, ShellInput, ShellItem, ShellModel, StatusModel } from './contract';

/** `localize()` of core for one UI locale; `fallback` (usually the key) stands for a missing label. */
export function resolveLabel(label: LocalizedString | undefined, locale: string, fallback: string): string {
  return label === undefined ? fallback : localize(label, [locale]);
}

function pick(
  keys: readonly string[],
  labels: Readonly<Record<string, { label?: LocalizedString | undefined } | undefined>>,
  locale: string,
): ShellItem[] {
  return keys
    .filter((k) => labels[k] !== undefined)
    .map((key) => ({ key, label: resolveLabel(labels[key]?.label, locale, key) }));
}

function isTheme(v: unknown): v is ThemeName {
  return typeof v === 'string' && THEME_NAMES.has(v);
}

/**
 * Derives what one role's app shows. Defaults for a role without `app`: every view of the file in
 * file order, the first view as home, every declared tool, no shortcuts, the normal theme.
 * Keys the file does not define are dropped (`compile()` reports them as problems).
 */
export function deriveShellModel(input: ShellInput): ShellModel {
  const { file, roleKey, locale } = input;
  const app = file.roles?.[roleKey]?.app;
  const viewDefs = file.views ?? {};
  const taskDefs = file.tasks ?? {};

  const views = pick(app?.views ? Object.keys(app.views) : Object.keys(viewDefs), viewDefs, locale);
  const home = views.find((v) => v.key === app?.home)?.key ?? views[0]?.key ?? null;
  const tools = (app?.tools ? Object.keys(app.tools) : Object.keys(file.tools ?? {}))
    .filter((key) => toolAvailabilityFor(file, [roleKey], key) !== undefined)
    .map((key) => ({ key, label: key }));
  const allowed = input.allowedTasks ? new Set(input.allowedTasks) : null;
  const tasks = pick(Object.keys(taskDefs), taskDefs, locale).filter((t) => !allowed || allowed.has(t.key));
  const runnable = new Set(tasks.map((t) => t.key));
  const shortcuts = tasks.filter((t) => Object.hasOwn(app?.shortcuts ?? {}, t.key) && runnable.has(t.key));
  const roleTheme = app?.ui?.['theme'];
  const theme = input.userTheme ?? (isTheme(roleTheme) ? roleTheme : 'normal');

  return {
    roleKey,
    views,
    home,
    tools,
    shortcuts,
    tasks,
    theme,
    graph: buildGraph(views, tools, shortcuts, tasks),
  };
}

/**
 * The navigation graph. Level 1: Map (home) and Me. Level 2: views and tools under Map, the Me
 * sections under Me. Sheets (task picker, task, status details) are in-place disclosure, level 0.
 * An edge is one tap; going back is implicit and not modelled.
 */
function buildGraph(
  views: readonly ShellItem[],
  tools: readonly ShellItem[],
  shortcuts: readonly ShellItem[],
  tasks: readonly ShellItem[],
): NavGraph {
  const nodes: NavNode[] = [
    { id: 'map', kind: 'area', level: 1, label: 'map' },
    { id: 'me', kind: 'area', level: 1, label: 'me' },
    { id: 'status', kind: 'sheet', level: 0, label: 'status' },
    { id: 'new', kind: 'sheet', level: 0, label: 'new' },
  ];
  const edges: NavEdge[] = [
    { from: 'map', to: 'me' },
    { from: 'me', to: 'map' },
    { from: 'map', to: 'status' },
    { from: 'me', to: 'status' },
    { from: 'map', to: 'new' },
  ];
  for (const v of views) {
    nodes.push({ id: `view:${v.key}`, kind: 'section', level: 2, label: v.label });
    edges.push({ from: 'map', to: `view:${v.key}` });
  }
  for (const t of tools) {
    nodes.push({ id: `tool:${t.key}`, kind: 'section', level: 2, label: t.label });
    edges.push({ from: 'map', to: `tool:${t.key}` });
  }
  for (const t of tasks) {
    nodes.push({ id: `task:${t.key}`, kind: 'sheet', level: 0, label: t.label });
    edges.push({ from: 'new', to: `task:${t.key}` });
  }
  for (const s of shortcuts) edges.push({ from: 'map', to: `task:${s.key}` });
  for (const s of ME_SECTIONS.keys) {
    nodes.push({ id: `me:${s}`, kind: 'section', level: 2, label: s });
    edges.push({ from: 'me', to: `me:${s}` });
  }
  return { start: 'map', nodes, edges };
}

/** Shortest number of taps from `from` to every reachable node. */
export function stepsFrom(graph: NavGraph, from: string): Map<string, number> {
  const steps = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as string;
    for (const e of graph.edges) {
      if (e.from === at && !steps.has(e.to)) {
        steps.set(e.to, (steps.get(at) ?? 0) + 1);
        queue.push(e.to);
      }
    }
  }
  return steps;
}

/**
 * Navigation depth: an area is level 1, what is reached from an area without a sheet is deeper.
 * Areas are peers (bottom navigation), so area-to-area edges do not add depth. Sheets do not count.
 */
export function navDepth(graph: NavGraph): number {
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const edges = graph.edges.filter(
    (e) =>
      kind.get(e.from) !== 'sheet' &&
      kind.get(e.to) !== 'sheet' &&
      !(kind.get(e.from) === 'area' && kind.get(e.to) === 'area'),
  );
  const depth = new Map<string, number>(graph.nodes.filter((n) => n.kind === 'area').map((n) => [n.id, 1]));
  const queue = [...depth.keys()];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as string;
    for (const e of edges) {
      if (e.from === at && !depth.has(e.to)) {
        depth.set(e.to, (depth.get(at) ?? 0) + 1);
        queue.push(e.to);
      }
    }
  }
  return Math.max(0, ...depth.values());
}

/** The most urgent kind to show: refused, then offline, then pending, then online. */
export function deriveStatusKind(s: StatusModel): StatusKind {
  if (s.refused.length > 0) return 'refused';
  if (!s.online) return 'offline';
  if (s.pending > 0) return 'pending';
  return 'online';
}
