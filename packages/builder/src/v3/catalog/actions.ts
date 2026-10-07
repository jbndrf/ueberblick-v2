/**
 * The catalog's actions as one list (C-004 step 1): tasks people press, plus the automatic ones (rules with their
 * own task, tasks only the system runs). A pure view over the inventory; the filter picks who carries them out.
 */
import type { AutoTimingKind } from '@ueberblick/core';
import type { Inventory, TaskBadge, TaskRow } from './inventory';

/** The filter chips of the list; `all` is the default. */
export const ACTION_FILTERS = { all: 'all', people: 'people', automatic: 'automatic' } as const;
export type ActionFilter = (typeof ACTION_FILTERS)[keyof typeof ACTION_FILTERS];

export interface ActionRow {
  /** Which selection opens it: a task pane or a rule pane. */
  readonly kind: 'task' | 'rule';
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly automatic: boolean;
  readonly badge?: TaskBadge;
  /** For a rule: its trigger kind. */
  readonly trigger?: AutoTimingKind;
  /** For a task: the row (the badge text needs its stages). */
  readonly task?: TaskRow;
}

const fromTask = (row: TaskRow): ActionRow => ({
  kind: 'task',
  key: row.key,
  path: row.path,
  label: row.label,
  automatic: row.automatic,
  ...(row.badge === undefined ? {} : { badge: row.badge }),
  task: row,
});

const keep = (row: ActionRow, filter: ActionFilter): boolean =>
  filter === ACTION_FILTERS.all || row.automatic === (filter === ACTION_FILTERS.automatic);

/** The rows of the list under `filter`: tasks first, then automatic actions; `hidden` gives the template elements the project hides. */
export function actionRows(inventory: Inventory, filter: ActionFilter, hidden = false): readonly ActionRow[] {
  const tasks = (hidden ? inventory.hiddenTasks : inventory.tasks).map(fromTask);
  const rules = (hidden ? inventory.hiddenRules : inventory.rules).map((r): ActionRow => ({
    kind: 'rule',
    key: r.key,
    path: r.path,
    label: r.label,
    automatic: true,
    trigger: r.trigger,
  }));
  return [...tasks, ...rules].filter((r) => keep(r, filter));
}
