/**
 * What the data page header shows and sends (v3 `data-viewer-header.svelte` and the pills of `workflows/[workflowId]/+page.svelte:869-1055`).
 * Plain data: the header component never imports the builder (only the routes under `(admin)` do), so the route turns the
 * draft into a `HeaderState` and applies a `HeaderCall` with the builder's ops.
 */
import { defineRegistry, type GeometryTypeKey, type KeyOf } from '@ueberblick/core';

/** The shapes v3's geometry pill offered (Punkt, Linie, Fläche); a type with another kind shows that kind until one is picked. */
export const HEADER_GEOMETRIES: readonly GeometryTypeKey[] = ['point', 'linestring', 'polygon'];

/** The states of "Private Einträge": off, on (only the creator sees an object), custom (another `visible_when`, edited in the Code view). */
export const HEADER_PRIVATE = ['off', 'on', 'custom'] as const;
export type HeaderPrivate = (typeof HEADER_PRIVATE)[number];

/** Who sees the type's objects: every role, these, nobody, or a per-property map (set in the permission matrix). */
export type HeaderAudience =
  | { readonly kind: 'all' }
  | { readonly kind: 'roles'; readonly roles: readonly string[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'property' };

export interface HeaderState {
  /** The draft's description in the page language. */
  readonly description: string;
  readonly roles: readonly { readonly key: string; readonly label: string }[];
  readonly audience: HeaderAudience;
  readonly private: HeaderPrivate;
  /** The custom `visible_when`, shown in the note of the custom state. */
  readonly privateWhen?: string;
  /** Map or form, and the geometry kind. Absent on a Tabelle: no pill. */
  readonly shape?: { readonly map: boolean; readonly kind?: GeometryTypeKey };
  /** Objects of the type now: a shape change then shows the note of the deploy overview. */
  readonly featureCount: number;
}

export type HeaderCall =
  | { readonly action: 'name'; readonly value: string }
  | { readonly action: 'description'; readonly value: string }
  | { readonly action: 'roles'; readonly roles: readonly string[] }
  | { readonly action: 'private'; readonly on: boolean }
  | { readonly action: 'map'; readonly on: boolean }
  | { readonly action: 'geometry'; readonly kind: GeometryTypeKey };

export const HEADER_ACTIONS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'roles',
  'private',
  'map',
  'geometry',
]);

/** One call's answer: the refusal in the page language, so a component never reads a status. */
export type HeaderResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Why a header edit was not made; the route turns each into the page's refusal text (R6, one registry). */
export const HEADER_ERRORS = defineRegistry([
  { key: 'name_empty', description: 'The type has no name.' },
  { key: 'unknown_type', description: 'The draft has no type with this key.' },
  {
    key: 'locked',
    description:
      'The file holds this setting where the header cannot edit it (a per-property audience, a custom condition).',
  },
  { key: 'no_geometry', description: 'A geometry kind was set on a type that has no map.' },
  { key: 'problem', description: 'The edit would leave a compile problem in the project file.' },
  { key: 'refused', description: 'The document model refused the edit.' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type HeaderErrorCode = KeyOf<typeof HEADER_ERRORS>;
