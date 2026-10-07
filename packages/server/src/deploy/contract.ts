import type { TimerWarning } from '../timers/warnings';
import type { Store } from '../store';
import type {
  ConfigVersionStatus,
  DiffEntry,
  Ids,
  OverlayFile,
  Problem,
  TemplateFile,
  VersionDeployChoice,
} from '@ueberblick/core';

/** Resolves an overlay's `extends` (`template@major`) to the published template file. */
export interface TemplateSource {
  resolve(extendsRef: string): TemplateFile | undefined;
}

/** What a `keep` needs: the project's store (the pins are `$pin` system runs, R3) and a run id minter. */
export interface PinDeps {
  readonly store: Pick<Store, 'submitBatch'>;
  readonly ids: Pick<Ids, 'runId'>;
}

/** The deploy choice per Objektart (A-029 item 5); a type the request does not name gets `VERSION_DEPLOY_DEFAULT`. */
export type VersionChoices = Readonly<Record<string, VersionDeployChoice>>;

/** What a deploy would do with the running features of one changed type that has any (docs/08 "Deploy overview"). */
export interface VersionPlan {
  readonly type: string;
  /** Running (`aktiv`) features with no pin: `keep` would pin them, `move` lets them float onto the new version. */
  readonly running_floating: number;
  /** Features pinned to an older version (any state but deleted): they stay pinned either way. */
  readonly already_pinned: number;
  /** Completed and archived floating features: they always move with the values. */
  readonly settled_floating: number;
}

export interface DeployDeps {
  readonly clock: { now(): string };
  /** Required when a choice is `keep`: a deploy that must pin without it throws (a wiring error, never a silent move). */
  readonly pins?: PinDeps;
  /** Required to deploy an overlay; a plain template file needs none. */
  readonly templates?: TemplateSource;
}

/** A breaking-deploy mapping: move the values to another key (a `$move` run per feature), or discard them. */
export type ValueMapping = { readonly to: string } | { readonly discard: true };

/** A diff entry with the number of live features it touches (breaking entries about feature values only). */
export type PlannedChange = DiffEntry & { readonly affected?: number };

/** What a deploy reports. `created` is false when the file was already a stored version. */
export type DeployResult =
  | {
      readonly ok: true;
      readonly version: number;
      readonly created: boolean;
      readonly diff: readonly PlannedChange[];
      /** Value moves recorded for the executor (`{ to }` mappings). */
      readonly moves: number;
      /** Features pinned to the previous version by a `keep` choice, written in the deploy transaction. */
      readonly pinned: number;
      /** Not problems: the deploy went through. */
      readonly warnings: readonly TimerWarning[];
    }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** What a dry run reports; `version` is set when the file is already a stored version. */
export type PlanResult =
  | {
      readonly ok: true;
      readonly diff: readonly PlannedChange[];
      /** One entry per changed type with running features; empty for a first deploy and for a type nothing runs on. */
      readonly versions: readonly VersionPlan[];
      readonly warnings: readonly TimerWarning[];
      readonly version?: number;
    }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** One row of `config_versions` without the bulky columns. */
export interface VersionInfo {
  readonly version: number;
  readonly status: ConfigVersionStatus;
  readonly hash: string;
  readonly template: string | null;
  readonly templateVersion: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

/** A project file: a template or an overlay on one. */
export type DeployInput = TemplateFile | OverlayFile;
