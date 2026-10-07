// The public tool API (decision 0017, WP-553), extracted from photo, draw, measure and search. A tool is
// built with `defineTool` (define.ts) and mounted by the host (host.ts). Tool options come from the project
// file's `tools.<key>` settings (ToolSettingsSchema); the app fills `optionsFor` from there.
import type { Geometry, Position } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Instant, JsonValue, Key, Seq } from '@ueberblick/core/model';
import {
  type ProducibleType,
  type PropertyTypeKey,
  type ToolAvailability,
  type ToolContribution,
  type ToolHostErrorCode,
} from '@ueberblick/core/registry';
import type { ToolOptions } from '@ueberblick/core/registry/tools';

export {
  TOOL_CONTRIBUTIONS,
  TOOL_AVAILABILITY,
  TOOL_HOST_ERROR_CODES,
  PRODUCIBLE_SHAPES,
} from '@ueberblick/core/registry';
export type {
  ToolContribution,
  ToolAvailability,
  ToolHostErrorCode,
  ProducibleType,
} from '@ueberblick/core/registry';
export type { ToolOption, ToolOptions } from '@ueberblick/core/registry/tools';

/** Every contribution point except `form-field`: where a tool shows a panel outside a task. */
export type PanelPoint = Exclude<ToolContribution, 'form-field'>;

export class ToolHostError extends Error {
  constructor(
    readonly code: ToolHostErrorCode,
    readonly toolKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolHostError';
  }
}

/** Stores the bytes of a `file` value, keyed by their sha256 (the `blobs` table on the device). */
export interface BlobPort {
  put(sha256: string, bytes: Blob, mime: string): Promise<void>;
}

/** Hashes bytes; lowercase hex sha256. */
export interface HashPort {
  sha256(bytes: ArrayBuffer): Promise<string>;
}

/** A position fix in WGS84; `alt` and `accuracy` (radius of the 68 % confidence circle) in metres when the device knows them. */
export interface PositionFix {
  readonly lon: number;
  readonly lat: number;
  readonly alt?: number;
  readonly accuracy?: number;
}

/** Where the device is. The only way a tool learns it (no `navigator.geolocation` in a tool). */
export interface PositionPort {
  /** Rejects when the device cannot tell (denied, no signal, timeout). */
  current(): Promise<PositionFix>;
}

/** Everything a tool may reach besides its own context. Every port is required: a tool can rely on it. */
export interface ToolPorts {
  readonly blobs: BlobPort;
  readonly hash: HashPort;
  readonly position: PositionPort;
}

/** The one field a field tool may see. No other fields, no runs. */
export interface ToolField {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly type: PropertyTypeKey;
  readonly accept?: readonly string[];
  /** file: the most files the value may hold (the property's `max_files`; absent means the default 10). */
  readonly maxFiles?: number;
}

/** What the host gives every tool: its effective settings and preferences (tool-platform.md §3.4). */
export interface ToolValuesContext {
  /** Effective settings: schema defaults, then project settings, then role settings. */
  readonly settings: Readonly<Record<string, JsonValue>>;
  /** Effective preferences: schema defaults, project, role, then the person's own values. Current at each read. */
  readonly preferences: Readonly<Record<string, JsonValue>>;
  /** Saves one of the person's own preferences (checked against the tool's `preferences` schema). */
  setPreference(key: string, value: JsonValue): void;
}

export interface FieldToolContext extends ToolValuesContext {
  readonly field: ToolField;
  readonly locale: string;
  /** The current value of this field only. */
  readonly value: JsonValue | undefined;
  /** Per-tool, per-field options from the project (opaque JSON, the tool validates them). */
  readonly options: Readonly<Record<string, JsonValue>>;
  readonly ports: ToolPorts;
  /** A value for its own field; the host checks its shape against `produces`. */
  produce(value: JsonValue): void;
  /** Explicitly empties its own field (a stored value is removed). Distinct from `produce`: no `null` value. */
  clear(): void;
}

/** What a toolbar tool may do on the map: centre it, and show one temporary overlay geometry. Never writes. */
export interface ToolMapPort {
  /** Calls `handler` with the WGS84 [lon, lat] of each tap on the map. Returns the unsubscribe function. */
  onTap(handler: (position: Position) => void): () => void;
  /** Moves the view to a WGS84 [lon, lat] (Z ignored); the zoom stays unless one is given. */
  centerOn(position: Position, zoom?: number): void;
  /** Shows one temporary geometry (a measured line or area) above the map; replaces the previous one. */
  showOverlay(geometry: Geometry): void;
  clearOverlay(): void;
}

/** One searchable property of one feature type: a `tools.search.sources` entry `type.property`. */
export interface ToolTextSource {
  readonly type: Key;
  readonly property: string;
}

/** The device store's `searchText` (index lookup, pure read; a later API may reuse it, H4). */
export interface TextSearchPort {
  (sources: readonly ToolTextSource[], query: string, limit: number): readonly FeatureId[];
}

/** Who and what a record mentions (the server's index; unknown ids are already dropped). */
export interface ToolDataMentions {
  readonly persons: readonly string[];
  readonly features: readonly string[];
}

/** One entry of a tool's data stream (B-020): a record the server holds, or a send still in the outbox. */
export interface ToolDataItem {
  readonly id: string;
  /** Server order; `null` while the item is only on this device (pending or refused). */
  readonly seq: Seq | null;
  readonly author: string;
  /** Server time for a record; the device time of a pending item. */
  readonly at: Instant;
  readonly body: string;
  readonly mentions: ToolDataMentions;
  /** Set when the server refused the send: why. The item stays until retried or discarded. */
  readonly refusal?: { readonly code: string; readonly reason: string };
}

/** The person's read position in the stream, by server seq (never a clock). */
export interface ToolDataCursor {
  readonly lastReadSeq: Seq;
  readonly lastMentionSeq: Seq;
}

/**
 * `ctx.data` (tool API 3): the tool's own data stream on this device. The tool never calls the network: the
 * device mirrors the stream, sends through an outbox that survives a reload, and the doorbell announces
 * news. Only a tool that declares `data: true` gets it.
 */
export interface ToolDataPort {
  /** Records in server order, then pending and refused sends. A new array at each change, the same one between. */
  items(): readonly ToolDataItem[];
  /** Calls `listener` after items or the cursor changed. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Stores the item in the outbox and returns it at once (`seq` null); it is sent in the background. */
  append(body: string): Promise<ToolDataItem>;
  readonly cursor: ToolDataCursor;
  /** Tells the server how far the person has read. Batched: call it as often as needed. */
  markRead(seq: Seq): void;
  /** Sends a refused item again, as a new item. */
  retry(id: string): Promise<ToolDataItem>;
  /** Removes a refused or pending item from the outbox. */
  discard(id: string): Promise<void>;
}

/** What the app supplies: the stream port of a tool key, or `undefined` when the person has none (not offered). */
export interface ToolDataSource {
  forTool(toolKey: string): ToolDataPort | undefined;
}

export interface PanelToolContext extends ToolValuesContext {
  /** Where the host mounted the tool. */
  readonly point: PanelPoint;
  readonly locale: string;
  readonly ports: ToolPorts;
  /** Starts a task (opens the task sheet); never writes a value itself. */
  startTask(taskKey: string): void;
  readonly map: ToolMapPort;
  /** Opens the feature sheet of a feature (one tap from a search result). */
  openFeature(id: FeatureId): void;
  readonly searchText: TextSearchPort;
  /** Reads one feature (current state, queued runs applied) to label a result or find where to centre. */
  feature(id: FeatureId): FeatureState | undefined;
  /** The label of a feature type in the context's locale, the key when the type has none (the host reads it from the config). */
  typeLabel(type: Key): string;
  /** The tool's data stream (`ctx.data`); present only for a tool that declares `data: true` and has a stream. */
  readonly data?: ToolDataPort;
}

export interface ToolHandle {
  destroy(): void;
}

/** The tool API version `defineTool` stamps on a tool and the host accepts. A breaking change of any
 * context or port bumps it (H6: third-party tools are built against a version). 2: contribution points,
 * settings and preferences (WP-613). 3: `ctx.data` and the `data` declaration (WP-683, B-020). */
export const TOOL_API_VERSION = 3;

interface ToolSpecBase {
  /** The tool key of the project file (`tool: <key>`, `tools.<key>`). */
  readonly key: string;
  /** What the admin sets per project and role; checked when the project is compiled. */
  readonly settings?: ToolOptions;
  /** What the person may change, each with a default. */
  readonly preferences?: ToolOptions;
}

/** What an author gives `defineTool` for a tool inside a task: it produces a value of one property type. */
export interface FieldToolSpec extends ToolSpecBase {
  readonly contributes: readonly ['form-field'];
  readonly produces: ProducibleType;
  mount(el: HTMLElement, ctx: FieldToolContext): ToolHandle;
}

/** What an author gives `defineTool` for a tool outside tasks: it reads, or starts a task. It never produces. */
export interface PanelToolSpec extends ToolSpecBase {
  readonly contributes: readonly PanelPoint[];
  /** The tool keeps a data stream (`ctx.data`); the host gives the port only to a tool that says so. */
  readonly data?: true;
  mount(el: HTMLElement, ctx: PanelToolContext): ToolHandle;
}

export type ToolSpec = FieldToolSpec | PanelToolSpec;

/** A tool as `defineTool` returns it: checked, frozen and stamped with the API version. */
export type FieldTool = Readonly<FieldToolSpec> & { readonly api: typeof TOOL_API_VERSION };
export type PanelTool = Readonly<PanelToolSpec> & { readonly api: typeof TOOL_API_VERSION };
export type Tool = FieldTool | PanelTool;

export const isFieldTool = (tool: Tool): tool is FieldTool =>
  (tool.contributes as readonly string[]).includes('form-field');

/** Tools load on demand; the ui entry never imports a tool package. */
export type ToolLoader = () => Promise<Tool>;

/** What the app knows about the tools of the signed-in person, backed by the project file and the preference
 * store (WP-612). Without it the host applies no availability gate and uses schema defaults only. */
export interface ToolPersonPort {
  /** How the person's role has the tool; undefined when the role does not list it (the tool does not exist). */
  availability(toolKey: string): ToolAvailability | undefined;
  /** The project's `tools.<key>` and the role's `settings` of the tool. */
  settings(toolKey: string): {
    readonly project?: Readonly<Record<string, JsonValue>>;
    readonly role?: Readonly<Record<string, JsonValue>>;
  };
  /** The person's own switch (`prefs.tools[key]`); undefined when never set. */
  switchOf(toolKey: string): boolean | undefined;
  /** The person's own preferences of the tool (`prefs.tool_prefs[key]`). */
  preferencesOf(toolKey: string): Readonly<Record<string, JsonValue>> | undefined;
  setPreference(toolKey: string, key: string, value: JsonValue): void;
}

export interface ToolHostOptions {
  readonly loaders: Readonly<Record<string, ToolLoader>>;
  readonly ports: ToolPorts;
  readonly locale?: string;
  readonly person?: ToolPersonPort;
  /** The data streams of the person's tools (`ctx.data`). Without it no tool gets a port. */
  readonly data?: ToolDataSource;
  /** Per-field options of a form-field tool that the project cannot know (the field's geometry type, the map centre). */
  readonly optionsFor?: (toolKey: string, fieldKey: string) => Readonly<Record<string, JsonValue>>;
}

export interface MountFieldInput {
  readonly toolKey: string;
  readonly field: ToolField;
  readonly value: JsonValue | undefined;
  readonly onproduce: (value: JsonValue) => void;
  /** The tool cleared its field (the form empties it). */
  readonly onclear: () => void;
}

/** The app supplies these per mount; the host adds `locale` and `ports`. */
export type MountPanelInput = { readonly toolKey: string } & Omit<
  PanelToolContext,
  'locale' | 'ports' | 'settings' | 'preferences' | 'setPreference' | 'data'
>;

export interface ToolHost {
  mountField(el: HTMLElement, input: MountFieldInput): Promise<ToolHandle>;
  mountPanel(el: HTMLElement, input: MountPanelInput): Promise<ToolHandle>;
}
