/**
 * What the Erststart, Filter & Felder and Cluster sections show and send (WP-386). Plain data: it crosses from the
 * server load to the browser.
 */
import type { MapLayerKind, ToolAvailability } from '@ueberblick/core/registry';

/** One map layer as the Erststart section lists it (v3 `StartupSection` `MapLayerLite`). */
export interface StartLayer {
  readonly key: string;
  readonly label: string;
  readonly kind: MapLayerKind;
  /** `on_at_start` of the layer. */
  readonly on: boolean;
}

/** One value of an Objektart's classifying property (or stage) in the Erststart list (WP-397). */
export interface StartTypeValue {
  readonly value: string;
  readonly label: string;
  /** In `values_at_start`, or the type lists no `values_at_start`. */
  readonly on: boolean;
}

/** One Objektart as the Erststart section lists it (v3 "Sichtbare Workflows", `StartupSection.svelte:276-337`). */
export interface StartType {
  readonly key: string;
  readonly label: string;
  /** `on_at_start` is not false. */
  readonly on: boolean;
  /** v3's `tagInfo.mode`: the values are the stages of the type's process, or the values of its `classify` property. */
  readonly mode: 'stage' | 'values';
  /** Empty when the type has no classifying property; then it has no expand chevron. */
  readonly values: readonly StartTypeValue[];
}

export interface StartupView {
  readonly layers: readonly StartLayer[];
  readonly types: readonly StartType[];
}

/** What the admin chose for one Objektart: on or off, and the values on (null: all). */
export interface TypeStart {
  readonly on: boolean;
  readonly values: readonly string[] | null;
}
export type StartTypes = Readonly<Record<string, TypeStart>>;

/** What the admin chose: `base` is a base layer key, or null for "the first base layer". */
export interface StartupValues {
  readonly base: string | null;
  readonly overlays: readonly string[];
  /** The Objektarten to set; one that is not listed stays as it is. */
  readonly types: StartTypes;
}

/**
 * How one role has a tool at the start: its availability (`active` is on at first, `offered` lets the person switch
 * it on), or `none` when the role does not have the tool. v3's "Beim Start aktiv" switch is `active`.
 */
export type ToolStartState = ToolAvailability | 'none';

export interface RoleStart {
  readonly key: string;
  readonly label: string;
  readonly state: ToolStartState;
}

/** One tool whose start state a section edits (v3 `tools.cluster`, `filter.field_filters`). */
export interface ToolStartView {
  /** Does the project declare the tool (`tools.<key>`)? */
  readonly declared: boolean;
  readonly roles: readonly RoleStart[];
}

/** The part of the page data that the three sections of WP-386 read. */
export interface StartPageData {
  readonly startup: StartupView;
  readonly cluster: ToolStartView;
  readonly fieldFilters: ToolStartView;
}
