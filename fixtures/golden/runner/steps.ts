/** Executing `run`, `batch`, `replay` and `replay_refused` steps against the simulation server, and checking their results. */
import type { FeatureId, Key, RecordedObservation, Run, RunId } from '../../../packages/core/src/model';
import type { LedgerEntry } from '../../../packages/core/src/testing';
import { createIds } from '../../../packages/core/src/testing';
import { isChecked, RESULT_KEYS } from './classify';
import { isRec, matches, withIds, type Rec } from './match';
import type { ScenarioWorld } from './world';

export interface ItemOutcome {
  readonly ok: boolean;
  readonly code?: string;
}

/** What a step did, for later steps (`replay`) and for the expectations. */
export interface StepOutcome {
  readonly kind: string;
  readonly runs: readonly Run[];
  readonly entries: readonly LedgerEntry[];
  readonly items: readonly ItemOutcome[];
  readonly outcome: 'accepted' | 'refused' | 'partial';
  readonly refusal?: string;
  readonly observations: readonly RecordedObservation[];
  readonly traceLeft: boolean;
  /** The first refusal message, to make a failing scenario readable. */
  readonly message?: string;
}

const runIds = createIds(1);
const trace = (w: ScenarioWorld): string => JSON.stringify([w.server.head, w.server.snapshot()]);

function buildRun(w: ScenarioWorld, s: Rec): Run {
  const feature = typeof s['feature'] === 'string' ? w.aliases.id(s['feature']) : undefined;
  return {
    id: ((s['run_id'] as string | undefined) ?? runIds.runId()) as RunId,
    task: s['task'] as Key,
    actor: w.actor(s['actor']),
    configVersion: (s['config_version'] as number | undefined) ?? 1,
    input: withIds(s['input'] ?? {}, w.aliases) as Run['input'],
    ...(feature !== undefined ? { featureId: feature } : {}),
    ...(typeof s['auto'] === 'string' ? { auto: s['auto'] as Key } : {}),
  };
}

/** After acceptance, `creates: $new:x` names the feature the run's own `$type` observation made. */
function bindCreated(w: ScenarioWorld, item: Rec, run: Run, obs: readonly RecordedObservation[]): void {
  const alias = item['creates'];
  if (typeof alias !== 'string') return;
  const made = obs.find((o) => o.runId === run.id && o.property === '$type');
  if (!made) return;
  w.aliases.bind(alias, made.featureId as FeatureId);
  // `then.features` names the feature without the `$new:` prefix.
  if (alias.startsWith('$new:')) w.aliases.bind(alias.slice('$new:'.length), made.featureId as FeatureId);
}

export function execute(w: ScenarioWorld, s: Rec, done: ReadonlyMap<string, StepOutcome>): StepOutcome {
  const before = trace(w);
  const head = w.server.head;
  const kind = String(s['kind']);
  let runs: Run[];
  let atomic = true;
  let asBatch = false;
  if (kind === 'batch') {
    runs = (s['runs'] as Rec[]).map((item) => buildRun(w, item));
    atomic = s['atomic'] !== false;
    asBatch = true;
  } else if (kind === 'replay' || kind === 'replay_refused') {
    const first = done.get(String(s['of']))?.runs[0];
    if (!first) throw new Error(`replay of unknown step ${String(s['of'])}`);
    runs = [
      {
        ...first,
        ...(s['input'] !== undefined ? { input: withIds(s['input'], w.aliases) as Run['input'] } : {}),
        ...(s['actor'] !== undefined ? { actor: w.actor(s['actor']) } : {}),
      },
    ];
  } else runs = [buildRun(w, s)];

  const res = w.server.submit(runs, atomic, asBatch);
  const observations = w.server.observationsSince(head);
  const items = res.results.map((r) => ({
    ok: r.entry.ok,
    ...(r.entry.ok ? {} : { code: r.entry.refusal.code }),
  }));
  const okCount = items.filter((i) => i.ok).length;
  const outcome = okCount === items.length ? 'accepted' : okCount === 0 ? 'refused' : 'partial';
  const list = kind === 'batch' ? (s['runs'] as Rec[]) : [s];
  runs.forEach((run, i) => {
    if (items[i]?.ok) bindCreated(w, list[i] ?? s, run, observations);
  });
  const firstRefusal = res.results.flatMap((r) => (r.entry.ok ? [] : [r.entry.refusal.message]))[0];
  const firstBad = items.find((i) => !i.ok && i.code !== 'batch_failed') ?? items.find((i) => !i.ok);
  return {
    kind,
    runs,
    entries: res.results.map((r) => r.entry),
    items,
    outcome,
    ...(firstBad?.code !== undefined ? { refusal: outcome === 'refused' && asBatch ? 'batch_failed' : firstBad.code } : {}),
    observations,
    traceLeft: trace(w) !== before,
    ...(firstRefusal ? { message: firstRefusal } : {}),
  };
}

/** Compare a step's outcome with its expected result; returns failure messages. Unlisted keys fail. */
export function check(w: ScenarioWorld, id: string, expected: Rec, got: StepOutcome, done: ReadonlyMap<string, StepOutcome>): string[] {
  const fail: string[] = [];
  const at = (m: string): void => void fail.push(`${id}: ${m}`);
  for (const [key, want] of Object.entries(expected)) {
    if (!(key in (RESULT_KEYS[got.kind] ?? {}))) at(`unclassified result key "${key}" for step kind ${got.kind}`);
    else if (isChecked(got.kind, key)) checkKey(w, key, want, got, done, at);
  }
  return fail;
}

function checkKey(
  w: ScenarioWorld,
  key: string,
  want: unknown,
  got: StepOutcome,
  done: ReadonlyMap<string, StepOutcome>,
  at: (m: string) => void,
): void {
  const seen = got.observations.map((o) => ({ feature: o.featureId, property: o.property, result: o.result }));
  const same = (e: unknown, o: { feature: string; property: string; result: unknown }): boolean => {
    const r = isRec(e) ? e : {};
    const feature = typeof r['feature'] === 'string' ? w.aliases.id(r['feature']) : undefined;
    return (
      (feature === undefined || feature === o.feature) &&
      r['property'] === o.property &&
      (!('result' in r) ||
        matches(r['result'] === 'identical_to_input' ? got.runs[0]?.input[o.property] : withIds(r['result'], w.aliases), o.result))
    );
  };
  switch (key) {
    case 'outcome':
      if (got.outcome !== want) at(`outcome ${got.outcome}, expected ${String(want)}${got.message ? ` (${got.message})` : ''}`);
      break;
    case 'refusal':
      if (got.refusal !== want) at(`refusal ${String(got.refusal)}, expected ${String(want)}`);
      break;
    case 'observations':
      for (const e of want as unknown[]) if (!seen.some((o) => same(e, o))) at(`missing observation ${JSON.stringify(e)}`);
      break;
    case 'observations_absent':
      for (const e of want as unknown[]) if (seen.some((o) => same(e, o))) at(`observation ${JSON.stringify(e)} must be absent`);
      break;
    case 'no_trace':
      if (want === true && got.traceLeft) at('a refused step left a trace in state or seq');
      break;
    case 'one_transaction':
    case 'same_run_and_seq_range':
    case 'seq_contiguous': {
      const contiguous = got.observations.every((o, i) => i === 0 || o.seq === (got.observations[i - 1]?.seq ?? 0) + 1);
      if (want === true && !contiguous) at('observations do not have a contiguous seq range');
      break;
    }
    case 'failed_item': {
      const i = got.items.findIndex((x) => !x.ok && x.code !== 'batch_failed');
      if (i + 1 !== want) at(`failed item ${i + 1}, expected ${String(want)}`);
      break;
    }
    case 'item_refusal': {
      const code = got.items.find((x) => !x.ok && x.code !== 'batch_failed')?.code;
      if (code !== (want as Rec)['code']) at(`item refusal ${String(code)}, expected ${String((want as Rec)['code'])}`);
      break;
    }
    case 'accepted_items': {
      const ok = got.items.flatMap((x, i) => (x.ok ? [i + 1] : []));
      if (JSON.stringify(ok) !== JSON.stringify(want)) at(`accepted items ${JSON.stringify(ok)}, expected ${JSON.stringify(want)}`);
      break;
    }
    case 'refused_items':
      for (const e of want as Rec[]) {
        const item = got.items[(e['item'] as number) - 1];
        if (item?.ok !== false || item.code !== e['refusal']) at(`item ${String(e['item'])} was not refused with ${String(e['refusal'])}`);
      }
      break;
    case 'runs_accepted':
      if (got.items.filter((x) => x.ok).length !== want) at(`accepted ${got.items.filter((x) => x.ok).length} runs, expected ${String(want)}`);
      break;
    case 'same_result_as': {
      const prior = done.get(String(want))?.entries[0];
      if (JSON.stringify(prior) !== JSON.stringify(got.entries[0])) at(`result differs from step ${String(want)}`);
      break;
    }
    case 'new_observations':
      if (got.observations.length !== want) at(`${got.observations.length} new observations, expected ${String(want)}`);
      break;
    default:
      at(`no assertion implemented for checked key "${key}"`);
  }
}

/**
 * A rule can create a feature the scenario names only in `rule_runs` (`feature: $new:m1`). Bind each such
 * alias to the `$type` observation of a run caused by the entry's `rule` (PlannedRun.rule; the first unused
 * one when a rule ran twice). A `$new:` entry that no run satisfies is a failure, never a shifted alias.
 */
export function bindRuleCreated(w: ScenarioWorld, want: Rec, got: StepOutcome): string[] {
  const submitted = new Set(got.runs.map((r) => r.id));
  const made = got.observations
    .filter((o) => o.property === '$type' && !submitted.has(o.runId))
    .map((o) => ({ featureId: o.featureId, rule: w.server.ruleOf(o.runId), used: false }));
  const problems: string[] = [];
  for (const entry of (want['rule_runs'] as Rec[] | undefined) ?? []) {
    const name = entry['feature'];
    if (typeof name !== 'string' || !name.startsWith('$new:') || w.aliases.has(name)) continue;
    const m = made.find((c) => !c.used && c.rule === entry['rule']);
    if (!m) {
      problems.push(`rule_runs: rule ${String(entry['rule'])} created no run that created ${name}`);
      continue;
    }
    m.used = true;
    w.aliases.bind(name, m.featureId as FeatureId);
    w.aliases.bind(name.slice('$new:'.length), m.featureId as FeatureId);
  }
  return problems;
}
