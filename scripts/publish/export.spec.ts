import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keptScripts, parseExclude } from './export.mjs';

describe('publish export', () => {
  it('reads one path per line and ignores comments, blanks and edge slashes', () => {
    expect(parseExclude('# head\n\nwork/\n/reference\nscripts/x.mjs # why\n')).toEqual([
      'work',
      'reference',
      'scripts/x.mjs',
    ]);
  });

  it('drops the package scripts that call an excluded path and keeps the rest', () => {
    const scripts = {
      land: 'scripts/orchestrate/land.sh',
      wp: 'node scripts/wp-status.mjs',
      test: 'node scripts/ops/vitest-scoped.mjs run',
      sbom: 'node scripts/sbom.mjs',
    };
    expect(keptScripts(scripts, ['scripts/orchestrate', 'scripts/wp-status.mjs'])).toEqual({
      test: scripts.test,
      sbom: scripts.sbom,
    });
  });

  it('a path is matched whole, not as a prefix of a longer name', () => {
    expect(keptScripts({ a: 'node scripts/metrics/report.mjs' }, ['metrics'])).toEqual({
      a: 'node scripts/metrics/report.mjs',
    });
    expect(keptScripts({ a: 'node scripts/workers.mjs' }, ['scripts/work'])).toEqual({
      a: 'node scripts/workers.mjs',
    });
  });

  it('the exclude list keeps the product: apps, packages and the Dockerfile are never listed', () => {
    const list = parseExclude(readFileSync(new URL('./exclude.txt', import.meta.url), 'utf8'));
    for (const kept of ['apps', 'packages', 'Dockerfile', 'scripts/ops', 'scripts/publish'])
      expect(list.some((p) => kept === p || kept.startsWith(`${p}/`))).toBe(false);
  });
});
