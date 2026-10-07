/**
 * Sync per version (WP-316, A-029): the same 60k-feature project served with 1 and with 3 live config versions.
 * Budgets (docs/12): snapshot of 60k features <= 20 s, empty delta p95 <= 10 ms, a change in the next delta <= 1 s.
 * With 3 live versions 2 x 3000 features are pinned to versions 1 and 2, the rest follows the deployed version 3; the
 * visibility predicate is a union of three per-version predicates (the same text per version, so only the union costs).
 * Run: npm test -- -c bench/vitest.config.ts bench/sync
 */
import { createVersionCache } from '../../packages/server/src/store/run/config-for';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { assertBudget, DOC_BUDGETS, defineBudget, report, type Budget } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import {
  compile,
  createGeo,
  TemplateFileSchema,
  type Actor,
  type CompiledConfig,
  type Key,
  type SyncPage,
} from '../../packages/core/src';
import { createSyncService } from '../../packages/server/src/sync';
import { goldenAssets } from '../../packages/core/src/testing/golden';
import { SYNC_PROTOCOL_VERSION } from '../../packages/core/src/sync/contract';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const NOW = '2026-05-01T08:00:00.000Z';
const vera: Actor = { id: 'vera', kind: 'participant', roles: ['verwaltung' as Key] };

function scopedConfig(): CompiledConfig {
  const parsed = TemplateFileSchema.parse(
    parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
  );
  const baum = parsed.types?.['baum'];
  if (!baum) throw new Error('template has no baum');
  const scoped = TemplateFileSchema.parse({
    ...parsed,
    types: {
      ...parsed.types,
      baum: {
        ...baum,
        permissions: {
          ...baum.permissions,
          visible_when: "self.zustaendig == actor.id || 'verwaltung' in actor.roles",
        },
      },
    },
  });
  const compiled = compile(scoped, { assets: goldenAssets });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  return compiled.config;
}

describe('bench: sync per version', () => {
  it('snapshot, empty delta and a 100-row delta at 60k features with 1 and 3 live versions', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const configs = new Map<number, CompiledConfig>([1, 2, 3].map((v) => [v, scopedConfig()] as const));
    const service = createSyncService(db, {
      config: () => ({ version: 3, config: configs.get(3) as CompiledConfig }),
      at: (v) => configs.get(v),
      versions: createVersionCache((v) => configs.get(v)),
      clock: { now: () => NOW },
      geo: createGeo(),
    });
    const owner = db
      .prepare<{ who: string }>(
        `SELECT json_extract(properties, '$.zustaendig') AS who FROM features
         WHERE type = 'baum' AND who IS NOT NULL GROUP BY who ORDER BY count(*) DESC, who LIMIT 1`,
      )
      .get();
    if (!owner) throw new Error('no assigned trees in the bench data');
    const anna: Actor = { id: owner.who, kind: 'participant', roles: ['kontrolle' as Key] };

    const snapshot = (): { rows: number; seconds: number } => {
      const t0 = performance.now();
      let rows = 0;
      let pin: number | undefined;
      let after = 0;
      let scope = '';
      for (;;) {
        const page: SyncPage = service.page(vera, {
          since: 0,
          scope,
          v: SYNC_PROTOCOL_VERSION,
          ...(pin === undefined ? {} : { after, pin }),
        });
        scope = page.header.scopeFingerprint;
        pin = page.header.head;
        after = page.header.cursor;
        rows += page.features.length;
        if (!page.header.more) break;
      }
      return { rows, seconds: (performance.now() - t0) / 1000 };
    };

    const measure = (label: string, live: number): void => {
      expect(
        service.page(vera, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION, limit: 1 }).header.versions.live,
      ).toHaveLength(live);
      snapshot(); // warm-up: the page cache and the prepared statements, so 1 and 3 versions meet the same conditions
      const snap = snapshot();
      const annaScope = service.page(anna, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION, limit: 1 }).header
        .scopeFingerprint;
      const head = service.head();
      const empties: number[] = [];
      for (let i = 0; i < 20; i++)
        service.page(anna, { since: head, scope: annaScope, v: SYNC_PROTOCOL_VERSION });
      for (let i = 0; i < 400; i++) {
        const t = performance.now();
        service.page(anna, { since: head, scope: annaScope, v: SYNC_PROTOCOL_VERSION });
        empties.push(performance.now() - t);
      }
      // ~100 changed features in the window (head - 150, head]: touch them as a run would, then pull the delta.
      db.prepare(
        `UPDATE features SET updated_seq = ? - rowid % 100 WHERE rowid IN
         (SELECT rowid FROM features WHERE type = 'baum' ORDER BY rowid LIMIT 100)`,
      ).run(head);
      for (let i = 0; i < 5; i++)
        service.page(vera, { since: head - 150, scope: '', v: SYNC_PROTOCOL_VERSION });
      const deltas: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        service.page(vera, { since: head - 150, scope: '', v: SYNC_PROTOCOL_VERSION });
        deltas.push(performance.now() - t);
      }
      const empty = p95(empties);
      const delta = p95(deltas);
      console.log(
        `sync ${label}: live ${live}, snapshot ${snap.rows} features ${snap.seconds.toFixed(1)} s, empty delta p95 ${empty.toFixed(2)} ms, 100-row delta p95 ${delta.toFixed(1)} ms`,
      );
      expect(snap.rows).toBeGreaterThanOrEqual(60_000);
      assertBudget(
        report(
          defineBudget({
            id: `sync-snapshot-60k-${live}v`,
            limit: 20,
            unit: 's',
            derivedFrom: `snapshot-60k: ${live} live config version(s)`,
            device: 'server',
          }),
          Number(snap.seconds.toFixed(1)),
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: `sync-empty-delta-${live}v`,
            limit: (DOC_BUDGETS['empty-delta-p95'] as Budget).limit,
            unit: 'ms',
            derivedFrom: `empty-delta-p95: ${live} live config version(s)`,
            device: 'server',
          }),
          Number(empty.toFixed(2)),
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: `sync-delta-100-${live}v`,
            limit: 1000,
            unit: 'ms',
            derivedFrom: `delta-visible: a delta of 100 rows, ${live} live config version(s)`,
            device: 'server',
          }),
          Number(delta.toFixed(1)),
        ),
      );
    };

    measure('zero pins', 1);
    db.prepare('UPDATE features SET pinned_version = 1 WHERE rowid % 20 = 0').run();
    db.prepare('UPDATE features SET pinned_version = 2 WHERE rowid % 20 = 1').run();
    measure('2 x 3000 pinned', 3);
    db.close();
  }, 600_000);
});
