/**
 * The sheet registry of the map screen. Every sheet the bar, the header and the map open is a slot here; the screen
 * knows slots, never components. A slot with no entry opens nothing and its button stays (no placeholder screens):
 * the work package that ports a sheet adds ONE line to `SHEETS` and nothing else in the shell.
 * Components load on first open, so none of them is in the participant entry chunk.
 */
import type { Component } from 'svelte';
import type { FeatureId } from '@ueberblick/core/model';
import type { ClusterTap, MapHandle } from '@ueberblick/ui';
import type { Device } from '../device';
import type { Locale } from '../messages';
import type { FilterController } from '../sheets/filter/filter-controller';
import type { LayerController } from '../sheets/layer/layer-controller';
import type { PrefsClient } from '@ueberblick/client';
import type { PrefsPort } from '../sheets/settings/prefs';
import type { ToolEntry } from '../tools/entries';
import type { ToolPerson } from '../tools/person';
import type { OfflineContext } from '../offline/context';

export const SHEET_SLOTS = [
  'layers',
  'filter',
  'create',
  'recent',
  'tools',
  'settings',
  'feature',
  'cluster',
  'chat',
] as const;
export type SheetSlot = (typeof SHEET_SLOTS)[number];

/** What the screen gives every sheet: the device (the only data source), the language and the map. */
export interface ShellContext {
  readonly device: Device;
  readonly locale: Locale;
  readonly online: boolean;
  /** The live map; none while the list stands in for it or before it is up. */
  readonly map: MapHandle | undefined;
  /** The Liste stands in for the map (then `map` is none). */
  readonly listShown: boolean;
  /** Closes the Liste so the map shows again (a task that needs the map was started from a Liste row, WP-783). */
  readonly showMap: () => void;
  /** [lon, lat] of the middle of the map, or undefined while it does not know its extent. */
  readonly center: () => readonly [number, number] | undefined;
  /** Zuletzt is open beside the sheet (the picker of Neu then sits in the left half). */
  readonly recentOpen: boolean;
  /** Closes another slot (a backdrop tap on the picker also closes Zuletzt). */
  readonly closeSlot: (slot: SheetSlot) => void;
  /** The picker is shown over an open form (the + was pressed with a form open). */
  readonly pickerShown: boolean;
  /** A form is open (true): the picker closes and the + turns back, the form stays. False: no form. */
  readonly setForm: (on: boolean) => void;
  /** A pin is being placed: the bottom bar hides meanwhile (v3 `isSelectingCoordinates`). */
  readonly setPlacing: (placing: boolean) => void;
  /** Opens the chat panel (a Werkzeuge tile, "Im Chat erwähnen"): v3's own flag, no group sheet closes it. */
  readonly openChat: () => void;
  /** Opens the feature sheet on a feature. */
  readonly openFeature: (id: FeatureId) => void;
  /** The view the map draws (the role's home view); none when the role has no map. */
  readonly viewKey: string | null;
  /** The one holder of the Karteninhalt switches; the map draws a source with it laid over. */
  readonly filter: FilterController;
  /** The one holder of the Kartenlayer choice; the map draws it. */
  readonly layers: LayerController;
  /** The tools of this person (availability and the person's switch) and the person behind them (WP-655). */
  readonly tools: {
    readonly entries: readonly ToolEntry[];
    readonly person: ToolPerson;
  };
  /** The person's own look of the app: theme, font size, language. */
  readonly prefs: PrefsPort;
  /** The person's preference record (WP-612): saved filters, the remembered tab, tool switches. The one client of the app. */
  readonly record: Pick<PrefsClient, 'current' | 'set' | 'subscribe' | 'sync'>;
  /** The offline map data, the install state and the storage numbers (the Offline tab, WP-650). */
  readonly offline: OfflineContext;
  /** Opens Einstellungen, where the person switches tools (and so tabs) on (v3 "Tabs verwalten"). */
  readonly manageTabs: () => void;
  /** The person picked another language. */
  readonly setLocale: (locale: Locale) => void;
  /** Ends the session on this device. */
  readonly signOut: () => Promise<boolean>;
  /** A detail (feature or cluster) stands open: Zuletzt then sits beside it (v3 `besideDetail`). */
  readonly detailOpen: boolean;
}

export interface SheetProps {
  readonly ctx: ShellContext;
  readonly onclose: () => void;
  /** Only the `feature` slot gets the feature. */
  readonly featureId?: FeatureId;
  /** Only the `cluster` slot gets the tapped cluster. */
  readonly cluster?: ClusterTap;
}

export type SheetLoader = () => Promise<{ readonly default: Component<SheetProps> }>;

/** The ported sheets. */
export const SHEETS: Readonly<Partial<Record<SheetSlot, SheetLoader>>> = {
  // Kartenlayer (WP-621), Karteninhalt (WP-625) and Einstellungen (WP-626).
  layers: () => import('../sheets/layer/LayerSlot.svelte'),
  filter: () => import('./FilterSlot.svelte'),
  settings: () => import('./SettingsSlot.svelte'),
  // Werkzeuge (WP-655): the active tools as tiles; the switches live in Einstellungen -> Optionen.
  tools: () => import('../sheets/tools/ToolsSlot.svelte'),
  // Neu (WP-652): the picker, the pin and the create form with the pin as its geometry. Zuletzt (WP-622).
  create: () => import('./CreateSlot.svelte'),
  recent: () => import('./RecentSlot.svelte'),
  // The first-build feature sheet, until WP-623 replaces it, with WP-624's form sheet for a task.
  feature: () => import('./FeatureSlot.svelte'),
  // Cluster detail (WP-653): a tap on a cluster; its composition and v3's drill-down.
  cluster: () => import('../cluster/ClusterSlot.svelte'),
  // The Projekt-Chat (WP-684): v3's side panel with its own flag, so Layer, Filter and Einstellungen leave it open.
  chat: () => import('../sheets/tools/ChatSlot.svelte'),
};

export const sheetLoader = (slot: SheetSlot): SheetLoader | undefined => SHEETS[slot];
