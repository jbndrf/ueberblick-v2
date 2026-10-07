/** The run store as a `ScenarioServer`: the golden runner (fixtures/golden/runner) drives it like the simulated server. */
import type { Actor, AutoId, FeatureId, Json, RecordedObservation, RunId } from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import {
  SIM_CONFIG_VERSION,
  type FakeClock,
  type LedgerEntry,
  type ScenarioServer,
  type ScenarioServerFactory,
} from '@ueberblick/core/testing';
import { collectShas } from '../../erasure';
import type { SubmitResult } from './contract';
import { setup, type Ctx } from './testkit';

const entryOf = (r: SubmitResult): LedgerEntry =>
  r.outcome === 'accepted'
    ? { ok: true, firstSeq: r.seq.from, lastSeq: r.seq.to }
    : { ok: false, refusal: r.refusal };

const TABLES = ['observations', 'features', 'edges', 'feature_bbox', 'tombstones'];

function observationsSince(ctx: Ctx, seq: number): RecordedObservation[] {
  return ctx.db
    .prepare<{ seq: number; run_id: string; feature_id: string; property: string; result: string | null }>(
      'SELECT seq, run_id, feature_id, property, result FROM observations WHERE seq > ? ORDER BY seq',
    )
    .all(seq)
    .map((r) => ({
      featureId: r.feature_id as FeatureId,
      property: r.property,
      result: (r.result === null ? null : JSON.parse(r.result)) as Json,
      seq: r.seq,
      runId: r.run_id as RunId,
    }));
}

const db0 = (ctx: Ctx) =>
  ctx.db.prepare(
    "INSERT OR IGNORE INTO blobs (sha256, mime, bytes, created_at) VALUES (?, 'application/octet-stream', 0, 'x')",
  );

export const storeScenarioFactory: ScenarioServerFactory = (
  config,
  _perms,
  clock: FakeClock,
  geo,
  limits,
): ScenarioServer => {
  const rules = new Map<RunId, AutoId>();
  const ctx = setup({
    config,
    clock,
    geo,
    limits,
    hooks: [
      (tx) => {
        for (const p of tx.runs) if (p.rule !== undefined) rules.set(p.run.id, p.rule);
      },
    ],
  });
  // A scenario's file values stand for bytes the device uploaded before the run (WP-604): register them first.
  const hold = db0(ctx);
  // The run's actor is the uploader (WP-757): a run may only name bytes its actor uploaded.
  const owner = ctx.db.prepare(
    "INSERT OR IGNORE INTO blob_uploads (sha256, actor, actor_kind, created_at) VALUES (?, ?, ?, 'x')",
  );
  const uploaded = (batch: readonly { readonly input: Json; readonly actor: Actor }[]): void => {
    for (const run of batch) {
      const shas = new Set<string>();
      collectShas(run.input, shas);
      for (const sha of shas) {
        hold.run(sha);
        owner.run(sha, run.actor.id, run.actor.kind);
      }
    }
  };
  // A scenario's participants are not known to the store (the runner keeps them): every actor of a run and every
  // top-level text value of its input counts as a member, so WP-756's membership check lets the scenarios through.
  const join = ctx.db.prepare("INSERT OR IGNORE INTO participants (id, name, roles) VALUES (?, NULL, '[]')");
  const joined = (batch: readonly { readonly actor: Actor; readonly input: Json }[]): void => {
    for (const run of batch) {
      if (run.actor.kind === 'participant') join.run(run.actor.id);
      for (const v of Object.values(run.input as Record<string, Json>))
        if (typeof v === 'string') join.run(v);
    }
  };
  const count = (sql: string): number => (ctx.db.prepare<{ n: number }>(sql).get() as { n: number }).n;
  return {
    config,
    get head() {
      return count('SELECT coalesce(max(seq), 0) AS n FROM observations');
    },
    submit(batch, atomic, asBatch) {
      uploaded(batch);
      joined(batch);
      if (!(asBatch && atomic))
        return {
          replayed: false,
          results: batch.map((run) => ({ runId: run.id, entry: entryOf(ctx.store.submit(run)) })),
        };
      const r = ctx.store.submitBatch(batch);
      return {
        replayed: false,
        results: batch.map((run, i) => ({
          runId: run.id,
          entry:
            r.outcome === 'accepted'
              ? entryOf(r.results[i] as SubmitResult)
              : i === r.index
                ? { ok: false, refusal: r.refusal }
                : {
                    ok: false,
                    refusal: {
                      code: 'batch_failed',
                      message: `run ${r.runId} of the batch was refused: ${r.refusal.code}`,
                    },
                  },
        })),
      };
    },
    seed(fill) {
      const scratch = new MemoryStore(config, clock, ctx.deps.geo, SIM_CONFIG_VERSION);
      fill(scratch);
      ctx.seedObservations(scratch.log);
    },
    observationsSince: (seq) => observationsSince(ctx, seq),
    snapshot: () => JSON.stringify(TABLES.map((t) => ctx.db.prepare(`SELECT * FROM ${t}`).all())),
    feature: (id) => ctx.store.facts.feature(id),
    edgesFrom: (id) => ctx.store.facts.edgesFrom(id),
    ledgerOkCount: () =>
      count("SELECT count(*) AS n FROM runs WHERE outcome = 'accepted' AND actor_kind != 'import'"),
    ruleOf: (runId) => rules.get(runId),
  };
};
