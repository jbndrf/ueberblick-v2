/**
 * A simulated device: a confirmed replica (what the server told it), a run queue, and a predicted view
 * (confirmed plus the queued runs, planned by the same core.plan). docs/07 "Run queue (device)".
 */
import { formApi } from '../form';
import { createGeo } from '../geo';
import type { Geo } from '../geo/contract';
import type { Actor, RecordedObservation, Refusal, Run, RunId, Seq } from '../model';
import type { Perms } from '../perms/contract';
import { createPlan, oneVersion, PLAN_MAX_RULE_DEPTH } from '../plan';
import type { PlanApi, PlanPorts } from '../plan';
import type { CompiledConfig } from '../schema/compile/contract';
import type { LedgerEntry, RefusedRun, RunDraft } from './contract';
import type { FakeClock } from './ids';
import { SIM_CONFIG_VERSION, createIds } from './ids';
import { MemoryStore } from '../memory';

/** device -> server */
export type Request =
  | { readonly kind: 'submit'; readonly device: number; readonly run: Run }
  | { readonly kind: 'pull'; readonly device: number; readonly since: Seq };
/** server -> device */
export type Response =
  | {
      readonly kind: 'submitted';
      readonly device: number;
      readonly runId: RunId;
      readonly entry: LedgerEntry;
    }
  | {
      readonly kind: 'page';
      readonly device: number;
      readonly since: Seq;
      readonly upTo: Seq;
      readonly observations: readonly RecordedObservation[];
    };

interface Queued {
  readonly run: Run;
  /** Set when the server accepted it; dropped from the queue once the pull has reached this seq. */
  acceptedSeq?: Seq;
}

/** Ticks before an unanswered request is sent again. */
const RETRY_AFTER = 6;
export const PULL_PAGE = 40;

export class SimDevice {
  readonly refused: RefusedRun[] = [];
  queue: Queued[] = [];
  online = true;
  predicted: MemoryStore;
  private confirmed: MemoryStore;
  private submitSentAt: { id: RunId; tick: number } | undefined;
  private pullSentAt: number | undefined;
  private readonly api: PlanApi = createPlan(formApi);
  private readonly ids;

  constructor(
    readonly index: number,
    readonly actor: Actor,
    private readonly config: CompiledConfig,
    private readonly perms: Perms,
    private readonly clock: FakeClock,
    private readonly geo: Geo = createGeo(),
    /** Simulated flag: the server head this device seeded from (devices start with a copy of the seed). */
    start?: MemoryStore,
  ) {
    this.confirmed = start ? start.clone() : new MemoryStore(config, clock, geo, SIM_CONFIG_VERSION);
    this.predicted = this.confirmed.clone();
    this.ids = createIds(index + 1);
  }

  get head(): Seq {
    return this.confirmed.head;
  }

  get store(): MemoryStore {
    return this.confirmed;
  }

  private ports(facts: MemoryStore): PlanPorts {
    return {
      clock: this.clock,
      facts,
      geo: this.geo,
      limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
    };
  }

  /** The user starts a run. It is planned against the predicted view; a refusal stays visible as a draft. */
  create(draft: RunDraft): Run {
    const run: Run = {
      ...draft,
      id: this.ids.runId(),
      configVersion: SIM_CONFIG_VERSION,
      clientTime: this.clock.now(),
    };
    const r = this.api.planFor([run], oneVersion(this.config, this.perms), this.ports(this.predicted));
    if (!r.ok) {
      this.refused.push({ run, refusal: r.refusal, where: 'device' });
      return run;
    }
    this.queue.push({ run });
    for (const p of r.runs) this.predicted.append(p.run.id, p.observations, p.run.actor.id);
    return run;
  }

  /** Restart: in-flight bookkeeping is lost, the store and queue are persistent. */
  restart(): void {
    this.submitSentAt = undefined;
    this.pullSentAt = undefined;
    this.rebuild(false);
  }

  /** Requests this device wants to send now (sequential submit, periodic pull). */
  tick(tick: number): Request[] {
    if (!this.online) return [];
    const out: Request[] = [];
    const head = this.queue.find((q) => q.acceptedSeq === undefined);
    if (head && (this.submitSentAt === undefined || tick - this.submitSentAt.tick >= RETRY_AFTER)) {
      this.submitSentAt = { id: head.run.id, tick };
      out.push({ kind: 'submit', device: this.index, run: head.run });
    }
    if (this.pullSentAt === undefined || tick - this.pullSentAt >= RETRY_AFTER) {
      this.pullSentAt = tick;
      out.push({ kind: 'pull', device: this.index, since: this.confirmed.head });
    }
    return out;
  }

  receive(msg: Response): void {
    if (!this.online) return;
    if (msg.kind === 'submitted') this.onSubmitted(msg.runId, msg.entry);
    else this.onPage(msg);
  }

  private onSubmitted(runId: RunId, entry: LedgerEntry): void {
    const q = this.queue.find((x) => x.run.id === runId);
    if (!q || q.acceptedSeq !== undefined) return; // a duplicate answer
    if (this.submitSentAt?.id === runId) this.submitSentAt = undefined;
    if (entry.ok) {
      q.acceptedSeq = entry.lastSeq;
      this.pullSentAt = undefined; // fetch the result soon
      // The answer may arrive after the page that already carried the run (a delayed accept).
      this.dropConfirmed();
      return;
    }
    this.queue = this.queue.filter((x) => x !== q);
    this.refused.push({ run: q.run, refusal: entry.refusal, where: 'server' });
    this.rebuild(true);
  }

  private onPage(msg: Extract<Response, { kind: 'page' }>): void {
    if (msg.since !== this.confirmed.head) return; // stale, duplicated or reordered: the next pull asks again
    this.pullSentAt = undefined;
    if (msg.observations.length === 0) return;
    this.confirmed.applyRecorded(msg.observations);
    this.dropConfirmed();
  }

  /** Accepted runs whose observations the confirmed replica already holds leave the queue. */
  private dropConfirmed(): void {
    this.queue = this.queue.filter((q) => q.acceptedSeq === undefined || q.acceptedSeq > this.confirmed.head);
    this.rebuild(false);
  }

  /**
   * Predicted = confirmed + the queued runs, each re-planned. After a refusal, queued runs that now fail
   * are refused too; after a pull they stay queued and the server decides (never drop an unsent run silently).
   */
  private rebuild(refuseFailing: boolean): void {
    const view = this.confirmed.clone();
    const kept: Queued[] = [];
    for (const q of this.queue) {
      const r = this.api.planFor([q.run], oneVersion(this.config, this.perms), this.ports(view));
      if (r.ok) {
        for (const p of r.runs) view.append(p.run.id, p.observations, p.run.actor.id);
        kept.push(q);
      } else if (refuseFailing && q.acceptedSeq === undefined && this.submitSentAt?.id !== q.run.id) {
        this.refused.push({ run: q.run, refusal: r.refusal as Refusal, where: 'device' });
      } else kept.push(q);
    }
    this.queue = kept;
    this.predicted = view;
  }
}
