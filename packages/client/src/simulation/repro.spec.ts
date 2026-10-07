import { describe, expect, it } from 'vitest';
import type { RealSimOptions, RealSimReport } from './contract.testing';
import { failWithRepro, formatRepro, fromEnv, shrink, toEnv } from './repro.testing';

const BIG: RealSimOptions = {
  seed: 17,
  devices: 20,
  runsPerDevice: 500,
  faults: { drop: 0.15, duplicate: 0.15, maxDelay: 4 },
  offlineFlip: 0.08,
  restart: 0.02,
  runRate: 0.7,
  adminRate: 0.05,
  batchRate: 0.05,
};

/** A simulation stand-in that breaks convergence whenever there are >= 3 devices, >= 7 runs each and losses. */
const fake = (options: RealSimOptions): Promise<RealSimReport> =>
  Promise.resolve({
    seed: options.seed,
    options,
    digest: '',
    stats: {} as RealSimReport['stats'],
    violations:
      options.devices >= 3 && options.runsPerDevice >= 7 && options.faults.drop > 0
        ? [{ invariant: 'convergence', detail: 'device 2: features differ from a fresh snapshot' }]
        : [],
  });

describe('shrinking a failing seed', () => {
  it('finds the smallest devices x runs that still fail, and drops the faults that are not needed', async () => {
    const failing = await fake(BIG);
    const shrunk = await shrink(fake, failing);
    expect(shrunk.options.devices).toBe(3);
    expect(shrunk.options.runsPerDevice).toBe(7);
    expect(shrunk.options.faults.drop).toBeGreaterThan(0); // needed
    expect(shrunk.options.faults.duplicate).toBe(0);
    expect(shrunk.options.faults.maxDelay).toBe(0);
    expect(shrunk.options.restart).toBe(0);
    expect(shrunk.options.offlineFlip).toBe(0);
    expect(shrunk.options.adminRate).toBe(0);
    expect(shrunk.options.batchRate).toBe(0);
    expect(shrunk.report.violations[0]?.invariant).toBe('convergence');
    expect(shrunk.attempts).toBeLessThan(60);
  });

  it('keeps the invariant: a candidate that fails another way is not a reduction', async () => {
    const other = (o: RealSimOptions): Promise<RealSimReport> =>
      fake(o).then((r) =>
        o.devices < 10 ? { ...r, violations: [{ invariant: 'quiescence', detail: 'never quiet' }] } : r,
      );
    const failing = await other(BIG);
    const shrunk = await shrink(other, failing);
    expect(shrunk.options.devices).toBeGreaterThanOrEqual(10);
  });

  it('prints seed, sizes and a command that reads back to the same options', async () => {
    const failing = await fake(BIG);
    const shrunk = await shrink(fake, failing);
    const text = formatRepro(failing, shrunk);
    expect(text).toContain('seed 17');
    expect(text).toContain('20 devices x 500 runs shrunk to 3 x 7');
    const command = text.split('\n').find((l) => l.includes('npm run sim')) as string;
    const env = Object.fromEntries(
      command
        .trim()
        .replace(' npm run sim', '')
        .split(' ')
        .map((kv) => kv.split('=') as [string, string]),
    );
    expect(fromEnv(BIG, env)).toEqual(shrunk.options);
    expect(fromEnv(BIG, toEnv(BIG))).toEqual(BIG);
  });

  it('failWithRepro throws the reproduction for a failing report and returns for a passing one', async () => {
    await expect(failWithRepro(fake, await fake(BIG))).rejects.toThrow(/SIM_SEED=17 .* npm run sim/);
    await expect(failWithRepro(fake, await fake({ ...BIG, devices: 1 }))).resolves.toBeUndefined();
  });

  it('a variable that is not a number is refused, never read as zero', () => {
    expect(() => fromEnv(BIG, { SIM_DEVICES: 'many' })).toThrow(/SIM_DEVICES/);
  });
});
