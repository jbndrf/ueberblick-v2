/**
 * The port between the Versions lens and the server (docs/08). The lens knows no URL and no
 * `fetch`: the route provides an implementation with `setVersionsApi` (Svelte context), so the same
 * lens runs in tests with a fake, and an assistant (H4) uses the same routes the implementation calls.
 */
import { getContext, setContext } from 'svelte';
import type { Problem, PublishOutcome, TemplateFile } from '@ueberblick/core';
import type { Mapping } from './plan';

/** One stored config version, without the bulky columns. */
export interface VersionRow {
  readonly version: number;
  readonly status: string;
  readonly hash: string;
  readonly template: string | null;
  readonly templateVersion: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

/** A newer published version of the template the project extends. */
export interface UpgradeOffer {
  readonly from: string;
  readonly to: string;
  readonly template: TemplateFile;
}

export interface VersionsSnapshot {
  readonly versions: readonly VersionRow[];
  /** The running version and its effective file; null before the first deploy. */
  readonly deployed: { readonly version: number; readonly file: TemplateFile } | null;
  /** Number of features per feature type key. */
  readonly featureCounts: Readonly<Record<string, number>>;
  readonly upgrade: UpgradeOffer | null;
}

/**
 * A warning of the deploy plan: the deploy goes through, but something will not work as intended.
 * This is the wire contract of the versions API (same fields as a compile `Problem`). `code` is a
 * plain string here on purpose: the codes are the server's registry, and the builder knows none.
 */
export interface DeployWarning {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly hint: string;
}

/** The dry run of the saved draft; empty when the draft cannot be planned (problems show elsewhere). */
export interface PlanOutcome {
  readonly warnings: readonly DeployWarning[];
}

export type DeployOutcome =
  | {
      readonly ok: true;
      readonly version: number;
      readonly created: boolean;
      readonly warnings: readonly DeployWarning[];
    }
  | { readonly ok: false; readonly reason: 'problems'; readonly problems: readonly Problem[] }
  | { readonly ok: false; readonly reason: 'mapping_required'; readonly paths: readonly string[] }
  /** The saved draft is not the one the plan was made from (changed elsewhere, or a save is pending). */
  | { readonly ok: false; readonly reason: 'stale' }
  | { readonly ok: false; readonly reason: 'failed' };

export interface VersionsApi {
  snapshot(): Promise<VersionsSnapshot>;
  /** The effective file of a stored version (for compare). */
  versionFile(version: number): Promise<TemplateFile>;
  /** A dry run of the saved draft: what a deploy would warn about. Never changes anything. */
  plan(): Promise<PlanOutcome>;
  /** Deploys the saved draft. `mappings` are keyed by the path of each breaking diff entry. */
  deploy(mappings: Readonly<Record<string, Mapping>>): Promise<DeployOutcome>;
  /** Makes an older stored version the running one again: a new deploy of that version's file. */
  rollback(version: number): Promise<DeployOutcome>;
  /** Deploys an upgraded overlay (extends a newer template) and restarts the draft from it. */
  upgrade(input: {
    readonly overlay: string;
    readonly mappings: Readonly<Record<string, Mapping>>;
  }): Promise<DeployOutcome>;
  /** Publishes a template version (YAML text). */
  publish(templateSrc: string): Promise<PublishOutcome>;
}

/** The context key; a test mounts the lens with `context: new Map([[VERSIONS_API_CONTEXT, api]])`. */
export const VERSIONS_API_CONTEXT = Symbol('builder.versions.api');
const KEY = VERSIONS_API_CONTEXT;

export const setVersionsApi = (api: VersionsApi): void => {
  setContext(KEY, api);
};

/** The api the host provided, or undefined (the lens then says it is not available). */
export const getVersionsApi = (): VersionsApi | undefined => getContext<VersionsApi | undefined>(KEY);
