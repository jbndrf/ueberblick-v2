/**
 * The checklist of v3 configuration concepts (docs/research/arch-01-config-inventory.md section 2),
 * and the function that finds which of them a v3 export uses. The synthetic fixtures together must
 * use every concept (test), so a converter change cannot quietly leave one untested.
 */
import type { Cond, Effect, Trigger } from './model';
import { readProject, isRec } from './read';
import {
  V3_CLAUSE_KINDS,
  V3_COLUMN_TYPES,
  V3_EFFECT_KINDS,
  V3_EXECUTION_MODES,
  V3_FIELD_OPS,
  V3_FIELD_TYPES,
  V3_GEOMETRY_TYPES,
  V3_MAP_SOURCE_TYPES,
  V3_PREFILL_KINDS,
  V3_RELATION_KINDS,
  V3_STAGE_TYPES,
  V3_TOOL_KINDS,
  V3_TRIGGER_KINDS,
  V3_WRITE_MODES,
} from './registry';

const SETTINGS = [
  'display_name',
  'map_defaults',
  'startup_defaults',
  'admin_presets',
  'consent_banner_title',
  'consent_banner_body',
  'consent_accept_label',
  'consent_reject_label',
  'require_consent_before_login',
] as const;

const WORKFLOW_FLAGS = [
  'private_instances',
  'inactive',
  'marker_color',
  'icon_config',
  'filter_value_icons',
  'visible_to_roles',
  'type:incident',
  'type:survey',
] as const;

const PLACEMENT = [
  'required',
  'show_if',
  'force_dirty',
  'related',
  'help_text',
  'placeholder',
  'layout',
] as const;
const FIELD_FLAGS = [
  'view_roles',
  'write_roles',
  'display_config',
  'compute_expression',
  'validation:number',
  'validation:text_length',
  'validation:pattern',
  'validation:step',
  'option:date_time',
  'option:date_time_of_day',
  'option:max_files',
  'option:allowed_file_types',
] as const;

/** Every concept a complete set of fixtures must exercise. */
export const V3_CONCEPTS: readonly string[] = [
  ...V3_FIELD_TYPES.keys.map((k) => `field_type:${k}`),
  ...V3_WRITE_MODES.map((k) => `write_mode:${k}`),
  ...FIELD_FLAGS.map((k) => `field:${k}`),
  ...V3_CLAUSE_KINDS.keys.map((k) => `clause:${k}`),
  ...V3_FIELD_OPS.keys.map((k) => `op:${k}`),
  ...['all', 'any', 'not'].map((k) => `group:${k}`),
  'aggregate:count',
  'aggregate:any',
  ...V3_EFFECT_KINDS.keys.map((k) => `effect:${k}`),
  'effect:create_instance:workflow',
  'effect:create_instance:into_field',
  ...V3_TRIGGER_KINDS.keys.map((k) => `trigger:${k}`),
  'activation:available',
  'activation:triggered',
  ...V3_EXECUTION_MODES.keys.map((k) => `execution_mode:${k}`),
  ...V3_TOOL_KINDS.keys.map((k) => `tool_kind:${k}`),
  'quick_edit:fields',
  'quick_edit:location',
  ...PLACEMENT.map((k) => `placement:${k}`),
  ...V3_PREFILL_KINDS.map((k) => `prefill:${k}`),
  'task:entry',
  'task:visual',
  ...V3_STAGE_TYPES.map((k) => `stage:${k}`),
  'edges',
  'data_views',
  'field_tags',
  ...V3_GEOMETRY_TYPES.map((k) => `geometry:${k}`),
  ...WORKFLOW_FLAGS.map((k) => `workflow:${k}`),
  ...V3_RELATION_KINDS.map((k) => `relation:${k}`),
  'relation:many',
  'relation:single',
  'role',
  'role:max_instances',
  'custom_table',
  ...V3_COLUMN_TYPES.map((k) => `column_type:${k}`),
  'selector:custom_table',
  'selector:participants',
  'selector:roles',
  ...V3_MAP_SOURCE_TYPES.map((k) => `layer:${k}`),
  'layer_type:base',
  'layer_type:overlay',
  ...SETTINGS.map((k) => `setting:${k}`),
  'info_page',
];

function condConcepts(c: Cond, into: Set<string>): void {
  switch (c.kind) {
    case 'all':
    case 'any':
      into.add(`group:${c.kind}`);
      c.items.forEach((i) => condConcepts(i, into));
      break;
    case 'not':
      into.add('group:not');
      condConcepts(c.item, into);
      break;
    case 'unknown':
      break;
    default:
      into.add(`clause:${c.kind}`);
      if ('op' in c && c.kind !== 'stage') into.add(`op:${c.op}`);
      if (c.kind === 'field' && c.aggregate) into.add(`aggregate:${c.aggregate}`);
      if (c.kind === 'related' && c.condition) condConcepts(c.condition, into);
  }
}

const effectConcepts = (e: Effect, into: Set<string>): void => {
  into.add(`effect:${e.kind}`);
  if (e.kind === 'create_instance') {
    if (e.workflow) into.add('effect:create_instance:workflow');
    if (e.intoProp) into.add('effect:create_instance:into_field');
  }
};

const triggerConcepts = (t: Trigger, into: Set<string>): void => {
  into.add(`trigger:${t.kind}`);
  if (t.kind === 'when') condConcepts(t.cond, into);
};

/** The concepts of `V3_CONCEPTS` that a v3 export uses. */
export function observedConcepts(v3Export: unknown): Set<string> {
  const p = readProject(v3Export);
  const out = new Set<string>();
  for (const s of Object.keys(p.settings)) out.add(`setting:${s}`);
  if (p.roles.length > 0) out.add('role');
  for (const r of p.roles) if ('max_instances' in r.record) out.add('role:max_instances');
  for (const t of p.tables) {
    out.add('custom_table');
    for (const c of t.columns) out.add(`column_type:${String(c.record['column_type'])}`);
  }
  for (const l of p.layers) {
    out.add(`layer:${String(l.record['source_type'])}`);
    out.add(`layer_type:${String(l.record['layer_type'])}`);
  }
  if (p.pages.length > 0) out.add('info_page');
  for (const r of p.relations) {
    out.add(`relation:${String(r.record['kind'] ?? 'parent_child')}`);
    out.add(`relation:${r.record['multiplicity'] === 'single' ? 'single' : 'many'}`);
  }
  for (const w of p.types) {
    const r = w.record;
    out.add(`geometry:${String(r['geometry_type'])}`);
    if (r['private_instances'] === true) out.add('workflow:private_instances');
    if (r['is_active'] === false) out.add('workflow:inactive');
    for (const f of ['marker_color', 'icon_config', 'filter_value_icons', 'visible_to_roles']) {
      const v = r[f];
      if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) out.add(`workflow:${f}`);
    }
    if (typeof r['workflow_type'] === 'string') out.add(`workflow:type:${r['workflow_type']}`);
    for (const f of w.props) {
      const rec = f.record;
      out.add(`field_type:${String(rec['field_type'])}`);
      out.add(`write_mode:${String(rec['write_mode'] ?? 'observation')}`);
      const opts = isRec(rec['field_options']) ? rec['field_options'] : {};
      const rules = isRec(rec['validation_rules']) ? rec['validation_rules'] : {};
      if (Array.isArray(rec['view_roles']) && rec['view_roles'].length > 0) out.add('field:view_roles');
      if (Array.isArray(rec['write_roles']) && rec['write_roles'].length > 0) out.add('field:write_roles');
      if (rec['display_config']) out.add('field:display_config');
      if (rec['compute_expression']) out.add('field:compute_expression');
      if (rec['field_type'] === 'number' && ('min' in rules || 'max' in rules))
        out.add('field:validation:number');
      if ('minLength' in rules || 'maxLength' in rules) out.add('field:validation:text_length');
      if ('pattern' in rules) out.add('field:validation:pattern');
      if ('step' in rules) out.add('field:validation:step');
      if (opts['date_mode'] === 'datetime') out.add('field:option:date_time');
      if (opts['date_mode'] === 'time') out.add('field:option:date_time_of_day');
      if ('max_files' in opts) out.add('field:option:max_files');
      if ('allowed_file_types' in opts) out.add('field:option:allowed_file_types');
      if (rec['field_type'] === 'custom_table_selector')
        out.add(`selector:${String(opts['source_type'] ?? 'custom_table')}`);
    }
    for (const s of w.stages) out.add(`stage:${s.type}`);
    if (w.edges.length > 0) out.add('edges');
    if (w.tabs) out.add('data_views');
    if (w.tags.length > 0) out.add('field_tags');
    for (const t of w.tasks) {
      out.add(t.triggered ? 'activation:triggered' : 'activation:available');
      if (t.trigger) triggerConcepts(t.trigger, out);
      if (t.entry) out.add('task:entry');
      if (t.visual) out.add('task:visual');
      t.conditions.forEach((c) => condConcepts(c.v, out));
      t.effects.forEach((e) => effectConcepts(e.v, out));
      for (const s of t.steps) {
        out.add(`tool_kind:${s.v.kind}`);
        if (s.v.kind === 'quick_edit')
          out.add(s.v.mode === 'location' ? 'quick_edit:location' : 'quick_edit:fields');
        for (const pl of s.v.placements) {
          const pv = pl.v;
          if (pv.required) out.add('placement:required');
          if (pv.showIf) {
            out.add('placement:show_if');
            condConcepts(pv.showIf, out);
          }
          if (pv.forceDirty) out.add('placement:force_dirty');
          if (pv.related) out.add('placement:related');
          if (pv.helpText) out.add('placement:help_text');
          if (pv.placeholder) out.add('placement:placeholder');
          if (pv.layout) out.add('placement:layout');
          out.add(`prefill:${pv.prefill.kind}`);
        }
      }
    }
    for (const r of w.rules) {
      triggerConcepts(r.trigger.v, out);
      if (r.mode) out.add(`execution_mode:${r.mode.v}`);
      for (const s of r.steps) {
        condConcepts(s.v.when.v, out);
        s.v.effects.forEach((e) => effectConcepts(e.v, out));
      }
    }
  }
  return out;
}
