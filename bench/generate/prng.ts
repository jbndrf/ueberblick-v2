/** Seeded randomness and ids for the generator. The same seed gives the same sequence, always. */
import { rng } from '../geo/data';

export interface Random {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
  /** Standard normal, Box-Muller. */
  gauss(): number;
  /** UUIDv7-shaped id: `ms` in the time field, seeded bits elsewhere. */
  uuid7(ms: number): string;
}

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

export function createRandom(seed: number): Random {
  const next = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (xs) => xs[Math.floor(next() * xs.length)] as (typeof xs)[number],
    gauss: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    uuid7(ms) {
      const time = hex(ms, 12);
      const a = hex(int(0, 0xfff), 3);
      const b = hex(0x8 + int(0, 3), 1) + hex(int(0, 0xfff), 3);
      const c = hex(int(0, 0xffffff), 6) + hex(int(0, 0xffffff), 6);
      return `${time.slice(0, 8)}-${time.slice(8)}-7${a}-${b}-${c}`;
    },
  };
}
