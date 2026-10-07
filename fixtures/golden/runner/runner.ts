/**
 * The golden scenario runner (WP-050): executes corpus scenarios against core.plan and core.fold through
 * the simulation harness. It re-implements no rule (R1): runs go through `SimServer` (which calls
 * `core.plan` and stores what it accepts through `core.fold`); the runner only translates the scenario
 * format and compares results. Steps and keys it cannot run yet are reported as named skips.
 */
import { goldenFiles, goldenYaml, type ScenarioServerFactory } from '../../../packages/core/src/testing';
import { EXECUTED_KINDS, RESULT_KEYS, SKIPPED_KINDS, STATE_CHANGING_KINDS, THEN_KEYS } from './classify';
import { runCompileStep, onlyCompile } from './compile';
import { KNOWN_SKIPS, hitKey, type KnownSkip } from './known-skips';
import { isRec, matches, withIds, type Rec } from './match';
import { checkState, skippedFeatureKeys, unclassifiedFeatureKeys } from './state';
import { bindRuleCreated, check, execute, type StepOutcome } from './steps';
import { buildWorld, type ScenarioDoc, type ScenarioWorld } from './world';

export interface Skip {
  readonly scenario: string;
  readonly where: string;
  readonly reason: string;
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly failures: readonly string[];
  readonly skips: readonly Skip[];
  readonly stepsRun: number;
  readonly stepsTotal: number;
  /** Issues of the named skips this scenario used. */
  readonly namedSkips: readonly string[];
}

export const scenarioPaths = (): string[] => goldenFiles('scenarios').filter((p) => p.endsWith('.yaml'));
export const loadScenario = (path: string): ScenarioDoc => goldenYaml(path) as ScenarioDoc;

export function runScenario(
  doc: ScenarioDoc,
  known: readonly KnownSkip[] = KNOWN_SKIPS,
  make?: ScenarioServerFactory,
): ScenarioResult {
  const failures: string[] = [];
  const skips: Skip[] = [];
  const skip = (where: string, reason: string): void => void skips.push({ scenario: doc.scenario, where, reason });
  const expected = (isRec(doc.then['steps']) ? doc.then['steps'] : {}) as Record<string, Rec>;
  /** A compile step needs no world: the project may be meant to fail merging, so no world builds. */
  const compileStep = (step: Rec): void => {
    const id = String(step['id']);
    const want = expected[id] ?? {};
    for (const key of Object.keys(want)) {
      if (!(key in (RESULT_KEYS['compile'] ?? {}))) failures.push(`${id}: unclassified result key "${key}" for step kind compile`);
    }
    failures.push(...runCompileStep(doc, step, want));
  };
  let world: ScenarioWorld | undefined;
  try {
    world = buildWorld(doc, make);
  } catch (e) {
    if (!onlyCompile(doc)) throw e;
    for (const st of doc.when) compileStep(st);
    return { scenario: doc.scenario, failures, skips, stepsRun: doc.when.length, stepsTotal: doc.when.length, namedSkips: [] };
  }
  const w = world;
  const done = new Map<string, StepOutcome>();
  let stateKnown = true;
  /** Feature aliases whose state a named skip made unknowable; only mismatches about these are skipped. */
  const tainted = new Set<string>();
  let taintIssue = '';
  const givenVersion = (doc.given['config_version'] as number | undefined) ?? 1;
  const hits = new Set<string>();
  let stepsRun = 0;

  /** The named skip that covers a problem at `at` (a step id or `then`), if any. */
  const named = (at: string, message?: string): KnownSkip | undefined => {
    const k = known.find((x) => x.at?.includes(`${doc.scenario}/${at}`) || (message !== undefined && x.refusal?.test(message)));
    if (k) hits.add(hitKey(k, k.at?.includes(`${doc.scenario}/${at}`) ? `${doc.scenario}/${at}` : undefined));
    return k;
  };

  const aliasesOf = (step: Rec, want: Rec | undefined): string[] => {
    const items = Array.isArray(step['runs']) ? (step['runs'] as Rec[]) : [step];
    const own = items.flatMap((i) => [i['feature'], i['creates']]);
    const obs = ((want?.['observations'] as Rec[] | undefined) ?? []).map((o) => o['feature']);
    return [...own, ...obs].filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^\$new:/, ''));
  };
  const touchesTaint = (aliases: readonly string[]): boolean => aliases.some((a) => tainted.has(a));

  for (const [key, why] of Object.entries(doc.given)) {
    if (key === 'history') skip('given.history', 'seeded history is not modelled by the fake store');
  }

  for (const step of doc.when) {
    const id = String(step['id']);
    const kind = String(step['kind']);
    if (!(EXECUTED_KINDS as readonly string[]).includes(kind)) {
      const reason = SKIPPED_KINDS[kind];
      if (reason === undefined) failures.push(`${id}: unclassified step kind "${kind}"`);
      else skip(id, `step kind ${kind}: ${reason}`);
      if (STATE_CHANGING_KINDS.has(kind)) stateKnown = false;
      continue;
    }
    if (kind === 'compile') {
      compileStep(step);
      stepsRun++;
      continue;
    }
    if (step['dry_run'] === true) {
      skip(id, 'dry_run is not offered by SimServer (plan without applying is a server endpoint concern)');
      stateKnown = false;
      continue;
    }
    if (typeof step['config_version'] === 'number' && step['config_version'] !== givenVersion) {
      skip(id, `run recorded against config version ${String(step['config_version'])}: the fake server holds one config version (versions and review are WP-104)`);
      stateKnown = false;
      continue;
    }
    const got = execute(w, step, done);
    if (got.outcome !== 'refused') failures.push(...bindRuleCreated(w, expected[id] ?? {}, got).map((m) => `${id}: ${m}`));
    done.set(id, got);
    stepsRun++;
    const problems = check(w, id, expected[id] ?? {}, got, done);
    if (problems.length > 0) {
      const aliases = aliasesOf(step, expected[id]);
      const k = named(id, got.message);
      if (k || touchesTaint(aliases)) {
        skip(id, k ? `${k.issue}: ${k.reason}` : `${taintIssue}: concerns a feature whose state a skipped step made unknown`);
        if (k) taintIssue = k.issue;
        for (const a of aliases) tainted.add(a);
      } else failures.push(...problems);
    }
    for (const key of Object.keys(expected[id] ?? {})) {
      const why = RESULT_KEYS[kind]?.[key];
      if (typeof why === 'string') skip(`${id}.${key}`, why);
    }
  }
  for (const id of Object.keys(expected)) {
    if (!doc.when.some((s) => s['id'] === id)) failures.push(`${id}: expected result for a step that does not exist`);
  }
  for (const [key, want] of Object.entries(doc.then)) {
    const rule = THEN_KEYS[key];
    if (rule === undefined) failures.push(`then.${key}: unclassified expectation key`);
    else if (rule !== true) skip(`then.${key}`, rule);
    else if (key === 'features' && unclassifiedFeatureKeys(want).length > 0) {
      failures.push(`then.features: unclassified keys ${unclassifiedFeatureKeys(want).join(', ')}`);
    } else if (key !== 'steps') {
      if (key === 'features') for (const f of skippedFeatureKeys(want)) skip(`then.features.${f.key}`, f.reason);
      if (!stateKnown && tainted.size === 0) {
        skip(`then.${key}`, 'a skipped step changes state, so the final state cannot be asserted');
        continue;
      }
      for (const p of checkState(w, key, want)) {
        const k = named('then');
        if (k) skip(`then.${key}`, `${k.issue}: ${k.reason}`);
        else if (p.aliases.length > 0 ? touchesTaint(p.aliases) : tainted.size > 0) {
          skip(`then.${key}`, `${taintIssue}: concerns a feature whose state a skipped step made unknown`);
        } else failures.push(p.message);
      }
    }
  }
  return { scenario: doc.scenario, failures, skips, stepsRun, stepsTotal: doc.when.length, namedSkips: [...hits] };
}

export function runAll(): ScenarioResult[] {
  return scenarioPaths().map((p) => runScenario(loadScenario(p)));
}
