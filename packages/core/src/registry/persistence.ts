import { defineRegistry, type KeyOf } from './define';

/** The outcome of a run as recorded in the ledger (docs/04-data-model.md `runs.outcome`). */
export const RUN_OUTCOMES = defineRegistry([
  { key: 'accepted', description: 'The run was planned and its observations were appended.' },
  { key: 'rejected', description: 'The run was refused; only the run row with its refusal code is kept.' },
] as const);
export type RunOutcome = KeyOf<typeof RUN_OUTCOMES>;

/** Lifecycle of a compiled config version (docs/04-data-model.md `config_versions.status`). */
export const CONFIG_VERSION_STATUSES = defineRegistry([
  { key: 'draft', description: 'Compiled but not deployed.' },
  { key: 'deployed', description: 'The version new runs are planned against.' },
  { key: 'retired', description: 'Superseded; kept so queued runs can still be validated.' },
] as const);
export type ConfigVersionStatus = KeyOf<typeof CONFIG_VERSION_STATUSES>;
