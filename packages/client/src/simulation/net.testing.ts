/**
 * Seeded faults around a transport call: lost requests, lost replies (the server applied, the device did not
 * hear), duplicates and late duplicates (a stale copy that reaches the server after newer runs), and offline
 * periods. Every decision comes from the seeded `Rng`, in call order, so a run replays exactly.
 */
import type { NetworkFaults, Rng } from '@ueberblick/core/testing';

/** What the simulated wire throws. Anything else that escapes a transport is a bug and fails the run. */
export class NetworkFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkFault';
  }
}

/** One device's connection: while `online` is false every call fails before it leaves the device. */
export interface Link {
  online: boolean;
}

export interface FaultStats {
  requestsLost: number;
  repliesLost: number;
  duplicates: number;
  lateDuplicates: number;
}

interface Late {
  readonly due: number;
  readonly send: () => Promise<unknown>;
}

export const NO_FAULTS: NetworkFaults = { drop: 0, duplicate: 0, maxDelay: 0 };

export class Faults {
  readonly stats: FaultStats = { requestsLost: 0, repliesLost: 0, duplicates: 0, lateDuplicates: 0 };
  private late: Late[] = [];

  constructor(
    private readonly rng: Rng,
    public faults: NetworkFaults,
    private readonly tick: () => number,
  ) {}

  /**
   * `send` reaches the server and answers. `replayable` calls (run submits) may arrive a second time; a pull
   * is a read, so a duplicate of it changes nothing and is not modelled.
   */
  async call<T>(link: Link, send: () => Promise<T>, replayable: boolean): Promise<T> {
    if (!link.online) throw new NetworkFault('offline');
    if (this.rng.chance(this.faults.drop / 2)) {
      this.stats.requestsLost++;
      throw new NetworkFault('request lost');
    }
    const answer = await send();
    if (replayable && this.rng.chance(this.faults.duplicate)) {
      this.stats.duplicates++;
      if (this.faults.maxDelay > 0 && this.rng.chance(0.5)) {
        this.stats.lateDuplicates++;
        this.late.push({ due: this.tick() + 1 + this.rng.int(this.faults.maxDelay * 3), send });
      } else await send();
    }
    if (this.rng.chance(this.faults.drop / 2)) {
      this.stats.repliesLost++;
      throw new NetworkFault('reply lost');
    }
    return answer;
  }

  /** Delivers the late duplicates that are due (`all`: every one, as the network heals). Their answers go nowhere. */
  async deliverLate(all = false): Promise<void> {
    const now = this.tick();
    const due = this.late.filter((l) => all || l.due <= now);
    this.late = this.late.filter((l) => !due.includes(l));
    for (const l of due) await l.send();
  }
}
