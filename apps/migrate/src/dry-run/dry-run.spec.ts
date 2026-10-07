/** WP-303 acceptance: the whole migration chain runs end to end on the synthetic fixtures. */
import { describe, expect, it } from 'vitest';
import { DRY_RUN_STEPS, dryRun, dryRunFixture, formatDryRun } from './index';

describe('dry run on the synthetic fixtures', () => {
  it('passes every step for baumkontrolle, in order', async () => {
    const result = await dryRun(dryRunFixture('baumkontrolle'));
    expect(result.steps.map((s) => s.step)).toEqual(DRY_RUN_STEPS.keys);
    expect(result.steps.filter((s) => !s.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('carries the fixture data into the project database', async () => {
    const result = await dryRun(dryRunFixture('baumkontrolle'));
    const migrate = result.steps.find((s) => s.step === 'migrate');
    const verify = result.steps.find((s) => s.step === 'verify');
    expect(migrate?.detail).toMatch(/\d+ runs accepted/);
    expect(verify?.detail).toMatch(/\d+ features/);
  });

  it('fails at the first bad step and skips the rest', async () => {
    const input = dryRunFixture('baumkontrolle');
    const result = await dryRun({ ...input, config: { format: 99 } });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ step: 'convert', ok: false });
  });

  it('fails the differential check when a run differs without explanation', async () => {
    const input = dryRunFixture('baumkontrolle');
    const runs = (input.runs as { recorded: { outcome: string; known?: unknown } }[]).map((r) => ({
      ...r,
      recorded: {
        ...r.recorded,
        known: undefined,
        outcome: r.recorded.outcome === 'accepted' ? 'refused' : 'accepted',
      },
    }));
    const result = await dryRun({ ...input, runs });
    expect(result.steps.find((s) => s.step === 'diffcheck')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('prints one line per step and a verdict', async () => {
    const text = formatDryRun(await dryRun(dryRunFixture('baumkontrolle')));
    for (const k of DRY_RUN_STEPS.keys) expect(text).toContain(k);
    expect(text).toMatch(/dry run passed/);
  });
});
