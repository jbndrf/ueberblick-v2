/**
 * What the data page's ⋮ menu sends and gets back (WP-419, S3-19; v3 `W/+page.svelte:657-800,1127-1217`): "Duplizieren",
 * "Aus Projekt importieren" and "Objektart löschen". Plain data: the components never import the builder (only the routes
 * under `(admin)` do), so the route turns each call into the builder's copy and remove ops on the draft.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

export type MenuCall =
  | { readonly action: 'duplicate' }
  /** The other projects of the admin with their deployed types (the import dialog's two selects). */
  | { readonly action: 'sources' }
  | { readonly action: 'import'; readonly project: string; readonly type: string }
  /** The delete dialog's counts. */
  | { readonly action: 'counts' }
  | { readonly action: 'remove' };

export const MENU_ACTIONS: ReadonlySet<string> = new Set([
  'duplicate',
  'sources',
  'import',
  'counts',
  'remove',
]);

export interface ImportSource {
  readonly key: string;
  readonly name: string;
  readonly types: readonly { readonly key: string; readonly label: string }[];
}

/** The delete dialog's counts (v3 `deleteCounts`): the design of the type, then its data. */
export interface DeleteCounts {
  readonly stages: number;
  readonly tasks: number;
  readonly rules: number;
  readonly views: number;
  /** Objekte of the type now; with some, the admin types this number to confirm. */
  readonly objects: number;
  /** Recorded values (observations) of those Objekte. */
  readonly values: number;
}

/** A copy that was made: the new type's key and what the copy left out, as sentences in the page language. */
export interface CopyDone {
  readonly key: string;
  readonly notes: readonly string[];
}

export type MenuAnswer =
  | { readonly kind: 'copy'; readonly copy: CopyDone }
  | { readonly kind: 'sources'; readonly sources: readonly ImportSource[] }
  | { readonly kind: 'counts'; readonly counts: DeleteCounts }
  /** The type is out of the draft; `notes` are the problems the removal leaves (a relation that pointed here). */
  | { readonly kind: 'removed'; readonly notes: readonly string[] };

export type MenuResult =
  { readonly ok: true; readonly answer: MenuAnswer } | { readonly ok: false; readonly message: string };

/** Why a menu call was refused; the route turns each into the page's refusal text (R6, one registry). */
export const MENU_ERRORS = defineRegistry([
  { key: 'unknown_type', description: 'The draft has no type with this key.' },
  { key: 'no_source', description: 'The other project or its type is not available to this admin.' },
  { key: 'problem', description: 'The copy would leave a compile problem in the project file.' },
  { key: 'refused', description: 'The document model refused the edit (for example a template lock).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type MenuErrorCode = KeyOf<typeof MENU_ERRORS>;
