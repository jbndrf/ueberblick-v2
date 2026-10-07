// The participant app shell contract (WP-522). Written first; model.ts and the components implement it.
// The shell renders what a role's app profile declares (H3). It knows neither MapLibre nor forms:
// map, feature sheet and task sheet arrive as slots (snippets).
import type { Snippet } from 'svelte';
import type { MeSection, NavNodeKind, StatusKind, StorageState, ThemeName } from '@ueberblick/core/registry';
import type { TemplateFile } from '@ueberblick/core/model';

export interface ShellInput {
  /** The effective project file (template with overlay applied). */
  readonly file: TemplateFile;
  readonly roleKey: string;
  /** Language tag used to resolve `LocalizedString` labels, e.g. `de`. */
  readonly locale: string;
  /** The user's own theme setting; wins over the role's `ui.theme`. */
  readonly userTheme?: ThemeName | undefined;
  /** Task keys the role may run, from core perms. Omitted: every task of the file. The shell does no permission logic. */
  readonly allowedTasks?: readonly string[] | undefined;
}

export interface ShellItem {
  readonly key: string;
  readonly label: string;
}

export interface NavNode {
  readonly id: string;
  readonly kind: NavNodeKind;
  /** 1 for an area, 2 for a section, 0 for a sheet (in-place, not a level). */
  readonly level: 0 | 1 | 2;
  readonly label: string;
}

/** One tap goes from `from` to `to`. */
export interface NavEdge {
  readonly from: string;
  readonly to: string;
}

export interface NavGraph {
  /** Node id of the place the participant naturally starts from. */
  readonly start: string;
  readonly nodes: readonly NavNode[];
  readonly edges: readonly NavEdge[];
}

export interface ShellModel {
  readonly roleKey: string;
  readonly views: readonly ShellItem[];
  /** Key of the default view, or null when the role sees no view. */
  readonly home: string | null;
  readonly tools: readonly ShellItem[];
  /** Tasks pinned for one-tap access. */
  readonly shortcuts: readonly ShellItem[];
  /** Every task the role can start from the "+" picker (shortcuts included). */
  readonly tasks: readonly ShellItem[];
  readonly theme: ThemeName;
  readonly graph: NavGraph;
}

export interface RefusedRun {
  readonly runId: string;
  readonly reason: string;
}

export interface StatusModel {
  readonly online: boolean;
  /** ISO 8601 timestamp of the last successful sync, or null if never. */
  readonly lastSyncedAt: string | null;
  /** Number of unsent runs. */
  readonly pending: number;
  /** Age in milliseconds of the oldest unsent run; null when nothing is pending. */
  readonly oldestPendingAge: number | null;
  readonly refused: readonly RefusedRun[];
  readonly storage: StorageState;
}

export interface AppShellProps {
  model: ShellModel;
  status: StatusModel;
  /** Exports the unsent runs (queue export). Offered when data is at risk or runs are pending. */
  onexport: () => void;
  /** Feature open in the feature sheet, or null. */
  featureId?: string | null;
  onfeatureclose?: () => void;
  /** The map for the active view. The shell never imports map code. */
  map: Snippet<[{ viewKey: string | null }]>;
  featureSheet?: Snippet<[{ featureId: string }]> | undefined;
  taskSheet: Snippet<[{ taskKey: string }]>;
  /** Content of the Me area (profile, settings, offline packs). */
  me?: Snippet<[{ section: MeSection }]> | undefined;
  /** H4: a slot for an assistant panel. Empty by default; rendered only when given. */
  assistant?: Snippet | undefined;
  /** Called when a task starts from a shortcut or the picker. */
  ontask?: (taskKey: string) => void;
  /** Called when a tool of the role is picked. */
  ontool?: (toolKey: string) => void;
}

export interface StatusIndicatorProps {
  status: StatusModel;
  onexport: () => void;
}

export type { StatusKind };
