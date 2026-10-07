import { defineRegistry, type KeyOf } from './define';
import type { FeatureState } from '../model';
import type { ExprTypeKind } from './expr-kinds';

/**
 * The system fields every feature carries (A-028 items 2-3, owner Q23/Q26). A rule reads one as `self.$<key>`; the
 * sigil keeps them apart from config properties (A-005). `state` is the field of `FeatureState` that holds the value
 * (fold derives it), `column` the `features` column the SQL translation reads, `sql` whether that column exists yet (false: the checker refuses the field where the expression compiles to SQL; the column's WP flips it), `type` the checker's type. The set is
 * open: a new entry needs a fold rule, a column and a sync field, nothing in the rule language.
 */
export const SYSTEM_FIELDS = defineRegistry([
  {
    key: 'lifecycle',
    state: 'lifecycle',
    column: 'lifecycle',
    sql: true,
    type: 'string',
    description:
      "The system lifecycle: 'active', 'completed', 'archived' or 'deleted' (registry LIFECYCLE_STATES).",
  },
  {
    key: 'created_by',
    state: 'createdBy',
    column: 'created_by',
    sql: true,
    type: 'string',
    description: 'The id of the actor whose run created the feature ("Erstellt von"). Written once by plan.',
  },
  {
    key: 'created_at',
    state: 'createdAt',
    column: 'created_at',
    sql: true,
    type: 'timestamp',
    description: 'When the feature was created ("Erstellt am"): the time of its `$type` observation.',
  },
  {
    key: 'changed_at',
    state: 'changedAt',
    column: 'changed_at',
    sql: true,
    type: 'timestamp',
    description: 'When the feature last changed ("Zuletzt geändert"): the time of its newest observation.',
  },
  {
    key: 'version',
    state: 'pinnedVersion',
    column: 'pinned_version',
    sql: true,
    type: 'int',
    description:
      'The config version the feature is pinned to (A-029, integer = `config_versions.version`); null while it floats on the deployed version. Only system and admin runs write it. The SQL column `features.pinned_version` has a partial index (project migration 18).',
  },
] as const satisfies readonly {
  readonly key: string;
  readonly state: keyof FeatureState;
  readonly column: string;
  readonly sql: boolean;
  readonly type: Extract<ExprTypeKind, 'string' | 'timestamp' | 'int'>;
  readonly description: string;
}[]);
export type SystemFieldKey = KeyOf<typeof SYSTEM_FIELDS>;
export type SystemField = ReturnType<typeof SYSTEM_FIELDS.get>;

/** The sigil that marks a system field in a rule (`self.$created_by`) and in an observation key (`$lifecycle`). */
export const SYSTEM_FIELD_SIGIL = '$';

/** The entry a rule's member name (`$created_by`) means, or undefined when it names none. */
export function systemFieldOf(name: string): SystemField | undefined {
  if (!name.startsWith(SYSTEM_FIELD_SIGIL)) return undefined;
  const key = name.slice(SYSTEM_FIELD_SIGIL.length);
  return SYSTEM_FIELDS.has(key) ? SYSTEM_FIELDS.get(key) : undefined;
}

/** The value of the system field `name` (`$created_by`) of a feature, or undefined when `name` is none or the value is not set. */
export function readSystemField(f: FeatureState, name: string): string | number | undefined {
  const field = systemFieldOf(name);
  return field === undefined ? undefined : (f[field.state] as string | number | undefined);
}
