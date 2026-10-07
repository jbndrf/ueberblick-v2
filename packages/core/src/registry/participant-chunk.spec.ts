import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WP-815: the participant shell imports core subpaths (`export *` of the registry barrel in bench/shell-size).
// Compile-time, admin and server tables live in their own modules and subpaths, so the barrel never bundles them.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const OUT_OF_BARREL = [
  'compile',
  'expr-errors',
  'import',
  'map-tile-upload',
  'tile-proxy',
  'packs',
  'versions',
  'template',
  'filter-clauses',
  'filters',
  'tool-options',
  'system-tasks',
] as const;

describe('registry barrel keeps compile-time and admin tables out of the participant chunk', () => {
  const barrel = read('./index.ts');
  it.each(OUT_OF_BARREL)('does not re-export ./%s', (mod) => {
    expect(barrel).not.toContain(`from './${mod}'`);
  });
  it('does not re-export the import wizard', () => {
    expect(barrel).not.toContain("from '../import'");
  });
  it('the pattern problem tables stay out of the barrel; only their key types come in (WP-858)', () => {
    expect(read('./index.ts')).toContain(
      "export type { MatchesSyntaxProblem, MatchesUnsupportedFeature } from './expr-matches-problems'",
    );
    expect(read('./index.ts')).not.toMatch(/export \{[^}]*MATCHES_(SYNTAX|UNSUPPORTED)/);
  });
  it('the system task table (descriptions) is admin-only; the barrel keeps only the keys (WP-858)', () => {
    expect(read('./admin.ts')).toContain("from './system-tasks'");
    expect(read('./index.ts')).toContain("from './system-task-keys'");
    expect(read('./system-task-keys.ts')).not.toMatch(/description/);
  });
  it('every system task key has a table entry and the other way round', async () => {
    const { SYSTEM_TASKS } = await import('./admin');
    const { SYSTEM_TASK_KEYS } = await import('./system-task-keys');
    expect(SYSTEM_TASKS.entries.map((e) => e.key).sort()).toEqual([...SYSTEM_TASK_KEYS].sort());
  });
  it('the subpath files re-export what they took', () => {
    for (const file of ['admin', 'filter', 'tools'])
      expect(read(`./${file}.ts`)).toMatch(/from '\.\/[a-z-]+'/);
  });
  it('the participant bench entry imports no compile-time or admin subpath', () => {
    const entry = read('../../../../bench/shell-size/participant-entry.ts');
    expect(entry).not.toMatch(/registry\/(compile|expr-errors|admin)/);
  });
});
