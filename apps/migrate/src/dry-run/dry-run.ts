/**
 * The dry run: the whole migration chain (convert, differential check, import project, data migration, verify)
 * on one v3 project, into a fresh project database. Each step is one step of `docs/process/cutover-runbook.md`;
 * the same functions serve the pilot on real exports. The first failing step ends the run.
 */
import { servedSql, type Clock } from '@ueberblick/core';
import { openProjectDb } from '@ueberblick/server';
import { convertConfig } from '../config';
import { diffcheck, formatReport, parseRuns, summarize } from '../diffcheck';
import { migrationStore, readDataExport, runMigration } from '../data';
import type { DryRunStep } from './registry';

export interface DryRunInput {
  /** The parsed v3 project definition. */
  readonly config: unknown;
  /** Recorded v3 runs for the differential check (a list of runs). */
  readonly runs: unknown;
  /** The parsed v3 data export. */
  readonly data: unknown;
}

export interface DryRunOptions {
  /** Directory for the project database; default `:memory:`. */
  readonly dir?: string;
  /** Key of the project database. */
  readonly key?: string;
}

export interface StepResult {
  readonly step: DryRunStep;
  readonly ok: boolean;
  /** One line: the numbers, or the reason for the failure. */
  readonly detail: string;
}

export interface DryRunResult {
  readonly ok: boolean;
  readonly steps: readonly StepResult[];
}

const CLOCK: Clock = { now: () => '2026-05-01T08:00:00.000Z' };
const message = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export async function dryRun(input: DryRunInput, options: DryRunOptions = {}): Promise<DryRunResult> {
  const steps: StepResult[] = [];
  const done = (step: DryRunStep, ok: boolean, detail: string): DryRunResult | undefined => {
    steps.push({ step, ok, detail });
    return ok ? undefined : { ok: false, steps };
  };
  const fail = (step: DryRunStep, e: unknown): DryRunResult => done(step, false, message(e)) as DryRunResult;

  let converted: ReturnType<typeof convertConfig>;
  try {
    converted = convertConfig(input.config as never);
  } catch (e) {
    return fail('convert', e);
  }
  const { report, check } = converted;
  const problems = check.ok
    ? ''
    : `; the converted project does not compile (${check.schemaIssues.length + check.problems.length} issues)`;
  const stray = report.stray.length > 0 ? `; ${report.stray.length} stray report items` : '';
  const early = done(
    'convert',
    check.ok && report.stray.length === 0,
    `${report.summary.total} items: ${report.summary.mapped} mapped, ${report.summary.approximated} approximated, ${report.summary.dropped} dropped${problems}${stray}`,
  );
  if (early) return early;

  try {
    const runs = parseRuns(input.runs);
    const differences = diffcheck(runs, converted);
    const summary = summarize(runs.length, differences);
    const stop = done(
      'diffcheck',
      summary.unexplained === 0,
      summary.unexplained === 0
        ? `${runs.length} runs, ${summary.agreed} agree, ${differences.length} differences, none unexplained`
        : formatReport(summary),
    );
    if (stop) return stop;
  } catch (e) {
    return fail('diffcheck', e);
  }

  // The diffcheck used the full project; the import project leaves the rules out (v3 rules already ran).
  const { target } = convertConfig(input.config as never, { target: 'import' });
  try {
    if (target === undefined) throw new Error('the converted project has no import project');
    done('target', true, `${Object.keys(target.tasks).length} feature types with import tasks`);
  } catch (e) {
    return fail('target', e);
  }

  const db = openProjectDb(options.dir ?? ':memory:', options.key ?? 'dryrun');
  try {
    const { store, geo, configVersion } = migrationStore(db, target, CLOCK);
    const result = await runMigration(store, readDataExport(input.data), converted.mapping, {
      target,
      geo,
      configVersion,
    });
    const refused = result.problems.filter((p) => p.code === 'refused');
    const stop = done(
      'migrate',
      refused.length === 0,
      `${result.accepted} runs accepted in ${result.batches} batches, ${result.problems.length} problems reported, ${refused.length} runs refused`,
    );
    if (stop) return stop;

    const live = new Set(
      db
        .prepare<{ id: string }>(`SELECT id FROM features WHERE ${servedSql('lifecycle')}`)
        .all()
        .map((r) => r.id),
    );
    const carried = [...result.ids.entries()];
    const missing = carried.filter(([, id]) => !live.has(id)).map(([v3]) => v3);
    const last = done(
      'verify',
      missing.length === 0 && live.size === carried.length,
      missing.length > 0
        ? `not live in the project database: ${missing.join(', ')}`
        : `${live.size} features in the project database, ${carried.length} carried records`,
    );
    return last ?? { ok: true, steps };
  } catch (e) {
    return fail(steps.some((s) => s.step === 'migrate') ? 'verify' : 'migrate', e);
  } finally {
    db.close();
  }
}

/** One line per step and a verdict. */
export function formatDryRun(result: DryRunResult): string {
  const lines = result.steps.map((s) => `${s.ok ? 'ok  ' : 'FAIL'} ${s.step}: ${s.detail}`);
  lines.push(result.ok ? 'dry run passed' : 'dry run FAILED');
  return lines.join('\n');
}
