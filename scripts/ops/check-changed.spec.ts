import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kindOf } from './check-recorded.mjs';
import { isRerunTrigger } from './rerun-triggers.mjs';

// WP-935: `npm run check:changed` = check:fast + boundaries + the tests whose import graph reaches a file
// changed against local main. It never counts as a full check, and files read by path rerun everything.
const root = fileURLToPath(new URL('../..', import.meta.url));
const scripts = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts;
const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8');

describe('check:changed (WP-935)', () => {
  it('runs check:fast, boundaries and the affected tests through the gate and the step runner', () => {
    expect(scripts['check:changed']).toMatch(
      /^scripts\/ops\/check-gate\.sh node scripts\/ops\/steps\.mjs --parallel --fail-fast --before typecheck:gen changed check:fast:scoped boundaries test:changed$/,
    );
  });

  it('selects tests against local main (no remote needed) and passes when nothing is affected', () => {
    expect(scripts['test:changed']).toBe(
      'node scripts/metrics/test-record.mjs --changed main --passWithNoTests',
    );
  });

  it('test-record plans its vitest command from the merge-base selection (WP-955)', () => {
    const record = readFileSync(join(root, 'scripts/metrics/test-record.mjs'), 'utf8');
    expect(record).toContain('vitestArgs(process.argv.slice(2), process.cwd())');
  });

  it('is recorded as scoped, so check-recorded never reuses it as a full check', () => {
    expect(kindOf(['--changed', 'main', '--passWithNoTests'], { UEB_GATE_HELD: 'slot.1:1' })).toBe('scoped');
  });

  it('vitest takes its rerun triggers from the shared list, anchored at the repository root', () => {
    expect(config).toContain('forceRerunTriggers: rerunTriggers(');
  });

  // Agent worktrees live under .claude/worktrees/: a bare leading `**` would never cross that dot directory.
  describe.each(['/home/u/repo', '/home/u/repo/.claude/worktrees/agent-a1b2'])(
    'in a checkout at %s',
    (base) => {
      it.each([
        'package-lock.json',
        'vitest.config.ts',
        'apps/web/vite.config.ts',
        'packages/ui/tsconfig.json',
        'scripts/ops/resources.mjs',
      ])('a change to %s reruns every test', (file) => {
        expect(isRerunTrigger(base, `${base}/${file}`)).toBe(true);
      });

      it.each([
        'packages/core/src/geo/bbox.ts',
        'packages/builder/src/lenses/yaml/complete.ts',
        'docs/user/index.md',
        'scripts/ops/steps.mjs',
        'packages/ui/messages/de.json',
        'docs/process/lead-loop.md',
        '.claude/agents/implementer.md',
        'CLAUDE.md',
        'docs/12-performance-budgets.md',
        '.dependency-cruiser.cjs',
        'eslint.config.js',
        '.prettierrc',
        '.prettierignore',
        'schema/x.json',
        'fixtures/golden/templates/baum.yaml',
        'package.json',
        'packages/ui/package.json',
        // WP-1006: bench configs do not shape the normal test run (bench:test loads them)
        'bench/geo/vitest.config.ts',
        'bench/harness/vitest.config.ts',
        'bench/vitest.config.ts',
        // no spec reads it by path; hooks.server.spec.ts imports it, so the graph finds it (was a blanket trigger)
        'apps/web/src/hooks.server.ts',
      ])('a change to %s selects by import graph', (file) => {
        expect(isRerunTrigger(base, `${base}/${file}`)).toBe(false);
      });
    },
  );
});
