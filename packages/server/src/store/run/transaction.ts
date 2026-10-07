/** The run transaction (docs/03 "life of a run"): ledger, plan, append, fold, edges, hooks, seq. See contract.ts. */
import {
  clampClientTime,
  resultTimeOf,
  createPlan,
  type CompiledConfig,
  type PlannedRun,
  type RecordedObservation,
  type Refusal,
  type Run,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { memberCheck } from './members';
import { createErasure } from '../../erasure';
import { deployedVersion } from '../../deploy/versions';
import { createFacts } from '../facts';
import { createConfigResolver } from './config-for';
import {
  HookFailed,
  NoDeployedVersion,
  type AcceptedResult,
  type BatchResult,
  type SeqRange,
  type Store,
  type StoreDeps,
  type SubmitResult,
} from './contract';
import { createBlobRefs } from './blob-refs';
import { createBlobAccess } from '../../http/blobs/access';
import { createLedger } from './ledger';
import { createProjector } from './projection';
import { inverseRelations } from './inverse';
import { logBatch, type Fresh } from './log';

const invalid = (message: string): Refusal => ({ code: 'invalid_input', message });

export function createStore(db: Db, deps: StoreDeps): Store {
  const facts = createFacts(db, new Map());
  const ledger = createLedger(db);
  const projector = createProjector(db, deps, facts);
  const planApi = createPlan(deps.form);
  // A-029 (WP-315): every feature is planned and folded under its own version; the cache holds the live ones.
  const versions = createConfigResolver(db, deps.versions);
  const blobRefs = createBlobRefs(
    db,
    createBlobAccess({ db, clock: deps.clock, deployed: () => deployedVersion(db)?.version, versions }),
  );
  const erasure = deps.erasure ?? createErasure(db);
  const isParticipant = memberCheck(db);
  const head = db.prepare<{ seq: number }>(
    `SELECT max(coalesce((SELECT max(seq) FROM observations), 0), coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq`,
  );
  const insertObservation = db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time, result_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  /** The ledger rows of a refused batch: the failing run with its refusal, the others as `batch_failed`. */
  function reject(
    runs: readonly Run[],
    fresh: readonly number[],
    failed: number,
    refusal: Refusal,
  ): BatchResult {
    const receivedAt = deps.clock.now();
    const culprit = runs[failed] as Run;
    for (const i of fresh) {
      const run = runs[i] as Run;
      ledger.insert({
        run,
        receivedAt,
        result: {
          refusal:
            i === failed
              ? refusal
              : {
                  code: 'batch_failed',
                  message: `run ${culprit.id} of the batch was refused: ${refusal.code}`,
                },
        },
      });
    }
    return { outcome: 'refused', index: failed, runId: culprit.id, refusal };
  }

  function accept(
    runs: readonly Run[],
    stored: readonly (SubmitResult | undefined)[],
    fresh: readonly number[],
    deployed: number,
    planned: readonly PlannedRun[],
    orphans: string[],
  ): BatchResult {
    const receivedAt = deps.clock.now();
    const base = (head.get() as { seq: number }).seq;
    let seq = base;
    const submitted = new Set<string>(fresh.map((i) => (runs[i] as Run).id));
    const recorded: RecordedObservation[] = [];
    /** Per planned run: its own observations; per submitted run: the group of it and the rule runs it caused. */
    const own: { readonly range: SeqRange; readonly last: number | undefined }[] = [];
    const groups = new Map<string, { from: number; to: number; at: number }>();
    let group: { from: number; to: number; at: number } | undefined;
    for (const p of planned) {
      const from = seq + 1;
      const at = recorded.length;
      // The one place that stamps the `resultTime` (R1): the receive time, or an import's historical time (WP-794).
      const resultTime = resultTimeOf(p.run, receivedAt);
      for (const o of p.observations) recorded.push({ ...o, resultTime, seq: ++seq, runId: p.run.id });
      own.push({ range: { from, to: seq }, last: seq >= from ? seq : undefined });
      if (submitted.has(p.run.id)) {
        group = { from, to: seq, at };
        groups.set(p.run.id, group);
      } else if (group !== undefined) group.to = seq;
    }

    planned.forEach((p, i) => {
      const o = own[i] as (typeof own)[number];
      const g = groups.get(p.run.id);
      ledger.insert({
        run: p.run,
        receivedAt,
        ...(p.run.causedBy !== undefined ? { causedBy: p.run.causedBy } : {}),
        ...(o.last !== undefined ? { seq: o.last } : {}),
        ...(p.observations[0] !== undefined ? { featureId: p.observations[0].featureId } : {}),
        result: { seq: g ? { from: g.from, to: g.to } : o.range },
      });
    });
    for (const o of recorded)
      insertObservation.run(
        o.seq,
        o.runId,
        o.featureId,
        o.property,
        JSON.stringify(o.result),
        o.phenomenonTime ?? null,
        o.resultTime ?? null,
      );

    const config = versions.at(deployed).config;
    const features = projector.project({ deployed, config: (v) => versions.at(v).config }, recorded, seq);
    blobRefs.record(recorded);
    purge(planned, receivedAt, orphans);
    const range: SeqRange = { from: base + 1, to: seq };
    for (const hook of deps.hooks ?? []) {
      try {
        hook({ db, config, seq: range, runs: planned, features });
      } catch (e) {
        throw isBusy(e) ? e : new HookFailed(hook.hookName ?? 'unnamed', e); // rolls the run back, named (WP-860)
      }
    }

    const results = runs.map((run, i): AcceptedResult => {
      const s = stored[i];
      if (s !== undefined) return s as AcceptedResult;
      const g = groups.get(run.id) as { from: number; to: number; at: number };
      const count = g.to - g.from + 1;
      return {
        outcome: 'accepted',
        runId: run.id,
        seq: { from: g.from, to: g.to },
        observations: recorded.slice(g.at, g.at + Math.max(0, count)),
      };
    });
    return { outcome: 'accepted', results, seq: range };
  }

  /**
   * The guarded purge of every planned run with a `redact` step (A-021), inside the run transaction and after the
   * fold: it sees the run rows and the appended nulls. One call per `erased` entry (one per redact step), each with its
   * own pairs; `erase` always records the subject's `erased_at`, even when nothing is left to blank.
   */
  function purge(planned: readonly PlannedRun[], at: string, orphans: string[]): void {
    for (const p of planned) {
      if (p.purge.length === 0) continue;
      for (const e of p.erased)
        orphans.push(
          ...erasure.erase({ subject: e.subject, purge: e.purge, erasureRun: p.run.id, at }).orphanedBlobs,
        );
    }
  }

  /** The first planned run (submitted or rule-caused) whose id the ledger or an earlier run of this plan already holds. */
  function takenRuleRun(planned: readonly PlannedRun[]): { root: string; refusal: Refusal } | undefined {
    const parent = new Map<string, string | undefined>(planned.map((p) => [p.run.id, p.run.causedBy]));
    const seen = new Set<string>();
    for (const p of planned) {
      const dup = seen.has(p.run.id);
      seen.add(p.run.id);
      // a submitted run is fresh here (its id passed `binding`): only a clash with an earlier planned run counts
      const held = dup || (p.run.causedBy !== undefined && ledger.find(p.run.id) !== undefined);
      if (!held) continue;
      let root: string = p.run.causedBy ?? p.run.id;
      for (let up = parent.get(root); up !== undefined; up = parent.get(root)) root = up;
      return {
        root,
        refusal: {
          code: 'id_taken',
          message: `the run id '${p.run.id}' already exists`,
        },
      };
    }
    return undefined;
  }

  function execute(runs: readonly Run[], orphans: string[], logged: Fresh): BatchResult {
    // A run id answers only the actor and payload that stored it (WP-754): never hand out another's result.
    const foreign = runs.findIndex((r) => ledger.binding(r) === 'foreign');
    if (foreign >= 0) {
      const run = runs[foreign] as Run;
      logged.runs = [run];
      return {
        outcome: 'refused',
        index: foreign,
        runId: run.id,
        refusal: { code: 'id_taken', message: `the run id '${run.id}' already exists` },
      };
    }
    const stored = runs.map((r) => ledger.find(r.id));
    const refused = stored.flatMap((s, index) => (s?.outcome === 'refused' ? [{ index, s }] : []));
    if (refused.length > 0) {
      const root = refused.find((r) => r.s.refusal.code !== 'batch_failed') ?? refused[0];
      const { index, s } = root as (typeof refused)[number];
      return { outcome: 'refused', index, runId: s.runId, refusal: s.refusal };
    }
    const fresh = stored.flatMap((s, i) => (s === undefined ? [i] : []));
    if (fresh.length === 0) {
      const done = stored as AcceptedResult[];
      const nonEmpty = done.filter((r) => r.seq.to >= r.seq.from);
      const h = (head.get() as { seq: number }).seq;
      return {
        outcome: 'accepted',
        results: done,
        seq: nonEmpty.length
          ? {
              from: Math.min(...nonEmpty.map((r) => r.seq.from)),
              to: Math.max(...nonEmpty.map((r) => r.seq.to)),
            }
          : { from: h + 1, to: h },
      };
    }

    logged.runs = fresh.map((i) => runs[i] as Run);
    const first = runs[fresh[0] as number] as Run;
    versions.at(first.configVersion); // a version this server no longer holds throws ConfigVersionGone
    // Floating features and creates take the deployed version; a database with none refuses, it does not default.
    const deployed = deployedVersion(db)?.version;
    if (deployed === undefined) throw new NoDeployedVersion();
    const ids = new Set<string>();
    for (const i of fresh) {
      const run = runs[i] as Run;
      const problem = ids.has(run.id)
        ? `run id ${run.id} occurs twice in the batch`
        : run.causedBy !== undefined
          ? 'a submitted run cannot be caused by a rule'
          : run.configVersion !== first.configVersion
            ? 'the runs of a batch share one config version'
            : undefined;
      // A malformed request is not a run's fault: it is answered, and nothing is written (no ledger row).
      if (problem !== undefined) {
        logged.runs = [run]; // no ledger row for the others: only the malformed run is reported
        return { outcome: 'refused', index: i, runId: run.id, refusal: invalid(problem) };
      }
      ids.add(run.id);
    }

    const result = planApi.planFor(
      fresh.map((i) => runs[i] as Run),
      versions.configFor(deployed),
      { clock: deps.clock, facts, geo: deps.geo, limits: deps.limits, isParticipant },
    );
    if (!result.ok)
      return reject(
        runs,
        fresh,
        runs.findIndex((r) => r.id === result.runId),
        result.refusal,
      );
    // A rule run's id is minted by the plan (`seededIds`): when the ledger already holds it, the primary key would
    // roll the whole batch back untyped. Answer it as `id_taken` for the submitted run that caused it (WP-750).
    const taken = takenRuleRun(result.runs);
    if (taken !== undefined) {
      const at = runs.findIndex((r) => r.id === taken.root);
      return reject(runs, fresh, at < 0 ? (fresh[0] as number) : at, taken.refusal);
    }
    // A run never points at bytes the server does not have: refuse before anything but the ledger is written.
    const lost = blobRefs.missing(result.runs);
    if (lost !== undefined) {
      const at = runs.findIndex((r) => r.id === lost.runId);
      return reject(runs, fresh, at < 0 ? (fresh[0] as number) : at, lost.refusal);
    }
    return accept(runs, stored, fresh, deployed, result.runs, orphans);
  }

  /**
   * The one intake of every run (R3): a run that arrives without a client time gets the server's time, so the audit
   * times (`createdAt`, `changedAt`) are always set (WP-724, R4). A participant run's client time is clamped to
   * `[now - AUDIT_MAX_OFFLINE_AGE, now + AUDIT_CLOCK_SKEW]` (WP-762): a client cannot forge a created or changed time,
   * offline work still arrives late with its own past time. Admin, import and system runs are trusted and keep their
   * time (imports and the v3 migration carry historical created times). The ledger's `client_time` is the stamped time.
   */
  const stamped = (runs: readonly Run[]): readonly Run[] => {
    const now = deps.clock.now();
    return runs.map((r) => ({
      ...r,
      clientTime:
        r.clientTime === undefined
          ? now
          : r.actor.kind === 'participant'
            ? clampClientTime(r.clientTime, now)
            : r.clientTime,
    }));
  };

  const afterCommit = (hook: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      try {
        deps.log.log('run.hook_failed', { hook, code: errorKind(e) });
      } catch {
        /* the log itself is what failed; the committed result is still returned */
      }
    }
  };

  /** ONE transaction; only after its commit may erased blob bytes go (a crash before is finished by the blob sweeper). */
  const submitBatch = (submitted: readonly Run[]): BatchResult => {
    const runs = stamped(submitted);
    const orphans: string[] = [];
    const t0 = performance.now();
    const logged: Fresh = { runs: [] };
    const result = db.transaction(() => execute(runs, orphans, logged));
    // After the commit the run is accepted whatever these do: a failing hook is named in the log, never rethrown (WP-842).
    afterCommit('orphans', () => {
      if (orphans.length > 0) deps.onOrphanedBlobs?.(orphans);
    });
    afterCommit('log', () => logBatch(deps.log, logged, result, performance.now() - t0)); // from the outcome only
    return result;
  };

  const accessCache = new WeakMap<CompiledConfig, ReturnType<typeof createFacts>>();
  return {
    facts,
    access(version) {
      const config = deps.config(version);
      if (config === undefined) return undefined;
      let a = accessCache.get(config);
      if (a === undefined) accessCache.set(config, (a = createFacts(db, inverseRelations(config))));
      return a;
    },
    submit(run): SubmitResult {
      const r = submitBatch([run]);
      return r.outcome === 'accepted'
        ? (r.results[0] as AcceptedResult)
        : { outcome: 'refused', runId: r.runId, refusal: r.refusal };
    },
    submitBatch,
  };
}

/** better-sqlite3 names a locked database `SQLITE_BUSY` or `SQLITE_LOCKED` (also with a suffix, e.g. `_SNAPSHOT`). */
export const isBusy = (e: unknown): boolean => {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(code);
};

/** A short machine code for the log: the driver's code when the error has one, else its name; never the message. */
export const errorKind = (e: unknown): string => {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string') return code;
  return e instanceof Error ? e.name : 'threw';
};
