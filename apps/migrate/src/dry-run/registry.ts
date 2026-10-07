/** The steps of the dry run, in order (R6). Each is one step of the cutover runbook, `docs/process/cutover-runbook.md`. */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

export const DRY_RUN_STEPS = defineRegistry([
  {
    key: 'convert',
    description: 'Convert the v3 configuration; the result compiles and the report is complete.',
  },
  { key: 'diffcheck', description: 'Replay recorded v3 runs; no difference is unexplained.' },
  { key: 'target', description: 'Build the import project (converted project plus import tasks, no rules).' },
  { key: 'migrate', description: 'Run the data migration into a project database; no run is refused.' },
  { key: 'verify', description: 'Every carried record is a live feature in the project database.' },
] as const);
export type DryRunStep = KeyOf<typeof DRY_RUN_STEPS>;
