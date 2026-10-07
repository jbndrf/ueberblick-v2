/** Test support: the recorded synthetic v3 runs and the eval-core corpus. Not used at run time. */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseRuns } from './runs';
import type { EvalCase } from './evalcore';
import type { V3Run } from './types';

/** The recorded runs of `fixtures/v3-synthetic/runs/<name>.yaml`. */
export function loadRuns(name: string): V3Run[] {
  const url = new URL(`../../../../fixtures/v3-synthetic/runs/${name}.yaml`, import.meta.url);
  return parseRuns(parse(readFileSync(url, 'utf8')));
}

/** The v3 eval-core corpus (`fixtures/v3/eval-core.fixtures.json`, copied from `reference/pb/pb_hooks/`). */
export function loadEvalCore(): EvalCase[] {
  const url = new URL('../../../../fixtures/v3/eval-core.fixtures.json', import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { cases: EvalCase[] }).cases;
}
