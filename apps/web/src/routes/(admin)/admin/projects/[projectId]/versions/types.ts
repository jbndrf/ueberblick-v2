import type { DeployWarning, Plan, UpgradeOffer } from '@ueberblick/builder';
import type { TemplateFile } from '@ueberblick/core';
import type { ValueMapping } from '@ueberblick/server';
import type { PinMoveView } from '../../../../../../lib/admin/deploy/pin-move-view';
import type { Locale } from '../../../shell/locale';

/** One line of the list (v3 `releases/+page.server.ts:15-23`; no notes exist in v4, E9). */
export interface VersionLine {
  readonly version: number;
  readonly status: string;
  /** Number of Objektarten (feature types) the version declares. */
  readonly objektarten: number;
  readonly createdAt: string;
  readonly template: string | null;
  readonly templateVersion: string | null;
}

/** What the upgrade offer needs on the client: the offer, the draft's sources and the deployed file. */
export interface UpgradeData {
  readonly offer: UpgradeOffer;
  readonly templateSrc: string;
  readonly overlaySrc: string;
  readonly deployed: TemplateFile | undefined;
  readonly featureCounts: Readonly<Record<string, number>>;
}

export interface VersionsPageData {
  readonly versions: readonly VersionLine[];
  readonly upgrade: UpgradeData | null;
}

/** What a page action answers; the route turns the SvelteKit action result into this. */
export type ActionAnswer =
  | {
      readonly ok: true;
      readonly version?: number;
      readonly warnings?: readonly DeployWarning[];
      readonly plan?: Plan;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly paths?: readonly string[];
    };

/** The dry run of "Auf aktuelle Version verschieben": the dialog's view, or the engine's reason in the admin's language. */
export type MovePlanAnswer =
  { readonly ok: true; readonly view: PinMoveView } | { readonly ok: false; readonly reason: string };

/** The move itself: how many Objekte now run on the deployed version `to`, or the reason nothing changed. */
export type MoveAnswer =
  | { readonly ok: true; readonly to: number; readonly unpinned: number }
  | { readonly ok: false; readonly reason: string };

/** The page's calls to the server; the route implements them over the form actions. */
export interface VersionsCalls {
  rollback(version: number): Promise<ActionAnswer>;
  compare(from: number, to: number): Promise<ActionAnswer>;
  discard(): Promise<ActionAnswer>;
  upgrade(overlay: string, mappings: Readonly<Record<string, unknown>>): Promise<ActionAnswer>;
  /** WP-368 (owner P3): the dry run for the Objekte pinned to `version`. */
  movePlan(version: number, locale: Locale): Promise<MovePlanAnswer>;
  /** WP-368: moves them to the deployed version with the admin's answers per breaking difference. */
  movePins(
    version: number,
    mappings: Readonly<Record<string, ValueMapping>>,
    locale: Locale,
  ): Promise<MoveAnswer>;
}
