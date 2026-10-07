/** Loads `profiles.yaml` and turns a profile and a seed into simulation options. */
import { z } from 'zod';
import { goldenYaml } from '../../../packages/core/src/testing';
import type { RealSimOptions } from '../../../packages/client/src/simulation/contract.testing';

const Rate = z.number().min(0).max(1);
const Profile = z.strictObject({
  seeds: z.number().int().positive(),
  devices: z.number().int().positive(),
  runsPerDevice: z.number().int().positive(),
  faults: z.strictObject({ drop: Rate, duplicate: Rate, maxDelay: z.number().int().min(0) }),
  offlineFlip: Rate,
  restart: Rate,
  runRate: Rate,
  adminRate: Rate,
  batchRate: Rate,
});
const Profiles = z.strictObject({
  short: Profile,
  check: Profile,
  long: Profile,
  regressions: z.array(z.number().int()),
});

export type ProfileName = 'short' | 'check' | 'long';
const file = Profiles.parse(goldenYaml('simulation/profiles.yaml'));

export const REGRESSION_SEEDS: readonly number[] = file.regressions;

/** Seeds 1..N of the profile. */
export const seedsOf = (name: ProfileName): number[] =>
  Array.from({ length: file[name].seeds }, (_, i) => i + 1);

export function optionsFor(name: ProfileName, seed: number): RealSimOptions {
  const { seeds: _seeds, ...shape } = file[name];
  return { seed, ...shape };
}
