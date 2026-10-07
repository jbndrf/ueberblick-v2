/**
 * A failing seed prints a minimal reproduction: the same seed with the fewest devices and runs, and the fewest
 * fault kinds, that still break the same invariant, as a command line (`SIM_SEED=17 SIM_DEVICES=2 ... npm run sim`).
 * Shrinking is greedy: every candidate is a full simulation, and a candidate is kept when its first violation is
 * of the same invariant as the original.
 */
import type { RealSimOptions, RealSimReport } from './contract.testing';

export type RunSim = (options: RealSimOptions) => Promise<RealSimReport>;

export interface Shrunk {
  readonly options: RealSimOptions;
  readonly report: RealSimReport;
  /** Simulations run while shrinking. */
  readonly attempts: number;
}

/** The knobs that can be zeroed, in the order they are tried. */
const OFF: readonly (readonly [string, (o: RealSimOptions) => RealSimOptions])[] = [
  ['admin batches', (o) => ({ ...o, adminRate: 0 })],
  ['device batches', (o) => ({ ...o, batchRate: 0 })],
  ['restarts', (o) => ({ ...o, restart: 0 })],
  ['offline periods', (o) => ({ ...o, offlineFlip: 0 })],
  ['late duplicates', (o) => ({ ...o, faults: { ...o.faults, maxDelay: 0 } })],
  ['duplicates', (o) => ({ ...o, faults: { ...o.faults, duplicate: 0 } })],
  ['losses', (o) => ({ ...o, faults: { ...o.faults, drop: 0 } })],
];

const MAX_ATTEMPTS = 60;

const firstInvariant = (r: RealSimReport): string | undefined => r.violations[0]?.invariant;

export async function shrink(run: RunSim, failing: RealSimReport): Promise<Shrunk> {
  const want = firstInvariant(failing);
  let best: Shrunk = { options: failing.options, report: failing, attempts: 0 };
  let attempts = 0;
  const tryOptions = async (candidate: RealSimOptions): Promise<boolean> => {
    if (attempts >= MAX_ATTEMPTS) return false;
    attempts++;
    const report = await run(candidate);
    if (firstInvariant(report) !== want) return false;
    best = { options: candidate, report, attempts };
    return true;
  };
  const smaller = (n: number): number[] => (n > 2 ? [Math.ceil(n / 2), n - 1] : n > 1 ? [n - 1] : []);

  let progress = true;
  while (progress && attempts < MAX_ATTEMPTS) {
    progress = false;
    const cur = best.options;
    for (const n of smaller(cur.runsPerDevice))
      if (await tryOptions({ ...cur, runsPerDevice: n })) {
        progress = true;
        break;
      }
    if (progress) continue;
    for (const n of smaller(cur.devices))
      if (await tryOptions({ ...cur, devices: n })) {
        progress = true;
        break;
      }
    if (progress) continue;
    for (const [, off] of OFF) {
      const next = off(cur);
      if (JSON.stringify(next) !== JSON.stringify(cur) && (await tryOptions(next))) {
        progress = true;
        break;
      }
    }
  }
  return { ...best, attempts };
}

/** The environment variables `npm run sim` reads, so a printed reproduction is a command line. */
export function toEnv(o: RealSimOptions): Record<string, string> {
  return {
    SIM_SEED: String(o.seed),
    SIM_DEVICES: String(o.devices),
    SIM_RUNS: String(o.runsPerDevice),
    SIM_DROP: String(o.faults.drop),
    SIM_DUPLICATE: String(o.faults.duplicate),
    SIM_DELAY: String(o.faults.maxDelay),
    SIM_OFFLINE: String(o.offlineFlip),
    SIM_RESTART: String(o.restart),
    SIM_RATE: String(o.runRate),
    SIM_ADMIN: String(o.adminRate),
    SIM_BATCH: String(o.batchRate),
  };
}

const num = (env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} is not a number: ${raw}`);
  return n;
};

/** Options for one run: `base` with the `SIM_*` variables applied (`toEnv` is the inverse). */
export function fromEnv(
  base: RealSimOptions,
  env: Readonly<Record<string, string | undefined>>,
): RealSimOptions {
  return {
    ...base,
    seed: num(env, 'SIM_SEED', base.seed),
    devices: num(env, 'SIM_DEVICES', base.devices),
    runsPerDevice: num(env, 'SIM_RUNS', base.runsPerDevice),
    faults: {
      drop: num(env, 'SIM_DROP', base.faults.drop),
      duplicate: num(env, 'SIM_DUPLICATE', base.faults.duplicate),
      maxDelay: num(env, 'SIM_DELAY', base.faults.maxDelay),
    },
    offlineFlip: num(env, 'SIM_OFFLINE', base.offlineFlip),
    restart: num(env, 'SIM_RESTART', base.restart),
    runRate: num(env, 'SIM_RATE', base.runRate),
    adminRate: num(env, 'SIM_ADMIN', base.adminRate),
    batchRate: num(env, 'SIM_BATCH', base.batchRate),
  };
}

/** What a failing seed prints. */
export function formatRepro(original: RealSimReport, shrunk: Shrunk): string {
  const o = original.options;
  const m = shrunk.options;
  const command = `${Object.entries(toEnv(m))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')} npm run sim`;
  const first = shrunk.report.violations[0];
  return [
    `simulation failed: seed ${original.seed}, ${original.violations.length} violation(s), first ${first?.invariant ?? 'none'}`,
    `  ${first?.detail ?? ''}`,
    `minimal reproduction (${o.devices} devices x ${o.runsPerDevice} runs shrunk to ${m.devices} x ${m.runsPerDevice} in ${shrunk.attempts} attempts):`,
    `  ${command}`,
  ].join('\n');
}

/** Shrinks a failing report and throws an error whose message is the reproduction. Returns for a passing one. */
export async function failWithRepro(run: RunSim, report: RealSimReport): Promise<void> {
  if (report.violations.length === 0) return;
  const shrunk = await shrink(run, report);
  throw new Error(formatRepro(report, shrunk));
}
