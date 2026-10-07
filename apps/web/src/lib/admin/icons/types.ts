/**
 * What the Icons dialog shows and sends. Plain data: it crosses from the server to the browser. These shapes mirror
 * the builder package's icons ops (`iconsState`, `IconLook`, ...): code outside the admin routes never imports the
 * builder package (boundary `participant-no-builder`), so the route hands the builder's functions in as an `IconsKit`, and
 * TypeScript checks that they fit these shapes.
 */

/** An icon the designer writes: a registry key or an inline SVG, with an optional size. */
export type IconShape =
  | { readonly key: string; readonly size?: number | undefined }
  | { readonly svg: string; readonly size?: number | undefined }
  /** A bundle file the designer never writes (ingestion embeds it as `{ svg }`); read only. */
  | { readonly $ref: string; readonly size?: number | undefined };

/** A colour and an icon: one entry of `classify.values`, or the `marker` of the type. */
export interface IconLook {
  readonly color?: string | undefined;
  readonly icon?: IconShape | undefined;
}

export interface IconChoice {
  readonly key: string;
  readonly label: string;
  /** Set on an option of the stage property: whether it starts or ends the process. */
  readonly stage?: { readonly start: boolean; readonly end: boolean };
}

/** What the dialog shows of one type. */
export interface IconsState {
  readonly type: string;
  /** The picked classifying property and its entries; null is "keine". */
  readonly classify: {
    readonly property: string;
    readonly values: Readonly<Record<string, IconLook>>;
  } | null;
  readonly marker: IconLook | null;
  /** The properties the picker offers: every `select` property of the type, with its option keys. */
  readonly selects: readonly (IconChoice & { readonly optionKeys: readonly string[] })[];
  /** The options of the classifying property in file order; empty with no property. */
  readonly options: readonly IconChoice[];
  /** The key of the stage property (`process.property`), if the type has a process. */
  readonly stage: string | null;
}

/** One edit of the dialog (v3 `updateIconConfig` and `updateFilterValueIcons`, plus the property picker). */
export type IconCall =
  | { readonly action: 'property'; readonly property: string | null }
  | { readonly action: 'set_value'; readonly value: string; readonly look: IconLook }
  | { readonly action: 'clear_value'; readonly value: string }
  | { readonly action: 'set_marker'; readonly look: IconLook }
  | { readonly action: 'clear_marker' };

/** The result of a call: the dialog's state after it, or the refusal already in the page language. */
export type IconResult =
  { readonly ok: true; readonly state: IconsState } | { readonly ok: false; readonly message: string };

export interface IconTemplate {
  readonly id: string;
  readonly path: string;
  readonly registryKey?: string | undefined;
}

export interface IconBadge {
  readonly id: string;
  readonly color: string;
  readonly path: string;
}

export interface ComposeInput {
  readonly template: IconTemplate;
  readonly color: string;
  readonly size?: number | undefined;
  readonly badge?: IconBadge | undefined;
}

/** The builder's icon functions, handed in by the admin route (the builder package, `v3/icons`). */
export interface IconsKit {
  readonly templates: readonly IconTemplate[];
  readonly badges: readonly IconBadge[];
  templateIcon(input: ComposeInput): IconShape;
  /** The first reason a look is not acceptable (core's SVG gate, the size, the colour), or null. */
  checkLook(look: IconLook): { readonly code: string; readonly detail?: string | undefined } | null;
  /** The entries of the state's classify that switching to `property` (null: "keine") would drop. */
  droppedFor(state: IconsState, property: string | null): readonly string[];
}
