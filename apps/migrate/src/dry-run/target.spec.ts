/** The dry run stops at the `target` step when the converter gives no import project. */
import { describe, expect, it, vi } from 'vitest';
import type { ConvertResult } from '../config';

vi.mock('../config', async (importOriginal) => {
  const real = await importOriginal<
    Record<string, unknown> & { convertConfig: (v: unknown, o?: object) => ConvertResult }
  >();
  return {
    ...real,
    convertConfig: (v3: unknown, options?: { target?: 'import' }) => {
      const result = real.convertConfig(v3, options);
      return { ...result, target: undefined };
    },
  };
});

const { dryRun, dryRunFixture } = await import('./index');

describe('dry run without an import project', () => {
  it('fails at the target step and skips the rest', async () => {
    const result = await dryRun(dryRunFixture('baumkontrolle'));
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.step)).toEqual(['convert', 'diffcheck', 'target']);
    expect(result.steps[2]).toMatchObject({ ok: false });
    expect(result.steps[2]?.detail).toContain('no import project');
  });
});
