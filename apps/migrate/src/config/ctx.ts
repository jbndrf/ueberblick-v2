/** Shared state of one conversion: what each v3 feature type, property and role became. */
import type { Property, PropertyTypeKey } from '@ueberblick/core';
import type { KeySpace } from './keys';
import type { Report } from './report';
import type { ReportStatus } from './registry';

export type Note = (status: ReportStatus, reason: string) => void;

/** What one v3 field became. */
export interface PropInfo {
  readonly v3Key: string;
  readonly key: string;
  readonly type: PropertyTypeKey;
  /** v3 stored value (option label, or the key itself) to option key. */
  readonly options: Map<string, string>;
  /** The feature type key that a `reference` points to. */
  readonly to?: string;
  /** v3 write mode: `computed` properties are written by the system only. */
  readonly writeMode: string;
  /** Form constraints (over `value`) that stand in for v3 validation rules. */
  readonly constraints: string[];
  readonly constraintMessage?: string;
  /** Rendering hint for forms (`multiline` for long text). */
  readonly appearance?: string;
  /** Roles that may see or write the property; `undefined` when v3 did not restrict it. */
  readonly view: readonly string[] | undefined;
  readonly write: readonly string[] | undefined;
  readonly def: Property;
  /** Why the converter marked the property `personal` (WP-172); absent when it did not. */
  readonly personalReason?: string;
  /**
   * Set for a many-valued v3 reference: the field became a relation of cardinality many (its key is the relation
   * key) and this is the reference property on the other type that it reads.
   */
  readonly relation?: { readonly type: string; property: string };
}

/** What one v3 workflow (or custom table) became: a v4 feature type. */
export interface TypeInfo {
  readonly v3Key: string;
  readonly key: string;
  /** True for a custom table (a lookup type), false for a v3 workflow. */
  readonly fromTable: boolean;
  /** Keys taken by properties and relations of this type. */
  readonly keys: KeySpace;
  readonly props: Map<string, PropInfo>;
  /** v3 stage key to option key. */
  readonly stageOptions: Map<string, string>;
  readonly stageKey: string;
  readonly geomKey?: string;
  readonly creatorKey: string;
  readonly lifecycleKey: string;
  needsCreator: boolean;
  /** Lifecycle statuses that v3 used; the `lifecycle` property is added when any exists. */
  readonly statuses: Set<string>;
  /** v4 keys of the tasks that create features of this type (creating tasks). */
  readonly entryTasks: string[];
  /** Roles (v4 keys) allowed to create features; `undefined` while no creating task exists, `all` when unrestricted. */
  createRoles: Set<string> | 'all' | undefined;
  /** Reference properties that point at another type: target type key to property key. */
  readonly refTo: Map<string, string>;
  /** Computed properties that a participant task sets: property key to the roles of those tasks (`all` when open). */
  readonly computedBy: Map<string, Set<string> | 'all'>;
}

export interface Ctx {
  readonly report: Report;
  /** Feature types made from v3 workflows, by v3 key. */
  readonly types: Map<string, TypeInfo>;
  /** Feature types made from custom tables, by v3 key. */
  readonly tables: Map<string, TypeInfo>;
  /** Any feature type by its v4 key. */
  byKey(key: string): TypeInfo | undefined;
  readonly roleKeys: Map<string, string>;
  readonly taskKeys: Map<string, string>;
  /** Tools that some form uses (`draw` for geometry input). */
  readonly toolsUsed: Set<string>;
  /** The v4 key of a role for use in expressions (an unknown role keeps a key of its own). */
  role(v3: string): string;
  /** The v4 key of a role that exists; audiences list only these. */
  knownRole(v3: string): string | undefined;
}

/** The property behind a v3 field that holds a value; a many-valued reference is a relation, not a value. */
export const valueProp = (type: TypeInfo, v3: string): PropInfo | undefined => {
  const p = type.props.get(v3);
  return p?.relation === undefined ? p : undefined;
};

export const noteTo =
  (report: Report, id: string, target?: string): Note =>
  (status, reason) =>
    report.note(id, status, status === 'mapped' ? undefined : reason, target);
