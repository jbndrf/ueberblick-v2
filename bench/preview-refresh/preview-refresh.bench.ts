/**
 * Budget (WP-341): a preview refresh (parse the draft, plan, compile, deploy into the preview store) of the largest
 * template stand-in (the 500-entity file of the compile benchmark, an index on every type) <= 2 s, like the deploy it
 * wraps. The debounce (1 s, coalesced per project) keeps typing from deploying more than once a second.
 * Run: npm test -- -c bench/vitest.config.ts bench/preview-refresh
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createProject } from '../../packages/server/src/admin/bootstrap';
import { createAuth } from '../../packages/server/src/auth';
import { seedDraft } from '../../packages/server/src/builder-draft';
import { openControlDb, openProjectDb, openProjectDbFile } from '../../packages/server/src/db/open';
import { createPreviewRefresher, ensurePreview, previewDbPath } from '../../packages/server/src/preview';
import { generate } from '../compile/generate';

const template = generate();
for (const t of Object.values(template.types ?? {})) t.properties['wert'] = { type: 'integer', index: true };
const clock = { now: () => '2026-10-01T10:00:00Z' };
const overlay = (extra: object = {}): string =>
  stringify({ schema: 'ueberblick/1', extends: 'bench@1', ...extra });

describe('bench: preview refresh', () => {
  it('refreshes the preview of a 500-entity template in <= 2 s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-bench-preview-'));
    try {
      const control = openControlDb(':memory:');
      const project = createProject(control, { key: 'bench', name: 'Bench' }, clock);
      const real = openProjectDb(':memory:', 'bench');
      seedDraft(real, {
        template: 'bench',
        templateVersion: '1.0.0',
        overlay: overlay(),
        by: 'a',
        at: clock.now(),
      });
      const preview = openProjectDbFile(previewDbPath(dir, 'bench'));
      const refresher = createPreviewRefresher({
        control,
        clock,
        auth: createAuth({ control, now: () => new Date(clock.now()), participantRoles: () => [] }),
        templates: { resolve: () => template },
        project: () => project,
        draftDb: () => real,
        ensurePreview: (id) => ensurePreview(control, dir, id, clock),
        previewDb: () => preview,
        afterDeploy: () => undefined,
        schedule: () => () => undefined,
      });
      let t = performance.now();
      expect(refresher.refreshPreview('bench').status).toBe('ready');
      const first = performance.now() - t;
      const firstType = Object.keys(template.types ?? {})[0] ?? '';
      real
        .prepare('UPDATE builder_draft SET overlay = ?')
        .run(overlay({ override: { [`types.${firstType}.label`]: { de: 'Geaendert' } } }));
      t = performance.now();
      expect(refresher.refreshPreview('bench').status).toBe('ready');
      const changed = performance.now() - t;
      console.info(`preview refresh: first ${first.toFixed(0)} ms, changed draft ${changed.toFixed(0)} ms`);
      assertBudget(
        report(
          defineBudget({
            id: 'preview-refresh-500',
            limit: 2000,
            unit: 'ms',
            derivedFrom:
              'one deploy (budget deploy-500, <= 2 s) plus a plan; runs off the request path, debounced to one per second per project',
            device: 'server',
          }),
          Math.round(Math.max(first, changed)),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
