import { defineRegistry, type KeyOf } from './define';

/**
 * Compile problem codes (docs/08 problems panel). WP-013 fills this list; every code needs a
 * negative fixture. Seeded by the lead with the classes named in the work package.
 */
export const PROBLEM_CODES = defineRegistry([
  { key: 'dangling_reference', description: 'A key refers to an entity that does not exist.' },
  { key: 'expression_parse', description: 'An expression does not parse.' },
  { key: 'expression_type', description: 'An expression does not type-check in its context.' },
  {
    key: 'inherit_with_own_geometry',
    description:
      'A relation draws its children at the parent (`inherit_position`), but the child type has a primary geometry of its own.',
  },
  { key: 'dead_option', description: 'A select option no task or default can ever set.' },
  { key: 'never_available', description: 'A task whose `when` can never be true.' },
  {
    key: 'when_trigger_uses_time',
    description:
      'The `when` of an automatic action without a timing reads `now` or `today()`; only `elapsed` fires on the clock.',
  },
  { key: 'rule_cycle', description: 'Automatic actions that trigger each other without a bound.' },
  {
    key: 'auto_after_other_type',
    description: 'An automatic action runs `after` a task that is offered on another feature type.',
  },
  {
    key: 'auto_schedule_without_idle',
    description:
      'An automatic `schedule` without `idle` on a task offered on a type: no subject, refused on every tick.',
  },
  {
    key: 'auto_edge_without_subject',
    description:
      'An automatic action without a timing (an edge on `when`) on a task offered from `$map` or `$none`.',
  },
  { key: 'auto_timing_conflict', description: 'An automatic action has more than one timing.' },
  {
    key: 'auto_value_missing',
    description:
      'A task with an automatic action has a required form field that no `then.set` gives a value: an automatic run has no form.',
  },
  { key: 'lock_violation', description: 'The overlay changes a locked template path.' },
  { key: 'unknown_path', description: 'The overlay addresses a path the template does not have.' },
  { key: 'path_exists', description: 'The overlay adds a path the template already has.' },
  { key: 'hidden_referenced', description: 'A hidden entity is still referenced by the effective config.' },
  {
    key: 'schema_invalid',
    description: 'The file does not fit the file schema (found by the builder document, not by compile).',
  },
  { key: 'reserved_key', description: 'A key equals a reserved word (RESERVED_KEYS).' },
  {
    key: 'visible_when_not_sql',
    description: 'A `permissions.visible_when` cannot be translated to SQL, so the server hides the rows.',
  },
  { key: 'personal_indexed', description: 'A personal property asks for a database index.' },
  {
    key: 'personal_without_redact',
    description:
      'The project has personal properties but no task with a `redact` step, so it cannot erase them.',
  },
  { key: 'personal_public', description: 'A view carries a personal property that every role can see.' },
  {
    key: 'derive_no_prefilter',
    description: 'A derive expression has no spatial predicate as a top-level `&&` operand.',
  },
  {
    key: 'derive_traverses_relation',
    description: 'A derive condition reads through a relation instead of own properties of self and other.',
  },
  {
    key: 'task_field_not_writable',
    description: 'A task form field that no role in the task audience may write.',
  },
  {
    key: 'task_role_cannot_write',
    description:
      'A role the task `when` admits may not write a field the task form writes, while another admitted role may: that role sees the task and is always refused.',
  },
  { key: 'derive_uses_time', description: 'A derive expression reads `now` or `today()`.' },
  {
    key: 'asset_unresolved',
    description: 'A `{ $ref }` (layer style, later a model asset) that the project bundle does not hold.',
  },
  { key: 'style_invalid', description: 'A resolved layer style does not have the shape its renderer needs.' },
  {
    key: 'tool_source_invalid',
    description: 'A `tools.search.sources` entry does not name a searchable `type.property`.',
  },
  {
    key: 'tool_setting_invalid',
    description: 'A tool setting is not in the tool schema, or its value does not fit it.',
  },
  {
    key: 'process_property_invalid',
    description: 'A type `process` names a property that is missing or is not a `select`.',
  },
  {
    key: 'process_stage_unknown',
    description: 'A process `start` or `end` value is not an option of the process property.',
  },
  {
    key: 'process_end_invalid',
    description: 'A process has no `end` stage, or its `end` contains the `start`.',
  },
  {
    key: 'process_property_default',
    description: 'The process property has a `default`; `start` replaces it.',
  },
  {
    key: 'process_property_written',
    description:
      'A task form field, quick-edit property or location step writes the process property; only `then.set` steps may.',
  },
  {
    key: 'task_step_property_invalid',
    description:
      'A quick-edit or location step names a property the task subject lacks, or a location step names a property that is not a geometry.',
  },
  {
    key: 'computed_cycle',
    description: 'Computed properties that read each other (or themselves), so no order can compute them.',
  },
  {
    key: 'computed_written',
    description:
      'A task form field, quick-edit property, location step or `then.set` writes a computed property; only plan does.',
  },
  {
    key: 'computed_default',
    description: 'A computed property has a `default`; plan computes the first value on create.',
  },
  {
    key: 'computed_input_unsupported',
    description:
      'A computed expression reads something plan cannot watch: a relation, a reference, another feature, `actor`, `now` or `today()`.',
  },
  {
    key: 'pack_unknown_layer',
    description: 'An offline pack lists a layer key that `map.layers` does not have.',
  },
  {
    key: 'pack_layer_not_packable',
    description:
      'An offline pack lists a layer whose source type is not packable (registry MAP_SOURCE_TYPES).',
  },
  {
    key: 'pack_zoom_range',
    description: 'An offline pack has min_zoom above max_zoom, or a zoom outside the allowed range.',
  },
  {
    key: 'pack_bounds',
    description: 'The bounds of an offline pack are not a west-south-east-north box in WGS84.',
  },
  {
    key: 'pack_too_large',
    description: 'The tile or size estimate of an offline pack is above the limits (PACK_LIMITS).',
  },
  { key: 'pack_unknown_role', description: 'An offline pack names a role the file does not declare.' },
  {
    key: 'select_unknown_role',
    description:
      'A participant property names a role in `select.all` or `select.self` that the file does not declare.',
  },
  {
    key: 'choice_filter_invalid',
    description: 'A form entry has a `choice_filter`, but its property is not a select or multiselect.',
  },
  {
    key: 'classify_property_invalid',
    description: 'The classifying property of a feature type is not a select property of the type.',
  },
  {
    key: 'classify_value_unknown',
    description: 'A `classify.values` key is not an option of the classifying property.',
  },
  {
    key: 'start_value_unknown',
    description: "A `values_at_start` entry is not an option of the type's classifying property.",
  },
  {
    key: 'start_values_without_property',
    description: 'A type has `values_at_start`, but no classifying property or stage to take values from.',
  },
  {
    key: 'marker_icon_invalid',
    description:
      'An inline SVG marker icon is too large, is not an svg, or holds an element or attribute that is not allowed.',
  },
] as const);
export type ProblemCode = KeyOf<typeof PROBLEM_CODES>;

/**
 * What a `dangling_reference` points at (`params.what`). The compiler builds its English noun from it;
 * the builder's message catalogue has one German noun per kind (WP-416).
 */
export const DANGLING_KINDS = defineRegistry([
  { key: 'feature_type', description: 'A feature type key.' },
  { key: 'property', description: 'A property key of a type the path names.' },
  { key: 'property_of', description: 'A property of the type or bound feature `params.of`.' },
  { key: 'task_subject_property', description: 'A property of the subject of a task.' },
  { key: 'participant_property_of', description: 'A participant property of the type `params.of`.' },
  {
    key: 'reference_property_of',
    description: 'A reference property of the type `params.of` that points at the type `params.to`.',
  },
  { key: 'task', description: 'A task key.' },
  { key: 'view', description: 'A view key.' },
  { key: 'role', description: 'A role key.' },
  { key: 'option', description: 'An option key of a select property.' },
  { key: 'option_of', description: 'An option of the property `params.of`.' },
  { key: 'bound_feature', description: 'A name a task binds with `bind`.' },
  { key: 'personal_subject', description: 'The subject of a personal property.' },
] as const);
export type DanglingKind = KeyOf<typeof DANGLING_KINDS>;

/**
 * The wordings of a problem code that need their own catalogue entry (`params.variant`; WP-416). The key is
 * `<code>.<variant>`; the code's own entry is the wording used when a problem names no variant.
 */
export const PROBLEM_VARIANTS = defineRegistry([
  {
    key: 'dangling_reference.declare_first',
    description: 'Nothing of this kind exists yet: the hint says to declare one.',
  },
  {
    key: 'dangling_reference.locked_path',
    description: 'A `lock` entry names a path the file does not have.',
  },
  { key: 'expression_parse.cron', description: 'An automatic schedule is not a cron expression.' },
  { key: 'expression_type.bind', description: 'A `bind` expression is not one related feature.' },
  { key: 'expression_type.of', description: 'A step `of` is not a feature or a list of features.' },
  { key: 'expression_type.bound_key', description: 'A bound-feature key in a step that has `of`.' },
  { key: 'expression_type.option_name', description: 'An option key written as a name, not as a string.' },
  { key: 'expression_type.literal', description: 'A literal value does not fit the property it sets.' },
  { key: 'asset_unresolved.style_bundle', description: 'A style `$ref` is missing from the given bundle.' },
  { key: 'asset_unresolved.icon', description: 'A marker icon `$ref` is missing and no bundle was given.' },
  {
    key: 'asset_unresolved.icon_bundle',
    description: 'A marker icon `$ref` is missing from the given bundle.',
  },
  { key: 'computed_input_unsupported.changed_at', description: 'A computed property reads `$changed_at`.' },
  {
    key: 'computed_input_unsupported.reference',
    description: 'A computed property reads through a reference.',
  },
  {
    key: 'computed_input_unsupported.name',
    description: 'A computed property reads an unstable name (`actor`, `now`).',
  },
  { key: 'computed_input_unsupported.time', description: 'A computed property calls `today()`.' },
  {
    key: 'computed_input_unsupported.bare_self',
    description: 'A computed property reads `self` as a whole.',
  },
  { key: 'tool_source_invalid.entry', description: 'A search source is not a `type.property` entry.' },
  { key: 'tool_source_invalid.not_type', description: 'A search source names a type that does not exist.' },
  { key: 'tool_source_invalid.no_property', description: 'A search source names a property the type lacks.' },
  {
    key: 'tool_source_invalid.not_searchable',
    description: 'A search source names a property that cannot be searched.',
  },
  { key: 'lock_violation.order', description: 'The overlay orders a map the template locks.' },
  { key: 'unknown_path.input', description: 'The overlay sets an input the template does not have.' },
  { key: 'unknown_path.invalid_path', description: 'An overlay `add` path is not a valid key path.' },
  { key: 'unknown_path.not_entity', description: 'An overlay `add` path is a whole section, not an entity.' },
  { key: 'unknown_path.add_parent', description: 'An overlay `add` path has no parent in the template.' },
  { key: 'unknown_path.hide', description: 'An overlay `hide` path does not exist in the template.' },
  { key: 'unknown_path.order_map', description: 'An overlay `order` path is not a map.' },
  { key: 'unknown_path.order_key', description: 'An overlay `order` list names a key the map lacks.' },
  {
    key: 'rule_cycle.conditional',
    description: 'Automatic actions that only their conditions keep from looping (a warning).',
  },
] as const);
export type ProblemVariant = KeyOf<typeof PROBLEM_VARIANTS>;

/** Kinds of change reported by `diff`. */
export const DIFF_CHANGES = defineRegistry([
  { key: 'added', description: 'The path exists only in the new file.' },
  { key: 'removed', description: 'The path exists only in the old file.' },
  { key: 'changed', description: 'The value at the path differs.' },
  {
    key: 'order_changed',
    description:
      'The keys of an ordered map (`ORDERED_MAPS`) are the same but in another order (A-042). `before` and `after` hold the key lists. Never breaking.',
  },
] as const);
export type DiffChange = KeyOf<typeof DIFF_CHANGES>;

/**
 * Words that may never be used as keys: rule-language names, literals and keywords (A-005).
 * Platform keywords in key positions use the `$` sigil instead (`on: $map`, `see: $all`), which
 * the key pattern can never produce, so new keywords never collide with existing projects.
 */
export const RESERVED_KEYS = defineRegistry([
  { key: 'self', description: 'Rule language: the primary feature.' },
  { key: 'form', description: 'Rule language: current form values.' },
  { key: 'value', description: 'Rule language: the value being validated.' },
  { key: 'actor', description: 'Rule language: the actor.' },
  { key: 'inputs', description: 'Rule language: template inputs.' },
  { key: 'other', description: 'Rule language: the candidate in a derive relation.' },
  { key: 'now', description: 'Rule language: injected time.' },
  { key: 'true', description: 'Rule language literal.' },
  { key: 'false', description: 'Rule language literal.' },
  { key: 'null', description: 'Rule language literal.' },
  { key: 'in', description: 'Rule language operator.' },
] as const);
export type ReservedKey = KeyOf<typeof RESERVED_KEYS>;

/**
 * The maps whose key order is meaning: property order, form field order, option order, task order,
 * layer draw order (docs/05 "Order"; the overlay's `order` addresses them). `*` stands for one key.
 * An order change of one of them is a change: it is in the deploy diff and in the config hash (A-042).
 */
export const ORDERED_MAPS = defineRegistry([
  { key: 'types', description: 'Feature types.' },
  { key: 'tasks', description: 'Tasks (the order of the task list).' },
  { key: 'views', description: 'Views.' },
  { key: 'roles', description: 'Roles.' },
  { key: 'types.*.properties', description: 'Properties of a type: their order in forms and Daten.' },
  { key: 'types.*.relations', description: 'Relations of a type.' },
  { key: 'types.*.properties.*.options', description: 'The options of a select property.' },
  {
    key: 'tasks.*.form',
    description: 'Form fields of a task, and with them the lines (column, row of each entry).',
  },
  { key: 'roles.*.app.views', description: 'The views of a role app, in tab order.' },
  { key: 'roles.*.app.shortcuts', description: 'The shortcuts of a role app.' },
  { key: 'roles.*.app.tools', description: 'The tools of a role app: the order of the Werkzeuge sheet.' },
  {
    key: 'roles.*.app.filter_presets',
    description: 'The filter presets of a role app: the order of the Ansichten tab.',
  },
  { key: 'views.*.layers', description: 'Map layers of a view.' },
  { key: 'map.layers', description: 'Background layers; authored order is the draw order.' },
  { key: 'map.packs', description: 'Offline packs: the order of the settings list and the server store.' },
  { key: 'tasks.*.auto', description: 'Automatic actions: the order in which they fire.' },
  { key: 'tools', description: 'Tool settings; the Werkzeuge sheet order when a role app lists none.' },
  { key: 'info_pages', description: 'Info pages (ties of `sort_order` keep this order).' },
] as const);
export type OrderedMap = KeyOf<typeof ORDERED_MAPS>;
