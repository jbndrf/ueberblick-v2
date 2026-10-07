/**
 * The simulated server: authoritative, assigns seq, keeps the ledger (F3, F12). It runs the same
 * core.plan a device does and stores what plan accepts; nothing else decides (R1, R3).
 */
import { formApi } from '../form';
import type { Geo } from '../geo/contract';
import type { Refusal, RecordedObservation, Run, RunId, Seq } from '../model';
import type { Perms } from '../perms/contract';
import { createPlan } from '../plan';
import type { ConfigFor, PlanApi, PlanLimits, PlanPorts } from '../plan';
import type { RedactPair } from '../plan/redact';
import type { CompiledConfig } from '../schema/compile/contract';
import type { AutoId } from '../schema/compile/autos';
import type { LedgerEntry, SubmitResult } from './contract';
import type { FakeClock } from './ids';
import { SIM_CONFIG_VERSION } from './ids';
import { MemoryStore } from '../memory';
import { bindingFieldsOf, sameRunBinding } from '../plan/binding';

export interface AcceptedRun {
  readonly run: Run;
  /** The rule that caused the run; absent for submitted runs. */
  readonly rule?: AutoId;
  readonly observationCount: number;
  readonly firstSeq: Seq;
  readonly lastSeq: Seq;
}

export class SimServer {
  readonly store: MemoryStore;
  readonly ledger = new Map<RunId, LedgerEntry>();
  /** Runs the server applied, in application order. Refused runs never appear here. */
  readonly accepted = new Map<RunId, AcceptedRun>();
  /** Erasure runs the server applied: the pairs it purged in place (B-005), for tests. */
  readonly erasures: {
    run: RunId;
    subjects: readonly string[];
    purge: readonly RedactPair[];
    lastSeq: Seq;
  }[] = [];
  /** The runs submitted under each id, to bind a replay to its actor and payload (WP-754). */
  private readonly submitted = new Map<RunId, Run>();
  private readonly api: PlanApi = createPlan(formApi);
  private readonly ports: PlanPorts;
  /** The one version the simulated server holds (A-029: the `…For` forms with a resolver, not the one-version adapter). */
  private readonly configFor: ConfigFor;

  constructor(
    readonly config: CompiledConfig,
    private readonly perms: Perms,
    readonly clock: FakeClock,
    geo: Geo,
    limits: PlanLimits,
  ) {
    this.store = new MemoryStore(config, clock, geo, SIM_CONFIG_VERSION);
    const resolved = { config, perms, version: SIM_CONFIG_VERSION };
    this.configFor = () => resolved;
    this.ports = { clock, facts: this.store, geo, limits };
  }

  get head(): Seq {
    return this.store.head;
  }

  /** Observations with seq > since, at most `limit`; the pull (a doorbell is only a hint, data comes from here). */
  pull(since: Seq, limit: number): { observations: readonly RecordedObservation[]; head: Seq; upTo: Seq } {
    const log = this.store.log;
    const start = log.findIndex((o) => o.seq > since);
    if (start < 0) return { observations: [], head: this.head, upTo: since };
    // Never split a run across pages: a device applies whole runs only.
    let end = Math.min(log.length, start + Math.max(1, limit));
    while (end < log.length && log[end]?.runId === log[end - 1]?.runId) end++;
    const observations = log.slice(start, end);
    return { observations, head: this.head, upTo: observations[observations.length - 1]?.seq ?? since };
  }

  /**
   * One request: a single run, or a batch. `atomic` means one refusal refuses all (H2). Runs whose id is
   * in the ledger are answered from it and never applied twice, but only for the same actor and payload;
   * any other run under a held id refuses the request with `id_taken` and leaves no trace (like the run store).
   */
  submit(batch: readonly Run[], atomic = true, asBatch = batch.length > 1): SubmitResult {
    const foreign = batch.find((r) => this.ledger.has(r.id) && !this.bindsToHeld(r));
    if (foreign !== undefined) {
      const taken: Refusal = { code: 'id_taken', message: `the run id '${foreign.id}' already exists` };
      return {
        replayed: false,
        results: batch.map((r) => ({
          runId: r.id,
          entry: {
            ok: false,
            refusal:
              r === foreign
                ? taken
                : { code: 'batch_failed', message: `run ${foreign.id} of the batch was refused: id_taken` },
          },
        })),
      };
    }
    const known = batch.filter((r) => this.ledger.has(r.id));
    const fresh = batch.filter((r) => !this.ledger.has(r.id));
    if (fresh.length === 0) {
      return {
        replayed: true,
        results: known.map((r) => ({ runId: r.id, entry: this.ledger.get(r.id) as LedgerEntry })),
      };
    }
    for (const r of fresh) this.submitted.set(r.id, r);
    if (atomic) this.applyGroup(fresh, asBatch);
    else for (const r of fresh) this.applyGroup([r], false);
    return {
      replayed: false,
      results: batch.map((r) => ({ runId: r.id, entry: this.ledger.get(r.id) as LedgerEntry })),
    };
  }

  /** Whether `run` is the same request as the one stored under its id; a rule run's id binds to nobody. */
  private bindsToHeld(run: Run): boolean {
    const held = this.submitted.get(run.id);
    return held !== undefined && sameRunBinding(bindingFieldsOf(held), bindingFieldsOf(run));
  }

  private applyGroup(runs: readonly Run[], asBatch: boolean): void {
    const r = this.api.planFor(runs, this.configFor, this.ports);
    if (!r.ok) {
      for (const run of runs) {
        const refusal: Refusal =
          run.id === r.runId
            ? r.refusal
            : { code: 'batch_failed', message: `run ${r.runId} of the batch was refused: ${r.refusal.code}` };
        this.ledger.set(run.id, { ok: false, refusal: asBatch || run.id === r.runId ? refusal : r.refusal });
      }
      return;
    }
    for (const p of r.runs) {
      const { firstSeq, lastSeq } = this.store.append(p.run.id, p.observations, p.run.actor.id);
      if (p.purge.length > 0) {
        this.store.purge(p.purge);
        this.erasures.push({
          run: p.run.id,
          subjects: p.erased.map((e) => e.subject),
          purge: p.purge,
          lastSeq,
        });
      }
      this.ledger.set(p.run.id, { ok: true, firstSeq, lastSeq });
      this.accepted.set(p.run.id, {
        run: p.run,
        ...(p.rule !== undefined ? { rule: p.rule } : {}),
        observationCount: p.observations.length,
        firstSeq,
        lastSeq,
      });
    }
  }

  /** Seed data as imports: observations of actor kind `import`, no task, before any device syncs. */
  seed(fill: (store: MemoryStore) => void): void {
    fill(this.store);
  }
}
