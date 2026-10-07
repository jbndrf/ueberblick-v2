/**
 * Budget (docs/12, WP-112): deploy of the largest template <= 2 s. The golden templates do not
 * compile yet (fixture/compiler mismatches), so the stand-in is the 500-entity file of the compile
 * benchmark with an index on every type. Run: npm test -- -c bench/vitest.config.ts bench/deploy
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import type { TemplateFile } from '../../packages/core/src/schema/file';
import { openProjectDb } from '../../packages/server/src/db/open';
import { deploy } from '../../packages/server/src/deploy';
import { generate } from '../compile/generate';

const file = generate();
for (const t of Object.values(file.types ?? {})) t.properties['wert'] = { type: 'integer', index: true };
const clock = { now: () => '2026-09-29T10:00:00Z' };

describe('deploy of a 500-entity file with 100 indexes', () => {
  it('deploys in <= 2 s; the same file again is cheaper', () => {
    const db = openProjectDb(':memory:', 'bench');
    let t = performance.now();
    const r = deploy(db, file, 'bench', { clock });
    const first = performance.now() - t;
    if (!r.ok) throw new Error(`bench file must deploy: ${JSON.stringify(r.problems.slice(0, 3))}`);
    t = performance.now();
    deploy(db, file, 'bench', { clock });
    const again = performance.now() - t;
    const changed: TemplateFile = structuredClone(file);
    for (const t of Object.values(changed.types ?? {})) t.label = 'Geaendert';
    t = performance.now();
    deploy(db, changed, 'bench', { clock });
    const second = performance.now() - t;
    console.info(
      `deploy: first ${first.toFixed(0)} ms, same file ${again.toFixed(0)} ms, changed ${second.toFixed(0)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'deploy-500',
          limit: 2000,
          unit: 'ms',
          derivedFrom: 'compile once (docs/12 rules of thumb): deploy is not a hot path, no row of its own',
          device: 'server',
        }),
        Math.round(Math.max(first, second)),
      ),
    );
  });
});
