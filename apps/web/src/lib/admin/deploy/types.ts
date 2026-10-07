/**
 * The wire shapes of the deploy overview (WP-360): the answer of the dry run `GET /builder-api/<project>/plan` and the
 * body of the deploy `POST /builder-api/<project>/deploy`. Declared here (no server import at run time) so the browser
 * code and the server code that fills them agree; the overview never computes a count itself (R1).
 */
import type { DiffEntry, VersionDeployChoice } from '@ueberblick/core';
import type { OrderTarget } from './entity-path';
import type { TimerWarning, ValueMapping, VersionPlan } from '@ueberblick/server';

/** One entry of the diff in plain words: what happened to which element. `name` is its label (or key). */
export interface PlanEntry {
  readonly path: string;
  readonly change: DiffEntry['change'];
  readonly breaking: boolean;
  /** Objekte holding a value this entry removes (breaking entries about feature values only). */
  readonly affected?: number;
  readonly name: string;
  /** The entry is a stage (an option of the type's process property): v3 says "Phase". */
  readonly stage?: true;
  /** What of the element changed: its changed keys, a task's changed form entries as `form.<key>` (WP-506). */
  readonly parts?: readonly string[];
  /** An `order_changed` line: which map and whose (`name` is the owner's name, or the map's key without an owner). */
  readonly order?: OrderTarget;
}

/** The changes of one Objektart, or (type `null`) the changes that belong to no Objektart (roles, views, ...). */
export interface PlanGroup {
  readonly type: string | null;
  readonly label: string;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
  /** Live Objekte of the Objektart now. */
  readonly objects: number;
  readonly entries: readonly PlanEntry[];
}

/** A breaking entry that needs a mapping before a deploy: where its values go, or "Werte verwerfen". */
export interface MappingView {
  readonly path: string;
  readonly name: string;
  readonly type: string | null;
  readonly stage: boolean;
  readonly affected: number;
  /** What the values can move to (empty: only discarding is possible). */
  readonly choices: readonly { readonly key: string; readonly label: string }[];
}

/** A blocker: one `Doc.problems()` entry with the Objektart the builder shows it under. */
export interface Blocker {
  readonly id: string;
  readonly path: string;
  readonly message: string;
  readonly type: string | null;
}

/** The dry run of the saved draft. `revision` is the one the deploy must name (409 `stale` otherwise). */
export interface DeployPlan {
  readonly revision: number | null;
  /** Nothing is deployed yet: the overview says "neu" per Objektart and lists no lines. */
  readonly first: boolean;
  readonly warnings: readonly TimerWarning[];
  readonly groups: readonly PlanGroup[];
  readonly versions: readonly VersionPlan[];
  readonly mappings: readonly MappingView[];
  readonly blockers: readonly Blocker[];
}

/** The deploy request of the overview: the mappings per breaking path and the choice per changed Objektart. */
export interface DeployRequest {
  readonly revision: number;
  readonly mappings: Readonly<Record<string, ValueMapping>>;
  readonly versions: Readonly<Record<string, VersionDeployChoice>>;
}

export type DeployAnswer =
  | { readonly kind: 'deployed'; readonly version: number }
  | { readonly kind: 'mapping_required' }
  | { readonly kind: 'problems'; readonly count: number }
  /** The draft was saved again since the plan was made. */
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed' };
