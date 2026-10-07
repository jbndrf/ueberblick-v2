/** A lossy, duplicating, reordering network on simulated ticks. Faults come from the seeded Rng only. */
import type { NetworkFaults, Rng } from './contract';

interface InFlight<M> {
  readonly at: number;
  readonly order: number;
  readonly msg: M;
}

export class SimNetwork<M> {
  private flight: InFlight<M>[] = [];
  private order = 0;

  constructor(
    private readonly rng: Rng,
    public faults: NetworkFaults,
  ) {}

  get pending(): number {
    return this.flight.length;
  }

  send(msg: M, tick: number): void {
    if (this.rng.chance(this.faults.drop)) return;
    this.enqueue(msg, tick);
    if (this.rng.chance(this.faults.duplicate)) this.enqueue(msg, tick);
  }

  /** Messages due at or before `tick`, in delivery order. */
  deliver(tick: number): M[] {
    const due = this.flight.filter((f) => f.at <= tick).sort((a, b) => a.at - b.at || a.order - b.order);
    this.flight = this.flight.filter((f) => f.at > tick);
    return due.map((f) => f.msg);
  }

  private enqueue(msg: M, tick: number): void {
    const delay = 1 + this.rng.int(this.faults.maxDelay + 1);
    this.flight.push({ at: tick + delay, order: ++this.order, msg });
  }
}
