/** The scripted dry run of the migration (WP-303). */
export {
  dryRun,
  formatDryRun,
  type DryRunInput,
  type DryRunOptions,
  type DryRunResult,
  type StepResult,
} from './dry-run';
export { dryRunFixture } from './fixture';
export { DRY_RUN_STEPS, type DryRunStep } from './registry';
