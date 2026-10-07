import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('serial bench run (WP-921)', () => {
  it('the bench config switches file parallelism off', async () => {
    const { default: cfg } = await import('../vitest.config');
    expect((cfg as { test?: { fileParallelism?: boolean } }).test?.fileParallelism).toBe(false);
  });

  it('two bench files never overlap, and the summary records the duration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-serial-'));
    const config = join(dir, 'vitest.config.mjs');
    const times = join(dir, 'times.jsonl');
    writeFileSync(times, '');
    // The fixtures take fileParallelism from the real bench config, so this proves the shipped setting works.
    writeFileSync(
      config,
      `import real from ${JSON.stringify(join(root, 'bench/vitest.config.ts'))};
export default { root: ${JSON.stringify(root)}, test: { fileParallelism: real.test.fileParallelism,
  include: ['bench/harness/fixtures/serial-*.fake.ts'] } };`,
    );
    const outDir = join(dir, 'out');
    const res = spawnSync(
      'node',
      ['bench/harness/cli.mjs', '--config', config, '--out-dir', outDir, '--date', '2026-01-02'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, BENCH_TIMES: times } },
    );
    expect(res.stdout).toContain('Suite duration');
    const spans = readFileSync(times, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { start: number; end: number })
      .sort((x, y) => x.start - y.start);
    expect(spans).toHaveLength(2);
    const [first, second] = spans;
    expect(second?.start).toBeGreaterThanOrEqual(first?.end ?? Infinity);
    const result = JSON.parse(readFileSync(join(outDir, '2026-01-02.json'), 'utf8')) as { durationMs: number };
    expect(result.durationMs).toBeGreaterThan(0);
  });
});
