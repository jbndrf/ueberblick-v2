import { defineRegistry, type KeyOf } from './define';

/**
 * Why a run, batch, import or view request was not accepted (docs/01 "Refusal"). `plan` raises the
 * entries with `plan: true`; the others are raised by the import, view and batch layers that wrap
 * plan, and live here so every refusal code has one home (R6). `Refusal.code` carries a key.
 */
export const REFUSAL_CODES = defineRegistry([
  {
    key: 'unknown_task',
    plan: true,
    description: 'No such task in the effective config (for example hidden).',
  },
  {
    key: 'unknown_feature',
    plan: true,
    description: 'The task needs a feature that does not exist.',
  },
  {
    key: 'case_closed',
    plan: true,
    description: 'The feature is archived or deleted: it accepts no run (a completed one still does).',
    text: { en: 'This entry is archived or deleted.', de: 'Dieser Eintrag ist archiviert oder gelöscht.' },
    hint: {
      en: 'Ask an admin to restore it, or start a new entry.',
      de: 'Bitte eine Administratorin um Wiederherstellung oder lege einen neuen Eintrag an.',
    },
  },
  {
    key: 'not_available',
    plan: true,
    description: 'The task is not offered here: wrong target or type, or its `when` is false.',
  },
  {
    key: 'not_permitted',
    plan: true,
    description: "The actor's role may not do this (see, create, write, delete).",
  },
  {
    key: 'invalid_input',
    plan: true,
    description: 'The input does not match the form, or a step could not be evaluated.',
  },
  {
    key: 'required_missing',
    plan: true,
    description: 'A relevant required field, or a required property of a new feature, has no value.',
  },
  {
    key: 'id_taken',
    plan: true,
    description:
      'A create names a feature id that already exists, or that an earlier create of the batch used (no create overwrites a feature).',
  },
  { key: 'constraint_failed', plan: true, description: 'A field constraint is false.' },
  { key: 'readonly_field', plan: true, description: 'A value was supplied for a readonly field.' },
  { key: 'bind_unresolved', plan: true, description: 'A bind has no related feature.' },
  { key: 'bind_undeclared', plan: true, description: 'The run addresses a feature outside the task binds.' },
  { key: 'geometry_required', plan: true, description: 'A required geometry is missing.' },
  {
    key: 'quota_exceeded',
    plan: true,
    description:
      "The actor already created as many features as the quota of their role allows (a role's `quota`, WP-639).",
  },
  {
    key: 'too_many_targets',
    plan: true,
    description: 'A then-step `of` names more features than THEN_STEP_TARGETS_MAX (A-035).',
  },
  { key: 'depth_exceeded', plan: true, description: 'The rule chain went deeper than the platform limit.' },
  {
    key: 'batch_failed',
    plan: false,
    description:
      'One run of an atomic batch was refused, so the whole batch is (raised by the batch layer around plan).',
  },
  {
    key: 'blob_mismatch',
    plan: false,
    description:
      'The server rejected the uploaded bytes of a file value: they do not hash to the sha256 (raised by the device upload).',
  },
  {
    key: 'blob_too_large',
    plan: false,
    description:
      'The server rejected the uploaded bytes of a file value: over the upload limit (raised by the device upload).',
  },
  {
    key: 'blob_lost',
    plan: false,
    description:
      'The queue cannot upload a file of the run: its bytes (or stored mime) are no longer on the device, and the server does not hold them either (raised by the device upload).',
  },
  {
    key: 'blob_missing',
    plan: false,
    description:
      'A file value names a sha256 whose bytes the server does not have (raised by the run store: upload before the run).',
  },
  { key: 'crs_undeclared', plan: false, description: 'An import has no source_crs (raised by the import).' },
  {
    key: 'property_not_visible',
    plan: false,
    description: 'An expression named a property the actor may not see (raised by views).',
  },
  {
    key: 'unknown_property',
    plan: false,
    description: 'An expression named a property that does not exist (raised by views).',
  },
] as const);
export type RefusalCode = KeyOf<typeof REFUSAL_CODES>;
