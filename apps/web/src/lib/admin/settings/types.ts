/** What the Projekteinstellungen page shows and sends. Plain data: it crosses from the server load to the browser. */
import type { LayerOp, LayersView } from './layers-model';
import type { MapConfig } from '@ueberblick/core/model';
import type { InfoPageRow, InfoPageValues } from './info-pages';
import type { MapViewError, MapViewValues } from './map-view';
import type { PackLayerOption, PackRoleOption, PackRow, PackValues } from './packs';
import type { PresetRef, PresetSave } from './presets-types';
import type { StartPageData, StartupValues } from './start-types';

/** What the Branding section shows. */
export interface BrandingView {
  /** The Anzeigename in the page language; empty when the file has none (the project name applies). */
  readonly name: string;
  /** The sha of the icon blob, or null. */
  readonly icon: string | null;
}

/** What the Standardansicht section shows, and whether the file has set it. */
export interface MapView extends MapViewValues {
  /** False while the file has no `map.start`: the values are v3's defaults and nothing is saved yet. */
  readonly saved: boolean;
}

/** One role in the Chat section's picker (v3's `getOptionId` / `getOptionLabel` / `getOptionDescription`). */
export interface ChatRoleOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
}

/** What the Chat section shows (v3 `chat_enabled`, `chat_visible_to_roles`): whether the project has the chat tool, and who has it. */
export interface ChatView {
  /** The project declares the chat tool (`tools.chat`). */
  readonly enabled: boolean;
  /** Every role has the chat ("Leer = alle"); `roles` is then empty. */
  readonly all: boolean;
  /** The roles that have the chat when not all do. */
  readonly roles: readonly string[];
  readonly options: readonly ChatRoleOption[];
}

/** One input the template offers (`TemplateFile.inputs`): its declaration and the project's current value. */
export interface TemplateInputView {
  readonly key: string;
  /** The property type from the registry. */
  readonly type: string;
  /** False for a type this section cannot edit (shown read-only). */
  readonly editable: boolean;
  readonly label: string;
  readonly description?: string;
  /** The effective value: the overlay's, else the template's default; null when neither exists. */
  readonly value: unknown;
  /** select: the options in the page language. */
  readonly options: readonly { readonly key: string; readonly label: string }[];
}

/** What the Vorlage section shows: the template, its version and its inputs (none: the template offers no inputs). */
export interface TemplateView {
  readonly key: string;
  readonly label: string;
  readonly version: string;
  readonly inputs: readonly TemplateInputView[];
}

/** One Objektart in the Status & Freigabe list (v3 listed the workflows with their running cases and blockers). */
export interface LifecycleType {
  readonly key: string;
  readonly label: string;
  /** How many served objects of the type exist (v3: "laufende Fälle"). */
  readonly objects: number;
  /** What keeps the draft from deploying, in the page language. */
  readonly blockers: readonly string[];
}

/** What the Status & Freigabe section shows (v3 `data.lifecycle`, `data.goLivePreview`). */
export interface LifecycleView {
  /** The deployed version, or null while nothing is live. */
  readonly version: number | null;
  /** Nothing is deployed yet: v3's "Entwurf". */
  readonly neverPublished: boolean;
  /** The draft differs from the deployed version (or nothing is deployed yet and there is a draft). */
  readonly dirty: boolean;
  readonly types: readonly LifecycleType[];
  /** Blockers that belong to no Objektart (the roles, the map ...). */
  readonly other: readonly string[];
  /** How many blockers there are in all. */
  readonly blockerCount: number;
}

/** What the sections that edit the draft show: everything the project file holds for them. */
export interface SettingsDocData extends StartPageData {
  /** The project's name: the placeholder of the Anzeigename field (v3 `placeholder={data.project.name}`). */
  readonly projectName: string;
  readonly branding: BrandingView;
  readonly map: MapView;
  readonly chat: ChatView;
  readonly template: TemplateView;
  readonly layers: LayersView;
  readonly infoPages: readonly InfoPageRow[];
  readonly packs: readonly PackRow[];
  /** The map layers a pack may hold (empty: v3's "Keine Layer konfiguriert"). */
  readonly packLayers: readonly PackLayerOption[];
  readonly roles: readonly PackRoleOption[];
  /** The file's map section: the region map draws the pack's layers from it. Null when the file has none. */
  readonly mapConfig: MapConfig | null;
}

export interface SettingsPageData extends SettingsDocData {
  readonly lifecycle: LifecycleView;
}

/** One save of the page. A key left out of `branding` stays as it is; `name: ''` and `icon: null` clear. */
export type SettingsCall =
  | { readonly action: 'branding'; readonly name?: string; readonly icon?: string | null }
  | ({ readonly action: 'map' } & MapViewValues)
  | { readonly action: 'chat'; readonly enabled: boolean; readonly roles: readonly string[] }
  | { readonly action: 'template_inputs'; readonly values: Readonly<Record<string, unknown>> }
  | ({ readonly action: 'layers' } & LayerOp)
  | ({ readonly action: 'info_page' } & InfoPageValues)
  | { readonly action: 'info_page_delete'; readonly key: string }
  | ({ readonly action: 'pack' } & PackValues)
  | { readonly action: 'pack_roles'; readonly key: string; readonly roles: readonly string[] }
  | { readonly action: 'pack_delete'; readonly key: string }
  /** Erststart: the layers on at start (WP-386). */
  | ({ readonly action: 'startup' } & StartupValues)
  /** Cluster / Filter & Felder "Beim Start aktiv" for `roles` (null: every role) (WP-386). */
  | {
      readonly action: 'cluster' | 'field_filters';
      readonly roles: readonly string[] | null;
      readonly on: boolean;
    }
  | { readonly action: 'preset_save'; readonly preset: PresetSave }
  | { readonly action: 'preset_delete'; readonly ref: PresetRef };

/** The answer of a call: done (with what the page shows now), or the refusal in the page language. */
export type CallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly fields?: readonly MapViewError[] };

/** What the upload endpoint answers (`POST /api/admin/p/<project>/assets`). */
export interface UploadedAsset {
  readonly sha256: string;
  readonly bytes: number;
  readonly mime: string;
}

/** One QGIS / GIS token as the "API-Tokens" section lists it (never the secret; WP-388). */
export interface ApiTokenRow {
  readonly id: string;
  /** The owner: a participant, or null for an admin token (WP-1070). */
  readonly participantId: string | null;
  readonly adminEmail: string | null;
  readonly label: string;
  readonly lastFour: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
}

/** A new token: the secret appears here, once. */
export interface CreatedToken {
  readonly token: string;
  readonly info: ApiTokenRow;
}

/** A participant the token can be issued for. */
export interface ParticipantOption {
  readonly id: string;
  readonly name: string | null;
}

/** What the project-delete dialog lists (`GET /api/admin/projects/<project>`); a zero is not shown. */
export interface DeleteCounts {
  readonly types: number;
  readonly roles: number;
  readonly layers: number;
  readonly packs: number;
  readonly infoPages: number;
  readonly participants: number;
  readonly features: number;
}
