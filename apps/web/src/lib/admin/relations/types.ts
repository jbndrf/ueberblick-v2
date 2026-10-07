/** What the Beziehungen page shows and sends. Plain data: it crosses from the server load to the browser. */
import type { RelationCardinality } from '@ueberblick/core';

/** One row of the list (v3 `WorkflowRelation`, with the type names already looked up). */
export interface RelationRowData {
  readonly id: string;
  readonly label: string;
  readonly parent: string;
  readonly parentLabel: string;
  readonly child: string;
  readonly childLabel: string;
  readonly refKey: string;
  readonly cardinality: RelationCardinality;
  /** Anbindung, and what a parent's delete does to the children (read from the tasks and steps that carry them). */
  /** A key of the builder's `RELATION_ATTACHMENTS` (the browser does not import the builder). */
  readonly attachment: string;
  /** A key of the builder's `ON_DELETE_BEHAVIORS`. */
  readonly onDelete: string;
  /** A key of the builder's `RELATION_GEOMETRIES`: 'Geometrie beim Erstellen', read from the file. */
  readonly geometry: string;
  /** The child type has its own primary geometry (then only zeichnen is valid). */
  readonly childHasGeometry: boolean;
  /** The engine reports `inherit_with_own_geometry` on this relation (the child gained a geometry later). */
  readonly geometryProblem: boolean;
  /** Where the relation comes from: the template, or the project's own draft. */
  readonly source: 'template' | 'overlay';
}

export interface TypeChoice {
  readonly key: string;
  readonly label: string;
  /** The type has a primary geometry. */
  readonly hasGeometry: boolean;
}

export interface RelationsPageData {
  readonly relations: readonly RelationRowData[];
  readonly types: readonly TypeChoice[];
  /** The choices of the two option selects, from the builder's registries (the browser never imports the builder). */
  readonly choices: {
    readonly attachments: readonly string[];
    readonly onDelete: readonly string[];
    readonly geometries: readonly string[];
  };
}

/** A problem the Doc reports for a deletion, in the page language. */
export interface RelationUse {
  readonly path: string;
  readonly message: string;
}

/** What the delete dialog shows: what still names the relation, and where the reference sits for the count. */
export interface DeletePreview {
  readonly uses: readonly RelationUse[];
  readonly child: string;
  readonly refKey: string;
}

/** The result of a call to the page's routes: done, or the refusal already in the page language. */
export type CallResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export interface RelationValues {
  readonly name: string;
  readonly parent: string;
  readonly child: string;
  readonly cardinality: RelationCardinality;
  /** A key of the builder's `RELATION_ATTACHMENTS` (the browser does not import the builder). */
  readonly attachment: string;
  /** A key of the builder's `ON_DELETE_BEHAVIORS`. */
  readonly onDelete: string;
  /** A key of the builder's `RELATION_GEOMETRIES`. */
  readonly geometry: string;
}

/** The body of the page's `POST`: one relation edit on the draft, or a look at what a deletion would break. */
export type RelationCall =
  | ({ readonly action: 'create' } & RelationValues)
  | ({ readonly action: 'update'; readonly id: string } & Partial<RelationValues>)
  | { readonly action: 'uses'; readonly id: string }
  | { readonly action: 'delete'; readonly id: string };
