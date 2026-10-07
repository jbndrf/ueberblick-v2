/**
 * Registries of the converter (R6): the report statuses, and the v3 vocabulary the converter reads.
 * The v3 lists are the concepts of docs/research/arch-01-config-inventory.md; `concepts.ts` turns
 * them into the checklist that the synthetic fixtures must cover.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** How one v3 item ended up in the result. */
export const REPORT_STATUSES = defineRegistry([
  { key: 'mapped', description: 'Has a v4 counterpart with the same meaning.' },
  { key: 'approximated', description: 'Converted, but v4 expresses it differently; the reason says how.' },
  { key: 'dropped', description: 'Not converted; the reason says why.' },
] as const);
export type ReportStatus = KeyOf<typeof REPORT_STATUSES>;

/** Severity order used when one item collects several notes: the worst status wins. */
export const STATUS_RANK: Record<ReportStatus, number> = { mapped: 0, approximated: 1, dropped: 2 };

export const V3_FIELD_TYPES = defineRegistry([
  { key: 'short_text', description: 'Single line text.' },
  { key: 'long_text', description: 'Multi-line text.' },
  { key: 'number', description: 'Number.' },
  { key: 'email', description: 'E-mail address.' },
  { key: 'date', description: 'Date, date-time or time.' },
  { key: 'file', description: 'File upload.' },
  { key: 'dropdown', description: 'One option.' },
  { key: 'multiple_choice', description: 'Several options.' },
  { key: 'smart_dropdown', description: 'Options that depend on another field.' },
  { key: 'custom_table_selector', description: 'A row of a custom table, a participant or a role.' },
  { key: 'instance_reference', description: 'A reference to another feature.' },
] as const);

export const V3_CLAUSE_KINDS = defineRegistry([
  { key: 'field', description: 'The value of a field against a literal.' },
  { key: 'stage', description: 'Current stage.' },
  { key: 'role', description: 'Acting role.' },
  { key: 'ownership', description: 'Own or any.' },
  { key: 'instance_status', description: 'Lifecycle status.' },
  { key: 'field_to_field', description: 'Two fields compared.' },
  { key: 'related', description: 'Related features.' },
] as const);

export const V3_FIELD_OPS = defineRegistry([
  { key: 'equals', description: '=' },
  { key: 'not_equals', description: '!=' },
  { key: 'contains', description: 'text contains' },
  { key: 'includes', description: 'list includes' },
  { key: 'not_includes', description: 'list does not include' },
  { key: 'is_empty', description: 'empty' },
  { key: 'is_not_empty', description: 'not empty' },
  { key: 'gt', description: '>' },
  { key: 'gte', description: '>=' },
  { key: 'lt', description: '<' },
  { key: 'lte', description: '<=' },
  { key: 'older_than_days', description: 'older than n days' },
  { key: 'newer_than_days', description: 'newer than n days' },
] as const);

export const V3_EFFECT_KINDS = defineRegistry([
  { key: 'transition', description: 'Move to a stage.' },
  { key: 'snapshot', description: 'Protocol entry.' },
  { key: 'create_instance', description: 'Spawn a feature.' },
  { key: 'set_field', description: 'Write a value.' },
  { key: 'clear_field', description: 'Write an empty value.' },
  { key: 'set_instance_status', description: 'Set the lifecycle status.' },
  { key: 'compute', description: 'Server-evaluated value.' },
] as const);

export const V3_TRIGGER_KINDS = defineRegistry([
  { key: 'on_transition', description: 'Stage change.' },
  { key: 'on_field_change', description: 'A value was recorded for a field.' },
  { key: 'on_create', description: 'Feature created.' },
  { key: 'scheduled', description: 'Cron.' },
  { key: 'elapsed', description: 'Duration after a reference point.' },
  { key: 'when', description: 'Condition flips to true.' },
  { key: 'on_task_run', description: 'A task ran.' },
  { key: 'on_task_outcome', description: 'A task produced an outcome.' },
] as const);

export const V3_TOOL_KINDS = defineRegistry([
  { key: 'form', description: 'Paged form.' },
  { key: 'quick_edit', description: 'Inline edit or location edit.' },
  { key: 'automation', description: 'Deprecated tool kind.' }, // glossary-lint-ignore
] as const);

export const V3_EXECUTION_MODES = defineRegistry([
  { key: 'run_all', description: 'Every matching step.' },
  { key: 'first_match', description: 'First matching step only.' },
] as const);

export const V3_MAP_SOURCE_TYPES = ['tile', 'wms', 'uploaded', 'preset', 'geojson'] as const;
export const V3_COLUMN_TYPES = ['text', 'number', 'date', 'boolean'] as const;
export const V3_RELATION_KINDS = ['parent_child', 'peer'] as const;
export const V3_PREFILL_KINDS = ['empty', 'constant', 'last_value', 'computed'] as const;
export const V3_STAGE_TYPES = ['start', 'intermediate', 'end'] as const;
export const V3_WRITE_MODES = ['singleton', 'observation', 'computed'] as const;
export const V3_GEOMETRY_TYPES = ['point', 'line', 'polygon'] as const;
