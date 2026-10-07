/** Differential check of the migration (WP-302): recorded v3 runs replayed through the converted v4 project. */
export { compileConverted, diffcheck, DEFAULT_NOW_MS, DiffcheckConfigError } from './diffcheck';
export { evalCoreScenario, knownFor, type EvalCase, type EvalCoreScenario } from './evalcore';
export { formatReport, summarize, type DiffReport } from './format';
export {
  DIFF_CAUSES,
  DIFF_KINDS,
  RECORDED_OUTCOMES,
  type DiffCause,
  type DiffKind,
  type RecordedOutcome,
} from './registry';
export { parseRuns, RunsError } from './runs';
export type { Difference, V3Instance, V3Recorded, V3RelatedInstance, V3Run, V3Value } from './types';
